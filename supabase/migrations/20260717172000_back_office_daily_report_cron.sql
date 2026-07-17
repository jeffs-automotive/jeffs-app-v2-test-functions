-- =====================================================================
-- pg_cron: back-office-daily-report — 7 AM Eastern, Mon–Sat
-- =====================================================================
-- 2026-07-17. Daily digest of open + stale (>48h) back-office issues, mirroring the
-- keytag-daily-report idiom (scheduler_invoke_edge_function → bearer → build → Resend,
-- per-day idempotency key). Recipients come from qteklink_settings.back_office.digest_emails.
-- Schedule 0 11 * * 1-6 (UTC) = 7 AM EDT Mon–Sat. Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

SELECT cron.unschedule('back-office-daily-report')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'back-office-daily-report');

-- Body wrapped in BEGIN/EXCEPTION → scheduler_error_log (observability rule 8; pattern
-- 20260516200000 / 20260702182000) so a dispatch failure is recorded, not silent.
SELECT cron.schedule(
  'back-office-daily-report',
  '0 11 * * 1-6',
  $cron$
  DO $$
  BEGIN
    PERFORM public.scheduler_invoke_edge_function('back-office-daily-report', '{}'::jsonb);
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO public.scheduler_error_log
        (origin, origin_id, surface, level, error_code, message)
      VALUES
        ('cron', 'back-office-daily-report', 'cron/back-office-daily-report', 'error', SQLSTATE, SQLERRM);
  END $$;
  $cron$
);

DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM cron.job WHERE jobname = 'back-office-daily-report';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'back-office-daily-report cron failed to register (rows=%)', v_count;
  END IF;
END
$$;
