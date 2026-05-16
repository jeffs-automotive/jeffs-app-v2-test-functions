-- scheduler_error_log — Phase 17.1 (2026-05-16) — centralized error capture
-- for the V2 scheduler. Per Chris's request 2026-05-16: "We should also set
-- up our own error log in supabase so you don't have to dig around so much."
--
-- Why a Postgres table when we already have Sentry: Sentry needs the MCP
-- server connected to be queryable from this dev workflow. The Supabase
-- logs surface HTTP status codes but not application-level exception
-- detail. A Postgres table is reachable from `mcp__supabase__execute_sql`
-- (always-on) and lets us triage failures with single SQL queries.
--
-- Sentry remains the primary observability tool for production. This
-- table is the OPS triage surface that complements it.
--
-- Origin convention:
--   - 'vercel-action' = Vercel Server Action (V2 wizard submit-* actions)
--   - 'edge-fn'       = Supabase Edge Function (scheduler-*-direct etc.)
--   - 'cron'          = pg_cron / Edge cron triggers
--   - 'api-route'     = Vercel Next.js /api/* route (mark-abandoned, etc.)
--
-- Severity convention (matches Sentry levels):
--   - 'fatal'   = customer flow blocked, escalation triggered
--   - 'error'   = unexpected failure (action threw / DB write failed)
--   - 'warning' = expected-but-noteworthy (Tekmetric 5xx with retry,
--                 keyword escalation triggered, etc.)
--   - 'info'    = audit / diagnostic events (deliberate non-error captures)

CREATE TABLE IF NOT EXISTS scheduler_error_log (
  id            BIGSERIAL PRIMARY KEY,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id    UUID NULL REFERENCES customer_chat_sessions(id) ON DELETE SET NULL,
  origin        TEXT NOT NULL,
  origin_id     TEXT NULL,
  surface       TEXT NOT NULL,
  level         TEXT NOT NULL DEFAULT 'error',
  error_code    TEXT NULL,
  message       TEXT NULL,
  context       JSONB NULL,
  stack         TEXT NULL,
  resolved_at   TIMESTAMPTZ NULL,
  resolved_by   TEXT NULL,
  -- Convenience: which wizard step was the row on when the error fired.
  -- Captured at write time so triage queries don't have to JOIN against
  -- customer_chat_sessions (which may have advanced past the failure step
  -- by the time someone looks).
  step_at_error TEXT NULL,
  CONSTRAINT scheduler_error_log_origin_chk
    CHECK (origin IN ('vercel-action', 'edge-fn', 'cron', 'api-route', 'other')),
  CONSTRAINT scheduler_error_log_level_chk
    CHECK (level IN ('fatal', 'error', 'warning', 'info'))
);

CREATE INDEX IF NOT EXISTS idx_sel_occurred
  ON scheduler_error_log (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_sel_session
  ON scheduler_error_log (session_id, occurred_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sel_surface
  ON scheduler_error_log (surface, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_sel_unresolved
  ON scheduler_error_log (occurred_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sel_origin_id
  ON scheduler_error_log (origin_id, occurred_at DESC)
  WHERE origin_id IS NOT NULL;

-- Locked down: only service_role (Vercel + edge fns) can write. No public
-- access at all. RLS is enabled with no policies → denies authenticated +
-- anon by default. service_role bypasses RLS.
ALTER TABLE scheduler_error_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE scheduler_error_log IS
  'V2 scheduler centralized error capture. Vercel Server Actions + Supabase Edge Functions write here when they catch an exception or surface a structured warning. Complements Sentry — Sentry is the alerting surface; this table is the queryable ops triage surface.';
