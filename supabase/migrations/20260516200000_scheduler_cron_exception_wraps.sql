-- =====================================================================
-- Scheduler-app cron EXCEPTION wraps — created 2026-05-16
-- =====================================================================
-- Per Round 4 audit (R4-BLOCKER-C-2) + .claude/rules/observability.md
-- rule 8: every cron body must wrap in BEGIN..EXCEPTION..END so dispatch
-- failures (Vault secret missing, pg_net error, RAISE inside the helper)
-- land in a queryable triage table instead of being only visible in
-- cron.job_run_details + the Supabase Log Drain pipeline.
--
-- Four existing crons are re-scheduled here with EXCEPTION-wrapped
-- bodies. The job names + cron expressions are preserved — only the
-- body changes. Idempotent re-apply (unschedule + reschedule).
--
-- Why a new migration instead of editing the original four files: the
-- prior migrations already ran in shared environments; editing the
-- committed files would mean those environments would never pick up
-- the change. A fresh migration is the canonical way to mutate cron
-- registrations.
--
-- The EXCEPTION block writes to scheduler_error_log (created in
-- 20260516180000) rather than the canonical job_failures table from
-- observability.md (that table doesn't exist; scheduler_error_log is
-- our equivalent triage surface).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. scheduler-appointments-sync — every 10 min
-- ---------------------------------------------------------------------

SELECT public.cron_unschedule_if_exists('scheduler-appointments-sync');

SELECT cron.schedule(
  'scheduler-appointments-sync',
  '*/10 * * * *',
  $cron$
  DO $$
  BEGIN
    PERFORM public.scheduler_invoke_edge_function('appointments-sync', '{}'::jsonb);
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO public.scheduler_error_log
        (origin, origin_id, surface, level, error_code, message)
      VALUES
        ('cron',
         'scheduler-appointments-sync',
         'cron/scheduler-appointments-sync',
         'error',
         SQLSTATE,
         SQLERRM);
  END;
  $$;
  $cron$
);


-- ---------------------------------------------------------------------
-- 2. scheduler-transcript-dispatcher — every 5 min
-- ---------------------------------------------------------------------

SELECT public.cron_unschedule_if_exists('scheduler-transcript-dispatcher');

SELECT cron.schedule(
  'scheduler-transcript-dispatcher',
  '*/5 * * * *',
  $cron$
  DO $$
  BEGIN
    PERFORM public.scheduler_invoke_edge_function('transcript-dispatcher', '{}'::jsonb);
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO public.scheduler_error_log
        (origin, origin_id, surface, level, error_code, message)
      VALUES
        ('cron',
         'scheduler-transcript-dispatcher',
         'cron/scheduler-transcript-dispatcher',
         'error',
         SQLSTATE,
         SQLERRM);
  END;
  $$;
  $cron$
);


-- ---------------------------------------------------------------------
-- 3. keytag-daily-report — 11:00 UTC daily (7 AM EDT / 6 AM EST)
-- ---------------------------------------------------------------------

SELECT public.cron_unschedule_if_exists('keytag-daily-report');

SELECT cron.schedule(
  'keytag-daily-report',
  '0 11 * * *',
  $cron$
  DO $$
  BEGIN
    PERFORM public.scheduler_invoke_edge_function('keytag-daily-report', '{}'::jsonb);
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO public.scheduler_error_log
        (origin, origin_id, surface, level, error_code, message)
      VALUES
        ('cron',
         'keytag-daily-report',
         'cron/keytag-daily-report',
         'error',
         SQLSTATE,
         SQLERRM);
  END;
  $$;
  $cron$
);


-- ---------------------------------------------------------------------
-- 4. keytag-bulk-reconcile — 10:00 UTC daily (6 AM EDT / 5 AM EST)
-- ---------------------------------------------------------------------

SELECT public.cron_unschedule_if_exists('keytag-bulk-reconcile');

SELECT cron.schedule(
  'keytag-bulk-reconcile',
  '0 10 * * *',
  $cron$
  DO $$
  BEGIN
    PERFORM public.scheduler_invoke_edge_function('keytag-bulk-reconcile', '{}'::jsonb);
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO public.scheduler_error_log
        (origin, origin_id, surface, level, error_code, message)
      VALUES
        ('cron',
         'keytag-bulk-reconcile',
         'cron/keytag-bulk-reconcile',
         'error',
         SQLSTATE,
         SQLERRM);
  END;
  $$;
  $cron$
);


-- ---------------------------------------------------------------------
-- 5. Sanity: confirm all four jobs are registered
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM cron.job
   WHERE jobname IN (
     'scheduler-appointments-sync',
     'scheduler-transcript-dispatcher',
     'keytag-daily-report',
     'keytag-bulk-reconcile'
   );
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'cron exception-wrap re-registration failed (rows=%, expected 4)', v_count;
  END IF;
END
$$;
