-- scheduler_md_edit_v2_schema — 2026-05-19
--
-- Adds the schema surface for the MD-edit v2 workflow:
--   1. routine_services.description (customer-facing 1-2 sentence prose
--      shown on the Step 7 picker chip alongside price + waived-fee note)
--   2. scheduler_admin_audit_log.pre_state_snapshot (JSONB snapshot of every
--      row that was modified by an upload — enables revert_md_upload)
--   3. scheduler_admin_audit_log.snapshot_pruned_at (set by the 30-day
--      retention cron when the snapshot is nulled out; audit row stays)
--   4. cron job scheduler-admin-snapshot-prune (daily at 03:30 UTC, runs
--      30min after scheduler-error-log-prune)
--
-- See docs/scheduler/DEFERRED-AUDIT-ITEMS.md MD-1 + MD-2 for the design
-- discussion. The companion code changes are in supabase/functions/_shared/
-- {scheduler-admin-md.ts, tools/scheduler-admin.ts} and the orchestrator
-- tool registry at _shared/scheduler-tools.ts.

BEGIN;

-- ── 1. routine_services.description ─────────────────────────────────────

ALTER TABLE public.routine_services
  ADD COLUMN IF NOT EXISTS description TEXT NULL;

COMMENT ON COLUMN public.routine_services.description IS
  'Customer-facing 1-2 sentence prose shown under the picker chip label. NULL = no description rendered. Edit via patch_routine_service_fields or upload_routine_services_md.';

-- ── 2-3. scheduler_admin_audit_log snapshot columns ─────────────────────

ALTER TABLE public.scheduler_admin_audit_log
  ADD COLUMN IF NOT EXISTS pre_state_snapshot JSONB NULL,
  ADD COLUMN IF NOT EXISTS snapshot_pruned_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.scheduler_admin_audit_log.pre_state_snapshot IS
  'JSONB array of the prior state of every row affected by this admin operation. Captured at upload time. Used by revert_md_upload to undo. NULL when never captured (operation didn''t support snapshots) OR pruned (see snapshot_pruned_at).';

COMMENT ON COLUMN public.scheduler_admin_audit_log.snapshot_pruned_at IS
  'Set by scheduler-admin-snapshot-prune cron when pre_state_snapshot was nulled out after 30-day retention. NULL when snapshot is still live OR was never captured.';

-- Speed up revert lookups + retention prune scans.
CREATE INDEX IF NOT EXISTS scheduler_admin_audit_log_snapshot_idx
  ON public.scheduler_admin_audit_log (operation, occurred_at DESC)
  WHERE pre_state_snapshot IS NOT NULL;

-- ── 4. scheduler-admin-snapshot-prune cron ──────────────────────────────
--
-- Runs daily at 03:30 UTC (30 min after scheduler-error-log-prune to stay
-- out of its way). Nulls out pre_state_snapshot for any audit row older
-- than 30 days; sets snapshot_pruned_at to mark when it happened. Audit
-- row itself stays for compliance.

SELECT public.cron_unschedule_if_exists('scheduler-admin-snapshot-prune');

SELECT cron.schedule(
  'scheduler-admin-snapshot-prune',
  '30 3 * * *',
  $cron$
  BEGIN
    UPDATE public.scheduler_admin_audit_log
       SET pre_state_snapshot = NULL,
           snapshot_pruned_at = now()
     WHERE pre_state_snapshot IS NOT NULL
       AND snapshot_pruned_at IS NULL
       AND occurred_at < now() - interval '30 days';
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.scheduler_error_log
        (origin, origin_id, surface, level, error_code, message, context)
      VALUES (
        'cron', 'scheduler-admin-snapshot-prune', 'cron/admin-snapshot-prune',
        'error', SQLSTATE, SQLERRM,
        jsonb_build_object('detail', 'pg_cron body threw — body wrap caught')
      );
    EXCEPTION WHEN OTHERS THEN
      -- last-resort: swallow so cron stays scheduled
      NULL;
    END;
  END;
  $cron$
);

COMMIT;
