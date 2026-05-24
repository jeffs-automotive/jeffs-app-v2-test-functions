-- =====================================================================
-- sentry_cron_checkin — pair in_progress + close-out by explicit check_in_id
-- Created 2026-05-24 (supersedes 20260524190000)
-- =====================================================================
-- The 20260524190000 strict-spec rewrite dropped `check_in_id` from
-- both URLs on the theory that Sentry's "Check-Ins (Recommended)"
-- pattern pairs automatically via monitor_slug + recency. That's
-- correct for SYNCHRONOUS sequential calls (the cURL examples in the
-- docs run back-to-back in a shell). It is NOT correct for our case.
--
-- Why: our cron wrappers call sentry_cron_checkin via
-- `PERFORM net.http_post(...)` and `PERFORM net.http_get(...)`. pg_net
-- is asynchronous — these calls QUEUE rows in net.http_request_queue
-- and a background worker drains the queue in batches. Within a batch
-- the delivery order is NOT guaranteed to match enqueue order.
--
-- Concrete failure mode (observed in Sentry as
-- monitor_check_in_failure: "A timeout check-in was detected" on
-- scheduler-appointments-sync, keytag-bulk-reconcile, keytag-daily-report
-- between 2026-05-24 17:39 and 18:15 UTC):
--
--   T0  wrapper enqueues:
--        A. POST /cron/<slug>/<key>/   body {monitor_config, status:in_progress}
--        B. POST /functions/v1/<fn>    (edge fn invocation)
--        C. GET  /cron/<slug>/<key>/?status=ok
--   T1  bgw fires in order C → A → B (or any order)
--   T2  Sentry receives GET ok first — treats as heartbeat (no in_progress
--        to pair with), monitor marked OK briefly
--   T3  Sentry receives POST in_progress — opens a new in_progress
--        record, waits for close-out
--   T4  max_runtime elapses with no follow-up → timeout fires
--
-- Fix: re-add `check_in_id` to BOTH calls. Sentry pairs by ID, so
-- ordering becomes irrelevant. Per docs:
--   - GET overlapping-jobs pattern explicitly documents
--     ?check_in_id=X&status=Y on both legs.
--   - POST upsert pattern doesn't show check_in_id in the body example
--     but it is a documented field in Sentry's check-in data model
--     (see the SDK envelope schemas at develop-docs/sdk/telemetry/
--     check-ins.mdx). Including it in the POST body keeps the
--     server-side record's ID stable across the pair.
--
-- Function signature is preserved (same args, same return).
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
  IF p_status NOT IN ('in_progress', 'ok', 'error') THEN
    RAISE WARNING 'sentry_cron_checkin: invalid status %', p_status;
    RETURN NULL;
  END IF;

  v_dsn := public.tekmetric_get_secret('sentry_dsn');
  IF v_dsn IS NULL OR length(v_dsn) = 0 THEN
    RETURN NULL;
  END IF;

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

  -- Generate a UUID if caller didn't pass one. Per-call wrappers call
  -- with p_check_in_id=NULL on the in_progress side (this branch
  -- generates the ID and returns it) and pass the returned UUID back
  -- on the ok/error side (this branch reuses it). That keeps the pair
  -- linked by a stable identifier regardless of pg_net delivery order.
  v_check_in_id := coalesce(p_check_in_id, extensions.gen_random_uuid());

  v_base_url := format(
    'https://%s/api/%s/cron/%s/%s/',
    v_ingest_host,
    v_project_id,
    p_monitor_slug,
    v_public_key
  );

  IF p_status = 'in_progress' AND p_monitor_config IS NOT NULL THEN
    -- UPSERT + start. POST body carries the full record:
    --   - monitor_config: upsert payload (creates or updates the monitor)
    --   - status: in_progress (marks this check-in as started)
    --   - check_in_id: stable UUID this pair will share
    -- No querystring — Sentry's POST endpoint reads the body.
    PERFORM net.http_post(
      url := v_base_url,
      body := jsonb_build_object(
        'monitor_config', p_monitor_config,
        'status',         p_status,
        'check_in_id',    v_check_in_id::text
      ),
      headers := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 5000
    );
  ELSE
    -- Close-out check-in (ok / error / in_progress without config).
    -- GET with querystring per "Overlapping Jobs" docs section. The
    -- explicit check_in_id is the load-bearing piece here — it tells
    -- Sentry "this is the close-out for THAT specific in_progress,
    -- regardless of order of arrival."
    PERFORM net.http_get(
      url := v_base_url
        || '?status=' || p_status
        || '&check_in_id=' || v_check_in_id::text,
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
