-- =====================================================================
-- Skip Sundays for the keytag-daily-report cron — 2026-05-23
-- =====================================================================
-- Per Chris's directive: the morning key-tag report doesn't need to fire
-- on Sundays (shop closed). Re-schedule the existing cron from
-- '0 11 * * *' (every day at 11 UTC = 7 AM EDT) to '0 11 * * 1-6'
-- (Monday-Saturday only; cron day-of-week 0=Sun, 1=Mon … 6=Sat).
--
-- bulk-reconcile is INTENTIONALLY left on its daily schedule so weekend
-- anomaly detection still happens; the (category, ro_id) dedup gate in
-- issueManualReview prevents Saturday/Sunday-issued ARN rows from
-- being re-issued on Monday, and Monday's daily-report picks them up
-- on the first email day post-weekend.
--
-- The cron command itself (run_keytag_daily_report_with_checkin)
-- is unchanged — just the schedule.
-- =====================================================================

SELECT public.cron_unschedule_if_exists('keytag-daily-report');

SELECT cron.schedule(
  'keytag-daily-report',
  '0 11 * * 1-6',
  $cron$SELECT public.run_keytag_daily_report_with_checkin();$cron$
);
