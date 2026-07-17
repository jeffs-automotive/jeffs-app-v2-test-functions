-- =====================================================================
-- pg_cron: back-office-ro-watch — every 30 minutes
-- =====================================================================
-- 2026-07-17. Drives the back-office module's Tekmetric-derived automation:
--   A) reopened-RO detection (unpost/repost → a reopened_ro issue + alert)
--   B) open-RO auto-close (a tracked open RO closed → flip + "verify" nudge)
-- Reuses scheduler_invoke_edge_function (reads the service-role key from vault,
-- bearer-auths via pg_net) — the same helper the keytag + scheduler crons use.
-- Near-real-time (30 min) per Chris; dedup makes each scan idempotent.
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

SELECT cron.unschedule('back-office-ro-watch')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'back-office-ro-watch');

SELECT cron.schedule(
  'back-office-ro-watch',
  '*/30 * * * *',
  $$SELECT public.scheduler_invoke_edge_function('back-office-ro-watch', '{}'::jsonb);$$
);

DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM cron.job WHERE jobname = 'back-office-ro-watch';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'back-office-ro-watch cron failed to register (rows=%)', v_count;
  END IF;
END
$$;
