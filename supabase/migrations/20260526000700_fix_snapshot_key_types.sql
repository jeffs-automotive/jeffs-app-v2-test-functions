-- ════════════════════════════════════════════════════════════════════════
-- scheduler-edge-parity feature — E11f-smoke-fix: snapshot-key type fixes
-- ════════════════════════════════════════════════════════════════════════
--
-- BUG SUMMARY (discovered during E11f smoke test of revert_md_upload_attempt
-- on audit row 41, 2026-05-26):
--
--   The 5 V2 catalog/sub-surface uploaders key pre_state_snapshot.before by
--   the row's NATURAL IDENTITY (service_key TEXT, category/slug TEXT
--   composite, qid_<id> TEXT prefixed) — NOT by the table's scalar id PK.
--   But the E1b dispatch (`lock_targets_for_kind`), the E1c-d revert
--   handlers, and the E1f apply RPCs were written assuming the snapshot
--   keys cast directly to the PK type (UUID or BIGINT).
--
--   Concrete failure: `revert_md_upload_attempt(p_upload_id=41, p_dry_run=TRUE)`
--   on the legacy `testing_services` row returned:
--     outcome=crashed; error_detail=22P02::invalid input syntax for type
--     uuid: "check_ac"
--   because `lock_targets_for_kind` Kind 1 was:
--     `SELECT (jsonb_object_keys(snapshot->'before'))::UUID FROM ...`
--   and the snapshot keys are `"check_ac"`, `"battery_test"`, etc.
--
-- VERIFIED VIA REAL DATA (audit rows 41/42/44/45) + uploader source review:
--
--   | # | Kind                                       | Snapshot key shape         | Snapshot value carries `id`? |
--   | 1 | testing_services_v2                        | service_key TEXT            | NO                            |
--   | 2 | routine_services_v2                        | service_key TEXT            | NO                            |
--   | 3 | concern_subcategories_descriptions_v2      | "<category>/<slug>" TEXT    | YES                           |
--   | 4 | concern_subcategories_map_v2               | "<category>::<slug>" TEXT   | YES                           |
--   | 5 | concern_questions_required_facts_v2        | "qid_<id>" TEXT             | YES                           |
--   | 6 | concern_questions_flat                     | String(id) → "42"           | YES   (already aligned)       |
--   | 7 | concern_questions_per_category             | String(id) → "42" (sub+q)   | YES   (already aligned)       |
--   | 8 | concern_category_guidelines                | <category> slug TEXT        | mixed (already aligned)       |
--   | 9 | appointment_default_limits                 | String(day_of_week) → "3"   | YES   (already aligned E1cf-N1)|
--   |10 | closed_dates_future                        | <YYYY-MM-DD> DATE string    | YES   (already aligned)       |
--
-- FIX STRATEGY:
--
--   - Kinds 1, 2 (testing/routine_services_v2): snapshot values have NO `id`,
--     so look up by the natural identity column `service_key`. The table's
--     `UNIQUE (shop_id, service_key)` constraint serves as the ON CONFLICT
--     target (cross-shop hijack STRUCTURALLY IMPOSSIBLE per ADR-019 alt).
--     Convert: dispatch lock branches, revert handler INSERT id/conflict,
--     handler soft-delete WHERE clause, all to service_key TEXT space.
--
--   - Kinds 3, 4, 5 (V2 sub-surface handlers): snapshot values DO carry
--     `id`. Look up by `(val->>'id')::BIGINT` instead of `(key)::BIGINT`.
--     Convert: dispatch lock branches, revert handler UPDATE WHERE clause.
--
--   - Kinds 6-10: ALIGNED. No changes.
--
-- WHAT THIS MIGRATION REPLACES (idempotent CREATE OR REPLACE):
--
--   1. lock_targets_for_kind (whole helper rewritten — CASE branches aren't
--      individually replaceable in plpgsql; non-affected branches kept verbatim)
--   2. revert_testing_services_v2
--   3. revert_routine_services_v2
--   4. revert_subcategory_descriptions_v2
--   5. revert_subcategory_service_map_v2
--   6. revert_question_required_facts_v2
--
-- NOT TOUCHED (already aligned):
--   - canonical_state_<kind> serializers (read whole surface; key shape
--     orthogonal — they emit deterministic text from full table state)
--   - apply RPCs (5 NEW ones) — they consume p_diff (NOT p_snapshot key
--     space) and pass through p_snapshot verbatim. No fix needed because
--     V2 catalogs' apply path is _uploadCatalogV2 (TS), NOT a plpgsql
--     apply RPC. The 5 NEW plpgsql apply RPCs (E1f) cover kinds 6-10
--     which are already aligned.
--   - kinds 6-10 dispatch + handlers (already aligned per E1cf-N1 +
--     the original design for INT-keyed kinds).
--
-- GRANT PATTERN (matches originals per ADR-005):
--   All 6 functions here are INTERNAL per ADR-005. NO GRANT to service_role.
--   Explicit REVOKE EXECUTE FROM PUBLIC + anon + authenticated + service_role
--   triple per R6-B1 (CREATE OR REPLACE preserves stale grants).
-- ════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════
-- FIX 1 of 6 — lock_targets_for_kind (whole helper rewrite)
-- ════════════════════════════════════════════════════════════════════════
-- Changes vs E1b:
--   Kind 1 (testing_services_v2)        : v_uuid_ids → v_service_keys TEXT[];
--                                          WHERE id = ANY → WHERE service_key = ANY
--   Kind 2 (routine_services_v2)        : same as Kind 1
--   Kind 3 (subcategories_descriptions) : read (val->>'id')::BIGINT instead of (key)::BIGINT
--   Kind 4 (subcategories_map)          : same as Kind 3
--   Kind 5 (questions_required_facts)   : same as Kind 3 (read val->>'id', not key)
--   Kinds 6-10: VERBATIM from E1b (no change — already aligned).
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.lock_targets_for_kind(
  p_kind TEXT,
  p_shop_id INTEGER,
  p_snapshot JSONB
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_lock_count    INTEGER := 0;
  v_int_ids       BIGINT[];
  v_service_keys  TEXT[];      -- NEW: for kinds 1, 2 — natural identity TEXT lookup
  v_categories    TEXT[];
  v_date          DATE;
  v_dates         DATE[];
BEGIN
  -- ─── PHASE 1 — surface lock (MANDATORY for all 10 kinds, per ADR-024 §0) ───
  PERFORM public.lock_surface_for_kind(p_shop_id, p_kind);

  -- ─── PHASE 2 — per-row / per-key locks per ADR-024 §1 lock-predicate table ───

  CASE p_kind

    -- ─── Kind 1: testing_services_v2 ─────────────────────────────────
    -- E11f-smoke-fix: snapshot keys are service_key TEXT (uploader writes
    -- snapshotBefore[mod.before.service_key] in catalog.ts:590 +
    -- added_keys = diff.added.map(r => r.service_key) in catalog.ts:594).
    -- Snapshot VALUES do NOT carry `id`. Look up by service_key.
    WHEN 'testing_services_v2' THEN
      SELECT ARRAY(
        SELECT DISTINCT v FROM (
          SELECT jsonb_object_keys(COALESCE(p_snapshot->'before', '{}'::JSONB)) AS v
          UNION ALL
          SELECT jsonb_array_elements_text(COALESCE(p_snapshot->'added_keys', '[]'::JSONB)) AS v
        ) k
        WHERE v IS NOT NULL AND v <> ''
      ) INTO v_service_keys;
      PERFORM 1 FROM public.testing_services
        WHERE shop_id = p_shop_id AND service_key = ANY(v_service_keys)
        ORDER BY service_key ASC
        FOR UPDATE;
      GET DIAGNOSTICS v_lock_count = ROW_COUNT;

    -- ─── Kind 2: routine_services_v2 ─────────────────────────────────
    -- Same shape as Kind 1.
    WHEN 'routine_services_v2' THEN
      SELECT ARRAY(
        SELECT DISTINCT v FROM (
          SELECT jsonb_object_keys(COALESCE(p_snapshot->'before', '{}'::JSONB)) AS v
          UNION ALL
          SELECT jsonb_array_elements_text(COALESCE(p_snapshot->'added_keys', '[]'::JSONB)) AS v
        ) k
        WHERE v IS NOT NULL AND v <> ''
      ) INTO v_service_keys;
      PERFORM 1 FROM public.routine_services
        WHERE shop_id = p_shop_id AND service_key = ANY(v_service_keys)
        ORDER BY service_key ASC
        FOR UPDATE;
      GET DIAGNOSTICS v_lock_count = ROW_COUNT;

    -- ─── Kind 3: concern_subcategories_descriptions_v2 ───────────────
    -- E11f-smoke-fix: snapshot keys are "<category>/<slug>" TEXT composite
    -- (uploader writes snapshotBefore[`${d.category}/${d.slug}`] in
    -- catalog.ts:2103). Snapshot VALUES carry `id` BIGINT — look up by
    -- val->>'id' instead of key.
    WHEN 'concern_subcategories_descriptions_v2' THEN
      SELECT ARRAY(
        SELECT DISTINCT (val->>'id')::BIGINT
        FROM jsonb_each(COALESCE(p_snapshot->'before', '{}'::JSONB)) AS s(key, val)
        WHERE val->>'id' IS NOT NULL
      ) INTO v_int_ids;
      PERFORM 1 FROM public.concern_subcategories
        WHERE shop_id = p_shop_id AND id = ANY(v_int_ids)
        ORDER BY id ASC
        FOR UPDATE;
      GET DIAGNOSTICS v_lock_count = ROW_COUNT;

    -- ─── Kind 4: concern_subcategories_map_v2 ────────────────────────
    -- E11f-smoke-fix: snapshot keys are "<category>::<slug>" TEXT composite
    -- (uploader writes snapshotBefore[`${d.category}::${d.subcategory_slug}`]
    -- in catalog.ts:1423). Snapshot VALUES carry `id` BIGINT.
    WHEN 'concern_subcategories_map_v2' THEN
      SELECT ARRAY(
        SELECT DISTINCT (val->>'id')::BIGINT
        FROM jsonb_each(COALESCE(p_snapshot->'before', '{}'::JSONB)) AS s(key, val)
        WHERE val->>'id' IS NOT NULL
      ) INTO v_int_ids;
      PERFORM 1 FROM public.concern_subcategories
        WHERE shop_id = p_shop_id AND id = ANY(v_int_ids)
        ORDER BY id ASC
        FOR UPDATE;
      GET DIAGNOSTICS v_lock_count = ROW_COUNT;

    -- ─── Kind 5: concern_questions_required_facts_v2 ─────────────────
    -- E11f-smoke-fix: snapshot keys are "qid_<id>" TEXT prefixed
    -- (uploader writes snapshotBefore[`qid_${d.question_id}`] in
    -- catalog.ts:2649). Snapshot VALUES carry `id` BIGINT.
    WHEN 'concern_questions_required_facts_v2' THEN
      SELECT ARRAY(
        SELECT DISTINCT (val->>'id')::BIGINT
        FROM jsonb_each(COALESCE(p_snapshot->'before', '{}'::JSONB)) AS s(key, val)
        WHERE val->>'id' IS NOT NULL
      ) INTO v_int_ids;
      PERFORM 1 FROM public.concern_questions
        WHERE shop_id = p_shop_id AND id = ANY(v_int_ids)
        ORDER BY id ASC
        FOR UPDATE;
      GET DIAGNOSTICS v_lock_count = ROW_COUNT;

    -- ─── Kind 6: concern_questions_flat (VERBATIM from E1b — ALIGNED) ──
    WHEN 'concern_questions_flat' THEN
      SELECT ARRAY(
        SELECT DISTINCT v::BIGINT FROM (
          SELECT jsonb_object_keys(COALESCE(p_snapshot->'before', '{}'::JSONB)) AS v
          UNION ALL
          SELECT jsonb_array_elements_text(COALESCE(p_snapshot->'added_keys', '[]'::JSONB)) AS v
        ) k
        WHERE v IS NOT NULL AND v <> ''
      ) INTO v_int_ids;
      PERFORM 1 FROM public.concern_questions
        WHERE shop_id = p_shop_id AND id = ANY(v_int_ids)
        ORDER BY id ASC
        FOR UPDATE;
      GET DIAGNOSTICS v_lock_count = ROW_COUNT;

    -- ─── Kind 7: concern_questions_per_category (VERBATIM from E1b) ──
    WHEN 'concern_questions_per_category' THEN
      SELECT ARRAY(
        SELECT DISTINCT v::BIGINT FROM (
          SELECT jsonb_object_keys(COALESCE(p_snapshot->'subcategories_before', '{}'::JSONB)) AS v
          UNION ALL
          SELECT jsonb_array_elements_text(COALESCE(p_snapshot->'added_subcategory_ids', '[]'::JSONB)) AS v
          UNION ALL
          SELECT (rec.value->>'subcategory_id') AS v
            FROM jsonb_each(COALESCE(p_snapshot->'questions_before', '{}'::JSONB)) AS rec
           WHERE rec.value->>'subcategory_id' IS NOT NULL
        ) k
        WHERE v IS NOT NULL AND v <> ''
      ) INTO v_int_ids;
      PERFORM 1 FROM public.concern_subcategories
        WHERE shop_id = p_shop_id AND id = ANY(v_int_ids)
        ORDER BY id ASC
        FOR UPDATE;
      GET DIAGNOSTICS v_lock_count = ROW_COUNT;

      SELECT ARRAY(
        SELECT DISTINCT v::BIGINT FROM (
          SELECT jsonb_object_keys(COALESCE(p_snapshot->'questions_before', '{}'::JSONB)) AS v
          UNION ALL
          SELECT jsonb_array_elements_text(COALESCE(p_snapshot->'added_question_ids', '[]'::JSONB)) AS v
        ) k
        WHERE v IS NOT NULL AND v <> ''
      ) INTO v_int_ids;
      PERFORM 1 FROM public.concern_questions
        WHERE shop_id = p_shop_id AND id = ANY(v_int_ids)
        ORDER BY id ASC
        FOR UPDATE;
      v_lock_count := v_lock_count + COALESCE((SELECT COUNT(*) FROM public.concern_questions
        WHERE shop_id = p_shop_id AND id = ANY(v_int_ids)), 0);

    -- ─── Kind 8: concern_category_guidelines (VERBATIM from E1b) ─────
    WHEN 'concern_category_guidelines' THEN
      SELECT ARRAY(
        SELECT DISTINCT v FROM (
          SELECT jsonb_object_keys(COALESCE(p_snapshot->'before', '{}'::JSONB)) AS v
          UNION ALL
          SELECT jsonb_array_elements_text(COALESCE(p_snapshot->'added_keys', '[]'::JSONB)) AS v
        ) k
        WHERE v IS NOT NULL AND v <> ''
      ) INTO v_categories;
      PERFORM 1 FROM public.concern_category_guidelines
        WHERE shop_id = p_shop_id AND category = ANY(v_categories)
        ORDER BY category ASC
        FOR UPDATE;
      GET DIAGNOSTICS v_lock_count = ROW_COUNT;

    -- ─── Kind 9: appointment_default_limits (VERBATIM from E1b — ALIGNED E1cf-N1) ──
    WHEN 'appointment_default_limits' THEN
      SELECT ARRAY(
        SELECT DISTINCT v::BIGINT FROM (
          SELECT jsonb_object_keys(COALESCE(p_snapshot->'before', '{}'::JSONB)) AS v
          UNION ALL
          SELECT jsonb_array_elements_text(COALESCE(p_snapshot->'added_keys', '[]'::JSONB)) AS v
        ) k
        WHERE v IS NOT NULL AND v <> ''
      ) INTO v_int_ids;
      PERFORM 1 FROM public.appointment_default_limits
        WHERE shop_id = p_shop_id AND day_of_week = ANY(v_int_ids::INT[])
        ORDER BY day_of_week ASC
        FOR UPDATE;
      GET DIAGNOSTICS v_lock_count = ROW_COUNT;

    -- ─── Kind 10: closed_dates_future (VERBATIM from E1b) ────────────
    WHEN 'closed_dates_future' THEN
      SELECT ARRAY(
        SELECT DISTINCT v::DATE FROM (
          SELECT jsonb_object_keys(COALESCE(p_snapshot->'before', '{}'::JSONB)) AS v
          UNION ALL
          SELECT jsonb_array_elements_text(COALESCE(p_snapshot->'added_keys', '[]'::JSONB)) AS v
        ) k
        WHERE v IS NOT NULL AND v <> ''
      ) INTO v_dates;

      FOR v_date IN
        SELECT d FROM unnest(v_dates) AS d
        ORDER BY d ASC
      LOOP
        PERFORM pg_advisory_xact_lock(
          p_shop_id::INT,
          hashtext(v_date::TEXT)
        );
        v_lock_count := v_lock_count + 1;
      END LOOP;

      PERFORM 1 FROM public.closed_dates
        WHERE shop_id = p_shop_id AND closed_date = ANY(v_dates)
        ORDER BY closed_date ASC
        FOR UPDATE;

    ELSE
      RAISE EXCEPTION 'revert_blocked: snapshot_kind_unknown: lock_targets_for_kind does not handle kind=% (system bug — extend the CASE block)', p_kind
        USING ERRCODE = '22023';
  END CASE;

  RETURN v_lock_count;
END $$;

REVOKE EXECUTE ON FUNCTION public.lock_targets_for_kind(TEXT, INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lock_targets_for_kind(TEXT, INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lock_targets_for_kind(TEXT, INTEGER, JSONB) FROM service_role;

COMMENT ON FUNCTION public.lock_targets_for_kind(TEXT, INTEGER, JSONB) IS
  'E11f-smoke-fix (2026-05-26): Kinds 1, 2 look up by service_key (snapshot keys are TEXT, NOT UUID). Kinds 3, 4, 5 look up by val->>''id'' (snapshot keys are TEXT composite/prefixed, but values carry id BIGINT). Kinds 6-10 unchanged. Step 4 of inner revert RPC per ADR-012. NO GRANT to service_role per ADR-005.';


-- ════════════════════════════════════════════════════════════════════════
-- FIX 2 of 6 — revert_testing_services_v2
-- ════════════════════════════════════════════════════════════════════════
-- Changes:
--   - INSERT id column REMOVED from column list (snapshot value has no id,
--     and we don't want to overwrite UUIDs anyway — keep existing row's PK)
--   - INSERT instead pulls service_key from snapshot value (which it does carry)
--   - ON CONFLICT target → (shop_id, service_key) — composite-natural-key
--     conflict structurally bars cross-shop hijack per ADR-019 preferred alt
--   - Soft-delete: WHERE service_key = ANY(v_added_service_keys) instead of
--     id = ANY(v_added_uuid_arr) — added_keys ARE service_keys (catalog.ts:594)
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.revert_testing_services_v2(
  p_shop_id  INTEGER,
  p_snapshot JSONB
) RETURNS TABLE(restored INT, deactivated INT, deleted INT, details JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_before                 JSONB;
  v_added_keys             JSONB;
  v_added_service_key_arr  TEXT[];
  v_expected_writes        INTEGER := 0;
  v_actual_writes          INTEGER := 0;
  v_actual_deact           INTEGER := 0;
BEGIN
  IF p_snapshot IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_testing_services_v2 received NULL p_snapshot'
      USING ERRCODE = '22023';
  END IF;

  v_before     := COALESCE(p_snapshot->'before',     '{}'::JSONB);
  v_added_keys := COALESCE(p_snapshot->'added_keys', '[]'::JSONB);

  IF jsonb_typeof(v_before) <> 'object' THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_testing_services_v2 snapshot.before must be JSONB object (got %)', jsonb_typeof(v_before)
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_added_keys) <> 'array' THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_testing_services_v2 snapshot.added_keys must be JSONB array (got %)', jsonb_typeof(v_added_keys)
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_expected_writes
    FROM jsonb_each(v_before);

  -- E11f-smoke-fix: added_keys are service_keys (TEXT), not UUIDs.
  SELECT ARRAY(
    SELECT v FROM (
      SELECT jsonb_array_elements_text(v_added_keys) AS v
    ) k
    WHERE v IS NOT NULL AND v <> ''
  ) INTO v_added_service_key_arr;

  -- ── UPSERT-restore "before" rows ────────────────────────────────────
  -- E11f-smoke-fix: snapshot key IS the service_key. Use composite natural
  -- key (shop_id, service_key) as ON CONFLICT target — cross-shop hijack
  -- STRUCTURALLY IMPOSSIBLE per ADR-019 preferred alt.
  --
  -- We do NOT specify `id` in the INSERT column list — let Postgres assign
  -- a fresh UUID on INSERT, or preserve the existing UUID on UPDATE. The
  -- row's natural identity is (shop_id, service_key), not the synthetic UUID.
  WITH attempted AS (
    INSERT INTO public.testing_services (
      shop_id, service_key, display_name, abbreviation,
      starting_price_cents, notes, description, concern_categories,
      example_keywords, active,
      created_at, updated_at,
      updated_by_oauth_client_id, updated_by_name
    )
    SELECT
      p_shop_id                                                     AS shop_id,
      val->>'service_key'                                           AS service_key,
      val->>'display_name'                                          AS display_name,
      val->>'abbreviation'                                          AS abbreviation,
      NULLIF(val->>'starting_price_cents', '')::INTEGER             AS starting_price_cents,
      val->>'notes'                                                 AS notes,
      val->>'description'                                           AS description,
      CASE WHEN val->'concern_categories' IS NULL
             OR jsonb_typeof(val->'concern_categories') = 'null'
           THEN NULL
           ELSE ARRAY(SELECT jsonb_array_elements_text(val->'concern_categories'))
      END                                                           AS concern_categories,
      CASE WHEN val->'example_keywords' IS NULL
             OR jsonb_typeof(val->'example_keywords') = 'null'
           THEN NULL
           ELSE ARRAY(SELECT jsonb_array_elements_text(val->'example_keywords'))
      END                                                           AS example_keywords,
      COALESCE((val->>'active')::BOOLEAN, TRUE)                     AS active,
      COALESCE((val->>'created_at')::TIMESTAMPTZ, now())            AS created_at,
      now()                                                         AS updated_at,
      val->>'updated_by_oauth_client_id'                            AS updated_by_oauth_client_id,
      val->>'updated_by_name'                                       AS updated_by_name
    FROM jsonb_each(v_before) AS s(key, val)
    ON CONFLICT (shop_id, service_key) DO UPDATE SET
      display_name               = EXCLUDED.display_name,
      abbreviation               = EXCLUDED.abbreviation,
      starting_price_cents       = EXCLUDED.starting_price_cents,
      notes                      = EXCLUDED.notes,
      description                = EXCLUDED.description,
      concern_categories         = EXCLUDED.concern_categories,
      example_keywords           = EXCLUDED.example_keywords,
      active                     = EXCLUDED.active,
      updated_at                 = EXCLUDED.updated_at,
      updated_by_oauth_client_id = EXCLUDED.updated_by_oauth_client_id,
      updated_by_name            = EXCLUDED.updated_by_name
    RETURNING 1
  )
  SELECT count(*) INTO v_actual_writes FROM attempted;

  -- Invariant 5 row-count check. With composite-natural-key conflict target
  -- the cross-shop hijack class is structurally impossible, so this check is
  -- defensive against snapshot rows missing the service_key field.
  IF v_actual_writes < v_expected_writes THEN
    RAISE EXCEPTION 'revert_blocked: cross_shop_hijack_attempt: revert_testing_services_v2 snapshot carries % rows but only % were writable in shop % (likely some snapshot.before values lack service_key)',
      v_expected_writes, v_actual_writes, p_shop_id
      USING ERRCODE = '42501';
  END IF;

  -- ── Soft-delete added rows (undo INSERT side of upload) ─────────────
  -- E11f-smoke-fix: added_keys are service_keys (TEXT), not UUIDs.
  IF array_length(v_added_service_key_arr, 1) > 0 THEN
    UPDATE public.testing_services
       SET active     = FALSE,
           updated_at = now()
     WHERE shop_id = p_shop_id
       AND service_key = ANY(v_added_service_key_arr)
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
    RAISE EXCEPTION 'revert_blocked: fk_broken: revert_testing_services_v2 raised foreign_key_violation (SQLERRM=%)', SQLERRM
      USING ERRCODE = '23503';
END $$;

REVOKE EXECUTE ON FUNCTION public.revert_testing_services_v2(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_testing_services_v2(INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revert_testing_services_v2(INTEGER, JSONB) FROM service_role;

COMMENT ON FUNCTION public.revert_testing_services_v2(INTEGER, JSONB) IS
  'E11f-smoke-fix (2026-05-26): looks up by (shop_id, service_key) instead of UUID id (snapshot keys + added_keys are service_key strings per catalog.ts uploader). Composite-PK conflict target makes cross-shop hijack structurally impossible per ADR-019 preferred alt. NO GRANT to service_role per ADR-005.';


-- ════════════════════════════════════════════════════════════════════════
-- FIX 3 of 6 — revert_routine_services_v2
-- ════════════════════════════════════════════════════════════════════════
-- Same shape as Fix 2 (Kind 1). routine_services also has UNIQUE (shop_id,
-- service_key) per migration 20260510131752 line 321.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.revert_routine_services_v2(
  p_shop_id  INTEGER,
  p_snapshot JSONB
) RETURNS TABLE(restored INT, deactivated INT, deleted INT, details JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_before                 JSONB;
  v_added_keys             JSONB;
  v_added_service_key_arr  TEXT[];
  v_expected_writes        INTEGER := 0;
  v_actual_writes          INTEGER := 0;
  v_actual_deact           INTEGER := 0;
BEGIN
  IF p_snapshot IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_routine_services_v2 received NULL p_snapshot'
      USING ERRCODE = '22023';
  END IF;

  v_before     := COALESCE(p_snapshot->'before',     '{}'::JSONB);
  v_added_keys := COALESCE(p_snapshot->'added_keys', '[]'::JSONB);

  IF jsonb_typeof(v_before) <> 'object' THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_routine_services_v2 snapshot.before must be JSONB object (got %)', jsonb_typeof(v_before)
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_added_keys) <> 'array' THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: revert_routine_services_v2 snapshot.added_keys must be JSONB array (got %)', jsonb_typeof(v_added_keys)
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_expected_writes
    FROM jsonb_each(v_before);

  SELECT ARRAY(
    SELECT v FROM (
      SELECT jsonb_array_elements_text(v_added_keys) AS v
    ) k
    WHERE v IS NOT NULL AND v <> ''
  ) INTO v_added_service_key_arr;

  WITH attempted AS (
    INSERT INTO public.routine_services (
      shop_id, service_key, display_name, abbreviation,
      display_order, wait_eligible, requires_explanation,
      concern_categories, starting_price_cents, price_waived_note,
      description, active,
      created_at, updated_at,
      updated_by_oauth_client_id, updated_by_name
    )
    SELECT
      p_shop_id                                                     AS shop_id,
      val->>'service_key'                                           AS service_key,
      val->>'display_name'                                          AS display_name,
      val->>'abbreviation'                                          AS abbreviation,
      COALESCE(NULLIF(val->>'display_order', '')::INTEGER, 0)       AS display_order,
      COALESCE((val->>'wait_eligible')::BOOLEAN, FALSE)             AS wait_eligible,
      COALESCE((val->>'requires_explanation')::BOOLEAN, FALSE)      AS requires_explanation,
      CASE WHEN val->'concern_categories' IS NULL
             OR jsonb_typeof(val->'concern_categories') = 'null'
           THEN NULL
           ELSE ARRAY(SELECT jsonb_array_elements_text(val->'concern_categories'))
      END                                                           AS concern_categories,
      NULLIF(val->>'starting_price_cents', '')::INTEGER             AS starting_price_cents,
      val->>'price_waived_note'                                     AS price_waived_note,
      val->>'description'                                           AS description,
      COALESCE((val->>'active')::BOOLEAN, TRUE)                     AS active,
      COALESCE((val->>'created_at')::TIMESTAMPTZ, now())            AS created_at,
      now()                                                         AS updated_at,
      val->>'updated_by_oauth_client_id'                            AS updated_by_oauth_client_id,
      val->>'updated_by_name'                                       AS updated_by_name
    FROM jsonb_each(v_before) AS s(key, val)
    ON CONFLICT (shop_id, service_key) DO UPDATE SET
      display_name               = EXCLUDED.display_name,
      abbreviation               = EXCLUDED.abbreviation,
      display_order              = EXCLUDED.display_order,
      wait_eligible              = EXCLUDED.wait_eligible,
      requires_explanation       = EXCLUDED.requires_explanation,
      concern_categories         = EXCLUDED.concern_categories,
      starting_price_cents       = EXCLUDED.starting_price_cents,
      price_waived_note          = EXCLUDED.price_waived_note,
      description                = EXCLUDED.description,
      active                     = EXCLUDED.active,
      updated_at                 = EXCLUDED.updated_at,
      updated_by_oauth_client_id = EXCLUDED.updated_by_oauth_client_id,
      updated_by_name            = EXCLUDED.updated_by_name
    RETURNING 1
  )
  SELECT count(*) INTO v_actual_writes FROM attempted;

  IF v_actual_writes < v_expected_writes THEN
    RAISE EXCEPTION 'revert_blocked: cross_shop_hijack_attempt: revert_routine_services_v2 snapshot carries % rows but only % were writable in shop %',
      v_expected_writes, v_actual_writes, p_shop_id
      USING ERRCODE = '42501';
  END IF;

  IF array_length(v_added_service_key_arr, 1) > 0 THEN
    UPDATE public.routine_services
       SET active     = FALSE,
           updated_at = now()
     WHERE shop_id = p_shop_id
       AND service_key = ANY(v_added_service_key_arr)
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
    RAISE EXCEPTION 'revert_blocked: fk_broken: revert_routine_services_v2 raised foreign_key_violation (SQLERRM=%)', SQLERRM
      USING ERRCODE = '23503';
END $$;

REVOKE EXECUTE ON FUNCTION public.revert_routine_services_v2(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_routine_services_v2(INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revert_routine_services_v2(INTEGER, JSONB) FROM service_role;

COMMENT ON FUNCTION public.revert_routine_services_v2(INTEGER, JSONB) IS
  'E11f-smoke-fix (2026-05-26): looks up by (shop_id, service_key) instead of UUID id (snapshot keys + added_keys are service_key strings). Same fix pattern as revert_testing_services_v2. NO GRANT to service_role per ADR-005.';


-- ════════════════════════════════════════════════════════════════════════
-- FIX 4 of 6 — revert_subcategory_descriptions_v2
-- ════════════════════════════════════════════════════════════════════════
-- Change: UPDATE WHERE clause uses (val->>'id')::BIGINT instead of
-- (src.key)::BIGINT. Snapshot keys are "<category>/<slug>" TEXT composite
-- (catalog.ts:2103); values carry `id` BIGINT.
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
    FROM jsonb_each(v_before)
    WHERE value->>'id' IS NOT NULL;

  -- E11f-smoke-fix: look up by val->>'id', NOT key.
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
     WHERE cs.id      = (src.val->>'id')::BIGINT   -- E11f-smoke-fix: id from value, not key
       AND cs.shop_id = p_shop_id
       AND src.val->>'id' IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_actual_writes FROM attempted;

  IF v_actual_writes < v_expected_writes THEN
    RAISE EXCEPTION 'revert_blocked: cross_shop_hijack_attempt: revert_subcategory_descriptions_v2 snapshot carries % rows but only % were writable in shop %',
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
  'E11f-smoke-fix (2026-05-26): looks up by val->>''id''::BIGINT instead of key::BIGINT (snapshot keys are <category>/<slug> TEXT composite per catalog.ts:2103; values carry id). NO GRANT to service_role per ADR-005.';


-- ════════════════════════════════════════════════════════════════════════
-- FIX 5 of 6 — revert_subcategory_service_map_v2
-- ════════════════════════════════════════════════════════════════════════
-- Same fix shape as Fix 4: snapshot keys are "<category>::<slug>" TEXT
-- composite (catalog.ts:1423); values carry `id` BIGINT.
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
    FROM jsonb_each(v_before)
    WHERE value->>'id' IS NOT NULL;

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
     WHERE cs.id      = (src.val->>'id')::BIGINT   -- E11f-smoke-fix
       AND cs.shop_id = p_shop_id
       AND src.val->>'id' IS NOT NULL
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
  'E11f-smoke-fix (2026-05-26): looks up by val->>''id''::BIGINT (snapshot keys are <category>::<slug> TEXT composite per catalog.ts:1423; values carry id). NO GRANT to service_role per ADR-005.';


-- ════════════════════════════════════════════════════════════════════════
-- FIX 6 of 6 — revert_question_required_facts_v2
-- ════════════════════════════════════════════════════════════════════════
-- Same fix shape as Fix 4: snapshot keys are "qid_<id>" TEXT prefixed
-- (catalog.ts:2649); values carry `id` BIGINT. The legacy WHERE clause
-- `cq.id = (src.key)::BIGINT` would throw 22P02 on "qid_71".
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
    FROM jsonb_each(v_before)
    WHERE value->>'id' IS NOT NULL;

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
     WHERE cq.id      = (src.val->>'id')::BIGINT   -- E11f-smoke-fix
       AND cq.shop_id = p_shop_id
       AND src.val->>'id' IS NOT NULL
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
  'E11f-smoke-fix (2026-05-26): looks up by val->>''id''::BIGINT (snapshot keys are qid_<id> TEXT prefixed per catalog.ts:2649; values carry id). NO GRANT to service_role per ADR-005.';


-- ════════════════════════════════════════════════════════════════════════
-- END E11f-smoke-fix migration — 6 functions rewritten via CREATE OR REPLACE
--
-- AUDIT FOOTPRINT:
--   - lock_targets_for_kind: 5 of 10 CASE branches changed (1, 2, 3, 4, 5);
--                            other 5 verbatim
--   - 5 revert handlers for kinds 1-5 rewritten
--
-- NOT TOUCHED:
--   - canonical_state_<kind> serializers (whole-surface reads; key shape
--     orthogonal to snapshot key shape — they emit deterministic text
--     from full table state, not snapshot-key lookups)
--   - 5 NEW Pattern S apply RPCs (cover kinds 6-10 which are already
--     aligned; the V2 catalog apply path is TS-side _uploadCatalogV2,
--     not a plpgsql RPC)
--   - kinds 6, 7, 8, 9, 10 dispatch + handlers (already aligned)
--   - outer/inner revert RPCs (no per-kind logic; dispatches to handlers)
-- ════════════════════════════════════════════════════════════════════════
