-- ════════════════════════════════════════════════════════════════════════
-- scheduler-edge-parity feature — E1e: revert handlers for legacy uploaders
-- ════════════════════════════════════════════════════════════════════════
--
-- Creates 5 per-snapshot_kind revert handlers for the 5 LEGACY uploaders
-- being refactored to Pattern S in E5a-e:
--
--   1. revert_concern_questions_flat       (snapshot_kind = 'concern_questions_flat')
--        soft-deletes added; UPSERT for before; BIGSERIAL PK
--   2. revert_concern_category_upload      (snapshot_kind = 'concern_questions_per_category')
--        BOTH tables (concern_subcategories + concern_questions) for ONE category
--        soft-deletes added; UPSERT for before
--        snapshot field names per E1b-N1: subcategories_before,
--        added_subcategory_ids, questions_before, added_question_ids
--   3. revert_concern_category_guideline   (snapshot_kind = 'concern_category_guidelines')
--        HARD DELETE added (composite PK shop_id, category); UPSERT for before
--   4. revert_appointment_default_limits   (snapshot_kind = 'appointment_default_limits')
--        HARD DELETE added (composite PK shop_id, day_of_week); UPSERT for before
--   5. revert_closed_dates_future          (snapshot_kind = 'closed_dates_future')
--        CONDITIONAL HARD DELETE — only future dates; UPSERT for before (future)
--        populates details JSONB with skipped_past_dates_*
--
-- ────────────────────────────────────────────────────────────────────────
-- Cross-references:
-- ────────────────────────────────────────────────────────────────────────
--   ADR-004 — universal return shape (restored/deactivated/deleted/details).
--             Handler 5 (closed_dates_future) is the only handler that
--             populates `details` — with skipped_past_dates_restore /
--             skipped_past_dates_delete arrays per past-date immutability.
--             Other 4 handlers always set details='{}'::JSONB.
--   ADR-005 — internal set: NO GRANT to service_role (R6-B1 explicit).
--   ADR-007 — canonical reason_code enum (cross_shop_hijack_attempt,
--             fk_target_tenant_mismatch, fk_broken, snapshot_invalid).
--   ADR-008 — classifier maps fk_target_tenant_mismatch → fk_broken.
--   ADR-013 — closed_dates per-date advisory lock pattern. Handler 5 does
--             NOT take advisory locks itself (inner RPC step 4 already
--             called lock_targets_for_kind which acquired them per Phase 2
--             closed_dates_future branch). Documented here for symmetry
--             with apply_closed_dates_upload (E1f) which DOES take them.
--   ADR-015 — absent-key TOCTOU residual (open on 4 non-closed_dates
--             surfaces — Phase 1.5 SEC-15 fix deferred). For hard-DELETE
--             of added_keys, the WHERE shop_id = p_shop_id clause is
--             belt-and-suspenders to bound the blast radius if a tampered
--             added_keys entry points at a foreign-shop row.
--   ADR-017 — search_path on every SECURITY DEFINER function.
--   ADR-019 — Invariants 1+5+6:
--               Inv 1: WHERE target.shop_id = p_shop_id on DO UPDATE
--               Inv 5: post-write ROW_COUNT vs expected
--               Inv 6: ONLY revert_concern_category_upload has FKs to
--                      validate (questions_before rows carry subcategory_id
--                      FK → concern_subcategories.id). Other 4 handlers
--                      have no FK columns to validate (Inv 6 = no-op).
--   ADR-024 — lock_targets_for_kind acquired by inner RPC step 4 BEFORE
--             this handler is called.
--
-- R6-B1 — explicit REVOKE FROM service_role on EVERY handler.
-- E1b-N1 — concern_category_upload snapshot field names are EXACT
--          per E1b dispatch's lock_targets_for_kind Kind 7 branch:
--          subcategories_before, added_subcategory_ids, questions_before,
--          added_question_ids. E5e author MUST populate these EXACT names.
--
-- ════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════
-- HANDLER 1 of 5 — revert_concern_questions_flat
-- ════════════════════════════════════════════════════════════════════════
-- Mutation surface: concern_questions table for (p_shop_id) — flat shape
-- Snapshot keys:    BIGSERIAL ids (concern_questions.id)
-- Apply path:       NEW apply_concern_questions_flat_upload (E1f)
-- Canonical mirror: canonical_state_concern_questions_flat (E1b dispatch)
--
-- Snapshot shape:
--   { snapshot_kind: 'concern_questions_flat',
--     before:      { '<id>': {row...}, ... },
--     added_keys:  ['<id>', ...] }
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.revert_concern_questions_flat(
  p_shop_id  INTEGER,
  p_snapshot JSONB
) RETURNS TABLE(restored INT, deactivated INT, deleted INT, details JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_before          JSONB;
  v_added_keys      JSONB;
  v_added_id_arr    BIGINT[];
  v_expected_writes INTEGER := 0;
  v_actual_writes   INTEGER := 0;
  v_actual_deact    INTEGER := 0;
  v_fk_referenced   INTEGER := 0;
  v_fk_resolved     INTEGER := 0;
BEGIN
  IF p_snapshot IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_concern_questions_flat received NULL p_snapshot'
      USING ERRCODE = '22023';
  END IF;

  v_before     := COALESCE(p_snapshot->'before',     '{}'::JSONB);
  v_added_keys := COALESCE(p_snapshot->'added_keys', '[]'::JSONB);

  IF jsonb_typeof(v_before) <> 'object' THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_concern_questions_flat snapshot.before must be JSONB object'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_added_keys) <> 'array' THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_concern_questions_flat snapshot.added_keys must be JSONB array'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_expected_writes
    FROM jsonb_each(v_before);

  -- Subquery-alias pattern per E1b dispatch canonical idiom
  SELECT ARRAY(
    SELECT v::BIGINT FROM (
      SELECT jsonb_array_elements_text(v_added_keys) AS v
    ) k
    WHERE v IS NOT NULL AND v <> ''
  ) INTO v_added_id_arr;

  -- ── Invariant 6: FK target tenant validation ────────────────────────
  -- concern_questions.subcategory_id → concern_subcategories.id
  -- Validate every DISTINCT subcategory_id referenced in v_before rows
  -- resolves in caller's tenant (cross-tenant FK target = tampered snap).
  SELECT count(DISTINCT (val->>'subcategory_id')),
         (SELECT count(DISTINCT cs.id)
            FROM jsonb_each(v_before) AS s(key, val)
            JOIN public.concern_subcategories cs
              ON cs.id = (s.val->>'subcategory_id')::BIGINT
             AND cs.shop_id = p_shop_id
           WHERE s.val->>'subcategory_id' IS NOT NULL)
    INTO v_fk_referenced, v_fk_resolved
    FROM jsonb_each(v_before) AS s(key, val)
   WHERE val->>'subcategory_id' IS NOT NULL;

  IF v_fk_resolved < v_fk_referenced THEN
    RAISE EXCEPTION 'revert_blocked: fk_target_tenant_mismatch: revert_concern_questions_flat snapshot references % distinct subcategory_id values but only % resolve in shop % (likely tampered snapshot or cross-tenant FK target)',
      v_fk_referenced, v_fk_resolved, p_shop_id
      USING ERRCODE = '42501';
  END IF;

  -- ── UPSERT-restore "before" rows (ADR-019 Invariants 1 + 5) ─────────
  WITH attempted AS (
    INSERT INTO public.concern_questions (
      id, shop_id, category, subcategory_id, question_text,
      options, multi_select, display_order, active, required_facts,
      created_at, updated_at,
      updated_by_oauth_client_id, updated_by_name
    )
    SELECT
      (key)::BIGINT                                                 AS id,
      p_shop_id                                                     AS shop_id,
      val->>'category'                                              AS category,
      NULLIF(val->>'subcategory_id', '')::BIGINT                    AS subcategory_id,
      val->>'question_text'                                         AS question_text,
      COALESCE(val->'options', '[]'::JSONB)                         AS options,
      COALESCE((val->>'multi_select')::BOOLEAN, FALSE)              AS multi_select,
      COALESCE(NULLIF(val->>'display_order', '')::INTEGER, 0)       AS display_order,
      COALESCE((val->>'active')::BOOLEAN, TRUE)                     AS active,
      CASE WHEN val->'required_facts' IS NULL
             OR jsonb_typeof(val->'required_facts') = 'null'
           THEN NULL
           ELSE (SELECT ARRAY(
                   SELECT elem::TEXT
                     FROM jsonb_array_elements_text(val->'required_facts') WITH ORDINALITY AS j(elem, ord)
                    ORDER BY ord))
      END                                                           AS required_facts,
      COALESCE((val->>'created_at')::TIMESTAMPTZ, now())            AS created_at,
      now()                                                         AS updated_at,
      val->>'updated_by_oauth_client_id'                            AS updated_by_oauth_client_id,
      val->>'updated_by_name'                                       AS updated_by_name
    FROM jsonb_each(v_before) AS s(key, val)
    ON CONFLICT (id) DO UPDATE SET
      category                   = EXCLUDED.category,
      subcategory_id             = EXCLUDED.subcategory_id,
      question_text              = EXCLUDED.question_text,
      options                    = EXCLUDED.options,
      multi_select               = EXCLUDED.multi_select,
      display_order              = EXCLUDED.display_order,
      active                     = EXCLUDED.active,
      required_facts             = EXCLUDED.required_facts,
      updated_at                 = EXCLUDED.updated_at,
      updated_by_oauth_client_id = EXCLUDED.updated_by_oauth_client_id,
      updated_by_name            = EXCLUDED.updated_by_name
      WHERE concern_questions.shop_id = p_shop_id   -- Invariant 1
    RETURNING 1
  )
  SELECT count(*) INTO v_actual_writes FROM attempted;

  IF v_actual_writes < v_expected_writes THEN
    RAISE EXCEPTION 'revert_blocked: cross_shop_hijack_attempt: revert_concern_questions_flat snapshot carries % rows but only % were writable in shop %',
      v_expected_writes, v_actual_writes, p_shop_id
      USING ERRCODE = '42501';
  END IF;

  -- ── Soft-delete added rows (undo INSERT side of upload) ─────────────
  IF array_length(v_added_id_arr, 1) > 0 THEN
    UPDATE public.concern_questions
       SET active     = FALSE,
           updated_at = now()
     WHERE shop_id = p_shop_id
       AND id = ANY(v_added_id_arr)
       AND active = TRUE;
    GET DIAGNOSTICS v_actual_deact = ROW_COUNT;
  END IF;

  restored    := v_actual_writes;
  deactivated := v_actual_deact;
  deleted     := 0;
  details     := '{}'::JSONB;
  RETURN NEXT;

EXCEPTION
  WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'revert_blocked: fk_broken: revert_concern_questions_flat raised foreign_key_violation (SQLERRM=%)', SQLERRM
      USING ERRCODE = '23503';
END $$;

REVOKE EXECUTE ON FUNCTION public.revert_concern_questions_flat(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_concern_questions_flat(INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revert_concern_questions_flat(INTEGER, JSONB) FROM service_role;

COMMENT ON FUNCTION public.revert_concern_questions_flat(INTEGER, JSONB) IS
  'Revert handler for snapshot_kind=concern_questions_flat per ADR-004 + ADR-019. UPSERTs snapshot.before (Invariants 1+5+6); soft-deletes snapshot.added_keys. NO GRANT to service_role per ADR-005.';


-- ════════════════════════════════════════════════════════════════════════
-- HANDLER 2 of 5 — revert_concern_category_upload (BOTH tables, R6-B3)
-- ════════════════════════════════════════════════════════════════════════
-- Mutation surface: concern_subcategories + concern_questions for ONE
--                   category in (p_shop_id)
-- Snapshot keys:    subcategories_before (BIGSERIAL ids on concern_subcategories)
--                   questions_before (BIGSERIAL ids on concern_questions)
-- Apply path:       NEW apply_concern_category_upload (E1f)
-- Canonical mirror: canonical_state_concern_category_upload (E1b dispatch)
--
-- E1b-N1 SNAPSHOT FIELD NAMES (LOAD-BEARING — DO NOT RENAME):
--   subcategories_before   — JSONB object keyed by subcategory id → row
--   added_subcategory_ids  — JSONB array of newly-inserted subcategory ids
--   questions_before       — JSONB object keyed by question id → row
--   added_question_ids     — JSONB array of newly-inserted question ids
--
-- These names match:
--   - canonical_state_concern_category_upload (E1b helper 9)
--   - lock_targets_for_kind Kind 7 branch (E1b helper 2)
--   - apply_concern_category_upload (E1f handler 2 — same file as this)
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.revert_concern_category_upload(
  p_shop_id  INTEGER,
  p_snapshot JSONB
) RETURNS TABLE(restored INT, deactivated INT, deleted INT, details JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_subs_before     JSONB;
  v_added_sub_ids   JSONB;
  v_qs_before       JSONB;
  v_added_q_ids     JSONB;
  v_added_sub_arr   BIGINT[];
  v_added_q_arr     BIGINT[];
  v_expected_subs   INTEGER := 0;
  v_expected_qs     INTEGER := 0;
  v_actual_subs     INTEGER := 0;
  v_actual_qs       INTEGER := 0;
  v_actual_deact_subs INTEGER := 0;
  v_actual_deact_qs   INTEGER := 0;
  v_fk_referenced   INTEGER := 0;
  v_fk_resolved     INTEGER := 0;
BEGIN
  IF p_snapshot IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_concern_category_upload received NULL p_snapshot'
      USING ERRCODE = '22023';
  END IF;

  -- E1b-N1 EXACT FIELD NAMES — DO NOT RENAME (load-bearing per E1b dispatch + E1f apply)
  v_subs_before    := COALESCE(p_snapshot->'subcategories_before',  '{}'::JSONB);
  v_added_sub_ids  := COALESCE(p_snapshot->'added_subcategory_ids', '[]'::JSONB);
  v_qs_before      := COALESCE(p_snapshot->'questions_before',      '{}'::JSONB);
  v_added_q_ids    := COALESCE(p_snapshot->'added_question_ids',    '[]'::JSONB);

  IF jsonb_typeof(v_subs_before) <> 'object' OR jsonb_typeof(v_qs_before) <> 'object' THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_concern_category_upload requires subcategories_before AND questions_before as JSONB objects'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_added_sub_ids) <> 'array' OR jsonb_typeof(v_added_q_ids) <> 'array' THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_concern_category_upload requires added_subcategory_ids AND added_question_ids as JSONB arrays'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_expected_subs FROM jsonb_each(v_subs_before);
  SELECT count(*) INTO v_expected_qs   FROM jsonb_each(v_qs_before);

  -- Subquery-alias pattern per E1b dispatch canonical idiom
  SELECT ARRAY(
    SELECT v::BIGINT FROM (
      SELECT jsonb_array_elements_text(v_added_sub_ids) AS v
    ) k
    WHERE v IS NOT NULL AND v <> ''
  ) INTO v_added_sub_arr;

  SELECT ARRAY(
    SELECT v::BIGINT FROM (
      SELECT jsonb_array_elements_text(v_added_q_ids) AS v
    ) k
    WHERE v IS NOT NULL AND v <> ''
  ) INTO v_added_q_arr;

  -- ── Invariant 6 (ADR-019): FK target tenant validation ──────────────
  -- questions_before rows carry subcategory_id FK → concern_subcategories.id
  -- Validate every DISTINCT subcategory_id in v_qs_before resolves in shop.
  -- After UPSERT-restore of subs, the parent rows we just wrote ARE in our
  -- shop, so an in-shop subcategory_id in questions_before is always safe.
  -- The risk surface is a tampered questions_before row with a subcategory_id
  -- pointing at ANOTHER shop's subcategory (which would not appear in our
  -- subs_before since we didn't write it).
  SELECT count(DISTINCT (val->>'subcategory_id')),
         (SELECT count(DISTINCT cs.id)
            FROM jsonb_each(v_qs_before) AS s(key, val)
            JOIN public.concern_subcategories cs
              ON cs.id = (s.val->>'subcategory_id')::BIGINT
             AND cs.shop_id = p_shop_id
           WHERE s.val->>'subcategory_id' IS NOT NULL)
    INTO v_fk_referenced, v_fk_resolved
    FROM jsonb_each(v_qs_before) AS s(key, val)
   WHERE val->>'subcategory_id' IS NOT NULL
     -- Exclude subcategories we're about to UPSERT-restore in THIS handler
     -- (they will be in shop AFTER step "UPSERT subs" below; we want to
     -- accept FK references to them).
     AND (val->>'subcategory_id')::BIGINT NOT IN (
       SELECT (key)::BIGINT FROM jsonb_each(v_subs_before)
     );

  IF v_fk_resolved < v_fk_referenced THEN
    RAISE EXCEPTION 'revert_blocked: fk_target_tenant_mismatch: revert_concern_category_upload questions_before references % distinct subcategory_id values (outside subs_before scope) but only % resolve in shop % (likely tampered snapshot)',
      v_fk_referenced, v_fk_resolved, p_shop_id
      USING ERRCODE = '42501';
  END IF;

  -- ── UPSERT-restore subcategories FIRST (FK parent) ──────────────────
  -- Parent-first ordering matches canonical sort + matches the lock order
  -- in lock_targets_for_kind Kind 7 (E1b) which locks subcategories first.
  WITH attempted_subs AS (
    INSERT INTO public.concern_subcategories (
      id, shop_id, category, slug, display_label,
      display_order, active,
      description, positive_examples, negative_examples, synonyms,
      eligible_testing_service_keys,
      created_at, updated_at,
      updated_by_oauth_client_id, updated_by_name
    )
    SELECT
      (key)::BIGINT                                                 AS id,
      p_shop_id                                                     AS shop_id,
      val->>'category'                                              AS category,
      val->>'slug'                                                  AS slug,
      val->>'display_label'                                         AS display_label,
      COALESCE(NULLIF(val->>'display_order', '')::INTEGER, 0)       AS display_order,
      COALESCE((val->>'active')::BOOLEAN, TRUE)                     AS active,
      val->>'description'                                           AS description,
      CASE WHEN val->'positive_examples' IS NULL
             OR jsonb_typeof(val->'positive_examples') = 'null'
           THEN NULL
           ELSE ARRAY(SELECT jsonb_array_elements_text(val->'positive_examples'))
      END                                                           AS positive_examples,
      CASE WHEN val->'negative_examples' IS NULL
             OR jsonb_typeof(val->'negative_examples') = 'null'
           THEN NULL
           ELSE ARRAY(SELECT jsonb_array_elements_text(val->'negative_examples'))
      END                                                           AS negative_examples,
      CASE WHEN val->'synonyms' IS NULL
             OR jsonb_typeof(val->'synonyms') = 'null'
           THEN NULL
           ELSE ARRAY(SELECT jsonb_array_elements_text(val->'synonyms'))
      END                                                           AS synonyms,
      CASE WHEN val->'eligible_testing_service_keys' IS NULL
             OR jsonb_typeof(val->'eligible_testing_service_keys') = 'null'
           THEN NULL
           ELSE ARRAY(SELECT jsonb_array_elements_text(val->'eligible_testing_service_keys'))
      END                                                           AS eligible_testing_service_keys,
      COALESCE((val->>'created_at')::TIMESTAMPTZ, now())            AS created_at,
      now()                                                         AS updated_at,
      val->>'updated_by_oauth_client_id'                            AS updated_by_oauth_client_id,
      val->>'updated_by_name'                                       AS updated_by_name
    FROM jsonb_each(v_subs_before) AS s(key, val)
    ON CONFLICT (id) DO UPDATE SET
      category                      = EXCLUDED.category,
      slug                          = EXCLUDED.slug,
      display_label                 = EXCLUDED.display_label,
      display_order                 = EXCLUDED.display_order,
      active                        = EXCLUDED.active,
      description                   = EXCLUDED.description,
      positive_examples             = EXCLUDED.positive_examples,
      negative_examples             = EXCLUDED.negative_examples,
      synonyms                      = EXCLUDED.synonyms,
      eligible_testing_service_keys = EXCLUDED.eligible_testing_service_keys,
      updated_at                    = EXCLUDED.updated_at,
      updated_by_oauth_client_id    = EXCLUDED.updated_by_oauth_client_id,
      updated_by_name               = EXCLUDED.updated_by_name
      WHERE concern_subcategories.shop_id = p_shop_id   -- Invariant 1
    RETURNING 1
  )
  SELECT count(*) INTO v_actual_subs FROM attempted_subs;

  IF v_actual_subs < v_expected_subs THEN
    RAISE EXCEPTION 'revert_blocked: cross_shop_hijack_attempt: revert_concern_category_upload subs_before carries % rows but only % were writable in shop %',
      v_expected_subs, v_actual_subs, p_shop_id
      USING ERRCODE = '42501';
  END IF;

  -- ── UPSERT-restore questions SECOND (FK child) ──────────────────────
  WITH attempted_qs AS (
    INSERT INTO public.concern_questions (
      id, shop_id, category, subcategory_id, question_text,
      options, multi_select, display_order, active, required_facts,
      created_at, updated_at,
      updated_by_oauth_client_id, updated_by_name
    )
    SELECT
      (key)::BIGINT                                                 AS id,
      p_shop_id                                                     AS shop_id,
      val->>'category'                                              AS category,
      NULLIF(val->>'subcategory_id', '')::BIGINT                    AS subcategory_id,
      val->>'question_text'                                         AS question_text,
      COALESCE(val->'options', '[]'::JSONB)                         AS options,
      COALESCE((val->>'multi_select')::BOOLEAN, FALSE)              AS multi_select,
      COALESCE(NULLIF(val->>'display_order', '')::INTEGER, 0)       AS display_order,
      COALESCE((val->>'active')::BOOLEAN, TRUE)                     AS active,
      CASE WHEN val->'required_facts' IS NULL
             OR jsonb_typeof(val->'required_facts') = 'null'
           THEN NULL
           ELSE (SELECT ARRAY(
                   SELECT elem::TEXT
                     FROM jsonb_array_elements_text(val->'required_facts') WITH ORDINALITY AS j(elem, ord)
                    ORDER BY ord))
      END                                                           AS required_facts,
      COALESCE((val->>'created_at')::TIMESTAMPTZ, now())            AS created_at,
      now()                                                         AS updated_at,
      val->>'updated_by_oauth_client_id'                            AS updated_by_oauth_client_id,
      val->>'updated_by_name'                                       AS updated_by_name
    FROM jsonb_each(v_qs_before) AS s(key, val)
    ON CONFLICT (id) DO UPDATE SET
      category                   = EXCLUDED.category,
      subcategory_id             = EXCLUDED.subcategory_id,
      question_text              = EXCLUDED.question_text,
      options                    = EXCLUDED.options,
      multi_select               = EXCLUDED.multi_select,
      display_order              = EXCLUDED.display_order,
      active                     = EXCLUDED.active,
      required_facts             = EXCLUDED.required_facts,
      updated_at                 = EXCLUDED.updated_at,
      updated_by_oauth_client_id = EXCLUDED.updated_by_oauth_client_id,
      updated_by_name            = EXCLUDED.updated_by_name
      WHERE concern_questions.shop_id = p_shop_id   -- Invariant 1
    RETURNING 1
  )
  SELECT count(*) INTO v_actual_qs FROM attempted_qs;

  IF v_actual_qs < v_expected_qs THEN
    RAISE EXCEPTION 'revert_blocked: cross_shop_hijack_attempt: revert_concern_category_upload questions_before carries % rows but only % were writable in shop %',
      v_expected_qs, v_actual_qs, p_shop_id
      USING ERRCODE = '42501';
  END IF;

  -- ── Soft-delete added questions FIRST (child table) ─────────────────
  -- Children before parents to avoid FK ordering concerns.
  IF array_length(v_added_q_arr, 1) > 0 THEN
    UPDATE public.concern_questions
       SET active     = FALSE,
           updated_at = now()
     WHERE shop_id = p_shop_id
       AND id = ANY(v_added_q_arr)
       AND active = TRUE;
    GET DIAGNOSTICS v_actual_deact_qs = ROW_COUNT;
  END IF;

  -- ── Soft-delete added sub-categories SECOND ─────────────────────────
  IF array_length(v_added_sub_arr, 1) > 0 THEN
    UPDATE public.concern_subcategories
       SET active     = FALSE,
           updated_at = now()
     WHERE shop_id = p_shop_id
       AND id = ANY(v_added_sub_arr)
       AND active = TRUE;
    GET DIAGNOSTICS v_actual_deact_subs = ROW_COUNT;
  END IF;

  restored    := v_actual_subs + v_actual_qs;
  deactivated := v_actual_deact_subs + v_actual_deact_qs;
  deleted     := 0;
  details     := '{}'::JSONB;
  RETURN NEXT;

EXCEPTION
  WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'revert_blocked: fk_broken: revert_concern_category_upload raised foreign_key_violation (SQLERRM=%)', SQLERRM
      USING ERRCODE = '23503';
END $$;

REVOKE EXECUTE ON FUNCTION public.revert_concern_category_upload(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_concern_category_upload(INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revert_concern_category_upload(INTEGER, JSONB) FROM service_role;

COMMENT ON FUNCTION public.revert_concern_category_upload(INTEGER, JSONB) IS
  'Revert handler for snapshot_kind=concern_questions_per_category per ADR-004 + ADR-019 + R6-B3 (BOTH tables) + E1b-N1 (snapshot field naming: subcategories_before/added_subcategory_ids/questions_before/added_question_ids). UPSERTs both tables; soft-deletes added in BOTH. NO GRANT to service_role per ADR-005.';


-- ════════════════════════════════════════════════════════════════════════
-- HANDLER 3 of 5 — revert_concern_category_guideline
-- ════════════════════════════════════════════════════════════════════════
-- Mutation surface: concern_category_guidelines for (p_shop_id, category)
-- Snapshot keys:    category slugs (TEXT, e.g. 'noise', 'brakes')
-- PK shape:         composite (shop_id, category) — NO scalar id
-- Apply path:       NEW apply_concern_category_guideline_upload (E1f)
-- Canonical mirror: canonical_state_concern_category_guideline (E1b dispatch)
--
-- Delete strategy: HARD DELETE for added_keys (composite-PK can't be soft-
-- deleted by active flag — table has no `active` column).
--
-- Snapshot shape:
--   { snapshot_kind: 'concern_category_guidelines',
--     before:      { '<category>': {row...} | null, ... },
--                   (null when row didn't exist pre-upload → revert deletes it)
--     added_keys:  ['<category>', ...]  -- categories the upload INSERTed
--   }
--
-- For composite-PK tables (per ADR-019 "preferred alternative"), use
-- ON CONFLICT (shop_id, category) which makes cross-shop hijack
-- STRUCTURALLY IMPOSSIBLE (shop_id is part of the conflict target).
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.revert_concern_category_guideline(
  p_shop_id  INTEGER,
  p_snapshot JSONB
) RETURNS TABLE(restored INT, deactivated INT, deleted INT, details JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_before          JSONB;
  v_added_keys      JSONB;
  v_added_cat_arr   TEXT[];
  v_before_nonnull  JSONB;
  v_expected_writes INTEGER := 0;
  v_actual_writes   INTEGER := 0;
  v_actual_deleted  INTEGER := 0;
BEGIN
  IF p_snapshot IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_concern_category_guideline received NULL p_snapshot'
      USING ERRCODE = '22023';
  END IF;

  v_before     := COALESCE(p_snapshot->'before',     '{}'::JSONB);
  v_added_keys := COALESCE(p_snapshot->'added_keys', '[]'::JSONB);

  IF jsonb_typeof(v_before) <> 'object' THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_concern_category_guideline snapshot.before must be JSONB object'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_added_keys) <> 'array' THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_concern_category_guideline snapshot.added_keys must be JSONB array'
      USING ERRCODE = '22023';
  END IF;

  -- Build a filtered subset of `before` excluding NULL values
  -- (NULL = row didn't exist pre-upload → the added_keys list covers it
  -- with hard-DELETE). Only non-NULL values are UPSERT-restored.
  SELECT COALESCE(jsonb_object_agg(key, val), '{}'::JSONB)
    INTO v_before_nonnull
    FROM jsonb_each(v_before) AS s(key, val)
   WHERE val IS NOT NULL AND jsonb_typeof(val) <> 'null';

  SELECT count(*) INTO v_expected_writes
    FROM jsonb_each(v_before_nonnull);

  -- Subquery-alias pattern per E1b dispatch canonical idiom
  SELECT ARRAY(
    SELECT v FROM (
      SELECT jsonb_array_elements_text(v_added_keys) AS v
    ) k
    WHERE v IS NOT NULL AND v <> ''
  ) INTO v_added_cat_arr;

  -- ── UPSERT-restore non-NULL "before" rows (ADR-019 preferred alt) ───
  -- composite PK (shop_id, category) is the conflict target → cross-shop
  -- hijack STRUCTURALLY IMPOSSIBLE (shop_id is part of the key, so a
  -- snapshot row carrying (shop=A, cat=X) cannot match (shop=B, cat=X)).
  -- WHERE filter on DO UPDATE is therefore redundant but kept for symmetry.
  WITH attempted AS (
    INSERT INTO public.concern_category_guidelines (
      shop_id, category, display_label, guideline_prose,
      updated_at,
      updated_by_oauth_client_id, updated_by_name
    )
    SELECT
      p_shop_id                                                     AS shop_id,
      (key)::TEXT                                                   AS category,
      val->>'display_label'                                         AS display_label,
      val->>'guideline_prose'                                       AS guideline_prose,
      now()                                                         AS updated_at,
      val->>'updated_by_oauth_client_id'                            AS updated_by_oauth_client_id,
      val->>'updated_by_name'                                       AS updated_by_name
    FROM jsonb_each(v_before_nonnull) AS s(key, val)
    ON CONFLICT (shop_id, category) DO UPDATE SET
      display_label              = EXCLUDED.display_label,
      guideline_prose            = EXCLUDED.guideline_prose,
      updated_at                 = EXCLUDED.updated_at,
      updated_by_oauth_client_id = EXCLUDED.updated_by_oauth_client_id,
      updated_by_name            = EXCLUDED.updated_by_name
      WHERE concern_category_guidelines.shop_id = p_shop_id   -- Invariant 1
                                                              -- (redundant
                                                              -- with composite
                                                              -- PK conflict
                                                              -- target — kept
                                                              -- for symmetry)
    RETURNING 1
  )
  SELECT count(*) INTO v_actual_writes FROM attempted;

  IF v_actual_writes < v_expected_writes THEN
    RAISE EXCEPTION 'revert_blocked: cross_shop_hijack_attempt: revert_concern_category_guideline before-nonnull set carries % rows but only % were writable in shop %',
      v_expected_writes, v_actual_writes, p_shop_id
      USING ERRCODE = '42501';
  END IF;

  -- ── HARD DELETE added categories (undo INSERT side of upload) ───────
  -- shop_id = p_shop_id is BELT-AND-SUSPENDERS guard against tampered
  -- added_keys entry pointing at another shop's row. ADR-015 absent-key
  -- TOCTOU residual is open (Phase 1.5 SEC-15 deferred); the shop_id
  -- guard bounds the blast radius if it materializes.
  IF array_length(v_added_cat_arr, 1) > 0 THEN
    DELETE FROM public.concern_category_guidelines
     WHERE shop_id = p_shop_id
       AND category = ANY(v_added_cat_arr);
    GET DIAGNOSTICS v_actual_deleted = ROW_COUNT;
  END IF;

  restored    := v_actual_writes;
  deactivated := 0;
  deleted     := v_actual_deleted;
  details     := '{}'::JSONB;
  RETURN NEXT;

EXCEPTION
  WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'revert_blocked: fk_broken: revert_concern_category_guideline raised foreign_key_violation (SQLERRM=%)', SQLERRM
      USING ERRCODE = '23503';
END $$;

REVOKE EXECUTE ON FUNCTION public.revert_concern_category_guideline(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_concern_category_guideline(INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revert_concern_category_guideline(INTEGER, JSONB) FROM service_role;

COMMENT ON FUNCTION public.revert_concern_category_guideline(INTEGER, JSONB) IS
  'Revert handler for snapshot_kind=concern_category_guidelines per ADR-004 + ADR-019. Composite PK (shop_id, category) — ON CONFLICT (shop_id, category) makes cross-shop hijack STRUCTURALLY IMPOSSIBLE. UPSERTs non-NULL before; HARD DELETEs added_keys. NO GRANT to service_role per ADR-005.';


-- ════════════════════════════════════════════════════════════════════════
-- HANDLER 4 of 5 — revert_appointment_default_limits
-- ════════════════════════════════════════════════════════════════════════
-- Mutation surface: appointment_default_limits for (p_shop_id)
-- Snapshot keys:    day_of_week integers (0..6)
-- PK shape:         composite (shop_id, day_of_week) — NO scalar id
-- Apply path:       NEW apply_appointment_default_limits_upload (E1f)
-- Canonical mirror: canonical_state_appointment_default_limits (E1b dispatch)
--
-- Delete strategy: HARD DELETE for added_keys (composite-PK, no active
-- column — can't soft-delete).
--
-- Snapshot shape:
--   { snapshot_kind: 'appointment_default_limits',
--     before:      { '<dow>': {row...}, ... },         (dow = 0..6 strings)
--     added_keys:  ['<dow>', ...] }
--
-- Note: dispatch already uses composite-PK pattern via day_of_week per
-- E1b lock_targets_for_kind Kind 9. The user task brief mistakenly said
-- "UUID PK"; actual schema is composite (shop_id, day_of_week).
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.revert_appointment_default_limits(
  p_shop_id  INTEGER,
  p_snapshot JSONB
) RETURNS TABLE(restored INT, deactivated INT, deleted INT, details JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_before          JSONB;
  v_added_keys      JSONB;
  v_added_dow_arr   INT[];
  v_expected_writes INTEGER := 0;
  v_actual_writes   INTEGER := 0;
  v_actual_deleted  INTEGER := 0;
BEGIN
  IF p_snapshot IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_appointment_default_limits received NULL p_snapshot'
      USING ERRCODE = '22023';
  END IF;

  v_before     := COALESCE(p_snapshot->'before',     '{}'::JSONB);
  v_added_keys := COALESCE(p_snapshot->'added_keys', '[]'::JSONB);

  IF jsonb_typeof(v_before) <> 'object' THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_appointment_default_limits snapshot.before must be JSONB object'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_added_keys) <> 'array' THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_appointment_default_limits snapshot.added_keys must be JSONB array'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_expected_writes
    FROM jsonb_each(v_before);

  -- Subquery-alias pattern per E1b dispatch canonical idiom
  SELECT ARRAY(
    SELECT v::INT FROM (
      SELECT jsonb_array_elements_text(v_added_keys) AS v
    ) k
    WHERE v IS NOT NULL AND v <> ''
  ) INTO v_added_dow_arr;

  -- ── UPSERT-restore "before" rows (composite PK preferred alt) ───────
  -- ON CONFLICT (shop_id, day_of_week) — cross-shop hijack STRUCTURALLY
  -- IMPOSSIBLE.
  WITH attempted AS (
    INSERT INTO public.appointment_default_limits (
      shop_id, day_of_week, is_closed,
      waiter_8am_slots, waiter_9am_slots, dropoff_total,
      notes, updated_at,
      updated_by_oauth_client_id, updated_by_name
    )
    SELECT
      p_shop_id                                                     AS shop_id,
      (key)::INT                                                    AS day_of_week,
      COALESCE((val->>'is_closed')::BOOLEAN, FALSE)                 AS is_closed,
      COALESCE(NULLIF(val->>'waiter_8am_slots', '')::INT, 0)        AS waiter_8am_slots,
      COALESCE(NULLIF(val->>'waiter_9am_slots', '')::INT, 0)        AS waiter_9am_slots,
      COALESCE(NULLIF(val->>'dropoff_total', '')::INT, 0)           AS dropoff_total,
      val->>'notes'                                                 AS notes,
      now()                                                         AS updated_at,
      val->>'updated_by_oauth_client_id'                            AS updated_by_oauth_client_id,
      val->>'updated_by_name'                                       AS updated_by_name
    FROM jsonb_each(v_before) AS s(key, val)
    ON CONFLICT (shop_id, day_of_week) DO UPDATE SET
      is_closed                  = EXCLUDED.is_closed,
      waiter_8am_slots           = EXCLUDED.waiter_8am_slots,
      waiter_9am_slots           = EXCLUDED.waiter_9am_slots,
      dropoff_total              = EXCLUDED.dropoff_total,
      notes                      = EXCLUDED.notes,
      updated_at                 = EXCLUDED.updated_at,
      updated_by_oauth_client_id = EXCLUDED.updated_by_oauth_client_id,
      updated_by_name            = EXCLUDED.updated_by_name
      WHERE appointment_default_limits.shop_id = p_shop_id   -- redundant w/ composite PK
    RETURNING 1
  )
  SELECT count(*) INTO v_actual_writes FROM attempted;

  IF v_actual_writes < v_expected_writes THEN
    RAISE EXCEPTION 'revert_blocked: cross_shop_hijack_attempt: revert_appointment_default_limits snapshot carries % rows but only % were writable in shop %',
      v_expected_writes, v_actual_writes, p_shop_id
      USING ERRCODE = '42501';
  END IF;

  -- ── HARD DELETE added day_of_week entries (undo upload INSERT) ──────
  IF array_length(v_added_dow_arr, 1) > 0 THEN
    DELETE FROM public.appointment_default_limits
     WHERE shop_id = p_shop_id
       AND day_of_week = ANY(v_added_dow_arr);
    GET DIAGNOSTICS v_actual_deleted = ROW_COUNT;
  END IF;

  restored    := v_actual_writes;
  deactivated := 0;
  deleted     := v_actual_deleted;
  details     := '{}'::JSONB;
  RETURN NEXT;

EXCEPTION
  WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'revert_blocked: fk_broken: revert_appointment_default_limits raised foreign_key_violation (SQLERRM=%)', SQLERRM
      USING ERRCODE = '23503';
END $$;

REVOKE EXECUTE ON FUNCTION public.revert_appointment_default_limits(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_appointment_default_limits(INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revert_appointment_default_limits(INTEGER, JSONB) FROM service_role;

COMMENT ON FUNCTION public.revert_appointment_default_limits(INTEGER, JSONB) IS
  'Revert handler for snapshot_kind=appointment_default_limits per ADR-004 + ADR-019. Composite PK (shop_id, day_of_week). UPSERTs before; HARD DELETEs added_keys. NO GRANT to service_role per ADR-005.';


-- ════════════════════════════════════════════════════════════════════════
-- HANDLER 5 of 5 — revert_closed_dates_future
-- ════════════════════════════════════════════════════════════════════════
-- Mutation surface: closed_dates for (p_shop_id) WHERE closed_date >= today
-- Snapshot keys:    DATE strings (YYYY-MM-DD)
-- PK shape:         id UUID; natural identity (shop_id, closed_date) is UNIQUE
-- Apply path:       NEW apply_closed_dates_upload (E1f)
-- Canonical mirror: canonical_state_closed_dates_future (E1b dispatch)
--
-- Delete strategy: CONDITIONAL HARD DELETE — only delete future dates per
-- past-date immutability invariant (per ADR-004 details JSONB +
-- closed_dates_future canonical scope).
--
-- ADR-013: per-date advisory locks already acquired by inner RPC step 4
-- (lock_targets_for_kind Kind 10 branch — FOR LOOP with sorted-date
-- 2-arg pg_advisory_xact_lock). Handler does NOT take locks itself.
-- The companion apply_closed_dates_upload (E1f) DOES take them.
--
-- Snapshot shape:
--   { snapshot_kind:   'closed_dates_future',
--     before:          { '<YYYY-MM-DD>': {row...}, ... },
--     added_keys:      ['<YYYY-MM-DD>', ...],
--     original_today:  'YYYY-MM-DD'  (REQUIRED — preserves "past closures
--                                     are immutable history" invariant) }
--
-- details JSONB output (per ADR-004):
--   { skipped_past_dates_restore: ['<date>', ...],
--     skipped_past_dates_delete:  ['<date>', ...] }
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.revert_closed_dates_future(
  p_shop_id  INTEGER,
  p_snapshot JSONB
) RETURNS TABLE(restored INT, deactivated INT, deleted INT, details JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_before                    JSONB;
  v_added_keys                JSONB;
  v_original_today            DATE;
  v_before_future             JSONB;
  v_added_future_arr          DATE[];
  v_skipped_restore           JSONB := '[]'::JSONB;
  v_skipped_delete            JSONB := '[]'::JSONB;
  v_expected_writes           INTEGER := 0;
  v_actual_writes             INTEGER := 0;
  v_actual_deleted            INTEGER := 0;
BEGIN
  IF p_snapshot IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_closed_dates_future received NULL p_snapshot'
      USING ERRCODE = '22023';
  END IF;

  v_before     := COALESCE(p_snapshot->'before',     '{}'::JSONB);
  v_added_keys := COALESCE(p_snapshot->'added_keys', '[]'::JSONB);

  IF jsonb_typeof(v_before) <> 'object' THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_closed_dates_future snapshot.before must be JSONB object'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_added_keys) <> 'array' THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_closed_dates_future snapshot.added_keys must be JSONB array'
      USING ERRCODE = '22023';
  END IF;

  -- ── original_today REQUIRED (per PLAN §4.5 + ADR-004 past-date scope) ─
  IF p_snapshot->>'original_today' IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_closed_dates_future snapshot missing required field original_today (preserves past-closures-are-immutable-history invariant; without it, the uploader''s forward-window scope cannot be reconstructed)'
      USING ERRCODE = '22023';
  END IF;

  v_original_today := (p_snapshot->>'original_today')::DATE;

  -- ── Partition before keys into (future-restore, past-skip) ──────────
  -- For UPSERT-restore: skip dates that have drifted into the past since
  -- the original upload. Today (at revert time) may be > original_today.
  -- We use original_today as the threshold to match the uploader's scope
  -- and preserve byte-parity with canonical_state_closed_dates_future.
  -- Past-skipped restores are recorded in details for operator visibility.
  WITH parts AS (
    SELECT
      key,
      val,
      (val->>'closed_date')::DATE AS row_date
    FROM jsonb_each(v_before) AS s(key, val)
  )
  SELECT COALESCE(jsonb_object_agg(key, val) FILTER (WHERE row_date >= v_original_today), '{}'::JSONB),
         COALESCE(jsonb_agg(key ORDER BY key) FILTER (WHERE row_date < v_original_today), '[]'::JSONB)
    INTO v_before_future, v_skipped_restore
    FROM parts;

  SELECT count(*) INTO v_expected_writes
    FROM jsonb_each(v_before_future);

  -- ── Partition added_keys into (future-delete, past-skip) ────────────
  -- Subquery-alias pattern per E1b dispatch canonical idiom
  WITH adds AS (
    SELECT v::DATE AS d FROM (
      SELECT jsonb_array_elements_text(v_added_keys) AS v
    ) k
    WHERE v IS NOT NULL AND v <> ''
  )
  SELECT ARRAY(SELECT d FROM adds WHERE d >= v_original_today ORDER BY d),
         COALESCE(jsonb_agg(d::TEXT ORDER BY d) FILTER (WHERE d < v_original_today), '[]'::JSONB)
    INTO v_added_future_arr, v_skipped_delete
    FROM adds;

  -- ── UPSERT-restore future "before" rows (composite-natural-key alt) ─
  -- Use (shop_id, closed_date) as conflict target — UNIQUE constraint
  -- per closed_dates schema. Cross-shop hijack STRUCTURALLY IMPOSSIBLE
  -- (shop_id is part of conflict target).
  WITH attempted AS (
    INSERT INTO public.closed_dates (
      shop_id, closed_date, reason, source, created_at
    )
    SELECT
      p_shop_id                                                     AS shop_id,
      (val->>'closed_date')::DATE                                   AS closed_date,
      val->>'reason'                                                AS reason,
      COALESCE(val->>'source', 'admin')                             AS source,
      COALESCE((val->>'created_at')::TIMESTAMPTZ, now())            AS created_at
    FROM jsonb_each(v_before_future) AS s(key, val)
    ON CONFLICT (shop_id, closed_date) DO UPDATE SET
      reason = EXCLUDED.reason,
      source = EXCLUDED.source
      WHERE closed_dates.shop_id = p_shop_id   -- redundant w/ composite key
    RETURNING 1
  )
  SELECT count(*) INTO v_actual_writes FROM attempted;

  IF v_actual_writes < v_expected_writes THEN
    RAISE EXCEPTION 'revert_blocked: cross_shop_hijack_attempt: revert_closed_dates_future before-future set carries % rows but only % were writable in shop %',
      v_expected_writes, v_actual_writes, p_shop_id
      USING ERRCODE = '42501';
  END IF;

  -- ── CONDITIONAL HARD DELETE added future dates ──────────────────────
  -- Past dates in added_keys are skipped (recorded in details). The
  -- closed_date >= v_original_today + shop_id guard prevents bypassing
  -- past-date immutability.
  IF array_length(v_added_future_arr, 1) > 0 THEN
    DELETE FROM public.closed_dates
     WHERE shop_id = p_shop_id
       AND closed_date = ANY(v_added_future_arr)
       AND closed_date >= v_original_today;   -- belt-and-suspenders past-date guard
    GET DIAGNOSTICS v_actual_deleted = ROW_COUNT;
  END IF;

  restored    := v_actual_writes;
  deactivated := 0;
  deleted     := v_actual_deleted;
  details     := jsonb_build_object(
    'skipped_past_dates_restore', v_skipped_restore,
    'skipped_past_dates_delete',  v_skipped_delete,
    'original_today',             v_original_today::TEXT
  );
  RETURN NEXT;

EXCEPTION
  WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'revert_blocked: fk_broken: revert_closed_dates_future raised foreign_key_violation (SQLERRM=%)', SQLERRM
      USING ERRCODE = '23503';
END $$;

REVOKE EXECUTE ON FUNCTION public.revert_closed_dates_future(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_closed_dates_future(INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revert_closed_dates_future(INTEGER, JSONB) FROM service_role;

COMMENT ON FUNCTION public.revert_closed_dates_future(INTEGER, JSONB) IS
  'Revert handler for snapshot_kind=closed_dates_future per ADR-004 + ADR-013 + ADR-019. CONDITIONAL hard DELETE — past-date immutability. Populates details JSONB with skipped_past_dates_* per ADR-004. Requires snapshot.original_today. Per-date advisory locks already acquired by inner RPC step 4. NO GRANT to service_role per ADR-005.';


-- ════════════════════════════════════════════════════════════════════════
-- END E1e migration — 5 handlers created
--
-- Next file (E1f): 20260526000500_apply_handlers_uploads.sql
-- creates 5 NEW Pattern S apply RPCs (apply_concern_questions_flat_upload,
-- apply_concern_category_upload, apply_concern_category_guideline_upload,
-- apply_appointment_default_limits_upload, apply_closed_dates_upload).
-- ════════════════════════════════════════════════════════════════════════
