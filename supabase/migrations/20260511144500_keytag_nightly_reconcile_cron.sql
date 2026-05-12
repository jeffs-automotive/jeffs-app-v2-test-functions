-- =====================================================================
-- pg_cron: keytag-bulk-reconcile nightly at 6 AM Eastern
-- =====================================================================
-- Created 2026-05-11. Schedules the keytag-bulk-reconcile Edge Function
-- to run BEFORE the keytag-daily-report email goes out, so the morning
-- digest sees a fully-reconciled keytags table:
--
--   06:00 AM EDT  →  10:00 UTC  → keytag-bulk-reconcile runs (this cron)
--   07:00 AM EDT  →  11:00 UTC  → keytag-daily-report email sends
--
-- Why 6 AM and not midnight: refreshes last_activity_at to the most
-- recent Tekmetric updatedDate just before the report. If we ran at
-- midnight, any RO touched between midnight and 7 AM (overnight admin
-- work, early-morning advisor activity) would still look stale at
-- report time.
--
-- The reconcile is read-mostly when webhooks have been delivering
-- reliably — most ROs just get their last_activity_at refreshed. Real
-- writes happen for missed-webhook backlog (RO went WIP/AR without us
-- seeing a webhook) and for tags whose Tekmetric keytag field drifted.
--
-- It does NOT use ?overwrite=true. The legacy-tag overwrite is a
-- one-time ad-hoc operation; nightly reconcile should NOT re-PATCH
-- Tekmetric on every RO. If you want to force overwrite, hit the
-- function manually with curl.
-- =====================================================================

SELECT cron.unschedule('keytag-bulk-reconcile')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'keytag-bulk-reconcile'
);

SELECT cron.schedule(
  'keytag-bulk-reconcile',
  '0 10 * * *',
  $$SELECT public.scheduler_invoke_edge_function('keytag-bulk-reconcile', '{}'::jsonb);$$
);

DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM cron.job WHERE jobname = 'keytag-bulk-reconcile';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'keytag-bulk-reconcile cron failed to register (rows=%)', v_count;
  END IF;
END
$$;
