-- =====================================================================
-- scheduler-comms reminder sweeper cron (revamp Phase 3)
-- =====================================================================
-- Invokes the scheduler-comms edge fn's sweep_reminders op every 10 min.
-- The fn is quiet-hours guarded (shop-local 08:00–20:59) and idempotent
-- via the scheduler_reminders (appointment, kind, channel) claim, so the
-- 10-min cadence just gives each appointment several send chances inside
-- its 24h/2h window. Pattern: 20260516200000 (BEGIN/EXCEPTION →
-- scheduler_error_log; job_failures doesn't exist in this repo).

SELECT public.cron_unschedule_if_exists('scheduler-comms-reminders');

SELECT cron.schedule(
  'scheduler-comms-reminders',
  '*/10 * * * *',
  $cron$
  DO $$
  BEGIN
    PERFORM public.scheduler_invoke_edge_function(
      'scheduler-comms',
      '{"op":"sweep_reminders"}'::jsonb
    );
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO public.scheduler_error_log
        (origin, origin_id, surface, level, error_code, message)
      VALUES
        ('cron',
         'scheduler-comms-reminders',
         'cron/scheduler-comms-reminders',
         'error',
         SQLSTATE,
         SQLERRM);
  END $$;
  $cron$
);
