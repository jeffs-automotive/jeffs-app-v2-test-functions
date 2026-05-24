-- =====================================================================
-- sentry_cron_checkin — rewrite to strictly match Sentry HTTP Crons API
-- Created 2026-05-24 (supersedes 20260524180000 + 20260523022303)
-- =====================================================================
-- The prior version (20260524180000) added `status` to the POST body to
-- stop 422s, but kept the querystring on POST and threaded check_in_id
-- through both POST querystring and GET querystring. That was an
-- incomplete fix — the canonical Sentry HTTP Crons API has TWO clean
-- patterns and we were doing a hybrid neither pattern endorsed.
--
-- After re-reading the official Sentry docs end-to-end (Sentry MCP
-- get_doc: platforms/javascript/guides/react-router/crons.md, 2026-05-24),
-- the two documented patterns for the
--   /api/<PROJECT_ID>/cron/<MONITOR_SLUG>/<PUBLIC_KEY>/
-- endpoint are:
--
-- 1. CHECK-INS (RECOMMENDED) — simple paired check-in via GET:
--      GET /.../cron/<slug>/<key>/?status=in_progress
--      GET /.../cron/<slug>/<key>/?status=ok    (or status=error)
--    Sentry pairs by monitor_slug + recency. No check_in_id needed.
--
-- 2. UPSERT (Create or Update Monitor through Check-In) — POST the
--    monitor_config on the start side so Sentry auto-creates the
--    monitor record:
--      POST /.../cron/<slug>/<key>/        (no querystring)
--      Content-Type: application/json
--      {"monitor_config": {...}, "status": "in_progress"}
--    Then close with the GET ok/error from pattern 1.
--
-- A third pattern (overlap protection via check_in_id in querystring on
-- GETs) exists for jobs that can overlap themselves. Ours can't:
--   - appointments-sync: */10 * * * *, max_runtime 5 → no overlap
--   - transcript-dispatcher: */5 * * * *, max_runtime 3 → no overlap
--   - keytag-bulk-reconcile: 0 10 * * *, max_runtime 30 → daily, no overlap
--   - keytag-daily-report: 0 11 * * 1-6, max_runtime 10 → daily, no overlap
-- So we drop check_in_id from the URL entirely.
--
-- Function signature is kept stable (still returns UUID, still accepts
-- p_check_in_id) so the per-cron wrappers don't need to change. The
-- UUID is generated but unused in the HTTP call — it's purely an ABI
-- preserve, plus it's still returned to the caller for any future
-- consumer that wants it.
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
  v_base_url    TEXT;
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
  v_project_id := split_part(v_project_id, '/', 1);
  IF length(v_public_key) = 0 OR length(v_ingest_host) = 0 OR length(v_project_id) = 0 THEN
    RAISE WARNING 'sentry_cron_checkin: DSN parse yielded empty component';
    RETURN NULL;
  END IF;

  -- Generate a UUID for the return value (kept for ABI compatibility
  -- with wrapper functions that pass v_check_in_id back to the second
  -- call). The UUID is NOT included in the HTTP request — pairing is
  -- handled by Sentry's monitor_slug + recency heuristic per the
  -- "Check-Ins (Recommended)" documented pattern.
  v_check_in_id := coalesce(p_check_in_id, extensions.gen_random_uuid());

  -- Base URL with trailing slash. Sentry's docs are consistent about
  -- the trailing slash; we keep it.
  v_base_url := format(
    'https://%s/api/%s/cron/%s/%s/',
    v_ingest_host,
    v_project_id,
    p_monitor_slug,
    v_public_key
  );

  IF p_status = 'in_progress' AND p_monitor_config IS NOT NULL THEN
    -- UPSERT pattern (Sentry docs §"Creating or Updating a Monitor
    -- Through a Check-In"): POST with bare URL, JSON body containing
    -- monitor_config + status. No querystring.
    PERFORM net.http_post(
      url := v_base_url,
      body := jsonb_build_object(
        'monitor_config', p_monitor_config,
        'status', p_status
      ),
      headers := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 5000
    );
  ELSE
    -- Simple paired check-in pattern (Sentry docs §"Check-Ins
    -- (Recommended)"): GET with ?status=X. No body, no check_in_id.
    PERFORM net.http_get(
      url := v_base_url || '?status=' || p_status,
      timeout_milliseconds := 5000
    );
  END IF;

  RETURN v_check_in_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'sentry_cron_checkin failed for slug=%, status=%: % (%)',
      p_monitor_slug, p_status, SQLERRM, SQLSTATE;
    RETURN NULL;
END;
$$;
