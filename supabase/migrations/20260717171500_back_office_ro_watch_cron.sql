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

-- Body wrapped in BEGIN/EXCEPTION → scheduler_error_log (observability rule 8; pattern
-- 20260516200000 / 20260702182000) so a Vault/pg_net dispatch failure is recorded, not
-- silent (Log Drain is plan-gated; a bare body would only surface in cron.job_run_details).
SELECT cron.schedule(
  'back-office-ro-watch',
  '*/30 * * * *',
  $cron$
  DO $$
  BEGIN
    PERFORM public.scheduler_invoke_edge_function('back-office-ro-watch', '{}'::jsonb);
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO public.scheduler_error_log
        (origin, origin_id, surface, level, error_code, message)
      VALUES
        ('cron', 'back-office-ro-watch', 'cron/back-office-ro-watch', 'error', SQLSTATE, SQLERRM);
  END $$;
  $cron$
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
