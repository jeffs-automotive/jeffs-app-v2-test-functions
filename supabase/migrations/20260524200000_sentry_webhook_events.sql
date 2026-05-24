-- =====================================================================
-- sentry_webhook_events — Sentry Integration Platform webhook log
-- Created 2026-05-24
-- =====================================================================
-- Receives Sentry's Internal Integration webhook deliveries (issue
-- created/resolved/etc.) so they're queryable from the Supabase MCP +
-- archivable for postmortem. Counterpart edge function:
-- supabase/functions/sentry-webhook/index.ts.
--
-- Per Sentry's Integration Platform docs
-- (https://docs.sentry.io/integrations/integration-platform/webhooks/):
--
--   Headers Sentry sends:
--     - Content-Type: application/json
--     - Request-ID: <per-event UUID>
--     - Sentry-Hook-Resource: installation | event_alert | issue |
--                              metric_alert | error | comment | seer |
--                              preprod_artifact
--     - Sentry-Hook-Timestamp: <unix ts>
--     - Sentry-Hook-Signature: hex(hmac_sha256(client_secret,
--                              JSON.stringify(parsed_body)))
--
--   Body shape:
--     { action, installation: {uuid}, data: {...}, actor: {...} }
--
-- Row policy: every delivery is logged, INCLUDING ones that fail HMAC
-- verification. signature_verified=false rows are an audit trail of
-- forged or misconfigured deliveries. The edge function still returns
-- 200 on bad signature so Sentry doesn't keep retrying — we don't want
-- a misconfigured secret to DDoS our endpoint with retries.
--
-- RLS: deny-all to public. Service-role only (the edge function is
-- service-role-authenticated to Supabase; webhook auth itself is via
-- the HMAC, not Supabase Auth).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.sentry_webhook_events (
  id                  BIGSERIAL PRIMARY KEY,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Headers
  request_id          TEXT,
  resource            TEXT NOT NULL,
  hook_timestamp      TEXT,
  signature_header    TEXT,
  signature_verified  BOOLEAN NOT NULL,
  -- Body (extracted)
  action              TEXT,
  installation_uuid   TEXT,
  actor_type          TEXT,
  actor_id            TEXT,
  actor_name          TEXT,
  -- Full raw payload + headers
  payload             JSONB NOT NULL,
  raw_headers         JSONB,
  -- Ingest-side metadata
  ingest_error        TEXT,
  -- Future fields (kept nullable for forward compat):
  processed_at        TIMESTAMPTZ
);

COMMENT ON TABLE public.sentry_webhook_events IS
  'Append-only log of incoming Sentry Internal Integration webhook deliveries. Edge function: sentry-webhook. Docs: https://docs.sentry.io/integrations/integration-platform/webhooks/';

COMMENT ON COLUMN public.sentry_webhook_events.signature_verified IS
  'True when HMAC-SHA256(JSON.stringify(parsed_body), client_secret) matched the Sentry-Hook-Signature header. False rows are forged or misconfigured.';

COMMENT ON COLUMN public.sentry_webhook_events.resource IS
  'From Sentry-Hook-Resource header. One of: installation, event_alert, issue, metric_alert, error, comment, seer, preprod_artifact.';

COMMENT ON COLUMN public.sentry_webhook_events.action IS
  'From body.action — varies by resource. For issue: created | resolved | assigned | archived | unresolved.';

-- Index for the common "show me recent issues" query.
CREATE INDEX IF NOT EXISTS sentry_webhook_events_resource_received_idx
  ON public.sentry_webhook_events (resource, received_at DESC);

-- Index on installation_uuid so we can filter for one specific
-- integration if we ever wire up a second (e.g., prod + test).
CREATE INDEX IF NOT EXISTS sentry_webhook_events_installation_idx
  ON public.sentry_webhook_events (installation_uuid)
  WHERE installation_uuid IS NOT NULL;

-- RLS: deny-all to public. Service-role bypasses RLS so the edge
-- function (which uses SUPABASE_SERVICE_ROLE_KEY) can write freely.
ALTER TABLE public.sentry_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.sentry_webhook_events FROM PUBLIC;
REVOKE ALL ON public.sentry_webhook_events FROM anon;
REVOKE ALL ON public.sentry_webhook_events FROM authenticated;
