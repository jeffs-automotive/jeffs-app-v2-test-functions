-- ────────────────────────────────────────────────────────────────────────
-- scheduler-edge-parity feature — Migration A Part 2a of 5
-- ────────────────────────────────────────────────────────────────────────
-- ONE CONCURRENT statement per file.
--
-- WHY ONE-PER-FILE: Supabase CLI 2.100.x uses pgx pipeline mode when
-- applying migrations via `supabase db push`. Multiple statements in one
-- file get sent as a single pipeline batch, and PostgreSQL rejects
-- CREATE INDEX CONCURRENTLY inside a pipeline with SQLSTATE 25001
-- ("CREATE INDEX CONCURRENTLY cannot be executed within a pipeline").
-- The fix is to have exactly ONE statement per migration file. The CLI
-- treats each file as its own pipeline batch; a single CONCURRENT
-- statement runs fine.
--
-- The `-- supabase: skip-tx-wrap` directive (line 1) is INTENT-ONLY for
-- this CLI version (no-op). Future CLI versions may parse it; keeping it
-- documents the architectural intent (no implicit transaction wrap for
-- CONCURRENT operations).
--
-- Recovery procedure if `supabase db push` still fails (e.g., after a
-- partial-apply, leaving an INVALID index):
--   1. DROP INDEX CONCURRENTLY IF EXISTS public.<name>; (via MCP execute_sql or psql)
--   2. CREATE INDEX CONCURRENTLY IF NOT EXISTS public.<name> ON ...;  (manual)
--   3. supabase migration repair --status applied <timestamp> --linked
-- See ROUND-6-RESIDUALS.md E1a-DEPLOY for the full runbook.
-- ────────────────────────────────────────────────────────────────────────
-- supabase: skip-tx-wrap

-- Race-defense partial unique: one successful revert per upload.
-- Predicate: a row enters the unique invariant ONLY if it's a successful
-- revert (reverts_upload_id set AND error_message null). Failed reverts
-- (error_message non-null) don't compete for the slot. This permits
-- multiple failed revert attempts on the same upload while enforcing
-- at-most-one successful landing.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS scheduler_admin_audit_log_one_successful_revert_idx
  ON public.scheduler_admin_audit_log (reverts_upload_id)
  WHERE reverts_upload_id IS NOT NULL AND error_message IS NULL;
