-- =====================================================================
-- Fix sentry_cron_checkin POST body — include `status` field
-- Created 2026-05-24 after live verification of OBS-8 surfaced 422s
-- =====================================================================
-- Background: Plan 02 Phase 3 (migration 20260523022303) shipped the
-- `sentry_cron_checkin` helper. The POST path (used when status =
-- 'in_progress' AND monitor_config IS NOT NULL) was sending only
-- `{"monitor_config": {...}}` in the JSON body, with `status` passed
-- via the querystring.
--
-- Sentry's HTTP Cron Monitor API rejects this with 422 "missing field
-- `status`" because the upsert endpoint reads `status` from the JSON
-- body, not the querystring. Verified against:
--   - Live response logs at 2026-05-24 17:24-17:25 UTC (2/3 POSTs
--     per cron fire returning 422)
--   - Sentry docs (Context7 /getsentry/sentry-docs query 2026-05-24):
--     POST body MUST include {"status": "in_progress", "monitor_config":
--     {...}} — confirmed in TWO official doc pages
--     (product/monitors-and-alerts/monitors/crons/getting-started/http,
--      platforms/javascript/common/crons).
--
-- GET path (status='ok'|'error' OR in_progress without config) was
-- already working — Sentry accepts `status` via querystring on GETs.
-- Only the POST path's body needed the field added.
--
-- The change is a one-line addition to jsonb_build_object. Function
-- signature, return type, security model, and search_path setting are
-- unchanged.
-- =====================================================================

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
  -- monitor on first sighting. Body MUST include status AND monitor_config
  -- per Sentry HTTP API (verified 2026-05-24 against official docs +
  -- live 422 responses from the prior version that omitted status).
  -- For ok/error or in_progress without config, GET is sufficient
  -- (status passed via querystring which Sentry accepts for GETs).
  IF p_status = 'in_progress' AND p_monitor_config IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_url,
      body := jsonb_build_object(
        'status', p_status,
        'monitor_config', p_monitor_config
      ),
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
