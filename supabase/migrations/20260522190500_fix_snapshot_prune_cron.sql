-- =====================================================================
-- Plan 01 Phase 1C — Fix scheduler-admin-snapshot-prune cron (audit I-OBS-2)
-- =====================================================================
-- 2026-05-22. The cron has been silently failing every day since 2026-05-19
-- with "syntax error at or near UPDATE". Root cause: the original cron body
-- (defined in `20260519140000_scheduler_md_edit_v2_schema.sql:57-79`) uses a
-- raw `BEGIN ... EXCEPTION ... END;` block — but Postgres requires
-- `EXCEPTION WHEN OTHERS` to be inside a PL/pgSQL block (function body or
-- `DO $$ ... $$;`). At the top level, `BEGIN` is parsed as a transaction
-- start and `EXCEPTION` errors out.
--
-- Fix: move the prune logic into a named PL/pgSQL function +
-- `SELECT run_admin_snapshot_prune();` from the cron. This is the canonical
-- pattern recommended by the 2026-05-22 research [01-supabase-postgres §5]
-- and matches `scheduler-hold-reaper` / `scheduler-error-log-prune` shape.
--
-- Also re-raises after the EXCEPTION INSERT so `cron.job_run_details`
-- correctly records `status = failed` on the rare cases the prune itself
-- throws. (Previously the broken syntax meant no row ever ran.)
--
-- IDEMPOTENT: function uses `CREATE OR REPLACE`; cron is unscheduled then
-- re-scheduled.

BEGIN;

-- ─── Named function ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.run_admin_snapshot_prune()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pruned_count INTEGER;
BEGIN
  UPDATE public.scheduler_admin_audit_log
     SET pre_state_snapshot = NULL,
         snapshot_pruned_at = now()
   WHERE pre_state_snapshot IS NOT NULL
     AND snapshot_pruned_at IS NULL
     AND occurred_at < now() - interval '30 days';

  GET DIAGNOSTICS v_pruned_count = ROW_COUNT;

  -- Best-effort: only insert if we actually pruned something. Avoids a
  -- no-op INSERT every day at 03:30 UTC.
  IF v_pruned_count > 0 THEN
    INSERT INTO public.scheduler_error_log
      (origin, origin_id, surface, level, error_code, message, context)
    VALUES (
      'cron',
      'scheduler-admin-snapshot-prune',
      'cron/admin-snapshot-prune',
      'info',
      'prune_run',
      format('pruned %s snapshots', v_pruned_count),
      jsonb_build_object('pruned_count', v_pruned_count)
    );
  END IF;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.scheduler_error_log
    (origin, origin_id, surface, level, error_code, message, context)
  VALUES (
    'cron',
    'scheduler-admin-snapshot-prune',
    'cron/admin-snapshot-prune',
    'error',
    SQLSTATE,
    SQLERRM,
    jsonb_build_object('detail', 'snapshot prune fn threw')
  );
  -- Re-raise so cron.job_run_details records this run as 'failed' and we
  -- can detect chronic failures from the cron history (not just from
  -- scheduler_error_log alone).
  RAISE;
END;
$$;

-- Lock down: only postgres (cron) + service_role should call this
REVOKE EXECUTE ON FUNCTION public.run_admin_snapshot_prune() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_admin_snapshot_prune() TO postgres, service_role;

-- ─── Reschedule cron with the function call ────────────────────────────
SELECT public.cron_unschedule_if_exists('scheduler-admin-snapshot-prune');

SELECT cron.schedule(
  'scheduler-admin-snapshot-prune',
  '30 3 * * *',
  'SELECT public.run_admin_snapshot_prune();'
);

COMMIT;
