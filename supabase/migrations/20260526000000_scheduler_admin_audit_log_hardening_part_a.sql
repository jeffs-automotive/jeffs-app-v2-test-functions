-- ────────────────────────────────────────────────────────────────────────
-- scheduler-edge-parity feature — Migration A (Part 1, transactional)
-- ────────────────────────────────────────────────────────────────────────
--
-- This file is the FIRST of two files that together comprise Migration A
-- per ADR-022 (audit_log Migration A + B + backfill) + ADR-Fix #3 +
-- ADR-Fix #16/#17/#21/#22 (canonical security pattern: 6 outer-callable
-- entry points get GRANT TO service_role; 25 internal SECURITY DEFINER
-- functions are NO-GRANT — defined in subsequent migrations, not here).
--
-- This file (Part 1) runs INSIDE Supabase CLI's implicit transaction wrap.
-- It performs additive DDL on the existing scheduler_admin_audit_log
-- table + creates the new scheduler_admin_revert_attempts table + sets
-- up RLS RESTRICTIVE deny-all per ADR-018 + REVOKE/GRANT triple on both
-- tables.
--
-- The 4 CONCURRENT indexes on the live scheduler_admin_audit_log table
-- ship in the companion file `20260526000001_audit_log_concurrent_indexes.sql`
-- (Part 2), which is non-transactional via `-- supabase: skip-tx-wrap`.
-- The 4 indexes on the brand-new scheduler_admin_revert_attempts table
-- are created here inside the transaction (table is empty + has zero
-- concurrent writers → ACCESS EXCLUSIVE lock is contention-free).
--
-- Cross-references:
--   ADR-006: migration apply order (E1a → this file)
--   ADR-017: SET search_path on every SECURITY DEFINER func (next migrations)
--   ADR-018: RLS RESTRICTIVE deny-all policy pattern
--   ADR-020: scheduler_admin_revert_attempts table schema (full DDL below)
--   ADR-022: Migration A + B + backfill
--   ROUND-6-RESIDUALS.md R6-B1: 25-function count for NO-GRANT triple (next migration)
--
-- Existing state (from migrations 20260513000100 + 20260519140000):
--   scheduler_admin_audit_log already exists with columns:
--     id, occurred_at, oauth_client_id, user_label, table_name, operation,
--     rows_added, rows_modified, rows_deactivated, md_content_hash,
--     diff_summary, error_message, pre_state_snapshot, snapshot_pruned_at
--   Existing CHECK on operation: IN ('upload_md','manual_change','export_md')
--   Existing indexes: table_idx, user_idx, snapshot_idx
--   Existing RLS: ENABLE + PERMISSIVE "deny_all" policy with USING(false)
-- ────────────────────────────────────────────────────────────────────────

-- ── 1. pgcrypto extension (per ADR-017 search_path → digest() resolves) ─

CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- pgcrypto installs into the `extensions` schema on Supabase by default
-- (per https://supabase.com/docs/guides/database/extensions). The dispatch
-- migration's SECURITY DEFINER functions use
-- SET search_path = pg_catalog, extensions, public, pg_temp
-- so unqualified `digest(...)` calls resolve to extensions.digest(...).

-- ── 2. PE-1: loosen operation CHECK to permit 'revert_upload' ───────────

ALTER TABLE public.scheduler_admin_audit_log
  DROP CONSTRAINT IF EXISTS scheduler_admin_audit_log_operation_check;
ALTER TABLE public.scheduler_admin_audit_log
  ADD CONSTRAINT scheduler_admin_audit_log_operation_check
    CHECK (operation IN ('upload_md','manual_change','export_md','revert_upload'));

-- ── 3. PE-2: shop_id NULLABLE (backfill via Deno script E11b-d) ──────────
--
-- Phase 2 of the backfill script will set sentinel `-1` for any historical
-- row whose shop_id cannot be derived from the snapshot/table-row evidence.
-- Migration B (E11e) flips to NOT NULL after backfill confirmation, then
-- adds CHECK (shop_id > 0 OR shop_id = -1) — the OR-clause permits the
-- sentinel rows.

ALTER TABLE public.scheduler_admin_audit_log
  ADD COLUMN IF NOT EXISTS shop_id INTEGER NULL;

COMMENT ON COLUMN public.scheduler_admin_audit_log.shop_id IS
  'Tenant scope. NULL on historical rows until backfill PHASE 1/2 derives. After Migration B: NOT NULL + CHECK (shop_id > 0 OR shop_id = -1). Sentinel -1 = pre-migration row with unresolvable shop_id; revert eligibility surfaces these with reason_code=shop_id_unknown_pre_migration_backfill per ADR-021.';

-- ── 4. PE-3: revert linkage columns ──────────────────────────────────────
--
-- successor_revert_id: forward pointer set by outer RPC when a successful
--   revert lands; used to detect "already reverted" eligibility rejection
--   (per ADR-007 reason_code=successor_revert_exists).
-- reverts_upload_id: back pointer set by inner RPC step 11 on revert audit
--   row creation; identifies the original upload that this revert undoes.
-- Both ON DELETE SET NULL — audit-log retention pruning of an old upload
-- shouldn't FK-error the revert row that points at it.

ALTER TABLE public.scheduler_admin_audit_log
  ADD COLUMN IF NOT EXISTS successor_revert_id BIGINT NULL
    REFERENCES public.scheduler_admin_audit_log(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reverts_upload_id BIGINT NULL
    REFERENCES public.scheduler_admin_audit_log(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.scheduler_admin_audit_log.successor_revert_id IS
  'Forward pointer to the revert audit row that undoes this upload (NULL if not yet reverted). Set by outer revert_md_upload_attempt at successful inner-RPC commit. UNIQUE per upload (enforced by partial unique index in Part 2: one_successful_revert_idx).';

COMMENT ON COLUMN public.scheduler_admin_audit_log.reverts_upload_id IS
  'Back pointer to the original upload this revert undoes (NULL on rows that are not reverts — i.e., upload_md/manual_change/export_md operations). Set by inner revert_md_upload_apply at audit-row INSERT (step 10).';

-- ── 5. scheduler_admin_revert_attempts table (NEW per ADR-020) ───────────
--
-- Operators get a complete failure trail visible to SQL queries even when
-- the inner RPC's transaction rolls back (per ADR-002 attempt-row contract).
-- 5 named pairwise-scope CHECK constraints + 1 inline `shop_id > 0`
-- positivity CHECK + 1 inline `outcome` domain CHECK = 7 total CHECK
-- constraints (per ROUND-6-RESIDUALS R6-I3 — count by individual CHECK).
-- The 5 pairwise-scope constraints close internally contradictory
-- (outcome, dry_run, reason_code, ...) tuples that nothing else catches.

CREATE TABLE IF NOT EXISTS public.scheduler_admin_revert_attempts (
  id                              BIGSERIAL PRIMARY KEY,
  attempted_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at                    TIMESTAMPTZ NULL,
  upload_id                       BIGINT NOT NULL
                                    REFERENCES public.scheduler_admin_audit_log(id) ON DELETE RESTRICT,
  shop_id                         INTEGER NOT NULL CHECK (shop_id > 0),
  actor_email                     TEXT,
  oauth_client_id                 TEXT,
  dry_run                         BOOLEAN NOT NULL,
  outcome                         TEXT NOT NULL
                                    CHECK (outcome IN ('pending','dry_run_success','success','rejected','crashed')),
  reason_code                     TEXT NULL,
  error_detail                    TEXT NULL,
  metadata                        JSONB NULL,
  dry_run_confirm_token_hash      TEXT NULL,
  revert_audit_log_id             BIGINT NULL
                                    REFERENCES public.scheduler_admin_audit_log(id),

  CONSTRAINT scheduler_admin_revert_attempts_token_hash_scope_check
    CHECK (
      (outcome = 'dry_run_success' AND dry_run_confirm_token_hash IS NOT NULL)
      OR (outcome <> 'dry_run_success' AND dry_run_confirm_token_hash IS NULL)
    ),

  CONSTRAINT scheduler_admin_revert_attempts_completed_at_invariant_check
    CHECK (
      (outcome = 'pending' AND completed_at IS NULL)
      OR (outcome <> 'pending' AND completed_at IS NOT NULL)
    ),

  CONSTRAINT scheduler_admin_revert_attempts_audit_log_scope_check
    CHECK (
      (outcome = 'success' AND revert_audit_log_id IS NOT NULL)
      OR (outcome <> 'success' AND revert_audit_log_id IS NULL)
    ),

  CONSTRAINT scheduler_admin_revert_attempts_dry_run_outcome_scope_check
    CHECK (
      (outcome = 'success'         AND dry_run = FALSE) OR
      (outcome = 'dry_run_success' AND dry_run = TRUE)  OR
      outcome IN ('pending', 'rejected', 'crashed')
    ),

  CONSTRAINT scheduler_admin_revert_attempts_success_field_scope_check
    CHECK (
      (outcome IN ('success', 'dry_run_success')
         AND reason_code IS NULL AND error_detail IS NULL)
      OR (outcome = 'rejected' AND reason_code IS NOT NULL)
      OR outcome = 'crashed'
      OR (outcome = 'pending' AND reason_code IS NULL AND error_detail IS NULL)
    )
);

COMMENT ON TABLE public.scheduler_admin_revert_attempts IS
  'Failure trail for revert attempts. Outer revert_md_upload_attempt RPC inserts pending row at STEP 0d (after parameter validation + upload-existence check), then updates to terminal outcome from EXCEPTION block. Survives inner-RPC rollback because outer pre-INSERT lives in outer transaction frame. See ADR-002 + ADR-020 for the full contract. Branch-2 not_found rejections do NOT produce a row (FK on upload_id makes recording a nonexistent upload impossible); operators must consult RPC-call log for those.';

COMMENT ON COLUMN public.scheduler_admin_revert_attempts.actor_email IS
  'Operator label, NOT strictly email-formatted per ADR-010 + SEC-18. Column name is legacy; semantic is human-readable identifier (may be email OR display_name from OAuth identity provider). Notification send-paths MUST NOT treat as email recipient without separate identity resolution.';

COMMENT ON COLUMN public.scheduler_admin_revert_attempts.error_detail IS
  'Verbose SQLSTATE:CONSTRAINT_NAME:SQLERRM body, including inline staleness-diff content from compute_unified_diff (may contain customer-facing scheduler MD). DB-only — NEVER forwarded to Sentry or RPC return per ADR-009 + ADR-010.';

COMMENT ON COLUMN public.scheduler_admin_revert_attempts.revert_audit_log_id IS
  'Back pointer to scheduler_admin_audit_log row that records this successful revert. NULL on non-success outcomes. SEC-14 deferred trigger will enforce semantic correctness (operation=revert_upload, reverts_upload_id=this.upload_id, shop_id match, error_message IS NULL).';

-- ── 6. scheduler_admin_revert_attempts indexes (5 total) ─────────────────
--
-- Inside BEGIN because the table is brand-new with zero rows and zero
-- concurrent writers — ACCESS EXCLUSIVE lock is contention-free.
-- Per ADR-020 (post-ADR-Fix #13 clarification): 5 indexes total, NOT 4.

CREATE UNIQUE INDEX IF NOT EXISTS scheduler_admin_revert_attempts_one_successful_attempt_idx
  ON public.scheduler_admin_revert_attempts (revert_audit_log_id)
  WHERE revert_audit_log_id IS NOT NULL;
-- Enforces: at most one attempt row may reference any given revert audit-log
-- row (closes attempt-row write doubling). NOTE: this does NOT enforce "one
-- successful revert per upload" — that invariant lives on the audit_log
-- itself via the partial unique index in Part 2 (one_successful_revert_idx).

CREATE INDEX IF NOT EXISTS scheduler_admin_revert_attempts_outcome_idx
  ON public.scheduler_admin_revert_attempts (outcome);

CREATE INDEX IF NOT EXISTS scheduler_admin_revert_attempts_shop_idx
  ON public.scheduler_admin_revert_attempts (shop_id);

CREATE INDEX IF NOT EXISTS scheduler_admin_revert_attempts_upload_idx
  ON public.scheduler_admin_revert_attempts (upload_id);

CREATE INDEX IF NOT EXISTS scheduler_admin_revert_attempts_pending_idx
  ON public.scheduler_admin_revert_attempts (attempted_at DESC)
  WHERE outcome = 'pending';
-- Pending partial index for stuck-pending alerting query: rows older than
-- ~5min in pending state suggest the outer RPC's EXCEPTION block didn't
-- run (process crashed, timeout, etc.). Operators alert on count > 0 with
-- WHERE outcome='pending' AND attempted_at < now() - interval '5 minutes'.

-- ── 7. RLS RESTRICTIVE deny-all on scheduler_admin_revert_attempts ───────
--
-- Per ADR-018. Defensive ENABLE RLS guards against environmental drift;
-- DO-block CREATE POLICY catches duplicate_object from partial-apply.

ALTER TABLE public.scheduler_admin_revert_attempts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY scheduler_admin_revert_attempts_default_deny
    ON public.scheduler_admin_revert_attempts
    AS RESTRICTIVE
    FOR ALL
    TO PUBLIC, anon, authenticated
    USING (false)
    WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN
  NULL;  -- policy already exists from partial-apply; safe no-op
END $$;

REVOKE ALL ON TABLE public.scheduler_admin_revert_attempts FROM PUBLIC;
REVOKE ALL ON TABLE public.scheduler_admin_revert_attempts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.scheduler_admin_revert_attempts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.scheduler_admin_revert_attempts_id_seq TO service_role;

-- ── 8. RLS RESTRICTIVE deny-all on existing scheduler_admin_audit_log ────
--
-- Per ADR-018. The existing table already has ENABLE RLS + a PERMISSIVE
-- "deny_all" policy (from migration 20260513000100). The new RESTRICTIVE
-- policy has a different name → no conflict; both coexist (both deny).
-- The RESTRICTIVE policy is the defense against a future PERMISSIVE allow
-- being added that would OR-against the existing PERMISSIVE deny.

ALTER TABLE public.scheduler_admin_audit_log ENABLE ROW LEVEL SECURITY;
-- Defensive — no-op if already enabled.

DO $$
BEGIN
  CREATE POLICY "scheduler_admin_audit_log_deny_all_restrictive"
    ON public.scheduler_admin_audit_log
    AS RESTRICTIVE
    FOR ALL
    TO public
    USING (false)
    WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN
  NULL;  -- policy already exists from prior partial-apply
END $$;

REVOKE ALL ON TABLE public.scheduler_admin_audit_log FROM PUBLIC;
REVOKE ALL ON TABLE public.scheduler_admin_audit_log FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.scheduler_admin_audit_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.scheduler_admin_audit_log_id_seq TO service_role;

-- ────────────────────────────────────────────────────────────────────────
-- END Migration A Part 1
--
-- Next file: 20260526000001_audit_log_concurrent_indexes.sql (Part 2,
-- non-transactional, 4 CONCURRENT indexes on the live audit_log table).
-- ────────────────────────────────────────────────────────────────────────
