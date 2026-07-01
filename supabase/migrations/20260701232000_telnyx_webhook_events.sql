-- =====================================================================
-- telnyx_webhook_events — durable Telnyx event intake ledger (firehose)
-- =====================================================================
-- v1 of the telnyx-webhook endpoint (docs/scheduler/telnyx-webhook-plan-2026-07-01.md).
-- Captures EVERY Telnyx webhook delivery BEFORE the endpoint returns 200:
--   - TODAY: 10DLC provisioning/status events (campaign webhook slot on the new
--     Low Volume Mixed campaign — approval, number assignment, suspension).
--   - REVAMP PHASE 2: inbound messages (customer replies, STOP/HELP) + delivery
--     receipts, once the Messaging Profile webhook points at the same endpoint.
--     The Phase 2 consent/DLR consumer reads from here; this table stays an
--     append-only intake ledger (the consumer keeps its own processing state).
--
-- Conventions: tekmetric_webhook_events / qteklink_events firehose pattern —
-- append-only (no UPDATE/DELETE even for service_role), deny-all RLS, dedup on
-- the provider's event id. payload carries phone-number PII → service_role
-- only; scrub before any log/Sentry surface (observability.md).

create table public.telnyx_webhook_events (
  id uuid primary key default gen_random_uuid(),
  -- Telnyx envelope: { data: { id, event_type, occurred_at, payload }, meta }.
  -- data.id is the event's own UUID — the dedup key across Telnyx's 3-attempt
  -- retry + failover redelivery. NULL for payloads that don't carry it
  -- (unknown/malformed shapes are still stored for diagnosis, undeduped).
  telnyx_event_id text,
  event_type text not null default 'unknown',
  occurred_at timestamptz,
  -- Ed25519 verification outcome for this delivery (false = accepted on the
  -- URL-token gate alone: TELNYX_PUBLIC_KEY unset, or headers absent).
  signature_verified boolean not null default false,
  -- Telnyx events are ACCOUNT-scoped, not shop-claimed — there is no shopId in
  -- the payload. Single-tenant today (Jeff's, Tekmetric 7476); left NULL until
  -- a TO/FROM-number → shop map exists (multi-shop follow-up; shop ids are
  -- never hardcoded per shop-agnostic.md).
  shop_id integer,
  -- Full envelope. Phone numbers / message text (PII) live ONLY here.
  payload jsonb not null,
  raw_headers jsonb,          -- denylist-redacted (diagnostic)
  raw_query_string text,      -- token-stripped (diagnostic)
  received_at timestamptz not null default now()
);

comment on table public.telnyx_webhook_events is
  'Append-only firehose of Telnyx webhook deliveries (10DLC provisioning now; inbound SMS + DLRs in revamp Phase 2). service_role INSERT/SELECT only; dedup on telnyx_event_id. payload holds PII — never log/Sentry it unscrubbed.';

-- Dedup across Telnyx retries. PARTIAL unique — insert-then-catch-23505 in the
-- receiver (PostgREST cannot infer a partial index for upsert onConflict, 42P10).
create unique index telnyx_webhook_events_event_id_key
  on public.telnyx_webhook_events (telnyx_event_id)
  where telnyx_event_id is not null;

create index telnyx_webhook_events_type_received_idx
  on public.telnyx_webhook_events (event_type, received_at desc);
create index telnyx_webhook_events_received_idx
  on public.telnyx_webhook_events (received_at desc);

-- Deny-all RLS: no policies; service_role bypasses RLS entirely.
alter table public.telnyx_webhook_events enable row level security;

-- Strip latent default-privilege DML grants (keytag L3 lesson, 20260626120000):
-- anon/authenticated get nothing; service_role is append-only (no UPDATE/
-- DELETE/TRUNCATE — retention pruning, if ever needed, ships as its own
-- migration with its own review).
revoke all on table public.telnyx_webhook_events from anon, authenticated;
revoke update, delete, truncate on table public.telnyx_webhook_events from service_role;
