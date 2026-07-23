-- tekbridge — shared Tekmetric internal-API bridge (Phase 1 skeleton)
--
-- Three tables, all service-role-only (deny-all RLS, zero policies — same
-- pattern as tekmetric_ro_mirror). The edge function `tekbridge` writes via the
-- service-role key (bypasses RLS); anon/authenticated are denied outright.
--
--   tekbridge_session_state  — health of the bot's Tekmetric web session (the
--     JWT itself lives in Vault under `tekbridge_session_jwt`, read/written via
--     the existing tekmetric_get_secret / tekmetric_set_secret wrappers).
--   tekbridge_jobs           — durable async queue for unattended/verified
--     writes (Phase 2 concern-sync). Created now so the plumbing is in place.
--   tekbridge_audit_log      — one row per capability invocation.
--
-- Conventions: shop_id = the Tekmetric numeric shop id (BIGINT, e.g. 7476) to
-- match the tekmetric_ro_mirror surface; TEXT strings; TIMESTAMPTZ timestamps.
-- See docs/tekmetric/tekbridge-plan.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- Session health (one row per shop)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tekbridge_session_state (
  shop_id           BIGINT      PRIMARY KEY,
  status            TEXT        NOT NULL DEFAULT 'stale'
                                CHECK (status IN ('active', 'stale', 'expired')),
  expires_at        TIMESTAMPTZ,
  last_refreshed_at TIMESTAMPTZ,
  last_error        TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tekbridge_session_state IS
  'Health of the tekbridge bot Tekmetric web session per shop. JWT is in Vault (tekbridge_session_jwt); this row tracks status/expiry for the gateway GET /session + stale-marking on 401.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Durable async job queue (unattended/verified writes — Phase 2)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tekbridge_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         BIGINT      NOT NULL,
  capability      TEXT        NOT NULL,
  input           JSONB       NOT NULL,
  idempotency_key TEXT        NOT NULL UNIQUE,
  status          TEXT        NOT NULL DEFAULT 'queued'
                              CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts        INT         NOT NULL DEFAULT 0,
  before_snapshot JSONB,
  after_snapshot  JSONB,
  result          JSONB,
  error           TEXT,
  actor           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tekbridge_jobs IS
  'Durable queue for unattended tekbridge writes. idempotency_key (hash of shop+capability+normalized input) makes retries safe. Consumed by a worker in Phase 2.';

-- Worker poll: fetch the oldest queued jobs.
CREATE INDEX IF NOT EXISTS tekbridge_jobs_status_created_idx
  ON public.tekbridge_jobs (status, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- Audit log (one row per capability invocation)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tekbridge_audit_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       BIGINT      NOT NULL,
  capability    TEXT        NOT NULL,
  input_summary JSONB,
  actor         TEXT,
  outcome       TEXT        NOT NULL CHECK (outcome IN ('ok', 'error')),
  verified      BOOLEAN,
  tekmetric_ref JSONB,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tekbridge_audit_log IS
  'Every tekbridge capability invocation: capability, actor, outcome, whether the write was verified via the public API, and the Tekmetric ref (e.g. concern id).';

CREATE INDEX IF NOT EXISTS tekbridge_audit_log_shop_created_idx
  ON public.tekbridge_audit_log (shop_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: deny-all. Service-role (edge fn) bypasses; anon/authenticated blocked.
-- Zero policies = no anon/authenticated access at all. Mirrors tekmetric_ro_mirror.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tekbridge_session_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tekbridge_jobs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tekbridge_audit_log     ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders: revoke table privileges from the client-facing roles so
-- even a future accidental policy can't expose these bridge-control tables.
REVOKE ALL ON public.tekbridge_session_state FROM anon, authenticated;
REVOKE ALL ON public.tekbridge_jobs          FROM anon, authenticated;
REVOKE ALL ON public.tekbridge_audit_log     FROM anon, authenticated;
