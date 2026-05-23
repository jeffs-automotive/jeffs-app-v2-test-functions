-- =====================================================================
-- Plan 02 Phase 3 — Sentry Cron Monitoring for 4 scheduler crons
-- =====================================================================
-- 2026-05-23. Closes audit I-OBS-4. Currently the 4 scheduler crons that
-- invoke edge functions (appointments-sync, transcript-dispatcher,
-- keytag-bulk-reconcile, keytag-daily-report) have no Sentry visibility
-- for MISSED fires (cron didn't run at the expected time) — we only see
-- failures via scheduler_error_log queries.
--
-- Approach: HTTP check-ins to Sentry's Cron Monitoring API from inside
-- the cron body via pg_net. The Sentry endpoint:
--
--   GET  https://<ingest_host>/api/<project_id>/cron/<slug>/<public_key>/?status=<s>&check_in_id=<uuid>
--   POST https://<ingest_host>/api/<project_id>/cron/<slug>/<public_key>/?status=in_progress&check_in_id=<uuid>
--        body: {"monitor_config": {"schedule": {...}, "checkin_margin": N, "max_runtime": N, "timezone": "UTC"}}
--
-- Sentry upserts the monitor from the monitor_config in the FIRST
-- in_progress envelope. After that, schedule/etc. is locked; subsequent
-- check-ins are status-only. Rate-limited 6/min/monitor.
--
-- IMPORTANT — cron semantics:
--   scheduler_invoke_edge_function is ASYNC (queues HTTP via pg_net,
--   returns request id immediately, does NOT wait for the edge fn's
--   actual completion). So the `ok` check-in here confirms "cron
--   successfully queued work" — NOT "edge fn completed successfully".
--   Edge fn success/failure is monitored separately via the Sentry
--   edge-fn channel (Phase 1 withSentryScope wraps) + scheduler_error_log.
--
-- Prerequisite: Sentry DSN must be stored in Vault as `sentry_dsn`:
--   SELECT public.tekmetric_set_secret(
--     'sentry_dsn',
--     'https://<public_key>@<ingest_host>/<project_id>',
--     'Sentry DSN for cron check-ins (Plan 02 Phase 3). Same as
--      EDGE_FN_SENTRY_DSN — both point at jeffs-app-v2-supabase project.'
--   );
--
-- IDEMPOTENT — until that secret is populated, sentry_cron_checkin is a
-- graceful no-op. The cron bodies still run; just no Sentry visibility
-- until Chris populates Vault. This means the migration can ship NOW and
-- the secret can land later without re-applying.

BEGIN;

-- ─── Helper function — fires a check-in to Sentry's cron API ──────────
--
-- Returns the check_in_id (caller passes it back on subsequent calls to
-- correlate in_progress + ok/error for the same run). NULL if Vault is
-- missing the sentry_dsn secret OR if pg_net call setup fails — both
-- are non-fatal for the cron run.
CREATE OR REPLACE FUNCTION public.sentry_cron_checkin(
  p_monitor_slug TEXT,
  p_status TEXT,
  p_check_in_id UUID DEFAULT NULL,
  p_monitor_config JSONB DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_dsn         TEXT;
  v_proto       TEXT;
  v_after_proto TEXT;
  v_at_split    INT;
  v_public_key  TEXT;
  v_host_path   TEXT;
  v_slash_split INT;
  v_ingest_host TEXT;
  v_project_id  TEXT;
  v_url         TEXT;
  v_check_in_id UUID;
BEGIN
  -- Validate status (cron API only accepts these 3 values).
  IF p_status NOT IN ('in_progress', 'ok', 'error') THEN
    RAISE WARNING 'sentry_cron_checkin: invalid status %', p_status;
    RETURN NULL;
  END IF;

  -- Sentry DSN from Vault. NULL when Vault doesn't have the secret yet —
  -- graceful no-op so the migration can ship before the secret lands.
  v_dsn := public.tekmetric_get_secret('sentry_dsn');
  IF v_dsn IS NULL OR length(v_dsn) = 0 THEN
    RETURN NULL;
  END IF;

  -- Parse DSN: https://<public_key>@<ingest_host>/<project_id>
  -- Defensive — Vault content is operator-supplied. Bail on any parse
  -- failure rather than letting split_part return junk values.
  v_proto := 'https://';
  IF position(v_proto IN v_dsn) <> 1 THEN
    RAISE WARNING 'sentry_cron_checkin: DSN does not start with https://';
    RETURN NULL;
  END IF;
  v_after_proto := substring(v_dsn FROM length(v_proto) + 1);
  v_at_split := position('@' IN v_after_proto);
  IF v_at_split = 0 THEN
    RAISE WARNING 'sentry_cron_checkin: DSN missing @ separator';
    RETURN NULL;
  END IF;
  v_public_key := substring(v_after_proto FROM 1 FOR v_at_split - 1);
  v_host_path := substring(v_after_proto FROM v_at_split + 1);
  v_slash_split := position('/' IN v_host_path);
  IF v_slash_split = 0 THEN
    RAISE WARNING 'sentry_cron_checkin: DSN missing /project_id';
    RETURN NULL;
  END IF;
  v_ingest_host := substring(v_host_path FROM 1 FOR v_slash_split - 1);
  v_project_id := substring(v_host_path FROM v_slash_split + 1);
  -- Strip trailing slash or path if present.
  v_project_id := split_part(v_project_id, '/', 1);
  IF length(v_public_key) = 0 OR length(v_ingest_host) = 0 OR length(v_project_id) = 0 THEN
    RAISE WARNING 'sentry_cron_checkin: DSN parse yielded empty component';
    RETURN NULL;
  END IF;

  v_check_in_id := coalesce(p_check_in_id, extensions.gen_random_uuid());

  v_url := format(
    'https://%s/api/%s/cron/%s/%s/?status=%s&check_in_id=%s',
    v_ingest_host,
    v_project_id,
    p_monitor_slug,
    v_public_key,
    p_status,
    v_check_in_id::text
  );

  -- For in_progress with monitor_config, POST so Sentry can upsert the
  -- monitor on first sighting. For ok/error or in_progress without
  -- config, GET is sufficient (lighter wire format).
  IF p_status = 'in_progress' AND p_monitor_config IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_url,
      body := jsonb_build_object('monitor_config', p_monitor_config),
      headers := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 5000
    );
  ELSE
    PERFORM net.http_get(
      url := v_url,
      timeout_milliseconds := 5000
    );
  END IF;

  RETURN v_check_in_id;
EXCEPTION
  WHEN OTHERS THEN
    -- Sentry's gone wrong — log + continue. Cron success doesn't depend
    -- on Sentry availability.
    RAISE WARNING 'sentry_cron_checkin failed for slug=%, status=%: % (%)',
      p_monitor_slug, p_status, SQLERRM, SQLSTATE;
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.sentry_cron_checkin IS
  'Fires a check-in to Sentry Cron Monitoring API for a given monitor slug. '
  'Returns the check_in_id for caller to reuse on subsequent in_progress/ok/error pings. '
  'Graceful no-op (returns NULL) when sentry_dsn is missing from Vault. '
  'See migration 20260523022303_sentry_cron_monitoring.sql for prerequisite setup.';

-- ─── Per-cron wrapper functions ───────────────────────────────────────
--
-- Pattern: each function fires in_progress → invokes edge fn → fires
-- ok OR error. Failure to fire check-in is non-fatal (the helper
-- swallows exceptions and returns NULL).

CREATE OR REPLACE FUNCTION public.run_scheduler_appointments_sync_with_checkin()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_check_in_id UUID;
BEGIN
  v_check_in_id := public.sentry_cron_checkin(
    'scheduler-appointments-sync',
    'in_progress',
    NULL,
    jsonb_build_object(
      'schedule',       jsonb_build_object('type', 'crontab', 'value', '*/10 * * * *'),
      'checkin_margin', 2,
      'max_runtime',    5,
      'timezone',       'UTC'
    )
  );
  BEGIN
    PERFORM public.scheduler_invoke_edge_function('appointments-sync', '{}'::jsonb);
    PERFORM public.sentry_cron_checkin('scheduler-appointments-sync', 'ok', v_check_in_id);
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.sentry_cron_checkin('scheduler-appointments-sync', 'error', v_check_in_id);
      INSERT INTO public.scheduler_error_log
        (origin, origin_id, surface, level, error_code, message)
      VALUES
        ('cron', 'scheduler-appointments-sync', 'cron/scheduler-appointments-sync',
         'error', SQLSTATE, SQLERRM);
      -- Do NOT re-raise — match the existing cron pattern (logged but
      -- not surfaced to pg_cron's job_run_details as failure). Sentry
      -- still gets the error check-in for visibility.
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_scheduler_transcript_dispatcher_with_checkin()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_check_in_id UUID;
BEGIN
  v_check_in_id := public.sentry_cron_checkin(
    'scheduler-transcript-dispatcher',
    'in_progress',
    NULL,
    jsonb_build_object(
      'schedule',       jsonb_build_object('type', 'crontab', 'value', '*/5 * * * *'),
      'checkin_margin', 2,
      'max_runtime',    3,
      'timezone',       'UTC'
    )
  );
  BEGIN
    PERFORM public.scheduler_invoke_edge_function('transcript-dispatcher', '{}'::jsonb);
    PERFORM public.sentry_cron_checkin('scheduler-transcript-dispatcher', 'ok', v_check_in_id);
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.sentry_cron_checkin('scheduler-transcript-dispatcher', 'error', v_check_in_id);
      INSERT INTO public.scheduler_error_log
        (origin, origin_id, surface, level, error_code, message)
      VALUES
        ('cron', 'scheduler-transcript-dispatcher', 'cron/scheduler-transcript-dispatcher',
         'error', SQLSTATE, SQLERRM);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_keytag_bulk_reconcile_with_checkin()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_check_in_id UUID;
BEGIN
  v_check_in_id := public.sentry_cron_checkin(
    'keytag-bulk-reconcile',
    'in_progress',
    NULL,
    jsonb_build_object(
      'schedule',       jsonb_build_object('type', 'crontab', 'value', '0 10 * * *'),
      'checkin_margin', 5,
      'max_runtime',    30,
      'timezone',       'UTC'
    )
  );
  BEGIN
    PERFORM public.scheduler_invoke_edge_function('keytag-bulk-reconcile', '{}'::jsonb);
    PERFORM public.sentry_cron_checkin('keytag-bulk-reconcile', 'ok', v_check_in_id);
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.sentry_cron_checkin('keytag-bulk-reconcile', 'error', v_check_in_id);
      INSERT INTO public.scheduler_error_log
        (origin, origin_id, surface, level, error_code, message)
      VALUES
        ('cron', 'keytag-bulk-reconcile', 'cron/keytag-bulk-reconcile',
         'error', SQLSTATE, SQLERRM);
  END;
END;
$$;

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
      'schedule',       jsonb_build_object('type', 'crontab', 'value', '0 11 * * *'),
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

-- ─── REVOKE + GRANT (service-role only — cron runs as postgres) ───────
DO $$
DECLARE
  fn_oid OID;
  fn_name TEXT;
  fn_names TEXT[] := ARRAY[
    'sentry_cron_checkin',
    'run_scheduler_appointments_sync_with_checkin',
    'run_scheduler_transcript_dispatcher_with_checkin',
    'run_keytag_bulk_reconcile_with_checkin',
    'run_keytag_daily_report_with_checkin'
  ];
BEGIN
  FOREACH fn_name IN ARRAY fn_names LOOP
    FOR fn_oid IN
      SELECT p.oid FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = fn_name
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated;', fn_oid::regprocedure);
      -- Wrappers run from pg_cron (runs as postgres); helper called from the wrappers.
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO postgres, service_role;', fn_oid::regprocedure);
    END LOOP;
  END LOOP;
END $$;

-- ─── Re-schedule the 4 crons ───────────────────────────────────────────
SELECT public.cron_unschedule_if_exists('scheduler-appointments-sync');
SELECT cron.schedule(
  'scheduler-appointments-sync',
  '*/10 * * * *',
  $cron$SELECT public.run_scheduler_appointments_sync_with_checkin();$cron$
);

SELECT public.cron_unschedule_if_exists('scheduler-transcript-dispatcher');
SELECT cron.schedule(
  'scheduler-transcript-dispatcher',
  '*/5 * * * *',
  $cron$SELECT public.run_scheduler_transcript_dispatcher_with_checkin();$cron$
);

SELECT public.cron_unschedule_if_exists('keytag-bulk-reconcile');
SELECT cron.schedule(
  'keytag-bulk-reconcile',
  '0 10 * * *',
  $cron$SELECT public.run_keytag_bulk_reconcile_with_checkin();$cron$
);

SELECT public.cron_unschedule_if_exists('keytag-daily-report');
SELECT cron.schedule(
  'keytag-daily-report',
  '0 11 * * *',
  $cron$SELECT public.run_keytag_daily_report_with_checkin();$cron$
);

COMMIT;
