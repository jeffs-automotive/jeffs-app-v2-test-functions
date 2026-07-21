-- =====================================================================
-- pg_cron: document-intake-daily — 10:10 UTC (~06:10 ET) every day
-- =====================================================================
-- 2026-07-21. Plan: docs/document-intake/document-intake-plan.md (v2, D8/D13).
-- Invokes the document-intake-email fn's cron mode, which (advisory-lock
-- serialized, failure-isolated steps):
--   1. RENEWS/recreates the two Graph mailbox subscriptions (<=2.5-day
--      expirations — valid under both documented lifetime numbers)
--   2. SWEEPS each mailbox (Inbox + Junk, rolling 7-day window) — the
--      delivery guarantee behind the best-effort webhook
--   3. DRAINS pending/retryable graph_mail_events + attachments
--   4. RECONCILES storage.objects <-> document_intake_files
--   5. WATCHDOG checks (agent heartbeat, intake staleness, subscription
--      expiry, backlog age, error-log rows) -> Sentry -> the D13 alert rule
-- Reuses scheduler_invoke_edge_function (vault key + pg_net bearer) — the
-- same helper every other cron uses. Body wrapped BEGIN/EXCEPTION ->
-- scheduler_error_log (observability rule 8; pattern 20260717171500).
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

SELECT cron.unschedule('document-intake-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'document-intake-daily');

SELECT cron.schedule(
  'document-intake-daily',
  '10 10 * * *',
  $cron$
  DO $$
  BEGIN
    PERFORM public.scheduler_invoke_edge_function('document-intake-email', '{"mode":"cron"}'::jsonb);
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO public.scheduler_error_log
        (origin, origin_id, surface, level, error_code, message)
      VALUES
        ('cron', 'document-intake-daily', 'cron/document-intake-daily', 'error', SQLSTATE, SQLERRM);
  END $$;
  $cron$
);

DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM cron.job WHERE jobname = 'document-intake-daily';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'document-intake-daily cron failed to register (rows=%)', v_count;
  END IF;
END
$$;
