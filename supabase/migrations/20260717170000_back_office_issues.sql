-- =====================================================================
-- Back Office module — issues + audit tables (Phase 1)
-- =====================================================================
-- 2026-07-17. Plan: docs/back-office/back-office-plan.md.
-- The first CROSS-APP module: the office manager (qteklink-app) raises issues,
-- the service advisors (admin-app) fix them, the office manager verifies. One
-- shared table + status machine drives BOTH app surfaces.
--
--   back_office_issues       — one row per issue, kind-discriminated
--                              (invoice_issue | open_ro | reopened_ro | misc),
--                              one shared resolution status machine
--                              (open -> sent_to_sa -> awaiting_verify -> verified).
--                              kind-specific data in `context` jsonb.
--   back_office_issue_events — append-only audit (prior/new status + actor + app +
--                              the note + the email-send result), keytag_audit_log style.
--
-- Multi-tenant: shop_id (Tekmetric shop id; Jeff's = 7476) + nullable realm_id.
-- The composite FK -> qbo_connections is MATCH SIMPLE, so it's enforced only for the
-- invoice/open-ro rows that carry a realm; reopened_ro / misc rows leave realm NULL.
-- Money is BIGINT cents. service_role-only (deny-all RLS); writes go ONLY through the
-- SECURITY DEFINER RPCs in the companion migration. Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

-- ─── back_office_issues ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.back_office_issues (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id          integer     NOT NULL,
  realm_id         text,                       -- set for invoice_issue / open_ro; NULL for reopened_ro / misc
  kind             text        NOT NULL,
  status           text        NOT NULL DEFAULT 'open',
  source           text        NOT NULL,       -- how the row was born
  -- misc / free-form
  title            text,
  -- repair-order linkage (all kinds may carry an RO#; reopened/open-ro also the tekmetric id)
  ro_number        text,
  tekmetric_ro_id  bigint,
  -- vendor bill / expense (invoice_issue, open_ro)
  vendor_name      text,
  bill_no          text,                        -- the QBO DocNumber
  bill_date        date,                        -- the QBO TxnDate
  total_cents      bigint,
  qbo_txn_type     text,                        -- 'Bill' | 'Purchase' (bills AND expenses)
  qbo_txn_id       text,                        -- QBO entity Id (attachment fetch + deep link)
  -- the two-party conversation
  bo_notes         text,                        -- office-manager issue description
  sa_notes         text,                        -- service-advisor fix description
  -- kind-specific machine context (change_type + before/after for reopened_ro; ro_status for open_ro;
  -- attachment ref for invoice_issue). See the plan for shapes.
  context          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- lifecycle stamps
  created_by       text,                        -- actor email/label (NULL when auto-detected)
  sent_to_sa_at    timestamptz,
  sa_submitted_at  timestamptz,
  verified_at      timestamptz,
  verified_by      text,
  last_activity_at timestamptz NOT NULL DEFAULT now(),  -- drives the 48h stale flag
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT back_office_issues_shop_positive CHECK (shop_id > 0),
  CONSTRAINT back_office_issues_kind_valid    CHECK (kind IN ('invoice_issue','open_ro','reopened_ro','misc')),
  CONSTRAINT back_office_issues_status_valid  CHECK (status IN ('open','sent_to_sa','awaiting_verify','verified')),
  CONSTRAINT back_office_issues_source_valid  CHECK (source IN ('manual','qbo_fetch','tekmetric_detection')),
  CONSTRAINT back_office_issues_txntype_valid CHECK (qbo_txn_type IS NULL OR qbo_txn_type IN ('Bill','Purchase')),
  CONSTRAINT back_office_issues_total_nonneg  CHECK (total_cents IS NULL OR total_cents >= 0),
  CONSTRAINT back_office_issues_ro_positive   CHECK (tekmetric_ro_id IS NULL OR tekmetric_ro_id > 0),
  CONSTRAINT back_office_issues_verified_shape CHECK (
    (status = 'verified' AND verified_at IS NOT NULL AND verified_by IS NOT NULL) OR
    (status <> 'verified' AND verified_at IS NULL)
  ),
  CONSTRAINT back_office_issues_conn_fk FOREIGN KEY (shop_id, realm_id)
    REFERENCES public.qbo_connections (shop_id, realm_id) MATCH SIMPLE ON DELETE RESTRICT
);

-- Dedup the auto-detected reopened rows: ONE row per (shop, RO, unpost cycle).
-- Re-detecting the same cycle REFRESHES that row; a later cycle is a distinct row.
CREATE UNIQUE INDEX IF NOT EXISTS back_office_issues_reopened_cycle
  ON public.back_office_issues (shop_id, tekmetric_ro_id, (context->>'unposted_at'))
  WHERE kind = 'reopened_ro';

-- Active-issue reads per app tab (kind) + the SA queue (status).
CREATE INDEX IF NOT EXISTS back_office_issues_active
  ON public.back_office_issues (shop_id, kind, status)
  WHERE status <> 'verified';

-- Stale scan for the daily digest.
CREATE INDEX IF NOT EXISTS back_office_issues_stale
  ON public.back_office_issues (shop_id, last_activity_at)
  WHERE status <> 'verified';

-- Month-to-date "closed this month" count.
CREATE INDEX IF NOT EXISTS back_office_issues_verified_at
  ON public.back_office_issues (shop_id, verified_at)
  WHERE status = 'verified';

COMMENT ON TABLE public.back_office_issues IS
  'Back-office module (Phase 1): kind-discriminated issue rows shared by qteklink-app (office manager) + admin-app (service advisors). One resolution status machine (open->sent_to_sa->awaiting_verify->verified); kind-specific data in context jsonb. service_role only; writes via the SECURITY DEFINER RPCs.';

ALTER TABLE public.back_office_issues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.back_office_issues FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.back_office_issues TO service_role;
-- Supabase pre-grants ALL to service_role via DEFAULT PRIVILEGES; REVOKE the writes so
-- they go ONLY through the SECURITY DEFINER RPCs (the companion migration).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.back_office_issues FROM service_role;

-- ─── back_office_issue_events (append-only audit) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.back_office_issue_events (
  id            bigserial   PRIMARY KEY,
  issue_id      uuid        NOT NULL REFERENCES public.back_office_issues (id) ON DELETE CASCADE,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  action        text        NOT NULL,
  prior_status  text,
  new_status    text,
  actor         text,                             -- email/label; NULL for system-driven
  actor_app     text,                             -- 'qteklink' | 'admin' | 'system'
  note          text,                             -- the note added in this transition
  email_sent_at timestamptz,                      -- stamped by back-office-notify
  email_error   text,
  CONSTRAINT back_office_issue_events_action_valid CHECK (action IN (
    'created','detected','ro_closed','sent_to_sa','resent_to_sa','sa_submitted','verified'
  )),
  CONSTRAINT back_office_issue_events_app_valid CHECK (
    actor_app IS NULL OR actor_app IN ('qteklink','admin','system')
  )
);

CREATE INDEX IF NOT EXISTS back_office_issue_events_issue
  ON public.back_office_issue_events (issue_id, occurred_at DESC);

COMMENT ON TABLE public.back_office_issue_events IS
  'Append-only audit for back_office_issues: every transition (prior/new status + actor + app + note + email-send result). service_role only; writes via the SECURITY DEFINER RPCs.';

ALTER TABLE public.back_office_issue_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.back_office_issue_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.back_office_issue_events TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.back_office_issue_events FROM service_role;

COMMIT;
