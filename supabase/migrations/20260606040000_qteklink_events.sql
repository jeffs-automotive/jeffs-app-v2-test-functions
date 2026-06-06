-- =====================================================================
-- QTekLink C3 — qteklink_events (append-only raw Tekmetric intake ledger)
-- =====================================================================
-- 2026-06-06. Plan §2/§3/§9/§15-C3. The `qteklink-webhook` edge function
-- DURABLY persists every Tekmetric webhook here BEFORE returning 200, dedupes on
-- a STABLE business identity (event kind + source id + event time — NOT the whole
-- body, which carries PII + volatile fields), and only records events going
-- forward (the clean cutover = this table simply starts empty; no backfill).
--
-- Multi-tenant (plan §3): shop_id + realm_id on every row + in the dedup key.
-- The webhook sets shop_id = data.shopId (empirically present on 100% of RO +
-- payment events) and realm_id = qbo_resolve_realm_for_shop(shop_id).
--
-- event_hash is a GENERATED column (the handler never computes it): sha256 hex of
--   event_kind | source_id | event_time_raw
-- using the RAW Tekmetric timestamp STRING (immutable — to_char(timestamptz) is
-- only STABLE, so it can't be used in a generated column). It is NULL when there
-- is no source_id, so a malformed event with no stable identity is NOT deduped
-- (every one is stored) — mirrors 20260522191500_webhook_event_idempotency.sql.
--
-- Idempotency uses a PARTIAL unique index (WHERE event_hash IS NOT NULL); the
-- webhook INSERTs then catches 23505 -> 200 (NEVER .upsert({onConflict}) —
-- PostgREST can't infer a partial index's predicate and raises 42P10; that was a
-- 4-day silent outage, see tekmetric-webhook/index.ts).
--
-- raw_body holds customer PII (payerName, ccLast4, customerId) -> service_role
-- ONLY (deny-all RLS); scrub before any log/Sentry/email. Append-only ledger:
-- service_role gets SELECT + INSERT only (no UPDATE/DELETE).
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.qteklink_events (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id            integer     NOT NULL,
  realm_id           text        NOT NULL,
  event_kind         text        NOT NULL,           -- classified (ro_* / payment_made / unknown)
  event_text         text,                           -- raw body.event string (audit)
  source_id          text,                           -- data.id as text — the stable source id
  event_time_raw     text,                            -- raw Tekmetric timestamp string (hash input)
  tekmetric_event_at timestamptz,                     -- parsed event time (reducer ordering, C4)
  payment_id         bigint,                          -- data.id for payment events
  tekmetric_ro_id    bigint,                          -- data.id (RO events) / data.repairOrderId (payments)
  received_at        timestamptz NOT NULL DEFAULT now(),
  raw_body           jsonb       NOT NULL,            -- full payload (PII) — service_role only
  raw_headers        jsonb,                           -- token/authorization redacted
  raw_query_string   text,                            -- token redacted
  -- encode(extensions.digest(text,'sha256'),'hex') — pgcrypto's digest is
  -- IMMUTABLE and takes text directly (convert_to/to_char are only STABLE and
  -- would make the generation expression non-immutable, 42P17). Matches the
  -- working recipe in 20260522191500_webhook_event_idempotency.sql.
  event_hash         text GENERATED ALWAYS AS (
    CASE
      WHEN source_id IS NULL OR length(btrim(source_id)) = 0 THEN NULL
      ELSE encode(
        extensions.digest(
          event_kind || '|' || source_id || '|' || coalesce(event_time_raw, ''),
          'sha256'),
        'hex')
    END
  ) STORED,
  CONSTRAINT qteklink_events_shop_positive  CHECK (shop_id > 0),
  CONSTRAINT qteklink_events_realm_nonblank CHECK (length(btrim(realm_id)) > 0),
  CONSTRAINT qteklink_events_kind_nonblank  CHECK (length(btrim(event_kind)) > 0)
);

-- Idempotency: one row per (shop, realm, event_hash). PARTIAL — a NULL hash
-- (no source id) is never deduped, so every malformed/identity-less event is kept.
CREATE UNIQUE INDEX IF NOT EXISTS qteklink_events_dedup
  ON public.qteklink_events (shop_id, realm_id, event_hash)
  WHERE event_hash IS NOT NULL;

-- Reducer (C4) + RO correlation (C5/C6) lookups.
CREATE INDEX IF NOT EXISTS qteklink_events_shop_realm_payment
  ON public.qteklink_events (shop_id, realm_id, payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS qteklink_events_shop_realm_ro
  ON public.qteklink_events (shop_id, realm_id, tekmetric_ro_id) WHERE tekmetric_ro_id IS NOT NULL;

COMMENT ON TABLE public.qteklink_events IS
  'QTekLink append-only raw Tekmetric event ledger (per shop+realm). Durable-before-200 intake; dedup via the generated event_hash (kind|source_id|event_time_raw); NULL hash (no source id) is not deduped. raw_body holds PII -> service_role only; scrub before any log/Sentry/email. Append-only (no UPDATE/DELETE grant).';

-- deny-all RLS; service_role only. Append-only: SELECT + INSERT, NO UPDATE/DELETE.
ALTER TABLE public.qteklink_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qteklink_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.qteklink_events TO service_role;

COMMIT;
