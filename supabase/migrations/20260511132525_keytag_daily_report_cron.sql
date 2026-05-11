-- =====================================================================
-- pg_cron job: keytag-daily-report at 7 AM Eastern, daily
-- =====================================================================
-- Created 2026-05-11. Adds the daily keytag-status email cron that
-- Chris previously had in his old project — now adapted for our
-- color-coded 180-tag pool (R1..R90, Y1..Y90).
--
-- Schedule: `0 11 * * *` (UTC) = 7:00 AM EDT during summer, 6:00 AM
-- EST during winter. Acceptable drift for a morning ops digest; can
-- be adjusted in November when DST ends if 6 AM is too early.
--
-- The cron calls scheduler_invoke_edge_function('keytag-daily-report', ...)
-- which is the same helper used by appointments-sync + transcript-
-- dispatcher (reads the service-role key from vault, bearer-auths via
-- pg_net.http_post).
--
-- Email destination: configured at the Edge Function level via env
-- vars (KEYTAG_REPORT_TO_EMAIL, KEYTAG_REPORT_FROM_EMAIL). Defaults:
--   From: Jeff's Automotive Key Tags <alerts@jeffsautomotive.com>
--   To:   service@jeffsautomotive.com
--
-- Idempotency: the Edge Function passes Idempotency-Key based on the
-- Eastern-time date so Resend won't double-send if pg_cron retries
-- within a 24h window.
-- =====================================================================

-- Unschedule any prior version of this job (idempotent re-apply)
SELECT cron.unschedule('keytag-daily-report')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'keytag-daily-report'
);

SELECT cron.schedule(
  'keytag-daily-report',
  '0 11 * * *',
  $$SELECT public.scheduler_invoke_edge_function('keytag-daily-report', '{}'::jsonb);$$
);

-- Sanity: confirm the row landed
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM cron.job WHERE jobname = 'keytag-daily-report';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'keytag-daily-report cron failed to register (rows=%)', v_count;
  END IF;
END
$$;
