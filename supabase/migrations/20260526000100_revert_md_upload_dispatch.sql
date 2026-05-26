-- ════════════════════════════════════════════════════════════════════════
-- scheduler-edge-parity feature — E1b: revert_md_upload dispatch migration
-- ════════════════════════════════════════════════════════════════════════
--
-- This file CREATEs the dispatch substrate that the inner revert RPC + the
-- 5 NEW apply RPCs (E1f) + the 10 revert handlers (E1c-e) all consume.
--
-- 16 SECURITY DEFINER functions are created here, in dependency order:
--
--   HELPERS (14 internal — NO GRANT to service_role per ADR-005):
--     1. lock_surface_for_kind(p_shop_id, p_kind)               — Phase 1 surface lock
--     2. lock_targets_for_kind(p_kind, p_shop_id, p_snapshot)   — Phase 1 + Phase 2 dispatcher
--     3. canonical_state_testing_services_v2                    — 10x serializer family
--     4. canonical_state_routine_services_v2
--     5. canonical_state_subcategory_descriptions_v2
--     6. canonical_state_subcategory_service_map_v2
--     7. canonical_state_question_required_facts_v2
--     8. canonical_state_concern_questions_flat
--     9. canonical_state_concern_category_upload                — reads BOTH tables per R6-B3
--    10. canonical_state_concern_category_guideline             — composite-PK keyed by category
--    11. canonical_state_appointment_default_limits
--    12. canonical_state_closed_dates_future
--    13. compute_current_canonical_for_kind                     — single-CASE dispatcher
--    14. compute_unified_diff                                   — staleness diff (slow path only)
--
--   INNER RPC (1 internal — NO GRANT to service_role):
--    15. revert_md_upload_apply                                 — 12-step dispatch + RAISE-only
--
--   OUTER RPC (1 outer-callable — GRANT TO service_role):
--    16. revert_md_upload_attempt                               — structured outcome only, NEVER re-RAISEs
--
-- ────────────────────────────────────────────────────────────────────────
-- Cross-references (every ADR + R6 residual that governs this file):
-- ────────────────────────────────────────────────────────────────────────
--   ADR-001 — outer/inner two-RPC split + outer NEVER re-RAISEs from EXCEPTION
--             block (STEP 0a/b/c RAISE BEFORE the block opens; STEP 0d returns
--             structured rejected/not_found without RAISE)
--   ADR-002 — STEP 0 a/b/c/d guards + 3-branch attempt-row contract
--             (Branch 1: row IS inserted; Branch 2: not_found rejection
--             without row insert; Branch 3: STEP 0a/b/c RAISE without row)
--   ADR-003 — PL/pgSQL transaction control via nested BEGIN…EXCEPTION
--             (NOT literal SAVEPOINT keywords — they don't compile in
--             function bodies). Inner invoked via SELECT … INTO … FROM …
--   ADR-005 — outer-callable entry-point set (6 functions w/ GRANT) vs
--             internal set (25 functions w/ NO GRANT, including explicit
--             REVOKE FROM service_role to defend against stale grants
--             preserved by CREATE OR REPLACE)
--   ADR-006 — migration apply order: this file is E1b, applies AFTER
--             20260526000000_part_a + 20260526000001_concurrent_indexes;
--             defers handler symbol resolution to CALL time (handlers
--             land in E1c-e migrations 00200/00300/00400; apply RPCs in
--             00500). PL/pgSQL function-body symbol resolution at call
--             time is what permits this lexicographic order.
--   ADR-007 — canonical reason_code enum (~20 values, closed allow-list)
--   ADR-008 — classifier extracts reason via regex 'revert_blocked:\s+([a-z0-9_]+)'
--             + IN(…) allow-list check; unknown → unclassified_revert_blocked
--   ADR-009 — sanitized v_sanitized_error_message via CASE on (outcome, reason)
--             — raw v_sqlerrm flows ONLY to error_detail (DB-only)
--   ADR-010 — 3-tier redaction: reason_code everywhere; error_message sanitized
--             in Sentry+RPC, not in DB; error_detail DB-only
--   ADR-011 — snapshot_kind_unknown reclassified rejected → crashed
--             (system bug — missing handler for a kind that passed eligibility)
--   ADR-012 — 12-step inner RPC: step 4 lock-targets BEFORE step 5 canonical-compute
--             BEFORE step 6 staleness check. STEP 0a/b/c live primarily in
--             outer; inner duplicates as DEFENSIVE re-checks (SECURITY DEFINER
--             hardening — cheap belt-and-suspenders). STEP 0d is OUTER-ONLY.
--   ADR-013 — closed_dates per-date advisory lock via 2-arg pg_advisory_xact_lock
--             (p_shop_id::INT, hashtext(closed_date::TEXT)) in PL/pgSQL FOR LOOP
--             — sorted-date order via subquery does NOT guarantee execution
--             order; only PL/pgSQL FOR LOOP does
--   ADR-014 — force_no_after_hash 3-branch logic: branch 1 (no hash AND no
--             canonical) accepts force; branch 2 (hash present) hash compare;
--             branch 3 (no hash but canonical present) canonical-fallback
--             ALWAYS fires regardless of force flag
--   ADR-016 — 4-layer multi-tenant defense (orchestrator-mcp L1 trust boundary;
--             this migration implements L2 GRANT taxonomy + L3 STEP 0 guards)
--   ADR-017 — SECURITY DEFINER search_path = pg_catalog, extensions, public,
--             pg_temp (pg_catalog first hardens built-ins; extensions for
--             pgcrypto's digest(); public for project tables; pg_temp LAST
--             forces explicit ordering to defeat session-temp shadow attack)
--   ADR-018 — RLS RESTRICTIVE deny-all (set up in Migration A; informational)
--   ADR-019 — handler invariants 1/5/6 (apply in E1c-e handlers; informational
--             here — this migration is the dispatch substrate, not the handlers)
--   ADR-020 — scheduler_admin_revert_attempts table (created in Migration A;
--             the outer RPC INSERTs/UPDATEs into it per ADR-002 contract)
--   ADR-023 — compute_unified_diff: single CTE statement with FILTER aggregate
--             + unfiltered COUNT(*) (avoids CTE-scope error; truncation marker
--             fires when total > p_max_lines). Line-aligned diff (NOT true LCS).
--   ADR-024 — Phase 1 surface lock FIRST + Phase 2 per-row/per-key locks +
--             10 canonical_state scopes (whole-surface reads → surface-lock
--             scope must match read scope to close drift class)
--
-- R6-B1  — explicit REVOKE FROM service_role on EVERY one of the 15 internal
--          functions (not just "omit GRANT" — CREATE OR REPLACE preserves
--          stale grants from prior partial migrations)
-- R6-B2  — lock_surface_for_kind CREATEd BEFORE lock_targets_for_kind
--          (which calls it) AND present in this file (was missing from
--          PLAN §3 + ADR-006 + INDEX inventories)
-- R6-B3  — canonical_state_concern_category_upload reads BOTH concern_subcategories
--          AND concern_questions (snapshot kind concern_questions_per_category
--          covers both tables; kind name historically understates scope)
-- R6-B4  — follow ADR-005 explicit Decision table for GRANT taxonomy,
--          NOT the stale "every other SECURITY DEFINER … GRANT TO service_role"
--          Consequences-paragraph wording
--
-- ────────────────────────────────────────────────────────────────────────
-- Byte-parity contract for canonical_state_<kind> serializers (CRITICAL):
-- ────────────────────────────────────────────────────────────────────────
-- Per ADR-024 line 13 + 141, the contract is byte-parity between
-- canonical_state_<kind> AND the apply-path's post-state serializer for
-- the SAME (shop_id, scope). Two apply-path families exist:
--
--   1. 5 NEW plpgsql apply RPCs (E1f, migration 00500): these will call
--      canonical_state_<kind> directly to compute expected_after_state_canonical
--      after writes. Byte-parity is AUTOMATIC (same function on both sides).
--
--   2. 5 EXISTING TS V2 uploaders (modified in E4 to emit canonical): these
--      run in Deno and will use a TS-side computeCanonicalAfterState() helper
--      (built in E2) that MUST mirror canonical_state_<kind> byte-for-byte.
--      Drift produces false-positive current_state_drift on every revert.
--
-- To make the TS mirror simple AND robust, the canonical_state serializers
-- below emit a STABLE STRUCTURED FORMAT (deterministic JSON-like text with
-- sorted keys), NOT literal MD. Rationale:
--   - MD format has cosmetic baggage (column descriptions, comment blocks)
--     that adds zero staleness-detection value
--   - The structured form is easier to mirror byte-for-byte in TS
--   - The staleness comparison is value-comparing, not presentation-comparing
--   - compute_unified_diff still renders human-readable line-aligned diff
--     into error_detail when staleness fails (operator triage surface)
--   - The TS-side computeCanonicalAfterState() (E2) replicates THIS format,
--     not the existing TS exporters which retain their MD presentation role
--
-- TS-mirror source-of-truth for each serializer (E2 builder MUST mirror):
--
-- | canonical_state_<kind>                          | Reads tables                                 | Sort key                                     | Existing TS exporter (informational only)         |
-- |-------------------------------------------------|----------------------------------------------|----------------------------------------------|---------------------------------------------------|
-- | canonical_state_testing_services_v2             | testing_services                             | service_key ASC                              | exportTestingServicesMdV2 (catalog.ts:764-779)    |
-- | canonical_state_routine_services_v2             | routine_services                             | service_key ASC                              | exportRoutineServicesMdV2 (catalog.ts:781-794)    |
-- | canonical_state_subcategory_descriptions_v2     | concern_subcategories (4 metadata cols)      | (category, slug) ASC                         | exportSubcategoryDescriptionsMdV2 (catalog.ts:2040-2119) |
-- | canonical_state_subcategory_service_map_v2      | concern_subcategories (service_map col)      | (category, slug) ASC                         | exportSubcategoryServiceMapMdV2 (catalog.ts:1405-1462)   |
-- | canonical_state_question_required_facts_v2      | concern_questions (required_facts col)       | id ASC                                       | exportQuestionRequiredFactsMdV2 (catalog.ts:2521-2581)   |
-- | canonical_state_concern_questions_flat          | concern_questions (all cols, flat shape)     | (category, display_order, id) ASC            | exportConcernQuestionsMd (scheduler-admin.ts:1094-1119)  |
-- | canonical_state_concern_category_upload         | BOTH concern_subcategories + concern_questions for one category | sub.display_order, q.display_order | NEW exportConcernCategoryMd (E6, PLAN §5.2) |
-- | canonical_state_concern_category_guideline      | concern_category_guidelines (composite PK)   | category ASC (derived from snapshot keys)    | NEW exportConcernCategoryGuidelineMd (E6, PLAN §5.1)     |
-- | canonical_state_appointment_default_limits      | appointment_default_limits                   | day_of_week ASC                              | exportAppointmentDefaultLimitsMd (scheduler-admin.ts:1362-1387) |
-- | canonical_state_closed_dates_future             | closed_dates WHERE closed_date >= original_today | closed_date ASC                          | exportClosedDatesMd (scheduler-admin.ts:1607-1632)        |
--
-- ════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════
-- HELPER 1 of 14 — lock_surface_for_kind
-- ════════════════════════════════════════════════════════════════════════
-- Governs: ADR-024 §0 (Phase 1 surface lock — MANDATORY first call by every
--          surface writer); R6-B2 (must exist + CREATEd before lock_targets);
--          R6-I3 (closed allow-list of 10 canonical snapshot_kinds — typos
--          hash to wrong slots and silently fail to serialize)
-- Cross-module contract: called FIRST by (1) lock_targets_for_kind below;
--          (2) every NEW apply RPC in 00500 migration (E1f); (3) future
--          SEC-17 surface writers (V2 TS uploader retrofit, cron jobs, etc.)
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.lock_surface_for_kind(
  p_shop_id INTEGER,
  p_kind TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
BEGIN
  -- Parameter shape guards (per ADR-002 STEP 0a + ADR-024 closed allow-list).
  IF p_shop_id IS NULL OR p_shop_id <= 0 THEN
    RAISE EXCEPTION 'lock_surface_for_kind: p_shop_id must be positive (got %)', p_shop_id
      USING ERRCODE = '22023';
  END IF;

  -- R6-I3 closed allow-list of 10 canonical snapshot_kinds. Typos hash to
  -- a DIFFERENT advisory-lock slot than cooperative writers expect,
  -- silently failing to serialize. The allow-list catches typos at lock-
  -- acquisition time, not at staleness-mismatch time hours later.
  IF p_kind IS NULL OR p_kind NOT IN (
    'testing_services_v2',
    'routine_services_v2',
    'concern_subcategories_descriptions_v2',
    'concern_subcategories_map_v2',
    'concern_questions_required_facts_v2',
    'concern_questions_flat',
    'concern_questions_per_category',
    'concern_category_guidelines',
    'appointment_default_limits',
    'closed_dates_future'
  ) THEN
    RAISE EXCEPTION 'lock_surface_for_kind: p_kind=% is not one of the 10 canonical snapshot_kinds per ADR-024 + PLAN §7 canonical mapping', p_kind
      USING ERRCODE = '22023';
  END IF;

  -- 2-arg advisory-xact lock per ADR-013 pattern:
  --   high 32 bits: p_shop_id::INT      — cross-tenant collisions structurally impossible
  --   low  32 bits: hashtext('surface:' || p_kind) — kind-namespaced surface
  -- Auto-released at transaction end. No DDL on the database — pure shared-memory entry.
  PERFORM pg_advisory_xact_lock(
    p_shop_id::INT,
    hashtext('surface:' || p_kind)
  );
END $$;

-- R6-B1 NO-GRANT triple (internal function per ADR-005 — service_role
-- cannot call this directly; reachable only via SECURITY DEFINER ownership
-- chain from the 6 outer-callable entry points)
REVOKE EXECUTE ON FUNCTION public.lock_surface_for_kind(INTEGER, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lock_surface_for_kind(INTEGER, TEXT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lock_surface_for_kind(INTEGER, TEXT) FROM service_role;

COMMENT ON FUNCTION public.lock_surface_for_kind(INTEGER, TEXT) IS
  'Phase 1 surface lock per ADR-024. MUST be called FIRST by every surface writer (5 NEW apply RPCs + inner revert RPC). Per-(shop_id, snapshot_kind) advisory transaction lock serializes COOPERATIVE writers. NOT cooperative: V2 TS uploaders (SEC-17). NO GRANT to service_role per ADR-005 internal set.';


-- ════════════════════════════════════════════════════════════════════════
-- HELPER 2 of 14 — lock_targets_for_kind
-- ════════════════════════════════════════════════════════════════════════
-- Governs: ADR-012 step 4 of the inner RPC (lock-targets BEFORE staleness);
--          ADR-024 §1 (Phase 1 + Phase 2 dispatcher); ADR-013 (closed_dates
--          PL/pgSQL FOR LOOP with sorted-date 2-arg advisory locks);
--          ADR-015 (acknowledged absent-key residual on 4 non-closed_dates
--          surfaces — SEC-15 deferred fix)
-- Returns: INT — count of locks acquired (informational; staleness check
--          at step 6 catches the case where snapshot keys don't resolve
--          to any current rows)
-- Cross-module contract: called by inner revert RPC step 4 (this file);
--          NOT called by apply RPCs (they take per-row/per-key locks
--          inline matching the Phase 2 patterns below)
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
  v_lock_count INTEGER := 0;
  v_int_ids    BIGINT[];   -- BIGINT for INTEGER PK + BIGSERIAL PK kinds
  v_uuid_ids   UUID[];      -- UUID PK kinds (testing/routine, closed_dates id)
  v_categories TEXT[];      -- category-keyed kinds (concern_category_guidelines)
  v_date       DATE;
  v_dates      DATE[];      -- closed_dates_future per-date set
BEGIN
  -- ─── PHASE 1 — surface lock (MANDATORY for all 10 kinds, per ADR-024 §0) ───
  -- Serializes all cooperative writers to (p_shop_id, p_kind) for the duration
  -- of this transaction. Closes the wider canonical-read-scope drift class.
  PERFORM public.lock_surface_for_kind(p_shop_id, p_kind);

  -- ─── PHASE 2 — per-row / per-key locks per ADR-024 §1 lock-predicate table ───
  -- Branches union BEFORE keys ∪ added_keys for kinds that have an `added_keys`
  -- concept (the per-row UPDATE-only V2 kinds excluded — those are UPSERT-only
  -- across an existing fixed row set, no concept of adds).

  CASE p_kind

    -- ─── Kind 1: testing_services_v2 ─────────────────────────────────
    -- ADR-024 lock-predicate table: testing_services rows with id ∈
    -- before keys ∪ added_keys. UUID PK.
    WHEN 'testing_services_v2' THEN
      SELECT ARRAY(
        SELECT DISTINCT v::UUID FROM (
          SELECT jsonb_object_keys(COALESCE(p_snapshot->'before', '{}'::JSONB)) AS v
          UNION ALL
          SELECT jsonb_array_elements_text(COALESCE(p_snapshot->'added_keys', '[]'::JSONB)) AS v
        ) k
        WHERE v IS NOT NULL AND v <> ''
      ) INTO v_uuid_ids;
      PERFORM 1 FROM public.testing_services
        WHERE shop_id = p_shop_id AND id = ANY(v_uuid_ids)
        ORDER BY id ASC
        FOR UPDATE;
      GET DIAGNOSTICS v_lock_count = ROW_COUNT;

    -- ─── Kind 2: routine_services_v2 ─────────────────────────────────
    -- Same shape as kind 1. UUID PK.
    WHEN 'routine_services_v2' THEN
      SELECT ARRAY(
        SELECT DISTINCT v::UUID FROM (
          SELECT jsonb_object_keys(COALESCE(p_snapshot->'before', '{}'::JSONB)) AS v
          UNION ALL
          SELECT jsonb_array_elements_text(COALESCE(p_snapshot->'added_keys', '[]'::JSONB)) AS v
        ) k
        WHERE v IS NOT NULL AND v <> ''
      ) INTO v_uuid_ids;
      PERFORM 1 FROM public.routine_services
        WHERE shop_id = p_shop_id AND id = ANY(v_uuid_ids)
        ORDER BY id ASC
        FOR UPDATE;
      GET DIAGNOSTICS v_lock_count = ROW_COUNT;

    -- ─── Kind 3: concern_subcategories_descriptions_v2 ───────────────
    -- ADR-024: UPSERT-only — no adds. BIGSERIAL PK.
    WHEN 'concern_subcategories_descriptions_v2' THEN
      SELECT ARRAY(
        SELECT DISTINCT (jsonb_object_keys(COALESCE(p_snapshot->'before', '{}'::JSONB)))::BIGINT
      ) INTO v_int_ids;
      PERFORM 1 FROM public.concern_subcategories
        WHERE shop_id = p_shop_id AND id = ANY(v_int_ids)
        ORDER BY id ASC
        FOR UPDATE;
      GET DIAGNOSTICS v_lock_count = ROW_COUNT;

    -- ─── Kind 4: concern_subcategories_map_v2 ────────────────────────
    -- Same shape as kind 3. BIGSERIAL PK.
    WHEN 'concern_subcategories_map_v2' THEN
      SELECT ARRAY(
        SELECT DISTINCT (jsonb_object_keys(COALESCE(p_snapshot->'before', '{}'::JSONB)))::BIGINT
      ) INTO v_int_ids;
      PERFORM 1 FROM public.concern_subcategories
        WHERE shop_id = p_shop_id AND id = ANY(v_int_ids)
        ORDER BY id ASC
        FOR UPDATE;
      GET DIAGNOSTICS v_lock_count = ROW_COUNT;

    -- ─── Kind 5: concern_questions_required_facts_v2 ─────────────────
    -- ADR-024: UPSERT-only. BIGSERIAL PK (concern_questions.id).
    WHEN 'concern_questions_required_facts_v2' THEN
      SELECT ARRAY(
        SELECT DISTINCT (jsonb_object_keys(COALESCE(p_snapshot->'before', '{}'::JSONB)))::BIGINT
      ) INTO v_int_ids;
      PERFORM 1 FROM public.concern_questions
        WHERE shop_id = p_shop_id AND id = ANY(v_int_ids)
        ORDER BY id ASC
        FOR UPDATE;
      GET DIAGNOSTICS v_lock_count = ROW_COUNT;

    -- ─── Kind 6: concern_questions_flat ──────────────────────────────
    -- ADR-024: concern_questions rows with id ∈ before keys ∪ added_keys.
    -- BIGSERIAL PK. Includes adds for hard-DELETE TOCTOU close.
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

    -- ─── Kind 7: concern_questions_per_category (BOTH tables per R6-B3) ──
    -- ADR-024: locks subcategory ids in subcategories_before ∪
    -- added_subcategory_ids ∪ ALL DISTINCT subcategory_id values referenced
    -- in questions_before row values (closes FK-target-not-in-before lock
    -- gap). PLUS question ids in questions_before ∪ added_question_ids.
    -- Postgres re-locks idempotently — overlapping ids do not double-count.
    WHEN 'concern_questions_per_category' THEN
      -- Lock subcategories first (parent in FK relationship → matches
      -- canonical sorted order for deadlock avoidance across writers).
      SELECT ARRAY(
        SELECT DISTINCT v::BIGINT FROM (
          SELECT jsonb_object_keys(COALESCE(p_snapshot->'subcategories_before', '{}'::JSONB)) AS v
          UNION ALL
          SELECT jsonb_array_elements_text(COALESCE(p_snapshot->'added_subcategory_ids', '[]'::JSONB)) AS v
          UNION ALL
          -- FK-target-not-in-before bridge: subcategory_id values referenced
          -- by question rows whose subcategory may have been deactivated
          -- separately. Locks those subcategory rows too.
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

      -- Then lock questions.
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
      -- Accumulate (Postgres re-locks idempotently — no double-count)
      v_lock_count := v_lock_count + COALESCE((SELECT COUNT(*) FROM public.concern_questions
        WHERE shop_id = p_shop_id AND id = ANY(v_int_ids)), 0);

    -- ─── Kind 8: concern_category_guidelines ─────────────────────────
    -- ADR-024: composite PK (shop_id, category) — NO scalar id column.
    -- Snapshot keyed by category slug.
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

    -- ─── Kind 9: appointment_default_limits ──────────────────────────
    -- Composite PK (shop_id, day_of_week). Snapshot keys are day_of_week
    -- integers (0..6). Includes added_keys for hard-DELETE TOCTOU close.
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

    -- ─── Kind 10: closed_dates_future ────────────────────────────────
    -- ADR-013 — MUST use PL/pgSQL FOR LOOP with 2-arg pg_advisory_xact_lock.
    -- Sorted-date ascending acquisition prevents deadlock against
    -- overlapping mutators. NOT a `PERFORM fn(...) FROM (SELECT ... ORDER BY)`
    -- form — Postgres's executor is free to evaluate volatile functions in
    -- any sequence; only PL/pgSQL FOR LOOP guarantees lock acquisition
    -- follows sort order, which is the property the deadlock-avoidance
    -- argument depends on.
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
          p_shop_id::INT,              -- high 32 bits: tenant scope
          hashtext(v_date::TEXT)       -- low 32 bits: date hash
        );
        v_lock_count := v_lock_count + 1;
      END LOOP;

      -- Also lock the closed_dates rows themselves (defense-in-depth —
      -- the per-date advisory locks are the load-bearing key-namespace
      -- protection; row-level FOR UPDATE adds row-state stability).
      PERFORM 1 FROM public.closed_dates
        WHERE shop_id = p_shop_id AND closed_date = ANY(v_dates)
        ORDER BY closed_date ASC
        FOR UPDATE;

    ELSE
      -- ADR-011 + ADR-007: snapshot_kind_unknown reclassified to crashed
      -- (system bug — missing handler for a kind that passed eligibility).
      -- Same RAISE format as the canonical-dispatcher ELSE so the outer
      -- classifier produces identical reason_code.
      RAISE EXCEPTION 'revert_blocked: snapshot_kind_unknown: lock_targets_for_kind does not handle kind=% (system bug — extend the CASE block)', p_kind
        USING ERRCODE = '22023';
  END CASE;

  RETURN v_lock_count;
END $$;

-- R6-B1 NO-GRANT triple
REVOKE EXECUTE ON FUNCTION public.lock_targets_for_kind(TEXT, INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lock_targets_for_kind(TEXT, INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lock_targets_for_kind(TEXT, INTEGER, JSONB) FROM service_role;

COMMENT ON FUNCTION public.lock_targets_for_kind(TEXT, INTEGER, JSONB) IS
  'Step 4 of inner revert RPC per ADR-012. Phase 1: lock_surface_for_kind. Phase 2: 10 CASE branches per ADR-024 lock-predicate table — per-row + per-key locks in canonical sorted order. closed_dates uses 2-arg advisory locks per ADR-013. Returns count of locks acquired. NO GRANT to service_role per ADR-005.';


-- ════════════════════════════════════════════════════════════════════════
-- HELPERS 3-12 of 14 — canonical_state_<kind> serializer family
-- ════════════════════════════════════════════════════════════════════════
-- Per ADR-024: each serializer reads the WHOLE surface for (p_shop_id)
-- (or, for closed_dates_future, the whole forward window from original_today)
-- and emits a STABLE STRUCTURED text format. Format design choice:
--
--   - Header line: `# <kind> shop=<shop_id> rows=<n>`
--   - Per-row line: pipe-separated stable-sorted key=value pairs:
--                   `| <pk>=<value> | col1=<v> | col2=<v> | ...`
--   - Lines sorted by primary natural sort key (documented per serializer)
--   - NULL → literal `<null>`; arrays → JSON-encoded with sorted elements
--   - Trailing newline (POSIX) so byte hash is deterministic
--
-- The TS-side computeCanonicalAfterState() helper (built in E2) MUST emit
-- the EXACT SAME bytes for the same inputs.
--
-- IMPORTANT: All 10 serializers carry the NO-GRANT triple per R6-B1.
-- ════════════════════════════════════════════════════════════════════════

-- ─── HELPER 3 — canonical_state_testing_services_v2 ─────────────────────
-- Reads: testing_services for (p_shop_id) — WHOLE surface
-- Mirrors apply path: _uploadCatalogV2(TESTING_CONFIG) writes these
-- columns; TS-side mirror is the post-write read in computeCanonicalAfterState.
CREATE OR REPLACE FUNCTION public.canonical_state_testing_services_v2(
  p_shop_id INTEGER,
  p_snapshot JSONB
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_result TEXT;
  v_count  INTEGER;
BEGIN
  -- p_snapshot is read but not used here — the whole-surface scope per
  -- ADR-024 means we serialize ALL rows for the shop. Snapshot param kept
  -- in signature for dispatch-call uniformity.
  PERFORM p_snapshot;

  WITH rows AS (
    SELECT
      id::TEXT                                                AS id,
      COALESCE(service_key, '<null>')                         AS service_key,
      COALESCE(display_name, '<null>')                        AS display_name,
      COALESCE(abbreviation, '<null>')                        AS abbreviation,
      COALESCE(starting_price_cents::TEXT, '<null>')          AS starting_price_cents,
      COALESCE(notes, '<null>')                               AS notes,
      COALESCE(description, '<null>')                         AS description,
      COALESCE(
        (SELECT jsonb_agg(elem ORDER BY elem)::TEXT
           FROM jsonb_array_elements_text(to_jsonb(COALESCE(example_keywords, '{}'::TEXT[]))) AS elem),
        '[]')                                                 AS example_keywords,
      COALESCE(
        (SELECT jsonb_agg(elem ORDER BY elem)::TEXT
           FROM jsonb_array_elements_text(to_jsonb(COALESCE(concern_categories, '{}'::TEXT[]))) AS elem),
        '[]')                                                 AS concern_categories,
      CASE WHEN active THEN 'true' ELSE 'false' END           AS active
    FROM public.testing_services
    WHERE shop_id = p_shop_id
    ORDER BY service_key ASC
  )
  SELECT
    string_agg(
      format('| id=%s | service_key=%s | display_name=%s | abbreviation=%s | starting_price_cents=%s | notes=%s | description=%s | example_keywords=%s | concern_categories=%s | active=%s |',
             id, service_key, display_name, abbreviation,
             starting_price_cents, notes, description,
             example_keywords, concern_categories, active),
      E'\n' ORDER BY service_key ASC
    ),
    COUNT(*)
  INTO v_result, v_count
  FROM rows;

  RETURN format(E'# testing_services_v2 shop=%s rows=%s\n%s\n',
                p_shop_id, v_count, COALESCE(v_result, ''));
END $$;

REVOKE EXECUTE ON FUNCTION public.canonical_state_testing_services_v2(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.canonical_state_testing_services_v2(INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.canonical_state_testing_services_v2(INTEGER, JSONB) FROM service_role;


-- ─── HELPER 4 — canonical_state_routine_services_v2 ─────────────────────
CREATE OR REPLACE FUNCTION public.canonical_state_routine_services_v2(
  p_shop_id INTEGER,
  p_snapshot JSONB
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_result TEXT;
  v_count  INTEGER;
BEGIN
  PERFORM p_snapshot;

  WITH rows AS (
    SELECT
      id::TEXT                                                AS id,
      COALESCE(service_key, '<null>')                         AS service_key,
      COALESCE(display_name, '<null>')                        AS display_name,
      COALESCE(abbreviation, '<null>')                        AS abbreviation,
      COALESCE(display_order::TEXT, '<null>')                 AS display_order,
      CASE WHEN wait_eligible THEN 'true' ELSE 'false' END    AS wait_eligible,
      CASE WHEN requires_explanation THEN 'true' ELSE 'false' END AS requires_explanation,
      COALESCE(
        (SELECT jsonb_agg(elem ORDER BY elem)::TEXT
           FROM jsonb_array_elements_text(to_jsonb(COALESCE(concern_categories, '{}'::TEXT[]))) AS elem),
        '[]')                                                 AS concern_categories,
      COALESCE(starting_price_cents::TEXT, '<null>')          AS starting_price_cents,
      COALESCE(price_waived_note, '<null>')                   AS price_waived_note,
      COALESCE(description, '<null>')                         AS description,
      CASE WHEN active THEN 'true' ELSE 'false' END           AS active
    FROM public.routine_services
    WHERE shop_id = p_shop_id
    ORDER BY service_key ASC
  )
  SELECT
    string_agg(
      format('| id=%s | service_key=%s | display_name=%s | abbreviation=%s | display_order=%s | wait_eligible=%s | requires_explanation=%s | concern_categories=%s | starting_price_cents=%s | price_waived_note=%s | description=%s | active=%s |',
             id, service_key, display_name, abbreviation, display_order,
             wait_eligible, requires_explanation, concern_categories,
             starting_price_cents, price_waived_note, description, active),
      E'\n' ORDER BY service_key ASC
    ),
    COUNT(*)
  INTO v_result, v_count
  FROM rows;

  RETURN format(E'# routine_services_v2 shop=%s rows=%s\n%s\n',
                p_shop_id, v_count, COALESCE(v_result, ''));
END $$;

REVOKE EXECUTE ON FUNCTION public.canonical_state_routine_services_v2(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.canonical_state_routine_services_v2(INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.canonical_state_routine_services_v2(INTEGER, JSONB) FROM service_role;


-- ─── HELPER 5 — canonical_state_subcategory_descriptions_v2 ─────────────
-- Reads ONLY the 4 stage-1-classifier metadata columns on concern_subcategories
-- that uploadSubcategoryDescriptionsMdV2 mutates: description, positive_examples,
-- negative_examples, synonyms. Sort key: (category, slug) ASC.
CREATE OR REPLACE FUNCTION public.canonical_state_subcategory_descriptions_v2(
  p_shop_id INTEGER,
  p_snapshot JSONB
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_result TEXT;
  v_count  INTEGER;
BEGIN
  PERFORM p_snapshot;

  WITH rows AS (
    SELECT
      id::TEXT                                                AS id,
      COALESCE(category, '<null>')                            AS category,
      COALESCE(slug, '<null>')                                AS slug,
      COALESCE(description, '<null>')                         AS description,
      COALESCE(
        (SELECT jsonb_agg(elem ORDER BY elem)::TEXT
           FROM jsonb_array_elements_text(to_jsonb(COALESCE(positive_examples, '{}'::TEXT[]))) AS elem),
        '[]')                                                 AS positive_examples,
      COALESCE(
        (SELECT jsonb_agg(elem ORDER BY elem)::TEXT
           FROM jsonb_array_elements_text(to_jsonb(COALESCE(negative_examples, '{}'::TEXT[]))) AS elem),
        '[]')                                                 AS negative_examples,
      COALESCE(
        (SELECT jsonb_agg(elem ORDER BY elem)::TEXT
           FROM jsonb_array_elements_text(to_jsonb(COALESCE(synonyms, '{}'::TEXT[]))) AS elem),
        '[]')                                                 AS synonyms,
      CASE WHEN active THEN 'true' ELSE 'false' END           AS active
    FROM public.concern_subcategories
    WHERE shop_id = p_shop_id
    ORDER BY category ASC, slug ASC
  )
  SELECT
    string_agg(
      format('| id=%s | category=%s | slug=%s | description=%s | positive_examples=%s | negative_examples=%s | synonyms=%s | active=%s |',
             id, category, slug, description,
             positive_examples, negative_examples, synonyms, active),
      E'\n' ORDER BY category, slug
    ),
    COUNT(*)
  INTO v_result, v_count
  FROM rows;

  RETURN format(E'# concern_subcategories_descriptions_v2 shop=%s rows=%s\n%s\n',
                p_shop_id, v_count, COALESCE(v_result, ''));
END $$;

REVOKE EXECUTE ON FUNCTION public.canonical_state_subcategory_descriptions_v2(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.canonical_state_subcategory_descriptions_v2(INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.canonical_state_subcategory_descriptions_v2(INTEGER, JSONB) FROM service_role;


-- ─── HELPER 6 — canonical_state_subcategory_service_map_v2 ──────────────
-- Reads ONLY the eligible_testing_service_keys column on concern_subcategories
-- (the column uploadSubcategoryServiceMapMdV2 mutates). Sort: (category, slug).
CREATE OR REPLACE FUNCTION public.canonical_state_subcategory_service_map_v2(
  p_shop_id INTEGER,
  p_snapshot JSONB
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_result TEXT;
  v_count  INTEGER;
BEGIN
  PERFORM p_snapshot;

  WITH rows AS (
    SELECT
      id::TEXT                                                AS id,
      COALESCE(category, '<null>')                            AS category,
      COALESCE(slug, '<null>')                                AS slug,
      COALESCE(
        (SELECT jsonb_agg(elem ORDER BY elem)::TEXT
           FROM jsonb_array_elements_text(to_jsonb(COALESCE(eligible_testing_service_keys, '{}'::TEXT[]))) AS elem),
        '[]')                                                 AS service_keys,
      CASE WHEN active THEN 'true' ELSE 'false' END           AS active
    FROM public.concern_subcategories
    WHERE shop_id = p_shop_id
    ORDER BY category ASC, slug ASC
  )
  SELECT
    string_agg(
      format('| id=%s | category=%s | slug=%s | eligible_testing_service_keys=%s | active=%s |',
             id, category, slug, service_keys, active),
      E'\n' ORDER BY category, slug
    ),
    COUNT(*)
  INTO v_result, v_count
  FROM rows;

  RETURN format(E'# concern_subcategories_map_v2 shop=%s rows=%s\n%s\n',
                p_shop_id, v_count, COALESCE(v_result, ''));
END $$;

REVOKE EXECUTE ON FUNCTION public.canonical_state_subcategory_service_map_v2(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.canonical_state_subcategory_service_map_v2(INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.canonical_state_subcategory_service_map_v2(INTEGER, JSONB) FROM service_role;


-- ─── HELPER 7 — canonical_state_question_required_facts_v2 ──────────────
-- Reads ONLY the required_facts column on concern_questions (the column
-- uploadQuestionRequiredFactsMdV2 mutates). Sort: id ASC.
CREATE OR REPLACE FUNCTION public.canonical_state_question_required_facts_v2(
  p_shop_id INTEGER,
  p_snapshot JSONB
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_result TEXT;
  v_count  INTEGER;
BEGIN
  PERFORM p_snapshot;

  WITH rows AS (
    SELECT
      id::TEXT                                                AS id,
      COALESCE(
        -- required_facts is an ORDERED array (MD-order de-duped — see catalog.ts:2152)
        -- so preserve incoming order, NOT alphabetical.
        -- FIX (orchestrator review item #5, 2026-05-26): use `unnest WITH ORDINALITY`
        -- + explicit ORDER BY to guarantee preservation across plan changes.
        -- The prior `jsonb_array_elements_text` without ORDINALITY relied on
        -- Postgres's practical-but-not-guaranteed input-order behavior — brittle
        -- to executor changes that could surface as universal current_state_drift.
        (SELECT jsonb_agg(elem ORDER BY ord)::TEXT
           FROM unnest(COALESCE(required_facts, '{}'::TEXT[])) WITH ORDINALITY AS s(elem, ord)),
        '[]')                                                 AS required_facts,
      CASE WHEN active THEN 'true' ELSE 'false' END           AS active
    FROM public.concern_questions
    WHERE shop_id = p_shop_id
    ORDER BY id ASC
  )
  SELECT
    string_agg(
      format('| id=%s | required_facts=%s | active=%s |',
             id, required_facts, active),
      E'\n' ORDER BY id::BIGINT
    ),
    COUNT(*)
  INTO v_result, v_count
  FROM rows;

  RETURN format(E'# concern_questions_required_facts_v2 shop=%s rows=%s\n%s\n',
                p_shop_id, v_count, COALESCE(v_result, ''));
END $$;

REVOKE EXECUTE ON FUNCTION public.canonical_state_question_required_facts_v2(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.canonical_state_question_required_facts_v2(INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.canonical_state_question_required_facts_v2(INTEGER, JSONB) FROM service_role;


-- ─── HELPER 8 — canonical_state_concern_questions_flat ──────────────────
-- Reads ALL concern_questions for (p_shop_id), flat shape (no per-category
-- nesting — mirrors the flat uploader uploadConcernQuestionsMd / exporter
-- exportConcernQuestionsMd). Sort: (category, display_order, id).
CREATE OR REPLACE FUNCTION public.canonical_state_concern_questions_flat(
  p_shop_id INTEGER,
  p_snapshot JSONB
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_result TEXT;
  v_count  INTEGER;
BEGIN
  PERFORM p_snapshot;

  WITH rows AS (
    SELECT
      id::TEXT                                                AS id,
      COALESCE(category, '<null>')                            AS category,
      COALESCE(question_text, '<null>')                       AS question_text,
      COALESCE(display_order::TEXT, '<null>')                 AS display_order,
      CASE WHEN active THEN 'true' ELSE 'false' END           AS active,
      -- options is JSONB array of {label,value} objects. Use the canonical
      -- jsonb sort representation (key-sorted within each object) for stability.
      COALESCE(options::TEXT, '<null>')                       AS options
    FROM public.concern_questions
    WHERE shop_id = p_shop_id
    ORDER BY category ASC, display_order ASC, id ASC
  )
  SELECT
    string_agg(
      format('| id=%s | category=%s | display_order=%s | question_text=%s | options=%s | active=%s |',
             id, category, display_order, question_text, options, active),
      E'\n' ORDER BY category, display_order::INT, id::BIGINT
    ),
    COUNT(*)
  INTO v_result, v_count
  FROM rows;

  RETURN format(E'# concern_questions_flat shop=%s rows=%s\n%s\n',
                p_shop_id, v_count, COALESCE(v_result, ''));
END $$;

REVOKE EXECUTE ON FUNCTION public.canonical_state_concern_questions_flat(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.canonical_state_concern_questions_flat(INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.canonical_state_concern_questions_flat(INTEGER, JSONB) FROM service_role;


-- ─── HELPER 9 — canonical_state_concern_category_upload (R6-B3 BLOCKER) ──
-- ADR-024 + R6-B3: snapshot_kind concern_questions_per_category covers BOTH
-- concern_subcategories AND concern_questions for ONE category. The category
-- slug is derived from the snapshot scope:
--   - p_snapshot->>'category_slug' (preferred; uploader writes this)
--   - OR fallback: read from the first subcategories_before / questions_before
--     row's `category` value
--
-- Reads BOTH tables for (p_shop_id, category) and emits a single canonical
-- block. Sort: subcategories first by display_order, then questions grouped
-- by subcategory_id ordered by display_order.
--
-- TS-side mirror MUST be the NEW exportConcernCategoryMd (PLAN §5.2, E6) — but
-- E1b ships BEFORE E6, so the E6 builder must mirror THIS serializer's output
-- format byte-for-byte. The E2 builder of computeCanonicalAfterState (TS)
-- mirrors this same format.
CREATE OR REPLACE FUNCTION public.canonical_state_concern_category_upload(
  p_shop_id INTEGER,
  p_snapshot JSONB
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_category   TEXT;
  v_subs_block TEXT;
  v_qs_block   TEXT;
  v_subs_count INTEGER;
  v_qs_count   INTEGER;
BEGIN
  -- Derive category slug from snapshot. Required field per PLAN §4.2.
  v_category := p_snapshot->>'category_slug';

  IF v_category IS NULL THEN
    -- Fallback: read from first subcategories_before row's category value.
    SELECT (rec.value->>'category')
      INTO v_category
      FROM jsonb_each(COALESCE(p_snapshot->'subcategories_before', '{}'::JSONB)) AS rec
      LIMIT 1;
  END IF;

  IF v_category IS NULL THEN
    -- Last-resort fallback: read from first questions_before row's category value.
    SELECT (rec.value->>'category')
      INTO v_category
      FROM jsonb_each(COALESCE(p_snapshot->'questions_before', '{}'::JSONB)) AS rec
      LIMIT 1;
  END IF;

  IF v_category IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: concern_questions_per_category snapshot missing category_slug AND has no subcategories_before/questions_before rows to derive it from'
      USING ERRCODE = '22023';
  END IF;

  -- ─── Sub-categories block (R6-B3: read BOTH tables) ───
  WITH sub_rows AS (
    SELECT
      id::TEXT                                                AS id,
      COALESCE(category, '<null>')                            AS category,
      COALESCE(slug, '<null>')                                AS slug,
      COALESCE(display_label, '<null>')                       AS display_label,
      COALESCE(display_order::TEXT, '<null>')                 AS display_order,
      CASE WHEN active THEN 'true' ELSE 'false' END           AS active
    FROM public.concern_subcategories
    WHERE shop_id = p_shop_id AND category = v_category
    ORDER BY display_order ASC, slug ASC
  )
  SELECT
    string_agg(
      format('| id=%s | slug=%s | display_label=%s | display_order=%s | active=%s |',
             id, slug, display_label, display_order, active),
      E'\n' ORDER BY display_order::INT, slug
    ),
    COUNT(*)
  INTO v_subs_block, v_subs_count
  FROM sub_rows;

  -- ─── Questions block (R6-B3: read BOTH tables) ───
  WITH q_rows AS (
    SELECT
      cq.id::TEXT                                             AS id,
      COALESCE(cq.subcategory_id::TEXT, '<null>')             AS subcategory_id,
      COALESCE(cs.slug, '<null>')                             AS sub_slug,
      COALESCE(cq.question_text, '<null>')                    AS question_text,
      COALESCE(cq.display_order::TEXT, '<null>')              AS display_order,
      CASE WHEN cq.active THEN 'true' ELSE 'false' END        AS active,
      CASE WHEN COALESCE(cq.multi_select, FALSE) THEN 'true' ELSE 'false' END AS multi_select,
      COALESCE(cq.options::TEXT, '<null>')                    AS options
    FROM public.concern_questions cq
    LEFT JOIN public.concern_subcategories cs
      ON cs.id = cq.subcategory_id AND cs.shop_id = p_shop_id
    WHERE cq.shop_id = p_shop_id AND cq.category = v_category
    -- Group by subcategory (via slug for determinism), then by display_order,
    -- then by id as tie-breaker
    ORDER BY COALESCE(cs.slug, ''), cq.display_order ASC, cq.id ASC
  )
  SELECT
    string_agg(
      format('| id=%s | sub_slug=%s | subcategory_id=%s | display_order=%s | question_text=%s | options=%s | multi_select=%s | active=%s |',
             id, sub_slug, subcategory_id, display_order,
             question_text, options, multi_select, active),
      E'\n' ORDER BY sub_slug, display_order::INT, id::BIGINT
    ),
    COUNT(*)
  INTO v_qs_block, v_qs_count
  FROM q_rows;

  RETURN format(E'# concern_questions_per_category shop=%s category=%s\n## subcategories rows=%s\n%s\n## questions rows=%s\n%s\n',
                p_shop_id, v_category,
                v_subs_count, COALESCE(v_subs_block, ''),
                v_qs_count,   COALESCE(v_qs_block, ''));
END $$;

REVOKE EXECUTE ON FUNCTION public.canonical_state_concern_category_upload(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.canonical_state_concern_category_upload(INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.canonical_state_concern_category_upload(INTEGER, JSONB) FROM service_role;


-- ─── HELPER 10 — canonical_state_concern_category_guideline ─────────────
-- Reads concern_category_guidelines for (p_shop_id, category) where category
-- ∈ jsonb_object_keys(snapshot->before) ∪ snapshot->added_keys.
-- Composite PK (shop_id, category) — NO scalar id column.
CREATE OR REPLACE FUNCTION public.canonical_state_concern_category_guideline(
  p_shop_id INTEGER,
  p_snapshot JSONB
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_result     TEXT;
  v_count      INTEGER;
  v_categories TEXT[];
BEGIN
  -- Derive category scope from snapshot per ADR-024 §3.
  SELECT ARRAY(
    SELECT DISTINCT v FROM (
      SELECT jsonb_object_keys(COALESCE(p_snapshot->'before', '{}'::JSONB)) AS v
      UNION ALL
      SELECT jsonb_array_elements_text(COALESCE(p_snapshot->'added_keys', '[]'::JSONB)) AS v
    ) k
    WHERE v IS NOT NULL AND v <> ''
  ) INTO v_categories;

  WITH rows AS (
    SELECT
      COALESCE(category, '<null>')                            AS category,
      COALESCE(display_label, '<null>')                       AS display_label,
      COALESCE(guideline_prose, '<null>')                     AS guideline_prose
    FROM public.concern_category_guidelines
    WHERE shop_id = p_shop_id
      AND category = ANY(v_categories)
    ORDER BY category ASC
  )
  SELECT
    string_agg(
      format('| category=%s | display_label=%s | guideline_prose=%s |',
             category, display_label, guideline_prose),
      E'\n' ORDER BY category
    ),
    COUNT(*)
  INTO v_result, v_count
  FROM rows;

  RETURN format(E'# concern_category_guidelines shop=%s rows=%s\n%s\n',
                p_shop_id, v_count, COALESCE(v_result, ''));
END $$;

REVOKE EXECUTE ON FUNCTION public.canonical_state_concern_category_guideline(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.canonical_state_concern_category_guideline(INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.canonical_state_concern_category_guideline(INTEGER, JSONB) FROM service_role;


-- ─── HELPER 11 — canonical_state_appointment_default_limits ─────────────
-- Reads appointment_default_limits for (p_shop_id) — WHOLE 7-row surface.
-- Sort: day_of_week ASC.
CREATE OR REPLACE FUNCTION public.canonical_state_appointment_default_limits(
  p_shop_id INTEGER,
  p_snapshot JSONB
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_result TEXT;
  v_count  INTEGER;
BEGIN
  PERFORM p_snapshot;

  WITH rows AS (
    SELECT
      day_of_week::TEXT                                       AS day_of_week,
      CASE WHEN is_closed THEN 'true' ELSE 'false' END        AS is_closed,
      COALESCE(waiter_8am_slots::TEXT, '<null>')              AS waiter_8am_slots,
      COALESCE(waiter_9am_slots::TEXT, '<null>')              AS waiter_9am_slots,
      COALESCE(dropoff_total::TEXT, '<null>')                 AS dropoff_total,
      COALESCE(notes, '<null>')                               AS notes
    FROM public.appointment_default_limits
    WHERE shop_id = p_shop_id
    ORDER BY day_of_week ASC
  )
  SELECT
    string_agg(
      format('| day_of_week=%s | is_closed=%s | waiter_8am_slots=%s | waiter_9am_slots=%s | dropoff_total=%s | notes=%s |',
             day_of_week, is_closed, waiter_8am_slots,
             waiter_9am_slots, dropoff_total, notes),
      E'\n' ORDER BY day_of_week::INT
    ),
    COUNT(*)
  INTO v_result, v_count
  FROM rows;

  RETURN format(E'# appointment_default_limits shop=%s rows=%s\n%s\n',
                p_shop_id, v_count, COALESCE(v_result, ''));
END $$;

REVOKE EXECUTE ON FUNCTION public.canonical_state_appointment_default_limits(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.canonical_state_appointment_default_limits(INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.canonical_state_appointment_default_limits(INTEGER, JSONB) FROM service_role;


-- ─── HELPER 12 — canonical_state_closed_dates_future ────────────────────
-- ADR-024: closed_dates WHERE closed_date >= (p_snapshot->>'original_today')::DATE.
-- "original_today" preserves "past closures are immutable history" — the
-- snapshot was taken at the moment of upload; this reads the same forward
-- window the uploader saw, NOT today's forward window.
-- Sort: closed_date ASC.
CREATE OR REPLACE FUNCTION public.canonical_state_closed_dates_future(
  p_shop_id INTEGER,
  p_snapshot JSONB
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_result         TEXT;
  v_count          INTEGER;
  v_original_today DATE;
BEGIN
  -- Required snapshot field (per PLAN §4.5). RAISE if missing.
  v_original_today := (p_snapshot->>'original_today')::DATE;
  IF v_original_today IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: closed_dates_future snapshot missing original_today (required to scope canonical read to the same forward window the uploader saw)'
      USING ERRCODE = '22023';
  END IF;

  -- FIX (orchestrator review item #3, 2026-05-26): UUID `id` is INTENTIONALLY
  -- EXCLUDED from the canonical text. The natural identity of a closed_dates
  -- row is `(closed_date, reason)` — `id` is incidental (auto-generated UUID
  -- with no business meaning). Including `id` would produce false-positive
  -- `current_state_drift` rejections if a date is hard-deleted then re-inserted
  -- via two separate operations (same conceptual content, new UUID). Other
  -- canonical_state_<kind> serializers DO include `id` because the row's
  -- natural identity IS the PK (e.g., testing_services.id is the service-key
  -- identifier the row IS).
  WITH rows AS (
    SELECT
      closed_date::TEXT                                       AS closed_date,
      COALESCE(reason, '<null>')                              AS reason,
      COALESCE(source, '<null>')                              AS source
    FROM public.closed_dates
    WHERE shop_id = p_shop_id
      AND closed_date >= v_original_today
    ORDER BY closed_date ASC
  )
  SELECT
    string_agg(
      format('| closed_date=%s | reason=%s | source=%s |',
             closed_date, reason, source),
      E'\n' ORDER BY closed_date
    ),
    COUNT(*)
  INTO v_result, v_count
  FROM rows;

  RETURN format(E'# closed_dates_future shop=%s rows=%s original_today=%s\n%s\n',
                p_shop_id, v_count, v_original_today::TEXT,
                COALESCE(v_result, ''));
END $$;

REVOKE EXECUTE ON FUNCTION public.canonical_state_closed_dates_future(INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.canonical_state_closed_dates_future(INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.canonical_state_closed_dates_future(INTEGER, JSONB) FROM service_role;


-- ════════════════════════════════════════════════════════════════════════
-- HELPER 13 of 14 — compute_current_canonical_for_kind (dispatcher)
-- ════════════════════════════════════════════════════════════════════════
-- Governs: ADR-024 §2 — single CASE block dispatching to one of 10 per-kind
--          canonical-state serializers; ELSE → snapshot_kind_unknown
--          (per ADR-011 reclassified to crashed)
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compute_current_canonical_for_kind(
  p_kind TEXT,
  p_shop_id INTEGER,
  p_snapshot JSONB
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_canonical TEXT;
BEGIN
  CASE p_kind
    WHEN 'testing_services_v2' THEN
      v_canonical := public.canonical_state_testing_services_v2(p_shop_id, p_snapshot);
    WHEN 'routine_services_v2' THEN
      v_canonical := public.canonical_state_routine_services_v2(p_shop_id, p_snapshot);
    WHEN 'concern_subcategories_descriptions_v2' THEN
      v_canonical := public.canonical_state_subcategory_descriptions_v2(p_shop_id, p_snapshot);
    WHEN 'concern_subcategories_map_v2' THEN
      v_canonical := public.canonical_state_subcategory_service_map_v2(p_shop_id, p_snapshot);
    WHEN 'concern_questions_required_facts_v2' THEN
      v_canonical := public.canonical_state_question_required_facts_v2(p_shop_id, p_snapshot);
    WHEN 'concern_questions_flat' THEN
      v_canonical := public.canonical_state_concern_questions_flat(p_shop_id, p_snapshot);
    WHEN 'concern_questions_per_category' THEN
      v_canonical := public.canonical_state_concern_category_upload(p_shop_id, p_snapshot);
    WHEN 'concern_category_guidelines' THEN
      v_canonical := public.canonical_state_concern_category_guideline(p_shop_id, p_snapshot);
    WHEN 'appointment_default_limits' THEN
      v_canonical := public.canonical_state_appointment_default_limits(p_shop_id, p_snapshot);
    WHEN 'closed_dates_future' THEN
      v_canonical := public.canonical_state_closed_dates_future(p_shop_id, p_snapshot);
    ELSE
      -- ADR-011 + ADR-007: snapshot_kind_unknown reclassified to crashed
      -- (system bug — missing serializer for a kind that passed eligibility)
      RAISE EXCEPTION 'revert_blocked: snapshot_kind_unknown: compute_current_canonical_for_kind does not handle kind=% (system bug — extend the CASE block + add canonical_state serializer)', p_kind
        USING ERRCODE = '22023';
  END CASE;
  RETURN v_canonical;
END $$;

REVOKE EXECUTE ON FUNCTION public.compute_current_canonical_for_kind(TEXT, INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_current_canonical_for_kind(TEXT, INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compute_current_canonical_for_kind(TEXT, INTEGER, JSONB) FROM service_role;

COMMENT ON FUNCTION public.compute_current_canonical_for_kind(TEXT, INTEGER, JSONB) IS
  'Step 5 of inner revert RPC per ADR-012. Dispatches to one of 10 canonical_state_<kind> serializers. ELSE → revert_blocked: snapshot_kind_unknown → outcome=crashed per ADR-011. NO GRANT to service_role per ADR-005.';


-- ════════════════════════════════════════════════════════════════════════
-- HELPER 14 of 14 — compute_unified_diff
-- ════════════════════════════════════════════════════════════════════════
-- Governs: ADR-023 — single CTE statement with FILTER aggregate on
--          string_agg + unfiltered COUNT(*); truncation marker fires when
--          v_total_diffs > p_max_lines. Line-aligned diff (NOT true LCS).
--          Slow path only (called from inner step 6 staleness rejection).
--          Output flows to error_detail (DB-only per ADR-010), NEVER to
--          Sentry tags / public error_message.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compute_unified_diff(
  p_expected TEXT,
  p_current  TEXT,
  p_max_lines INTEGER DEFAULT 50
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_diff_lines        TEXT;
  v_total_diffs       INTEGER;
  v_truncation_marker TEXT := '';
BEGIN
  WITH expected_lines AS (
    SELECT line, ord
      FROM regexp_split_to_table(COALESCE(p_expected, ''), E'\n')
        WITH ORDINALITY AS s(line, ord)
  ),
  current_lines AS (
    SELECT line, ord
      FROM regexp_split_to_table(COALESCE(p_current, ''), E'\n')
        WITH ORDINALITY AS s(line, ord)
  ),
  aligned AS (
    SELECT
      COALESCE(e.ord, c.ord) AS ord,
      e.line                  AS expected_line,
      c.line                  AS current_line
    FROM expected_lines e
    FULL OUTER JOIN current_lines c ON e.ord = c.ord
    WHERE e.line IS DISTINCT FROM c.line
  ),
  numbered AS (
    SELECT
      ord,
      expected_line,
      current_line,
      row_number() OVER (ORDER BY ord) AS diff_row
    FROM aligned
  )
  -- Single SELECT per ADR-023: FILTER aggregate on string_agg renders the
  -- slice; unfiltered COUNT(*) sees every differing row. Both compute against
  -- the same CTE in one statement (CTEs are scoped to a single SQL statement
  -- — using `numbered` in two separate SELECTs would error).
  SELECT
    string_agg(
      format(E'L%s:\n- %s\n+ %s', ord,
             COALESCE(expected_line, '<<absent>>'),
             COALESCE(current_line,  '<<absent>>')),
      E'\n' ORDER BY ord
    ) FILTER (WHERE diff_row <= p_max_lines),
    COUNT(*)
  INTO v_diff_lines, v_total_diffs
  FROM numbered;

  IF v_total_diffs > p_max_lines THEN
    v_truncation_marker := format(
      E'\n... (%s more lines differ; line-aligned — reordered blocks may overcount)',
      v_total_diffs - p_max_lines);
  END IF;

  RETURN COALESCE(v_diff_lines, '<<no differences detected (NULL-vs-NULL or both empty)>>')
         || v_truncation_marker;
END $$;

-- R6-B1 NO-GRANT triple (internal helper per ADR-005)
REVOKE EXECUTE ON FUNCTION public.compute_unified_diff(TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_unified_diff(TEXT, TEXT, INTEGER) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compute_unified_diff(TEXT, TEXT, INTEGER) FROM service_role;

COMMENT ON FUNCTION public.compute_unified_diff(TEXT, TEXT, INTEGER) IS
  'Line-aligned diff (NOT true LCS) per ADR-023. Single CTE with FILTER aggregate. Truncation marker when total > p_max_lines. Slow path only — called from inner step 6 staleness rejection. Output flows to error_detail (DB-only per ADR-010), never to Sentry or public error_message.';


-- ════════════════════════════════════════════════════════════════════════
-- INNER RPC 15 of 16 — revert_md_upload_apply (12-step RAISE-only contract)
-- ════════════════════════════════════════════════════════════════════════
-- Governs: ADR-001 (RAISE-only inner contract); ADR-003 (function, not
--          procedure — invoked via SELECT … INTO … FROM …); ADR-012
--          (12-step ordering — step 4 locks before step 5/6); ADR-014
--          (3-branch force_no_after_hash); ADR-017 (search_path)
--
-- IMPORTANT: this RPC RAISEs on any failure. The outer RPC's BEGIN/EXCEPTION
-- block catches and classifies. Inner NEVER returns structured failure.
--
-- Handler dispatch CASE (step 9) calls revert_<kind> functions defined in
-- migrations 00200/00300/00400. PL/pgSQL function-body symbol resolution
-- happens at CALL time, so this file can reference them even though they
-- don't exist yet (E1c/d/e land next in lexicographic apply order).
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.revert_md_upload_apply(
  p_shop_id INTEGER,
  p_upload_id BIGINT,
  p_actor_email TEXT,
  p_oauth_client_id TEXT,
  p_dry_run BOOLEAN,
  p_expected_confirm_token TEXT,
  p_force_no_after_hash BOOLEAN,
  p_attempt_id BIGINT
) RETURNS TABLE (
  audit_log_id BIGINT,
  confirm_token TEXT,
  restored INTEGER,
  deactivated INTEGER,
  deleted INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_parent          RECORD;
  v_kind            TEXT;
  v_snapshot        JSONB;
  v_after_hash      TEXT;
  v_expected_canonical TEXT;
  v_current_canonical TEXT;
  v_current_head_hash TEXT;
  v_token_recomputed TEXT;
  v_stats           RECORD;
  v_revert_audit_id BIGINT;
  v_diff_summary    JSONB;
  v_lock_count      INTEGER;
BEGIN
  -- ─── STEP 0a/b/c — defensive re-checks per ADR-012 ────────────────────
  -- Primary STEP 0 guards live in outer RPC per ADR-002; inner duplicates
  -- as cheap belt-and-suspenders for SECURITY DEFINER hardening. STEP 0d
  -- (upload-existence pre-check) is OUTER-ONLY per ADR-002 + ADR-Fix #9.
  IF p_shop_id IS NULL OR p_shop_id <= 0 THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: p_shop_id must be positive (defensive inner re-check; outer should have caught this)'
      USING ERRCODE = '22023';
  END IF;
  IF p_actor_email IS NULL OR length(trim(p_actor_email)) = 0 THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: p_actor_email is required (defensive inner re-check)'
      USING ERRCODE = '22023';
  END IF;
  IF p_dry_run IS NULL OR p_force_no_after_hash IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_invalid: p_dry_run and p_force_no_after_hash must be non-NULL (defensive inner re-check)'
      USING ERRCODE = '22023';
  END IF;

  -- ─── STEP 1 — SELECT FOR UPDATE NOWAIT on parent audit row ────────────
  -- NOWAIT → SQLSTATE 55P03 if another revert holds this row; outer
  -- classifier maps 55P03 → reason_code=another_revert_in_progress per
  -- ADR-007. We re-check shop_id here even though outer STEP 0d confirmed
  -- it — defense-in-depth.
  BEGIN
    SELECT *
      INTO v_parent
      FROM public.scheduler_admin_audit_log
     WHERE id = p_upload_id AND shop_id = p_shop_id
     FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    -- Re-RAISE with SQLSTATE preserved so outer classifier sees 55P03.
    RAISE;
  END;

  IF NOT FOUND THEN
    -- This branch is reachable if outer's STEP 0d was bypassed (e.g., test
    -- harness calling inner directly). Treat as not_found per ADR-007.
    RAISE EXCEPTION 'revert_blocked: not_found: audit row id=% not found in shop_id=% (defensive inner re-check after FOR UPDATE NOWAIT)',
                    p_upload_id, p_shop_id
      USING ERRCODE = '22023';
  END IF;

  -- ─── STEP 2 — eligibility (operation, snapshot, 30-day cutoff, kind) ──
  IF v_parent.operation <> 'upload_md' THEN
    RAISE EXCEPTION 'revert_blocked: not_upload_md: audit row id=% has operation=% (only upload_md is revertable)',
                    p_upload_id, v_parent.operation
      USING ERRCODE = '22023';
  END IF;

  IF v_parent.successor_revert_id IS NOT NULL THEN
    RAISE EXCEPTION 'revert_blocked: successor_revert_exists: audit row id=% has been reverted by successor_revert_id=%',
                    p_upload_id, v_parent.successor_revert_id
      USING ERRCODE = '22023';
  END IF;

  IF v_parent.snapshot_pruned_at IS NOT NULL THEN
    RAISE EXCEPTION 'revert_blocked: snapshot_pruned: audit row id=% snapshot pruned at % (retention cron)',
                    p_upload_id, v_parent.snapshot_pruned_at
      USING ERRCODE = '22023';
  END IF;

  IF v_parent.pre_state_snapshot IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: no_snapshot: audit row id=% has NULL pre_state_snapshot (operation did not support snapshot capture OR was created pre-snapshot-feature)',
                    p_upload_id
      USING ERRCODE = '22023';
  END IF;

  IF v_parent.occurred_at < now() - interval '30 days' THEN
    RAISE EXCEPTION 'revert_blocked: over_30_day_cutoff: audit row id=% occurred_at=% is older than 30 days',
                    p_upload_id, v_parent.occurred_at
      USING ERRCODE = '22023';
  END IF;

  -- Resolve snapshot_kind: prefer explicit snapshot.snapshot_kind; fall back
  -- to table_name-based legacy mapping for pre-CV2-B3 rows.
  v_snapshot := v_parent.pre_state_snapshot;
  v_kind := v_snapshot->>'snapshot_kind';
  IF v_kind IS NULL THEN
    -- Legacy table_name-based fallback (per PLAN §7 mapping table).
    v_kind := CASE v_parent.table_name
      WHEN 'concern_questions'           THEN 'concern_questions_flat'
      WHEN 'appointment_default_limits'  THEN 'appointment_default_limits'
      WHEN 'closed_dates'                THEN 'closed_dates_future'
      WHEN 'concern_category_guidelines' THEN 'concern_category_guidelines'
      ELSE NULL
    END;
  END IF;

  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'revert_blocked: table_not_supported: audit row id=% table_name=% has no snapshot_kind and no legacy fallback mapping',
                    p_upload_id, v_parent.table_name
      USING ERRCODE = '22023';
  END IF;

  -- ─── STEP 3 — dry-run / apply parameter-invariant guard ───────────────
  -- Per ADR-007: p_dry_run AND p_expected_confirm_token IS NOT NULL is a
  -- caller bug (passing token on a dry-run makes no sense + leaks token
  -- intent in audit trail).
  IF p_dry_run AND p_expected_confirm_token IS NOT NULL THEN
    RAISE EXCEPTION 'revert_blocked: dry_run_token_present: p_dry_run=true with non-NULL p_expected_confirm_token (caller bug — dry runs return tokens, they do not consume them)'
      USING ERRCODE = '22023';
  END IF;

  -- ─── STEP 4 — lock_targets_for_kind per ADR-012 + ADR-024 ─────────────
  -- Phase 1 surface lock + Phase 2 per-row/per-key locks BEFORE the
  -- canonical-state read at step 5. Closes X13 TOCTOU lost-update window.
  v_lock_count := public.lock_targets_for_kind(v_kind, p_shop_id, v_snapshot);
  -- Note: v_lock_count == 0 is acceptable — the staleness check at step 6
  -- catches divergence when snapshot keys don't resolve to any current rows.

  -- ─── STEP 5 — compute current canonical state per ADR-024 ─────────────
  v_current_canonical := public.compute_current_canonical_for_kind(v_kind, p_shop_id, v_snapshot);
  v_current_head_hash := encode(digest(v_current_canonical, 'sha256'), 'hex');

  -- ─── STEP 6 — staleness check (ADR-014 3-branch logic) ───────────────
  v_after_hash := v_snapshot->>'after_hash';
  v_expected_canonical := v_snapshot->>'expected_after_state_canonical';

  -- Branch 1: hard fail (or accept force) when truly blind — no hash AND no canonical.
  IF v_after_hash IS NULL AND v_expected_canonical IS NULL THEN
    IF NOT COALESCE(p_force_no_after_hash, FALSE) THEN
      RAISE EXCEPTION 'revert_blocked: cannot_safely_verify: pre-CV2-B3 snapshot has no expected_after_state_canonical / after_hash; pass force_no_after_hash=true to override (logged + flagged for review)'
        USING ERRCODE = '22023';
    END IF;
    -- else: force=true accepted; no canonical content to verify against; proceed
  END IF;

  -- Branch 2: hash fast-path when after_hash present.
  IF v_after_hash IS NOT NULL AND v_after_hash <> v_current_head_hash THEN
    RAISE EXCEPTION 'staleness_check_failed: current state differs from expected post-upload state; diff=%',
      public.compute_unified_diff(
        COALESCE(v_expected_canonical, '<<expected_after_state_canonical not stored in this pre-CV2-B3 snapshot>>'),
        v_current_canonical, 50)
      USING ERRCODE = '22023';
  END IF;

  -- Branch 3: canonical fallback — ALWAYS fires when after_hash absent but canonical
  -- present. Force flag does NOT bypass this branch per ADR-014.
  IF v_after_hash IS NULL AND v_expected_canonical IS NOT NULL THEN
    IF v_expected_canonical <> v_current_canonical THEN
      RAISE EXCEPTION 'staleness_check_failed: current state differs from expected post-upload state (canonical-fallback, no after_hash on this snapshot); diff=%',
        public.compute_unified_diff(v_expected_canonical, v_current_canonical, 50)
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ─── STEP 7 — dry-run early return ────────────────────────────────────
  -- Compute confirm_token deterministically per PLAN §7 + ADR-007. Token
  -- binds (upload_id, after_hash, actor_email) so a different actor's apply
  -- with the same dry-run token would re-derive differently.
  v_token_recomputed := encode(
    digest(
      p_upload_id::TEXT || ':' ||
      COALESCE(v_after_hash, v_current_head_hash) || ':' ||
      p_actor_email,
      'sha256'),
    'hex');

  IF p_dry_run THEN
    -- Return token; NO mutations; NO audit row. Outer translates this to
    -- outcome=dry_run_success and persists the token hash on the attempt row.
    RETURN QUERY SELECT
      NULL::BIGINT      AS audit_log_id,
      v_token_recomputed AS confirm_token,
      0::INTEGER         AS restored,
      0::INTEGER         AS deactivated,
      0::INTEGER         AS deleted;
    RETURN;
  END IF;

  -- ─── STEP 8 — apply mode: validate p_expected_confirm_token ───────────
  IF p_expected_confirm_token IS NULL THEN
    RAISE EXCEPTION 'confirm_token_mismatch: apply mode requires non-NULL p_expected_confirm_token (caller bug — apply mode without a token from a prior dry-run is never safe)'
      USING ERRCODE = '22023';
  END IF;
  IF p_expected_confirm_token <> v_token_recomputed THEN
    RAISE EXCEPTION 'confirm_token_mismatch: provided token did not match the deterministically re-derived token for (upload_id, after_hash, actor_email) — re-run dry-run to get a fresh token'
      USING ERRCODE = '22023';
  END IF;

  -- ─── STEP 9 — dispatch to per-kind revert handler ─────────────────────
  -- Each handler returns TABLE(restored INT, deactivated INT, deleted INT,
  -- details JSONB) per ADR-004. The 4th column merges into diff_summary at
  -- step 10. Handlers live in migrations 00200/00300/00400 (E1c-e); PL/pgSQL
  -- function-body symbol resolution at CALL time permits this forward ref.
  CASE v_kind
    WHEN 'testing_services_v2' THEN
      SELECT * INTO v_stats FROM public.revert_testing_services_v2(p_shop_id, v_snapshot);
    WHEN 'routine_services_v2' THEN
      SELECT * INTO v_stats FROM public.revert_routine_services_v2(p_shop_id, v_snapshot);
    WHEN 'concern_subcategories_descriptions_v2' THEN
      SELECT * INTO v_stats FROM public.revert_subcategory_descriptions_v2(p_shop_id, v_snapshot);
    WHEN 'concern_subcategories_map_v2' THEN
      SELECT * INTO v_stats FROM public.revert_subcategory_service_map_v2(p_shop_id, v_snapshot);
    WHEN 'concern_questions_required_facts_v2' THEN
      SELECT * INTO v_stats FROM public.revert_question_required_facts_v2(p_shop_id, v_snapshot);
    WHEN 'concern_questions_flat' THEN
      SELECT * INTO v_stats FROM public.revert_concern_questions_flat(p_shop_id, v_snapshot);
    WHEN 'concern_questions_per_category' THEN
      SELECT * INTO v_stats FROM public.revert_concern_category_upload(p_shop_id, v_snapshot);
    WHEN 'concern_category_guidelines' THEN
      SELECT * INTO v_stats FROM public.revert_concern_category_guideline(p_shop_id, v_snapshot);
    WHEN 'appointment_default_limits' THEN
      SELECT * INTO v_stats FROM public.revert_appointment_default_limits(p_shop_id, v_snapshot);
    WHEN 'closed_dates_future' THEN
      SELECT * INTO v_stats FROM public.revert_closed_dates_future(p_shop_id, v_snapshot);
    ELSE
      -- ADR-011: snapshot_kind_unknown → reclassified to crashed by outer
      -- classifier. Surfaces missing-handler-deploy as a system-bug Sentry
      -- page, not a user-remediable rejection.
      RAISE EXCEPTION 'revert_blocked: snapshot_kind_unknown: % is not in the per-kind handler dispatch — this is a system bug, not a user error', v_kind
        USING ERRCODE = '22023';
  END CASE;

  -- ─── STEP 10 — INSERT revert audit row ────────────────────────────────
  -- Merges standard diff keys + the handler's details JSONB per ADR-004.
  -- Also captures expected_after_state_canonical recomputed AFTER writes
  -- so the next revert (of this revert) has a fresh canonical to compare.
  v_diff_summary := jsonb_build_object(
    'kind', v_kind,
    'reverts_upload_id', p_upload_id,
    'force_no_after_hash_used',
      (COALESCE(p_force_no_after_hash, FALSE) AND v_after_hash IS NULL AND v_expected_canonical IS NULL),
    'lock_count', v_lock_count,
    'attempt_id', p_attempt_id
  ) || COALESCE(v_stats.details, '{}'::JSONB);

  INSERT INTO public.scheduler_admin_audit_log (
    occurred_at, oauth_client_id, user_label, table_name, operation,
    rows_added, rows_modified, rows_deactivated, md_content_hash,
    diff_summary, shop_id, reverts_upload_id
  ) VALUES (
    now(), p_oauth_client_id, p_actor_email, v_parent.table_name, 'revert_upload',
    COALESCE(v_stats.restored, 0),
    0,
    COALESCE(v_stats.deactivated, 0) + COALESCE(v_stats.deleted, 0),
    NULL,                       -- md_content_hash N/A for reverts
    v_diff_summary,
    p_shop_id, p_upload_id
  )
  RETURNING id INTO v_revert_audit_id;

  -- ─── STEP 11 — UPDATE parent.successor_revert_id ──────────────────────
  -- Atomic with step 10 within this inner-RPC subtransaction.
  UPDATE public.scheduler_admin_audit_log
     SET successor_revert_id = v_revert_audit_id
   WHERE id = p_upload_id;

  -- ─── STEP 12 — RETURN structured result ───────────────────────────────
  RETURN QUERY SELECT
    v_revert_audit_id           AS audit_log_id,
    NULL::TEXT                  AS confirm_token,
    COALESCE(v_stats.restored, 0)::INTEGER    AS restored,
    COALESCE(v_stats.deactivated, 0)::INTEGER AS deactivated,
    COALESCE(v_stats.deleted, 0)::INTEGER     AS deleted;
END $$;

-- R6-B1 NO-GRANT triple — inner RPC is internal per ADR-005
REVOKE EXECUTE ON FUNCTION public.revert_md_upload_apply(INTEGER, BIGINT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_md_upload_apply(INTEGER, BIGINT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, BIGINT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revert_md_upload_apply(INTEGER, BIGINT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, BIGINT) FROM service_role;

COMMENT ON FUNCTION public.revert_md_upload_apply(INTEGER, BIGINT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, BIGINT) IS
  'Inner revert RPC — 12-step dispatch per ADR-012. RAISE-only contract per ADR-001. Reachable ONLY via SECURITY DEFINER ownership chain from revert_md_upload_attempt (outer) per ADR-005. NO GRANT to service_role.';


-- ════════════════════════════════════════════════════════════════════════
-- OUTER RPC 16 of 16 — revert_md_upload_attempt
-- ════════════════════════════════════════════════════════════════════════
-- Governs: ADR-001 (outer/inner split, NEVER re-RAISEs from EXCEPTION block);
--          ADR-002 (3-branch attempt-row contract); ADR-007/008/009/010/011
--          (reason_code enum, classifier, sanitized error_message, redaction,
--          snapshot_kind_unknown → crashed); ADR-005 (the only outer-callable
--          entry point for the revert path — GRANT TO service_role)
--
-- RETURN signature MUST match ADR-001 verbatim:
--   (audit_log_id BIGINT, confirm_token TEXT, restored INT, deactivated INT,
--    deleted INT, dry_run BOOLEAN, outcome TEXT, reason_code TEXT,
--    error_message TEXT, attempt_id BIGINT)
-- Any drift breaks the no-RAISE contract at call time.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.revert_md_upload_attempt(
  p_shop_id INTEGER,
  p_upload_id BIGINT,
  p_actor_email TEXT,
  p_oauth_client_id TEXT,
  p_dry_run BOOLEAN,
  p_expected_confirm_token TEXT,
  p_force_no_after_hash BOOLEAN
) RETURNS TABLE (
  audit_log_id BIGINT,
  confirm_token TEXT,
  restored INTEGER,
  deactivated INTEGER,
  deleted INTEGER,
  dry_run BOOLEAN,
  outcome TEXT,
  reason_code TEXT,
  error_message TEXT,
  attempt_id BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp
AS $$
DECLARE
  v_attempt_id      BIGINT;
  v_inner           RECORD;
  v_outcome         TEXT;
  v_reason          TEXT;
  v_sqlstate        TEXT;
  v_sqlerrm         TEXT;
  v_constraint_name TEXT;
  v_sanitized_error_message TEXT;
  v_token_hash      TEXT;
BEGIN
  -- ─── STEP 0a — p_shop_id presence + positivity (ADR-002 Branch 3) ─────
  -- RAISE per Postgres convention BEFORE opening the BEGIN/EXCEPTION
  -- subtransaction. Callers see a Postgres SQLSTATE, NOT a structured
  -- outcome — pre-inner guards are Branch 3 of ADR-002.
  IF p_shop_id IS NULL OR p_shop_id <= 0 THEN
    RAISE EXCEPTION 'p_shop_id must be a positive integer (got %)', p_shop_id
      USING ERRCODE = '22023';
  END IF;
  IF p_upload_id IS NULL OR p_upload_id <= 0 THEN
    RAISE EXCEPTION 'p_upload_id must be a positive bigint (got %)', p_upload_id
      USING ERRCODE = '22023';
  END IF;

  -- ─── STEP 0b — p_actor_email presence (ADR-002 Branch 3) ──────────────
  IF p_actor_email IS NULL OR length(trim(p_actor_email)) = 0 THEN
    RAISE EXCEPTION 'p_actor_email is required (operator identity backstop)'
      USING ERRCODE = '22023';
  END IF;

  -- ─── STEP 0c — boolean param non-NULL guards (ADR-002 Branch 3) ───────
  IF p_dry_run IS NULL OR p_force_no_after_hash IS NULL THEN
    RAISE EXCEPTION 'p_dry_run and p_force_no_after_hash must be non-NULL booleans (caller bug — pass an explicit value)'
      USING ERRCODE = '22023';
  END IF;

  -- ─── STEP 0d — upload-existence + tenant pre-check (ADR-002 Branch 2) ──
  -- Returns structured rejected/not_found WITHOUT writing an attempt row.
  -- The attempt-table FK on upload_id makes recording a nonexistent upload
  -- schema-impossible, so the rejection itself is the audit record.
  IF NOT EXISTS (
    SELECT 1 FROM public.scheduler_admin_audit_log
     WHERE id = p_upload_id AND shop_id = p_shop_id
  ) THEN
    RETURN QUERY SELECT
      NULL::BIGINT      AS audit_log_id,
      NULL::TEXT        AS confirm_token,
      0::INTEGER        AS restored,
      0::INTEGER        AS deactivated,
      0::INTEGER        AS deleted,
      p_dry_run         AS dry_run,
      'rejected'::TEXT  AS outcome,
      'not_found'::TEXT AS reason_code,
      ('upload not found in caller shop (attempt_id n/a — branch-2 rejection per ADR-002 does not create an attempt row)')::TEXT
                        AS error_message,
      NULL::BIGINT      AS attempt_id;
    RETURN;
  END IF;

  -- ─── STEP 1 — pre-INSERT pending attempt row (outer transaction frame) ─
  -- Survives inner rollback per ADR-002 Branch 1. Outer subtransaction
  -- below either UPDATEs to terminal success or terminal rejected/crashed
  -- from the EXCEPTION handler.
  INSERT INTO public.scheduler_admin_revert_attempts (
    upload_id, shop_id, actor_email, oauth_client_id, dry_run,
    outcome
  ) VALUES (
    p_upload_id, p_shop_id, p_actor_email, p_oauth_client_id, p_dry_run,
    'pending'
  )
  RETURNING id INTO v_attempt_id;

  -- ─── STEP 2 — nested BEGIN/EXCEPTION subtransaction (per ADR-003) ─────
  -- This is the "SAVEPOINT" the prose refers to — implicit subtransaction
  -- via PL/pgSQL BEGIN block. No literal SAVEPOINT keywords (those don't
  -- compile in function bodies — only top-level sessions / procedures
  -- via CALL can issue them). Inner RAISE → subtransaction rolls back
  -- (inner mutations + audit row gone); EXCEPTION handler runs in outer
  -- transaction frame; attempt row PERSISTS (was INSERTed before this
  -- block opened).
  BEGIN
    SELECT *
      INTO v_inner
      FROM public.revert_md_upload_apply(
        p_shop_id, p_upload_id, p_actor_email, p_oauth_client_id,
        p_dry_run, p_expected_confirm_token, p_force_no_after_hash,
        v_attempt_id);

    -- Inner succeeded — classify dry_run vs apply.
    IF p_dry_run THEN
      -- dry_run_success: confirm_token populated; no audit_log_id.
      v_token_hash := encode(digest(v_inner.confirm_token, 'sha256'), 'hex');
      UPDATE public.scheduler_admin_revert_attempts
         SET outcome = 'dry_run_success',
             completed_at = now(),
             dry_run_confirm_token_hash = v_token_hash
       WHERE id = v_attempt_id;

      RETURN QUERY SELECT
        NULL::BIGINT                  AS audit_log_id,
        v_inner.confirm_token         AS confirm_token,
        0::INTEGER                    AS restored,
        0::INTEGER                    AS deactivated,
        0::INTEGER                    AS deleted,
        TRUE                          AS dry_run,
        'dry_run_success'::TEXT       AS outcome,
        NULL::TEXT                    AS reason_code,
        NULL::TEXT                    AS error_message,
        v_attempt_id                  AS attempt_id;
      RETURN;
    ELSE
      -- success: revert_audit_log_id populated; counts mirror handler.
      UPDATE public.scheduler_admin_revert_attempts
         SET outcome = 'success',
             completed_at = now(),
             revert_audit_log_id = v_inner.audit_log_id
       WHERE id = v_attempt_id;

      RETURN QUERY SELECT
        v_inner.audit_log_id          AS audit_log_id,
        NULL::TEXT                    AS confirm_token,
        v_inner.restored              AS restored,
        v_inner.deactivated           AS deactivated,
        v_inner.deleted               AS deleted,
        FALSE                         AS dry_run,
        'success'::TEXT               AS outcome,
        NULL::TEXT                    AS reason_code,
        NULL::TEXT                    AS error_message,
        v_attempt_id                  AS attempt_id;
      RETURN;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    -- ─── ADR-008 classifier — extract reason_code via regex + allow-list ─
    -- NEVER re-RAISEs per ADR-001. Inner mutations + audit row are already
    -- rolled back by the subtransaction. Attempt row PERSISTS (outer frame).
    GET STACKED DIAGNOSTICS
      v_sqlstate        = RETURNED_SQLSTATE,
      v_sqlerrm         = MESSAGE_TEXT,
      v_constraint_name = CONSTRAINT_NAME;

    -- Priority-ordered classifier per ADR-008:

    -- 1. SQLSTATE 55P03 — lock_not_available (NOWAIT on parent audit row)
    IF v_sqlstate = '55P03' THEN
      v_outcome := 'rejected';
      v_reason  := 'another_revert_in_progress';

    -- 2. SQLSTATE 23505 with the partial unique on one_successful_revert_idx
    --    → successor_revert_exists (concurrent successful revert landed first)
    ELSIF v_sqlstate = '23505' AND v_constraint_name = 'scheduler_admin_audit_log_one_successful_revert_idx' THEN
      v_outcome := 'rejected';
      v_reason  := 'successor_revert_exists';

    -- 3. SQLSTATE 23505 (any other constraint) → unique_violation crashed
    ELSIF v_sqlstate = '23505' THEN
      v_outcome := 'crashed';
      v_reason  := 'unique_violation';

    -- 4. ADR-007 'revert_blocked:' prefix — regex extract + allow-list check
    ELSIF v_sqlerrm LIKE 'revert_blocked:%' THEN
      v_outcome := 'rejected';
      v_reason  := substring(v_sqlerrm from 'revert_blocked:\s+([a-z0-9_]+)');

      -- Allow-list per ADR-007. Unknown → unclassified_revert_blocked.
      IF v_reason IS NULL OR v_reason NOT IN (
        'not_found','not_upload_md','successor_revert_exists','snapshot_pruned',
        'no_snapshot','over_30_day_cutoff','table_not_supported','snapshot_kind_unknown',
        'dry_run_token_present','cannot_safely_verify',
        'cross_shop_hijack_attempt','fk_target_tenant_mismatch','fk_broken',
        'snapshot_invalid'
      ) THEN
        v_reason := 'unclassified_revert_blocked';
      END IF;

      -- ADR-011 special case: snapshot_kind_unknown reclassified rejected → crashed
      -- (system bug — missing handler for a kind that passed step-2 eligibility;
      -- pages engineering on-call, not user-remediable)
      IF v_reason = 'snapshot_kind_unknown' THEN
        v_outcome := 'crashed';
      END IF;

      -- ADR-008 invariant 3: fk_target_tenant_mismatch → fk_broken (canonical
      -- enum collapses all FK-related rejections to one Sentry-grouping enum)
      IF v_reason = 'fk_target_tenant_mismatch' THEN
        v_reason := 'fk_broken';
      END IF;

    -- 5. 'confirm_token_mismatch:' prefix (raised by inner step 8)
    ELSIF v_sqlerrm LIKE 'confirm_token_mismatch:%' THEN
      v_outcome := 'rejected';
      v_reason  := 'confirm_token_mismatch';

    -- 6. 'staleness_check_failed:' prefix (raised by inner step 6 branch 2 / 3)
    ELSIF v_sqlerrm LIKE 'staleness_check_failed:%' THEN
      v_outcome := 'rejected';
      v_reason  := 'current_state_drift';

    -- 7. Catch-all ELSE → crashed with NULL reason_code (genuinely unexpected)
    ELSE
      v_outcome := 'crashed';
      v_reason  := NULL;
    END IF;

    -- ─── ADR-009 sanitized error_message via CASE table ───────────────────
    -- NEVER references v_sqlerrm. Only v_attempt_id is dynamic.
    v_sanitized_error_message := CASE v_outcome
      WHEN 'rejected' THEN
        CASE v_reason
          WHEN 'current_state_drift'        THEN 'current state drifted since dry-run; re-run dry_run to view the diff (attempt_id ' || v_attempt_id::TEXT || ')'
          WHEN 'confirm_token_mismatch'     THEN 'confirm_token did not match the latest dry-run for this upload; re-run dry_run for a fresh token (attempt_id ' || v_attempt_id::TEXT || ')'
          WHEN 'successor_revert_exists'    THEN 'upload has already been successfully reverted (attempt_id ' || v_attempt_id::TEXT || ')'
          WHEN 'another_revert_in_progress' THEN 'another revert is in progress for this upload; retry shortly (attempt_id ' || v_attempt_id::TEXT || ')'
          ELSE 'revert rejected: ' || COALESCE(v_reason, '<unknown>') || ' (attempt_id ' || v_attempt_id::TEXT || ')'
        END
      WHEN 'crashed' THEN
        'internal error occurred during revert; operators pivot to attempt_id ' || v_attempt_id::TEXT || ' for the verbose SQLSTATE:SQLERRM body in scheduler_admin_revert_attempts.error_detail'
      ELSE
        'revert failed with unclassified outcome: ' || COALESCE(v_outcome, '<null>') || ' (attempt_id ' || v_attempt_id::TEXT || ')'
    END;

    -- ─── Persist terminal outcome on the pre-INSERTed attempt row ─────────
    -- Per ADR-009: raw v_sqlerrm flows to error_detail (DB-only). The
    -- concatenated SQLSTATE:CONSTRAINT_NAME:SQLERRM aids unique-violation
    -- triage. Constraint name '<none>' placeholder for non-constraint errors.
    UPDATE public.scheduler_admin_revert_attempts
       SET outcome      = v_outcome,
           reason_code  = v_reason,
           error_detail = v_sqlstate || ':' || COALESCE(v_constraint_name, '<none>') || ':' || v_sqlerrm,
           completed_at = now()
     WHERE id = v_attempt_id;

    -- ─── RETURN structured row (NEVER re-RAISE per ADR-001) ───────────────
    -- Per ADR-009: error_message is the sanitized templated summary, NOT
    -- raw v_sqlerrm. Per ADR-010: reason_code (canonical enum) + attempt_id
    -- (pivot key) flow through; verbose detail stays in DB.
    RETURN QUERY SELECT
      NULL::BIGINT                AS audit_log_id,
      NULL::TEXT                  AS confirm_token,
      0::INTEGER                  AS restored,
      0::INTEGER                  AS deactivated,
      0::INTEGER                  AS deleted,
      p_dry_run                   AS dry_run,
      v_outcome                   AS outcome,
      v_reason                    AS reason_code,
      v_sanitized_error_message   AS error_message,
      v_attempt_id                AS attempt_id;
    RETURN;
  END;
END $$;

-- ─── ADR-005 outer-callable entry point — GRANT TO service_role ─────────
-- This is one of the 6 outer-callable entry points carrying the full
-- REVOKE PUBLIC/anon/authenticated + GRANT service_role triple. The
-- service_role grant is what orchestrator-mcp's revertMdUpload tool uses
-- to invoke the dispatch from edge-function context.
REVOKE EXECUTE ON FUNCTION public.revert_md_upload_attempt(INTEGER, BIGINT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_md_upload_attempt(INTEGER, BIGINT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.revert_md_upload_attempt(INTEGER, BIGINT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN) TO service_role;

COMMENT ON FUNCTION public.revert_md_upload_attempt(INTEGER, BIGINT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN) IS
  'Outer revert RPC — public-facing entry point. Wraps inner RPC in BEGIN/EXCEPTION subtransaction per ADR-001 + ADR-003. NEVER re-RAISEs from EXCEPTION block. Returns structured 10-column row per ADR-001 signature. Classifier per ADR-008 + sanitized error_message per ADR-009 + redaction per ADR-010. STEP 0a/b/c RAISE BEFORE block opens (Branch 3); STEP 0d returns structured not_found WITHOUT attempt row (Branch 2). Service_role-callable per ADR-005 outer-callable entry-point set.';


-- ════════════════════════════════════════════════════════════════════════
-- END E1b dispatch migration
--
-- 16 functions created. Next file (E1c): 20260526000200_revert_handlers_v2.sql
-- creates revert_testing_services_v2 + revert_routine_services_v2 — referenced
-- by the inner RPC's step 9 dispatch CASE above (PL/pgSQL defers function-body
-- symbol resolution to CALL time, so this file CREATEs cleanly even though
-- the handlers don't exist yet).
-- ════════════════════════════════════════════════════════════════════════
