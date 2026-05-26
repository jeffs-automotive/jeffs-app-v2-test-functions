-- ════════════════════════════════════════════════════════════════════════
-- scheduler-edge-parity feature — E1c: revert handlers for V2 catalogs
-- ════════════════════════════════════════════════════════════════════════
--
-- Creates 2 per-snapshot_kind revert handlers for the V2 catalog uploads:
--   1. revert_testing_services_v2  (snapshot_kind = 'testing_services_v2')
--   2. revert_routine_services_v2  (snapshot_kind = 'routine_services_v2')
--
-- Both handlers are paired with the V2 catalog uploaders that already use
-- Pattern S (`_uploadCatalogV2` in scheduler-admin-catalog.ts). They UPSERT
-- the snapshot's `before` rows back into their tables AND soft-delete (set
-- active=false) any rows whose ids were INSERTed by the original upload
-- (recorded in snapshot's `added_keys`).
--
-- ────────────────────────────────────────────────────────────────────────
-- Cross-references (every ADR + R6 residual that governs this file):
-- ────────────────────────────────────────────────────────────────────────
--   ADR-004 — universal handler return shape TABLE(restored INT,
--             deactivated INT, deleted INT, details JSONB). Both handlers
--             return `details = '{}'::JSONB` (no handler-specific metadata).
--   ADR-005 — internal set: NO GRANT to service_role. Handlers reachable
--             ONLY via SECURITY DEFINER ownership chain from the inner RPC
--             (dispatched by revert_md_upload_apply step 9). R6-B1 explicit
--             REVOKE FROM service_role triple defends against stale grants
--             preserved by CREATE OR REPLACE.
--   ADR-007 — canonical reason_code enum. Handlers RAISE one of:
--               revert_blocked: cross_shop_hijack_attempt: ... (Invariant 5)
--               revert_blocked: fk_target_tenant_mismatch: ... (Invariant 6)
--               revert_blocked: fk_broken: ... (FK violation post-mutation)
--               revert_blocked: snapshot_invalid: ... (input validators)
--             All raised with USING ERRCODE = '42501' (Invariant 5/6) or
--             '23503' (FK), classifier extracts enum via regex.
--   ADR-008 — outer classifier maps fk_target_tenant_mismatch → fk_broken;
--             handlers use either prefix.
--   ADR-013 — N/A (closed_dates handler lives in E1e).
--   ADR-017 — SET search_path = pg_catalog, extensions, public, pg_temp
--             on every SECURITY DEFINER function.
--   ADR-019 — Handler invariants 1+5+6:
--               Invariant 1: INSERT … ON CONFLICT (id) DO UPDATE …
--                            WHERE target.shop_id = p_shop_id
--                            (skips cross-shop conflict-targets instead of
--                            hijacking them)
--               Invariant 5: post-write ROW_COUNT vs expected from snapshot;
--                            RAISE cross_shop_hijack_attempt if short
--               Invariant 6: N/A for testing_services / routine_services —
--                            neither table has FK columns this handler
--                            UPSERTs into snapshot rows. (concern_categories
--                            and example_keywords are TEXT[] arrays — not
--                            FKs to other tables.) Invariant 6 is a no-op
--                            for these two kinds.
--   ADR-024 — lock_targets_for_kind acquired by inner RPC step 4 BEFORE
--             this handler is called. Handler does NOT call locks itself.
--             Defense-in-depth SELECT … FOR UPDATE may be inlined for
--             readability, but is redundant with inner-RPC step 4.
--
-- R6-B1 — explicit REVOKE FROM service_role on EVERY handler (CREATE OR
--         REPLACE preserves stale grants).
--
-- ────────────────────────────────────────────────────────────────────────
-- Snapshot field shape (read by both handlers):
-- ────────────────────────────────────────────────────────────────────────
--   p_snapshot = {
--     "snapshot_kind":   "testing_services_v2" | "routine_services_v2",
--     "before":          { "<uuid>": {row...}, ... },   -- pre-upload state
--     "added_keys":      ["<uuid>", "<uuid>", ...],     -- ids inserted by upload
--     "after_hash":      "<sha256-hex>",                 -- canonical post-upload
--     "expected_after_state_canonical": "<pipe-delimited>"
--   }
--
-- Revert strategy:
--   - UPSERT-restore every row in `before` (snapshot of pre-upload state)
--   - Soft-delete (active=false) every id in `added_keys` (rows the upload
--     INSERTed — undoing the upload means removing them)
-- ════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════
-- HANDLER 1 of 2 — revert_testing_services_v2
-- ════════════════════════════════════════════════════════════════════════
-- Mutation surface: testing_services table for (p_shop_id)
-- Snapshot keys:    UUID strings (testing_services.id is UUID)
-- Apply path:       _uploadCatalogV2(TESTING_CONFIG) in scheduler-admin-catalog.ts
-- Canonical mirror: canonical_state_testing_services_v2 (E1b dispatch)
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
  v_before          JSONB;
  v_added_keys      JSONB;
  v_added_uuid_arr  UUID[];
  v_expected_writes INTEGER := 0;
  v_actual_writes   INTEGER := 0;
  v_actual_deact    INTEGER := 0;
BEGIN
  -- ── Input validation (ADR-007 snapshot_invalid enum) ────────────────
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

  -- Compute expected writes for Invariant 5 (post-UPSERT row-count check).
  SELECT count(*) INTO v_expected_writes
    FROM jsonb_each(v_before);

  -- Materialize added_keys to a UUID[] for the soft-delete pass.
  -- Use subquery-alias pattern (canonical per E1b dispatch helper 2) to
  -- avoid double-evaluation of the SRF in a no-FROM SELECT body.
  SELECT ARRAY(
    SELECT v::UUID FROM (
      SELECT jsonb_array_elements_text(v_added_keys) AS v
    ) k
    WHERE v IS NOT NULL AND v <> ''
  ) INTO v_added_uuid_arr;

  -- ── Invariant 6: FK target tenant validation ────────────────────────
  -- testing_services has NO FK columns in its mutation surface
  -- (concern_categories is TEXT[], not a FK). Invariant 6 is a no-op here.

  -- ── UPSERT-restore "before" rows (ADR-019 Invariants 1 + 5) ─────────
  -- Invariant 1: WHERE target.shop_id = p_shop_id on DO UPDATE skips
  -- cross-shop conflict-targets (an attacker-tampered snapshot row whose
  -- `id` matches another shop's row cannot hijack that row).
  --
  -- All snapshot rows are INSERT-shape (shop_id := p_shop_id, all columns
  -- from snapshot value). Conflict on `id` (UUID PK).
  WITH attempted AS (
    INSERT INTO public.testing_services (
      id, shop_id, service_key, display_name, abbreviation,
      starting_price_cents, notes, description, concern_categories,
      example_keywords, active,
      created_at, updated_at,
      updated_by_oauth_client_id, updated_by_name
    )
    SELECT
      (key)::UUID                                                   AS id,
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
    ON CONFLICT (id) DO UPDATE SET
      service_key                = EXCLUDED.service_key,
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
      WHERE testing_services.shop_id = p_shop_id   -- Invariant 1: SKIP cross-shop hijack
    RETURNING 1
  )
  SELECT count(*) INTO v_actual_writes FROM attempted;

  -- ── Invariant 5: row-count check (ADR-019) ──────────────────────────
  -- If WHERE-filtered DO UPDATE silently skipped foreign-shop rows, the
  -- count comes back short → loud rejection. Sentry-safe: error_detail
  -- carries counts only (no row IDs per ADR-010 reach Sentry).
  IF v_actual_writes < v_expected_writes THEN
    RAISE EXCEPTION 'revert_blocked: cross_shop_hijack_attempt: revert_testing_services_v2 snapshot carries % rows but only % were writable in shop % (suggests one or more snapshot ids collide with another shop''s rows — possible tampered snapshot)',
      v_expected_writes, v_actual_writes, p_shop_id
      USING ERRCODE = '42501';
  END IF;

  -- ── Soft-delete added rows (undo INSERT side of upload) ─────────────
  -- Filter by shop_id is BELT-AND-SUSPENDERS — without it, a tampered
  -- added_keys entry could deactivate another shop's row. Inner RPC's
  -- step-4 lock already locked these rows under shop_id = p_shop_id
  -- per ADR-024 Phase 2; this explicit filter prevents any future
  -- direct-handler-call code path from bypassing tenant scoping.
  IF array_length(v_added_uuid_arr, 1) > 0 THEN
    UPDATE public.testing_services
       SET active     = FALSE,
           updated_at = now()
     WHERE shop_id = p_shop_id
       AND id = ANY(v_added_uuid_arr)
       AND active = TRUE;
    GET DIAGNOSTICS v_actual_deact = ROW_COUNT;
  END IF;

  -- ── Return canonical 4-column shape (ADR-004) ───────────────────────
  restored    := v_actual_writes;
  deactivated := v_actual_deact;
  deleted     := 0;
  details     := '{}'::JSONB;
  RETURN NEXT;

EXCEPTION
  -- ADR-007: FK violation post-mutation → fk_broken enum (e.g., a
  -- testing_services row referenced by an FK from another table that
  -- doesn't tolerate revert). Should not happen on testing_services
  -- (no inbound FKs), but symmetric across all handlers.
  WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'revert_blocked: fk_broken: revert_testing_services_v2 raised foreign_key_violation (SQLERRM=%)', SQLERRM
      USING ERRCODE = '23503';
END $$;

-- R6-B1 NO-GRANT triple (internal handler per ADR-005)
REVOKE EXECUTE ON FUNCTION public.revert_testing_services_v2(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_testing_services_v2(INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revert_testing_services_v2(INTEGER, JSONB) FROM service_role;

COMMENT ON FUNCTION public.revert_testing_services_v2(INTEGER, JSONB) IS
  'Revert handler for snapshot_kind=testing_services_v2 per ADR-004 + ADR-019. UPSERT-restores snapshot.before (Invariant 1 WHERE-filter, Invariant 5 row-count check); soft-deletes snapshot.added_keys. NO GRANT to service_role per ADR-005 internal set. Dispatched by revert_md_upload_apply step 9.';


-- ════════════════════════════════════════════════════════════════════════
-- HANDLER 2 of 2 — revert_routine_services_v2
-- ════════════════════════════════════════════════════════════════════════
-- Mutation surface: routine_services table for (p_shop_id)
-- Snapshot keys:    UUID strings (routine_services.id is UUID)
-- Apply path:       _uploadCatalogV2(ROUTINE_CONFIG) in scheduler-admin-catalog.ts
-- Canonical mirror: canonical_state_routine_services_v2 (E1b dispatch)
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
  v_before          JSONB;
  v_added_keys      JSONB;
  v_added_uuid_arr  UUID[];
  v_expected_writes INTEGER := 0;
  v_actual_writes   INTEGER := 0;
  v_actual_deact    INTEGER := 0;
BEGIN
  -- ── Input validation (ADR-007 snapshot_invalid enum) ────────────────
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

  -- Subquery-alias pattern (canonical per E1b dispatch helper 2)
  SELECT ARRAY(
    SELECT v::UUID FROM (
      SELECT jsonb_array_elements_text(v_added_keys) AS v
    ) k
    WHERE v IS NOT NULL AND v <> ''
  ) INTO v_added_uuid_arr;

  -- ── Invariant 6: routine_services has no FK columns in its mutation
  --    surface. No-op. (concern_categories is TEXT[], not FK.)

  -- ── UPSERT-restore "before" rows (ADR-019 Invariants 1 + 5) ─────────
  WITH attempted AS (
    INSERT INTO public.routine_services (
      id, shop_id, service_key, display_name, abbreviation,
      display_order, wait_eligible, requires_explanation,
      concern_categories, starting_price_cents, price_waived_note,
      description, active,
      created_at, updated_at,
      updated_by_oauth_client_id, updated_by_name
    )
    SELECT
      (key)::UUID                                                   AS id,
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
    ON CONFLICT (id) DO UPDATE SET
      service_key                = EXCLUDED.service_key,
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
      WHERE routine_services.shop_id = p_shop_id   -- Invariant 1
    RETURNING 1
  )
  SELECT count(*) INTO v_actual_writes FROM attempted;

  -- ── Invariant 5: row-count check ────────────────────────────────────
  IF v_actual_writes < v_expected_writes THEN
    RAISE EXCEPTION 'revert_blocked: cross_shop_hijack_attempt: revert_routine_services_v2 snapshot carries % rows but only % were writable in shop %',
      v_expected_writes, v_actual_writes, p_shop_id
      USING ERRCODE = '42501';
  END IF;

  -- ── Soft-delete added rows (undo INSERT side of upload) ─────────────
  IF array_length(v_added_uuid_arr, 1) > 0 THEN
    UPDATE public.routine_services
       SET active     = FALSE,
           updated_at = now()
     WHERE shop_id = p_shop_id
       AND id = ANY(v_added_uuid_arr)
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

-- R6-B1 NO-GRANT triple
REVOKE EXECUTE ON FUNCTION public.revert_routine_services_v2(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_routine_services_v2(INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revert_routine_services_v2(INTEGER, JSONB) FROM service_role;

COMMENT ON FUNCTION public.revert_routine_services_v2(INTEGER, JSONB) IS
  'Revert handler for snapshot_kind=routine_services_v2 per ADR-004 + ADR-019. UPSERT-restores snapshot.before; soft-deletes snapshot.added_keys. NO GRANT to service_role per ADR-005.';


-- ════════════════════════════════════════════════════════════════════════
-- END E1c migration — 2 handlers created
--
-- Next file (E1d): 20260526000300_revert_handlers_v2_subcategories.sql
-- creates 3 UPSERT-only V2 sub-surface handlers (descriptions, service_map,
-- required_facts).
-- ════════════════════════════════════════════════════════════════════════
