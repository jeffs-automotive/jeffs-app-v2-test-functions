-- =====================================================================
-- QTekLink C3 hardening — whole-body dedup hash (fix data-loss collisions)
-- =====================================================================
-- 2026-06-06. Cross-verify (Gemini + GPT) found the kind|source_id|event_time_raw
-- event_hash from 20260606040000 silently DROPS genuinely-distinct events:
--   - a refund and a void for the same payment id + paymentDate both classify
--     `unknown` -> identical hash -> the second is 23505'd away (lost);
--   - two same-kind updates on one RO within the same second collide;
--   - a sourced event with no recognized timestamp (coalesce '') collides on
--     kind+source;
--   - a literal '|' in any field makes the hash ambiguous.
--
-- Fix: hash the WHOLE canonical body. sha256(raw_body::text) dedups EXACT retries
-- (the real idempotency goal — Tekmetric re-delivers byte-identical bodies) and
-- never collides genuinely-distinct events (different body -> different hash ->
-- stored). jsonb::text is deterministic + IMMUTABLE (verified). The C4 reducer
-- does the business-level dedup (by payment_id / latest state). raw_body is NOT
-- NULL, so the hash is always present -> a plain (non-partial) unique index.
--
-- (pgcrypto/extensions.digest is relied on by the generated column; ensure it
-- exists so the migration is self-contained.)
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Replace the generated event_hash expression (can't ALTER a generated column's
-- expression in place — drop the dependent index + column, re-add both).
DROP INDEX IF EXISTS public.qteklink_events_dedup;
ALTER TABLE public.qteklink_events DROP COLUMN IF EXISTS event_hash;
ALTER TABLE public.qteklink_events
  ADD COLUMN event_hash text
  GENERATED ALWAYS AS (encode(extensions.digest(raw_body::text, 'sha256'), 'hex')) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS qteklink_events_dedup
  ON public.qteklink_events (shop_id, realm_id, event_hash);

COMMENT ON COLUMN public.qteklink_events.event_hash IS
  'Whole-body idempotency hash: sha256(raw_body::text). jsonb canonicalizes key order + whitespace, so it dedups canonically-equivalent retries (same canonical body -> 23505 -> 200) while genuinely-distinct events (refund vs void, same-second updates, missing timestamp) differ in some field -> distinct -> stored. The C4 reducer does business-level dedup. (source_id/event_time_raw are now informational columns, no longer hash inputs.)';

COMMIT;
