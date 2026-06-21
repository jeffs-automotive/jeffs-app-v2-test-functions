-- =====================================================================
-- Fix the keytag-daily-report Sentry cron-monitor schedule — 2026-06-21
-- =====================================================================
-- BUG: every Sunday Sentry logs a bogus "missed check-in" / "Cron failure:
-- keytag-daily-report" for a cron that is INTENTIONALLY not scheduled on
-- Sundays.
--
-- ROOT CAUSE: migration 20260523180000 re-scheduled the pg_cron job from
-- '0 11 * * *' to '0 11 * * 1-6' (Mon-Sat; shop closed Sunday) but left the
-- wrapper run_keytag_daily_report_with_checkin() unchanged — so the
-- monitor_config it sends to Sentry on every in_progress check-in still
-- declares schedule '0 11 * * *' (every day). Sentry therefore expects a
-- Sunday 11:00 UTC check-in that never comes and flags it missed.
--
-- (The comment in 20260523022303 claiming the schedule is "locked after the
-- first check-in" is mistaken: per Sentry's HTTP Crons docs a check-in with
-- monitor_config performs an UPSERT — "automatic creation OR UPDATE of a
-- monitor" — so each Mon-Sat check-in re-asserts whatever schedule the
-- wrapper sends. That is exactly why the monitor stays daily, and also why
-- this fix works: the next Mon-Sat check-in upserts the monitor to '1-6'.)
--
-- FIX: align the wrapper's monitor_config.schedule with the actual cron
-- schedule, '0 11 * * 1-6'. Nothing else changes. CREATE OR REPLACE keeps
-- the function's existing privileges, so no re-GRANT is needed.
--
-- After this is applied, the next scheduled run (Mon-Sat) upserts the Sentry
-- monitor to '0 11 * * 1-6' and Sunday "missed" alerts stop. The bulk-reconcile
-- wrapper is intentionally NOT touched — it genuinely runs daily ('0 10 * * *').
-- =====================================================================

CREATE OR REPLACE FUNCTION public.run_keytag_daily_report_with_checkin()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_check_in_id UUID;
BEGIN
  v_check_in_id := public.sentry_cron_checkin(
    'keytag-daily-report',
    'in_progress',
    NULL,
    jsonb_build_object(
      -- Mon-Sat only — matches the pg_cron schedule set in
      -- 20260523180000_keytag_daily_report_skip_sundays.sql. Sunday is
      -- intentionally skipped (shop closed), so Sentry must not expect it.
      'schedule',       jsonb_build_object('type', 'crontab', 'value', '0 11 * * 1-6'),
      'checkin_margin', 5,
      'max_runtime',    10,
      'timezone',       'UTC'
    )
  );
  BEGIN
    PERFORM public.scheduler_invoke_edge_function('keytag-daily-report', '{}'::jsonb);
    PERFORM public.sentry_cron_checkin('keytag-daily-report', 'ok', v_check_in_id);
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.sentry_cron_checkin('keytag-daily-report', 'error', v_check_in_id);
      INSERT INTO public.scheduler_error_log
        (origin, origin_id, surface, level, error_code, message)
      VALUES
        ('cron', 'keytag-daily-report', 'cron/keytag-daily-report',
         'error', SQLSTATE, SQLERRM);
  END;
END;
$$;
