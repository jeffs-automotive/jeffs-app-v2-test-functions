-- =====================================================================
-- Webhook event idempotency — whole-body dedup hash (fix dropped 2nd payment)
-- =====================================================================
-- 2026-06-16. The synthetic event_hash from 20260522191500 —
--   sha256( event_kind | coalesce(tekmetric_ro_id, payment_id, data.id)
--                      | status_id | data.updatedDate )
-- silently DROPS the second payment on a repair order:
--   - payment_made events set BOTH tekmetric_ro_id (= data.repairOrderId) AND
--     payment_id, so coalesce picks tekmetric_ro_id and payment_id NEVER enters
--     the hash;
--   - status_id is NULL for payment events;
--   - payment payloads carry NO data.updatedDate (0 of 803 observed).
-- => every payment_made on a given RO hashes to sha256('payment_made|<ro_id>||').
-- The 2nd (paid-in-full) payment is 23505'd away as a "Tekmetric retry" before
-- the handler runs, so release_keytag_for_ro never fires and the key tag stays
-- posted_ar (caught later as an ORP orphan by the nightly reconcile).
-- Confirmed live: Y1/#152753 (ORP-3XV67F), Y32/#153119 (ORP-58FVQT).
--
-- Fix: hash the WHOLE canonical body, sha256(raw_body::text) — the same approach
-- the qteklink subsystem adopted in 20260606060000 after cross-verify found the
-- identical class. jsonb::text canonicalizes key order + whitespace, so it
-- dedups byte-identical retries (the real idempotency goal — Tekmetric
-- re-delivers identical bodies) while genuinely-distinct events (two payments
-- differing in data.id) hash differently and are BOTH stored. jsonb::text is
-- deterministic + IMMUTABLE.
--
-- DIFFERENCE FROM the qteklink fix: these two tables KEEP the partial unique
-- index (WHERE event_hash IS NOT NULL AND idempotency_active = true). Rows that
-- pre-date the 2026-05-22 idempotency migration are idempotency_active=false and
-- MUST stay exempt (they are real historical Tekmetric-retry duplicates — a
-- plain unique index would fail to build against them).
--
-- Rebuild is collision-safe: among idempotency_active=true rows the existing
-- partial unique index already guarantees distinct synthetic hashes, hence
-- distinct bodies, hence distinct whole-body hashes — recompute cannot create a
-- new collision that violates the rebuilt index.
--
-- A generated column's expression can't be ALTERed in place, so drop the
-- dependent index + column and re-add both. The table rewrite recomputes
-- event_hash for every row (small tables). No app/edge code changes: handlers
-- only INSERT and react to 23505; nothing reads event_hash.
--
-- Apply: supabase db push. IDEMPOTENT (IF EXISTS / IF NOT EXISTS).
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ─── keytag_webhook_events ──────────────────────────────────────────────
DROP INDEX IF EXISTS public.keytag_webhook_events_event_hash_uniq;
ALTER TABLE public.keytag_webhook_events DROP COLUMN IF EXISTS event_hash;
ALTER TABLE public.keytag_webhook_events
  ADD COLUMN event_hash text
  GENERATED ALWAYS AS (encode(extensions.digest(raw_body::text, 'sha256'), 'hex')) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS keytag_webhook_events_event_hash_uniq
  ON public.keytag_webhook_events (event_hash)
  WHERE event_hash IS NOT NULL AND idempotency_active = true;

COMMENT ON COLUMN public.keytag_webhook_events.event_hash IS
  'Whole-body idempotency hash: sha256(raw_body::text). Replaces the 2026-05-22 '
  'synthetic (event_kind|entity_id|status_id|data.updatedDate) hash, which '
  'collapsed every payment_made on an RO to one value (payment_id lost the '
  'coalesce to tekmetric_ro_id, status_id NULL, payments carry no updatedDate) '
  'and dropped the paid-in-full payment. jsonb::text canonicalizes key order + '
  'whitespace, so it dedups byte-identical retries while distinct events differ '
  '-> stored. Partial unique index still keys on idempotency_active to exempt '
  'pre-migration historical duplicates.';

-- ─── tekmetric_webhook_events (firehose — same latent defect) ──────────
DROP INDEX IF EXISTS public.tekmetric_webhook_events_event_hash_uniq;
ALTER TABLE public.tekmetric_webhook_events DROP COLUMN IF EXISTS event_hash;
ALTER TABLE public.tekmetric_webhook_events
  ADD COLUMN event_hash text
  GENERATED ALWAYS AS (encode(extensions.digest(raw_body::text, 'sha256'), 'hex')) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS tekmetric_webhook_events_event_hash_uniq
  ON public.tekmetric_webhook_events (event_hash)
  WHERE event_hash IS NOT NULL AND idempotency_active = true;

COMMENT ON COLUMN public.tekmetric_webhook_events.event_hash IS
  'Whole-body idempotency hash: sha256(raw_body::text). Same fix + same partial '
  'unique index semantics as keytag_webhook_events.event_hash (2026-06-16).';

COMMIT;
