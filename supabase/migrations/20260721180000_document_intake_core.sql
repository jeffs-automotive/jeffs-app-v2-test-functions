-- =====================================================================
-- document-intake — core schema (P1 of plan v2)
-- =====================================================================
-- 2026-07-21. Plan: docs/document-intake/document-intake-plan.md (v2, post
-- cross-verify). Scan + email intake of documents (insurance/registration
-- cards first) into ONE private bucket with per-profile routing shared by
-- both channels.
--
--   document_intake_profiles     — routing config (D4): profile key -> bucket.
--                                  Shop config lives in the DB (shop-agnostic.md).
--   document_intake_mailboxes    — profile <-> mailbox mapping, UNIQUE on
--                                  lower(address) so one mailbox can never
--                                  route ambiguously (cross-verify).
--   document_intake_files        — one row per stored document. status:
--                                  pending -> ready -> linked | rejected|failed (D10).
--   graph_mail_events            — durable per-message job state for the Graph
--                                  channel (D8 state machine; dedup on
--                                  (mailbox, immutable message id)).
--   graph_mail_attachments       — per-attachment outcomes (partial success
--                                  retries exactly the missing one).
--   graph_mail_subscriptions     — persisted Graph subscription state
--                                  (subscriptionId binding + renewals).
--   document_intake_agent_state  — shop-PC agent heartbeat (D13 watchdog).
--   document_intake_error_log    — EXCEPTION sink for the storage trigger
--                                  (companion migration) + intake internals.
--
-- Also creates the PRIVATE bucket `vehicle-docs` (50MB cap, doc mime types;
-- column set verified against live storage.buckets 2026-07-21).
--
-- Multi-tenant: shop_id integer (Tekmetric id; Jeff's = 7476) per repo
-- convention (back_office_issues). Deny-all RLS everywhere (RLS enabled, no
-- policies -> anon/authenticated blocked; service_role bypasses RLS).
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

-- ─── document_intake_profiles ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.document_intake_profiles (
  key         text        PRIMARY KEY,
  shop_id     integer     NOT NULL,
  label       text        NOT NULL,
  bucket      text        NOT NULL,
  active      boolean     NOT NULL DEFAULT true,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_intake_profiles_key_shape  CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT document_intake_profiles_shop_positive CHECK (shop_id > 0)
);

COMMENT ON TABLE public.document_intake_profiles IS
  'Routing config for document intake (plan D4). One row per intake profile; '
  'the profile key IS the second object-path segment. Both channels (scan '
  'agent via the document-intake-agent gateway, email via document-intake-email) '
  'resolve destinations from this table — never from client input.';

-- ─── document_intake_mailboxes ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.document_intake_mailboxes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_key text        NOT NULL REFERENCES public.document_intake_profiles(key) ON UPDATE CASCADE,
  address     text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One mailbox routes to exactly one profile, case-insensitively (cross-verify:
-- intake_emails[] arrays could not enforce this).
CREATE UNIQUE INDEX IF NOT EXISTS document_intake_mailboxes_address_uniq
  ON public.document_intake_mailboxes (lower(address));

COMMENT ON TABLE public.document_intake_mailboxes IS
  'Mailbox -> profile routing for the Graph email channel (plan D4/D7). '
  'Membership here must mirror the Exchange RBAC scope group — adding a row '
  'without adding the mailbox to "Document Intake Mailboxes" yields a mailbox '
  'we cannot read, and vice versa an unreadable-but-granted mailbox.';

-- ─── document_intake_files ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.document_intake_files (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id             integer     NOT NULL,
  profile_key         text        REFERENCES public.document_intake_profiles(key) ON UPDATE CASCADE,
  source              text        NOT NULL,
  bucket              text        NOT NULL,
  object_path         text        NOT NULL,
  original_filename   text,
  mime_type           text,
  size_bytes          bigint,
  sha256              text,
  email_from          text,
  email_subject       text,
  graph_message_id    text,
  graph_attachment_id text,
  status              text        NOT NULL DEFAULT 'pending',
  error               text,
  linked_ref          jsonb,
  linked_at           timestamptz,
  received_at         timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_intake_files_object_path_uniq UNIQUE (object_path),
  CONSTRAINT document_intake_files_shop_positive    CHECK (shop_id > 0),
  CONSTRAINT document_intake_files_source_valid     CHECK (source IN ('scan','email','other')),
  CONSTRAINT document_intake_files_status_valid     CHECK (status IN ('pending','ready','rejected','failed','linked')),
  CONSTRAINT document_intake_files_size_nonneg      CHECK (size_bytes IS NULL OR size_bytes >= 0),
  CONSTRAINT document_intake_files_linked_shape     CHECK (
    (status = 'linked' AND linked_at IS NOT NULL) OR (status <> 'linked' AND linked_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS document_intake_files_profile_received_idx
  ON public.document_intake_files (profile_key, received_at DESC);
CREATE INDEX IF NOT EXISTS document_intake_files_status_idx
  ON public.document_intake_files (status);
CREATE INDEX IF NOT EXISTS document_intake_files_sha256_idx
  ON public.document_intake_files (sha256);

COMMENT ON TABLE public.document_intake_files IS
  'One row per stored intake document (plan D2/D10). object_path is the '
  'server-minted opaque key {shop_id}/{profile_key}/{channel}/{YYYY}/{MM}/'
  '{ts}_{sha8}.{ext}; the original filename lives ONLY here (PII stays out '
  'of object keys/logs). profile_key NULL = unrouted (kept, queryable). '
  'status: pending (stored, unvalidated) -> ready (magic-byte + size '
  'validated) -> linked (claimed by a consumer app; v1 has no consumers); '
  'rejected (failed validation) / failed (processing error). linked_ref '
  'becomes an atomic claim RPC when the first consumer module lands (D10).';

-- ─── graph_mail_events ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.graph_mail_events (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox             text        NOT NULL,
  graph_message_id    text        NOT NULL,
  internet_message_id text,
  subscription_id     text,
  from_address        text,
  subject             text,
  received_datetime   timestamptz,
  status              text        NOT NULL DEFAULT 'pending',
  attempts            integer     NOT NULL DEFAULT 0,
  next_retry_at       timestamptz,
  last_error          text,
  raw_notification    jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT graph_mail_events_msg_uniq     UNIQUE (mailbox, graph_message_id),
  CONSTRAINT graph_mail_events_status_valid CHECK (status IN ('pending','processing','completed','retryable','failed','skipped')),
  CONSTRAINT graph_mail_events_attempts_nonneg CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS graph_mail_events_drain_idx
  ON public.graph_mail_events (status, next_retry_at);

COMMENT ON TABLE public.graph_mail_events IS
  'Durable per-message job state for the Graph email channel (plan D8). The '
  'webhook stores pending rows then ACKs; EdgeRuntime.waitUntil processing is '
  'best-effort and the daily cron DRAINS pending/retryable rows — the cron is '
  'the delivery guarantee, the webhook is the latency optimization. Dedup on '
  '(mailbox, immutable graph message id) makes the rolling-window sweep '
  'idempotent (no watermark — cross-verify killed it).';

-- ─── graph_mail_attachments ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.graph_mail_attachments (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid        NOT NULL REFERENCES public.graph_mail_events(id) ON DELETE CASCADE,
  graph_attachment_id text        NOT NULL,
  filename            text,
  mime_type           text,
  size_bytes          bigint,
  is_inline           boolean     NOT NULL DEFAULT false,
  status              text        NOT NULL DEFAULT 'pending',
  skip_reason         text,
  object_path         text,
  attempts            integer     NOT NULL DEFAULT 0,
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT graph_mail_attachments_uniq         UNIQUE (event_id, graph_attachment_id),
  CONSTRAINT graph_mail_attachments_status_valid CHECK (status IN ('pending','uploaded','skipped','failed'))
);

COMMENT ON TABLE public.graph_mail_attachments IS
  'Per-attachment outcome for a graph_mail_events row (plan D8): a 3-attachment '
  'message can land 2 and retry exactly the third. object_path set when '
  'uploaded; the minted path is persisted BEFORE upload so retries reuse the '
  'same key (idempotency token, plan D2). skipped + skip_reason for inline '
  'images / off-type / oversize (D9) — skips are recorded, never silent.';

-- ─── graph_mail_subscriptions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.graph_mail_subscriptions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox           text        NOT NULL,
  subscription_id   text,
  client_state_hash text,
  expires_at        timestamptz,
  last_renewed_at   timestamptz,
  last_sweep_at     timestamptz,
  lifecycle_state   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS graph_mail_subscriptions_mailbox_uniq
  ON public.graph_mail_subscriptions (lower(mailbox));
CREATE UNIQUE INDEX IF NOT EXISTS graph_mail_subscriptions_subid_uniq
  ON public.graph_mail_subscriptions (subscription_id)
  WHERE subscription_id IS NOT NULL;

COMMENT ON TABLE public.graph_mail_subscriptions IS
  'Persisted Graph subscription state (plan D7/D8). Notifications are bound '
  'to a stored row by subscriptionId and verified against that row''s '
  'client_state_hash (sha256 of the per-subscription random clientState — '
  'the plaintext lives only in the subscription itself + transiently at '
  'creation). Renewals request <=2.5-day expirations (valid under both the '
  'documented 10,080-min cap and Gemini''s claimed 4,230).';

-- ─── document_intake_agent_state ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.document_intake_agent_state (
  hostname             text        PRIMARY KEY,
  shop_id              integer     NOT NULL,
  last_heartbeat_at    timestamptz,
  last_config_fetch_at timestamptz,
  last_upload_at       timestamptz,
  agent_version        text,
  details              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_intake_agent_state_shop_positive CHECK (shop_id > 0)
);

COMMENT ON TABLE public.document_intake_agent_state IS
  'Shop-PC scan-agent heartbeat + liveness (plan D13). Written via the '
  'document-intake-agent gateway; the daily watchdog alerts when '
  'last_heartbeat_at goes stale during shop hours (silent-stop detection).';

-- ─── document_intake_error_log ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.document_intake_error_log (
  id          bigserial   PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  origin      text        NOT NULL,
  origin_id   text,
  level       text        NOT NULL DEFAULT 'error',
  error_code  text,
  message     text,
  detail      jsonb
);

CREATE INDEX IF NOT EXISTS document_intake_error_log_occurred_idx
  ON public.document_intake_error_log (occurred_at DESC);

COMMENT ON TABLE public.document_intake_error_log IS
  'EXCEPTION sink for the storage.objects registrar trigger (plan D3 — SQL '
  'cannot reach Sentry) + intake internals. Swept by the daily watchdog: new '
  'rows here become a Sentry captureMessage -> the module alert rule (D13).';

-- ─── Deny-all RLS (service-role only; RLS on + zero policies) ────────────────
ALTER TABLE public.document_intake_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_intake_mailboxes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_intake_files       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.graph_mail_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.graph_mail_attachments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.graph_mail_subscriptions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_intake_agent_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_intake_error_log   ENABLE ROW LEVEL SECURITY;

-- Belt over the RLS suspenders: Supabase default privileges GRANT client
-- roles table access (RLS would silently filter, not error). Revoke outright
-- so anon/authenticated get a hard 42501 (back_office grant-matrix pattern).
REVOKE ALL ON TABLE
  public.document_intake_profiles,
  public.document_intake_mailboxes,
  public.document_intake_files,
  public.graph_mail_events,
  public.graph_mail_attachments,
  public.graph_mail_subscriptions,
  public.document_intake_agent_state,
  public.document_intake_error_log
FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.document_intake_error_log_id_seq FROM anon, authenticated;

-- ─── The private bucket ──────────────────────────────────────────────────────
-- Column set verified against live storage.buckets (2026-07-21): id/name/
-- public/file_size_limit/allowed_mime_types (+ defaults). 52428800 = 50MB.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vehicle-docs',
  'vehicle-docs',
  false,
  52428800,
  ARRAY['application/pdf','image/jpeg','image/png','image/heic','image/heif']
)
ON CONFLICT (id) DO NOTHING;

-- ─── Seeds (Jeff's = Tekmetric shop 7476) ────────────────────────────────────
INSERT INTO public.document_intake_profiles (key, shop_id, label, bucket, notes)
VALUES
  ('inspection_docs', 7476, 'State Inspection — Insurance + Registration', 'vehicle-docs',
   'Consumed by the state-inspection record-keeping app (future).'),
  ('loaner_insurance', 7476, 'Loaner — Insurance', 'vehicle-docs',
   'Consumed by the loaner-vehicle app (future).')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.document_intake_mailboxes (profile_key, address)
SELECT v.profile_key, v.address
FROM (VALUES
  ('inspection_docs', 'inspection@jeffsautomotive.com'),
  ('loaner_insurance', 'loaner@jeffsautomotive.com')
) AS v(profile_key, address)
WHERE NOT EXISTS (
  SELECT 1 FROM public.document_intake_mailboxes m WHERE lower(m.address) = lower(v.address)
);

COMMIT;
