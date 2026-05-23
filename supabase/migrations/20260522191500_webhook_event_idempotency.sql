-- =====================================================================
-- Plan 01 Phase 2 — Webhook event idempotency at the DB level (audit B5)
-- =====================================================================
-- 2026-05-22. Tekmetric webhooks have NO stable event_id header; on retry
-- (transient outage) the same payload arrives N times. The handlers
-- previously did `.insert()` and swallowed the unique-PK-collision error
-- (no unique on event_id existed), so retries landed as DISTINCT rows.
--
-- Real duplicate counts AT MIGRATION TIME (Tekmetric retries that
-- landed as separate rows because no idempotency was in place):
--   tekmetric_webhook_events: 3 dupe groups / 2619 rows
--   keytag_webhook_events:   31 dupe groups / 3248 rows
--
-- Strategy:
-- 1. Add `event_hash TEXT GENERATED ALWAYS AS (...)` STORED column that
--    Postgres auto-computes on INSERT from the canonical Tekmetric-
--    controlled fields. NULL when raw_body is missing identifying fields
--    (degenerate payloads — handler logs + returns 200).
-- 2. Add `idempotency_active BOOLEAN NOT NULL DEFAULT FALSE` column.
--    The DEFAULT FALSE means all EXISTING rows are excluded from the
--    unique constraint (preserving the historical duplicate rows that
--    pre-date this protection). Then ALTER the default to TRUE so new
--    INSERTs from the now-aware handler get FALSE excluded automatically.
-- 3. Create partial UNIQUE index
--    `WHERE event_hash IS NOT NULL AND idempotency_active = true`.
--    New rows (idempotency_active=true) get DB-level dedup. Old rows
--    are exempt — their duplicates already happened and the audit log
--    is fine to keep them.
--
-- Hash inputs (separated by `|` to prevent collision via concatenation):
--   1. event kind  — `event_type` OR `event_kind_inferred` OR `raw_body.event`
--   2. entity id   — first non-null of tekmetric_*_id columns OR raw_body.data.id
--   3. status_id   — status snapshot at the time of the event
--   4. updatedDate — Tekmetric's stable last-updated timestamp from raw_body.data
--
-- Receivers switch from `.insert()` → `.upsert(..., { onConflict: 'event_hash',
-- ignoreDuplicates: true })` so duplicate retries become DB-level no-ops
-- (return 200 with `{ ok: true, duplicate: true }`).
--
-- IDEMPOTENT: `ADD COLUMN IF NOT EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS`.
--
-- Reference: research-supabase-postgres §4 (synthetic hash construction),
-- research-integration-robustness §6 (Stripe Idempotency-Key model).

BEGIN;

-- ─── tekmetric_webhook_events ──────────────────────────────────────────
ALTER TABLE public.tekmetric_webhook_events
  ADD COLUMN IF NOT EXISTS event_hash TEXT
  GENERATED ALWAYS AS (
    CASE
      WHEN raw_body IS NULL THEN NULL
      WHEN raw_body->'data'->>'updatedDate' IS NULL
       AND tekmetric_ro_id IS NULL
       AND tekmetric_appointment_id IS NULL
       AND tekmetric_customer_id IS NULL
       AND tekmetric_vehicle_id IS NULL
       AND tekmetric_payment_id IS NULL
       AND (raw_body->'data'->>'id') IS NULL
      THEN NULL
      ELSE encode(
        extensions.digest(
          coalesce(event_type, event_kind_inferred, raw_body->>'event', '') || '|' ||
          coalesce(
            tekmetric_ro_id::text,
            tekmetric_appointment_id::text,
            tekmetric_customer_id::text,
            tekmetric_vehicle_id::text,
            tekmetric_payment_id::text,
            raw_body->'data'->>'id',
            ''
          ) || '|' ||
          coalesce(status_id::text, '') || '|' ||
          coalesce(raw_body->'data'->>'updatedDate', ''),
          'sha256'
        ),
        'hex'
      )
    END
  ) STORED;

ALTER TABLE public.tekmetric_webhook_events
  ADD COLUMN IF NOT EXISTS idempotency_active BOOLEAN NOT NULL DEFAULT FALSE;

-- Flip default → TRUE so new handler INSERTs (without explicit value)
-- automatically opt in to idempotency. Existing rows stay FALSE.
ALTER TABLE public.tekmetric_webhook_events
  ALTER COLUMN idempotency_active SET DEFAULT TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS tekmetric_webhook_events_event_hash_uniq
  ON public.tekmetric_webhook_events (event_hash)
  WHERE event_hash IS NOT NULL AND idempotency_active = true;

COMMENT ON COLUMN public.tekmetric_webhook_events.event_hash IS
  'SHA-256 hex of (event_kind | entity_id | status_id | data.updatedDate). '
  'Auto-computed by Postgres on INSERT. NULL when raw_body is missing all '
  'identifying fields. Used together with idempotency_active for partial '
  'UNIQUE — receivers use .upsert({onConflict: "event_hash", ignoreDuplicates: true}).';

COMMENT ON COLUMN public.tekmetric_webhook_events.idempotency_active IS
  'TRUE for rows inserted after the 2026-05-22 idempotency migration; FALSE '
  'for historical rows that pre-date DB-level dedup. The partial UNIQUE index '
  'on event_hash only applies to TRUE rows so historical duplicates do not '
  'block the constraint.';

-- ─── keytag_webhook_events ─────────────────────────────────────────────
ALTER TABLE public.keytag_webhook_events
  ADD COLUMN IF NOT EXISTS event_hash TEXT
  GENERATED ALWAYS AS (
    CASE
      WHEN raw_body IS NULL THEN NULL
      WHEN raw_body->'data'->>'updatedDate' IS NULL
       AND tekmetric_ro_id IS NULL
       AND payment_id IS NULL
       AND (raw_body->'data'->>'id') IS NULL
      THEN NULL
      ELSE encode(
        extensions.digest(
          coalesce(event_kind, raw_body->>'event', '') || '|' ||
          coalesce(
            tekmetric_ro_id::text,
            payment_id::text,
            raw_body->'data'->>'id',
            ''
          ) || '|' ||
          coalesce(status_id::text, '') || '|' ||
          coalesce(raw_body->'data'->>'updatedDate', ''),
          'sha256'
        ),
        'hex'
      )
    END
  ) STORED;

ALTER TABLE public.keytag_webhook_events
  ADD COLUMN IF NOT EXISTS idempotency_active BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.keytag_webhook_events
  ALTER COLUMN idempotency_active SET DEFAULT TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS keytag_webhook_events_event_hash_uniq
  ON public.keytag_webhook_events (event_hash)
  WHERE event_hash IS NOT NULL AND idempotency_active = true;

COMMENT ON COLUMN public.keytag_webhook_events.event_hash IS
  'SHA-256 hex of (event_kind | entity_id | status_id | data.updatedDate). '
  'See tekmetric_webhook_events.event_hash for full semantics.';

COMMENT ON COLUMN public.keytag_webhook_events.idempotency_active IS
  'See tekmetric_webhook_events.idempotency_active for full semantics.';

COMMIT;
