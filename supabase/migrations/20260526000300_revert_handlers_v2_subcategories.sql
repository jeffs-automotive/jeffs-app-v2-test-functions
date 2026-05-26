-- ════════════════════════════════════════════════════════════════════════
-- scheduler-edge-parity feature — E1d: revert handlers for V2 sub-surfaces
-- ════════════════════════════════════════════════════════════════════════
--
-- Creates 3 per-snapshot_kind revert handlers for the V2 sub-surface
-- uploaders (UPSERT-only — no `added_keys` concept because these uploaders
-- only mutate existing rows; no INSERT side):
--
--   1. revert_subcategory_descriptions_v2
--        snapshot_kind = 'concern_subcategories_descriptions_v2'
--        mutates: concern_subcategories.{description, positive_examples,
--                 negative_examples, synonyms} for shop's rows
--   2. revert_subcategory_service_map_v2
--        snapshot_kind = 'concern_subcategories_map_v2'
--        mutates: concern_subcategories.eligible_testing_service_keys
--   3. revert_question_required_facts_v2
--        snapshot_kind = 'concern_questions_required_facts_v2'
--        mutates: concern_questions.required_facts (ordered TEXT[])
--
-- All 3 handlers UPDATE the snapshot's `before` rows back into their
-- mutation surface. There are no INSERTs to undo (these uploaders cannot
-- create new rows — they target a fixed existing row set).
--
-- ────────────────────────────────────────────────────────────────────────
-- Cross-references:
-- ────────────────────────────────────────────────────────────────────────
--   ADR-004 — universal return shape (restored/deactivated/deleted/details);
--             these handlers always set deactivated=0, deleted=0,
--             details='{}'::JSONB (no handler-specific metadata).
--   ADR-005 — internal set: NO GRANT to service_role (R6-B1 explicit).
--   ADR-007 — canonical reason_code enum.
--   ADR-008 — classifier maps fk_target_tenant_mismatch → fk_broken.
--   ADR-017 — search_path on every SECURITY DEFINER function.
--   ADR-019 — handler Invariants 1+5+6:
--               Invariant 1: WHERE-filter on UPDATE skips cross-shop rows.
--                            (These handlers don't INSERT new rows — only
--                            UPDATE existing ones — so the v0.3-WRONG
--                            UPSERT-hijack risk doesn't apply. But the
--                            UPDATE itself must filter by shop_id, which
--                            is the equivalent multi-tenant guard for
--                            update-only handlers.)
--               Invariant 5: post-UPDATE ROW_COUNT vs expected from
--                            snapshot's `before` count.
--               Invariant 6: N/A — none of these column sets contain FK
--                            columns. (eligible_testing_service_keys is
--                            TEXT[] of natural keys, not FK ids.)
--   ADR-024 — lock_targets_for_kind by inner RPC step 4; these handlers
--             don't lock themselves.
--
-- R6-B1 — explicit REVOKE FROM service_role.
--
-- ────────────────────────────────────────────────────────────────────────
-- Snapshot field shape (all 3 handlers — UPSERT-only):
-- ────────────────────────────────────────────────────────────────────────
--   p_snapshot = {
--     "snapshot_kind":   "concern_subcategories_descriptions_v2" | ...,
--     "before":          { "<id>": {row...}, ... },     -- pre-upload state
--     "after_hash":      "<sha256-hex>",
--     "expected_after_state_canonical": "<pipe-delimited>"
--   }
--
-- No `added_keys` field (these handlers cannot INSERT).
-- ════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════
-- HANDLER 1 of 3 — revert_subcategory_descriptions_v2
-- ════════════════════════════════════════════════════════════════════════
-- Mutation surface: concern_subcategories.{description, positive_examples,
--                   negative_examples, synonyms} for (p_shop_id)
-- Snapshot keys:    BIGSERIAL ids (concern_subcategories.id)
-- Apply path:       uploadSubcategoryDescriptionsMdV2 in scheduler-admin-catalog.ts
-- Canonical mirror: canonical_state_subcategory_descriptions_v2 (E1b dispatch)
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.revert_subcategory_descriptions_v2(
  p_shop_id  INTEGER,
  p_snapshot JSONB
) RETURNS TABLE(restored INT, deactivated INT, deleted INT, details JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_before          JSONB;
  v_expected_writes INTEGER := 0;
  v_actual_writes   INTEGER := 0;
BEGIN
  -- ── Input validation ────────────────────────────────────────────────
  IF p_snapshot IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_subcategory_descriptions_v2 received NULL p_snapshot'
      USING ERRCODE = '22023';
  END IF;

  v_before := COALESCE(p_snapshot->'before', '{}'::JSONB);

  IF jsonb_typeof(v_before) <> 'object' THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_subcategory_descriptions_v2 snapshot.before must be JSONB object (got %)', jsonb_typeof(v_before)
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_expected_writes
    FROM jsonb_each(v_before);

  -- ── UPDATE existing rows from snapshot (ADR-019 Invariant 1 + 5) ────
  -- Invariant 1 equivalent for UPDATE-only handlers: WHERE shop_id =
  -- p_shop_id confines mutation to caller's tenant. A tampered snapshot
  -- with an id matching another shop's row hits the WHERE clause and
  -- silently skips — Invariant 5 row-count catch follows.
  WITH attempted AS (
    UPDATE public.concern_subcategories cs
       SET description        = src.val->>'description',
           positive_examples  = CASE WHEN src.val->'positive_examples' IS NULL
                                       OR jsonb_typeof(src.val->'positive_examples') = 'null'
                                     THEN NULL
                                     ELSE ARRAY(SELECT jsonb_array_elements_text(src.val->'positive_examples'))
                                END,
           negative_examples  = CASE WHEN src.val->'negative_examples' IS NULL
                                       OR jsonb_typeof(src.val->'negative_examples') = 'null'
                                     THEN NULL
                                     ELSE ARRAY(SELECT jsonb_array_elements_text(src.val->'negative_examples'))
                                END,
           synonyms           = CASE WHEN src.val->'synonyms' IS NULL
                                       OR jsonb_typeof(src.val->'synonyms') = 'null'
                                     THEN NULL
                                     ELSE ARRAY(SELECT jsonb_array_elements_text(src.val->'synonyms'))
                                END,
           updated_at         = now()
      FROM jsonb_each(v_before) AS src(key, val)
     WHERE cs.id      = (src.key)::BIGINT
       AND cs.shop_id = p_shop_id   -- Invariant 1: tenant scope
    RETURNING 1
  )
  SELECT count(*) INTO v_actual_writes FROM attempted;

  -- ── Invariant 5: row-count check (ADR-019) ──────────────────────────
  IF v_actual_writes < v_expected_writes THEN
    RAISE EXCEPTION 'revert_blocked: cross_shop_hijack_attempt: revert_subcategory_descriptions_v2 snapshot carries % rows but only % were writable in shop % (snapshot ids may collide with another shop''s rows or rows were deleted out-of-band)',
      v_expected_writes, v_actual_writes, p_shop_id
      USING ERRCODE = '42501';
  END IF;

  restored    := v_actual_writes;
  deactivated := 0;
  deleted     := 0;
  details     := '{}'::JSONB;
  RETURN NEXT;

EXCEPTION
  WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'revert_blocked: fk_broken: revert_subcategory_descriptions_v2 raised foreign_key_violation (SQLERRM=%)', SQLERRM
      USING ERRCODE = '23503';
END $$;

REVOKE EXECUTE ON FUNCTION public.revert_subcategory_descriptions_v2(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_subcategory_descriptions_v2(INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revert_subcategory_descriptions_v2(INTEGER, JSONB) FROM service_role;

COMMENT ON FUNCTION public.revert_subcategory_descriptions_v2(INTEGER, JSONB) IS
  'Revert handler for snapshot_kind=concern_subcategories_descriptions_v2 per ADR-004 + ADR-019. UPDATE-only — no INSERTs to undo. Mutates description/positive_examples/negative_examples/synonyms cols. NO GRANT to service_role per ADR-005.';


-- ════════════════════════════════════════════════════════════════════════
-- HANDLER 2 of 3 — revert_subcategory_service_map_v2
-- ════════════════════════════════════════════════════════════════════════
-- Mutation surface: concern_subcategories.eligible_testing_service_keys
--                   for (p_shop_id)
-- Snapshot keys:    BIGSERIAL ids
-- Apply path:       uploadSubcategoryServiceMapMdV2
-- Canonical mirror: canonical_state_subcategory_service_map_v2
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.revert_subcategory_service_map_v2(
  p_shop_id  INTEGER,
  p_snapshot JSONB
) RETURNS TABLE(restored INT, deactivated INT, deleted INT, details JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_before          JSONB;
  v_expected_writes INTEGER := 0;
  v_actual_writes   INTEGER := 0;
BEGIN
  IF p_snapshot IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_subcategory_service_map_v2 received NULL p_snapshot'
      USING ERRCODE = '22023';
  END IF;

  v_before := COALESCE(p_snapshot->'before', '{}'::JSONB);

  IF jsonb_typeof(v_before) <> 'object' THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_subcategory_service_map_v2 snapshot.before must be JSONB object (got %)', jsonb_typeof(v_before)
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_expected_writes
    FROM jsonb_each(v_before);

  -- ── UPDATE existing rows from snapshot (ADR-019 Invariant 1 + 5) ────
  WITH attempted AS (
    UPDATE public.concern_subcategories cs
       SET eligible_testing_service_keys =
             CASE WHEN src.val->'eligible_testing_service_keys' IS NULL
                    OR jsonb_typeof(src.val->'eligible_testing_service_keys') = 'null'
                  THEN NULL
                  ELSE ARRAY(SELECT jsonb_array_elements_text(src.val->'eligible_testing_service_keys'))
             END,
           updated_at = now()
      FROM jsonb_each(v_before) AS src(key, val)
     WHERE cs.id      = (src.key)::BIGINT
       AND cs.shop_id = p_shop_id
    RETURNING 1
  )
  SELECT count(*) INTO v_actual_writes FROM attempted;

  IF v_actual_writes < v_expected_writes THEN
    RAISE EXCEPTION 'revert_blocked: cross_shop_hijack_attempt: revert_subcategory_service_map_v2 snapshot carries % rows but only % were writable in shop %',
      v_expected_writes, v_actual_writes, p_shop_id
      USING ERRCODE = '42501';
  END IF;

  restored    := v_actual_writes;
  deactivated := 0;
  deleted     := 0;
  details     := '{}'::JSONB;
  RETURN NEXT;

EXCEPTION
  WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'revert_blocked: fk_broken: revert_subcategory_service_map_v2 raised foreign_key_violation (SQLERRM=%)', SQLERRM
      USING ERRCODE = '23503';
END $$;

REVOKE EXECUTE ON FUNCTION public.revert_subcategory_service_map_v2(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_subcategory_service_map_v2(INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revert_subcategory_service_map_v2(INTEGER, JSONB) FROM service_role;

COMMENT ON FUNCTION public.revert_subcategory_service_map_v2(INTEGER, JSONB) IS
  'Revert handler for snapshot_kind=concern_subcategories_map_v2 per ADR-004 + ADR-019. UPDATE-only — restores eligible_testing_service_keys col. NO GRANT to service_role per ADR-005.';


-- ════════════════════════════════════════════════════════════════════════
-- HANDLER 3 of 3 — revert_question_required_facts_v2
-- ════════════════════════════════════════════════════════════════════════
-- Mutation surface: concern_questions.required_facts (ordered TEXT[])
--                   for (p_shop_id)
-- Snapshot keys:    BIGSERIAL ids (concern_questions.id)
-- Apply path:       uploadQuestionRequiredFactsMdV2
-- Canonical mirror: canonical_state_question_required_facts_v2
--
-- IMPORTANT: required_facts is an ORDERED array (MD-order is canonical
-- per catalog.ts:2152). Snapshot stores the ordered JSON array; revert
-- must preserve the order, NOT alphabetically re-sort. We use the
-- WITH ORDINALITY pattern to restore the original index order.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.revert_question_required_facts_v2(
  p_shop_id  INTEGER,
  p_snapshot JSONB
) RETURNS TABLE(restored INT, deactivated INT, deleted INT, details JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_before          JSONB;
  v_expected_writes INTEGER := 0;
  v_actual_writes   INTEGER := 0;
BEGIN
  IF p_snapshot IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_question_required_facts_v2 received NULL p_snapshot'
      USING ERRCODE = '22023';
  END IF;

  v_before := COALESCE(p_snapshot->'before', '{}'::JSONB);

  IF jsonb_typeof(v_before) <> 'object' THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_question_required_facts_v2 snapshot.before must be JSONB object (got %)', jsonb_typeof(v_before)
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_expected_writes
    FROM jsonb_each(v_before);

  -- ── UPDATE existing rows from snapshot (ADR-019 Invariant 1 + 5) ────
  -- required_facts: preserve incoming order. WITH ORDINALITY mirrors the
  -- canonical_state serializer's `unnest(...) WITH ORDINALITY` pattern
  -- (per E1b helper 7, orchestrator review item #5).
  WITH attempted AS (
    UPDATE public.concern_questions cq
       SET required_facts =
             CASE WHEN src.val->'required_facts' IS NULL
                    OR jsonb_typeof(src.val->'required_facts') = 'null'
                  THEN NULL
                  ELSE (
                    SELECT ARRAY(
                      SELECT elem::TEXT
                        FROM jsonb_array_elements_text(src.val->'required_facts') WITH ORDINALITY AS j(elem, ord)
                       ORDER BY ord
                    )
                  )
             END,
           updated_at = now()
      FROM jsonb_each(v_before) AS src(key, val)
     WHERE cq.id      = (src.key)::BIGINT
       AND cq.shop_id = p_shop_id
    RETURNING 1
  )
  SELECT count(*) INTO v_actual_writes FROM attempted;

  IF v_actual_writes < v_expected_writes THEN
    RAISE EXCEPTION 'revert_blocked: cross_shop_hijack_attempt: revert_question_required_facts_v2 snapshot carries % rows but only % were writable in shop %',
      v_expected_writes, v_actual_writes, p_shop_id
      USING ERRCODE = '42501';
  END IF;

  restored    := v_actual_writes;
  deactivated := 0;
  deleted     := 0;
  details     := '{}'::JSONB;
  RETURN NEXT;

EXCEPTION
  WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'revert_blocked: fk_broken: revert_question_required_facts_v2 raised foreign_key_violation (SQLERRM=%)', SQLERRM
      USING ERRCODE = '23503';
END $$;

REVOKE EXECUTE ON FUNCTION public.revert_question_required_facts_v2(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_question_required_facts_v2(INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revert_question_required_facts_v2(INTEGER, JSONB) FROM service_role;

COMMENT ON FUNCTION public.revert_question_required_facts_v2(INTEGER, JSONB) IS
  'Revert handler for snapshot_kind=concern_questions_required_facts_v2 per ADR-004 + ADR-019. UPDATE-only — restores required_facts ORDERED TEXT[] (uses WITH ORDINALITY to preserve order). NO GRANT to service_role per ADR-005.';


-- ════════════════════════════════════════════════════════════════════════
-- END E1d migration — 3 handlers created
--
-- Next file (E1e): 20260526000400_revert_handlers_legacy.sql
-- creates 5 legacy-uploader revert handlers (concern_questions_flat,
-- concern_category_upload, concern_category_guideline, appointment_default_limits,
-- closed_dates_future).
-- ════════════════════════════════════════════════════════════════════════
