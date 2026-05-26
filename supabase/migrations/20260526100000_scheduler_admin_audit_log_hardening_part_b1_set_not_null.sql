-- ────────────────────────────────────────────────────────────────────────
-- scheduler-edge-parity feature — Migration B Part 1 (transactional)
-- ────────────────────────────────────────────────────────────────────────
--
-- STAGED — lives in supabase/migrations-staged/ per ADR-022 + ADR-006 +
-- PLAN §3 staging mechanic. Operator moves into supabase/migrations/ at
-- E11e ONLY AFTER:
--   1. E2-E10 ship (all new code writes shop_id explicitly)
--   2. E11a deploys orchestrator-mcp (so old uploaders are out of service
--      OR upgraded to set shop_id)
--   3. E11b-d backfill scripts run (or manual MCP backfill — done 2026-05-26
--      for test DB: 5 rows backfilled, 0 NULL remaining)
--   4. Verification: SELECT COUNT(*) FROM scheduler_admin_audit_log WHERE
--      shop_id IS NULL — MUST return 0
--
-- Cross-references:
--   ADR-006: migration apply order (E11e)
--   ADR-018: RLS policies already in place
--   ADR-022: Migration B + backfill design
-- ────────────────────────────────────────────────────────────────────────

-- ── 1. HARD CHECK on residual NULL shop_id rows ─────────────────────────
--
-- Fails LOUD if backfill PHASE 1/2 was skipped. The operator MUST run
-- scripts/backfill-audit-log-shop-id.ts first (or apply the equivalent
-- backfill manually via MCP). If this RAISE fires, the migration is
-- rolled back entirely (transactional file).

DO $$
DECLARE null_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO null_count
  FROM public.scheduler_admin_audit_log
  WHERE shop_id IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'Migration B blocked: % NULL shop_id rows remain. Run scripts/backfill-audit-log-shop-id.ts PHASE 1/2 first.', null_count;
  END IF;
END $$;

-- ── 2. Flip shop_id to NOT NULL ──────────────────────────────────────────

ALTER TABLE public.scheduler_admin_audit_log
  ALTER COLUMN shop_id SET NOT NULL;

-- ── 3. Idempotent ADD CONSTRAINT — permits sentinel -1 + positive ids ───
--
-- The OR-clause permits sentinel -1 rows that PHASE 2 backfill wrote for
-- historical rows whose shop_id couldn't be derived. Without the OR,
-- migration would fail after PHASE 2 sentinel was applied.
-- DO-block catches duplicate_object for partial-apply retry safety.

DO $$
BEGIN
  ALTER TABLE public.scheduler_admin_audit_log
    ADD CONSTRAINT scheduler_admin_audit_log_shop_id_valid_check
      CHECK (shop_id > 0 OR shop_id = -1);
EXCEPTION WHEN duplicate_object THEN
  NULL;  -- constraint exists from prior partial-apply; safe no-op
END $$;

-- ────────────────────────────────────────────────────────────────────────
-- END Migration B Part 1
--
-- Next files (per ADR-022 ADR-Fix #6 + pipeline-mode workaround per
-- ROUND-6-RESIDUALS E1a-DEPLOY runbook): Part 2 = 4 single-statement
-- skip-tx-wrap files that DROP + CREATE CONCURRENTLY the 2 narrowed indexes
-- (shop_recent_idx, surface_recent_idx) replacing the Migration A versions
-- (WHERE shop_id IS NOT NULL → WHERE shop_id > 0, excludes sentinel rows).
--
-- The narrowed indexes are an OPTIMIZATION; Part B1 alone is correctness-
-- complete. Part B2 can be deferred if the optimization is not urgent.
-- ────────────────────────────────────────────────────────────────────────
