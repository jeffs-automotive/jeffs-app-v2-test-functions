-- =====================================================================
-- Phase 9d — appointments shadow table correctness fixes
-- =====================================================================
-- Created 2026-05-16. Four concerns bundled atomically:
--
--   1. Add raw_payload JSONB so future Tekmetric field additions land
--      verbatim without requiring a schema migration.
--   2. Add typed columns for the 7 Tekmetric fields the prior interface
--      was discarding: arrived, lead_source, pickup_time, dropoff_time,
--      created_date, updated_date, confirmation_status.
--   3. Add parse_version SMALLINT so we can detect rows synced with an
--      older parser shape and re-sync them.
--   4. NO change to appointment_status CHECK — empirical webhook sample
--      (1146 rows) shows only NONE + CANCELED for appointmentStatus and
--      NONE + CONFIRMED for confirmationStatus. Tekmetric explicitly
--      rejects "CONFIRMED" as appointmentStatus on POST per 2026-05-16
--      testing. Keeping the existing CHECK is fine.
--
-- NO appointment_type CHECK change. The 2026-05-16 pre-flight audit
-- (see scheduler-refactor-state.json phase_09d notes) found that both
-- scheduler-slots.ts and availability.ts cast appointment_type as
-- "waiter" | "dropoff" at runtime. Adding 'towed' would orphan towed
-- rows in availability.ts's .eq("appointment_type", ...) filters. The
-- color-derived classifier maps orange (#F0572A) to 'dropoff' instead
-- — a towed appointment still consumes a service bay, which is what
-- dropoff capacity tracks. If V2.1 later wants to count towed as its
-- own type, that's a separate phase that widens the CHECK AND updates
-- every reader together.
--
-- BLOCKING for V2 launch (per scheduler-refactor-state.json
-- phase_09d_tekmetric_correctness.criticality_for_v2_launch_2026_05_16):
-- this migration is the prerequisite for the appointments-sync rewrite
-- that derives appointment_type from `color` instead of
-- appointmentOption.code. Without that rewrite, every chat-driven V2
-- booking would be counted as waiter capacity regardless of customer
-- pick, because Tekmetric's API silently ignores appointmentOption.
--
-- The current data confirms the existing classifier is broken — empirical
-- query 2026-05-16 against the local appointments table:
--   - 35 navy (#0D4A80) appointments are mislabeled as 'waiter' (should
--     be 'dropoff')
--   - 4 red  (#D01919) appointments are mislabeled as 'dropoff' (should
--     be 'waiter')
--   - 39 of 177 (22%) total are misclassified by the UTC-hour heuristic.
-- The post-migration sync will reclassify all rows based on color.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. appointments — new columns
-- ---------------------------------------------------------------------

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS arrived BOOLEAN,
  ADD COLUMN IF NOT EXISTS lead_source TEXT,
  ADD COLUMN IF NOT EXISTS pickup_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dropoff_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmation_status TEXT,
  ADD COLUMN IF NOT EXISTS raw_payload JSONB,
  ADD COLUMN IF NOT EXISTS parse_version SMALLINT NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.appointments.arrived IS
  'Tekmetric `arrived` field. Boolean: true when staff marked the customer as arrived in Tekmetric UI; null on fresh appointments. Phase 9d 2026-05-16.';

COMMENT ON COLUMN public.appointments.lead_source IS
  'Tekmetric `leadSource`. Marketing-source attribution string (must match a Shop Settings → Marketing entry). V2.1 will start setting this to "TM" for chat-driven bookings.';

COMMENT ON COLUMN public.appointments.pickup_time IS
  'Tekmetric `pickupTime`. Per 2026-05-16 empirical observation, NULL for waiter appointments and frequently equals startTime/endTime for fresh dropoffs. Semantics: customer picked up their vehicle (post-service).';

COMMENT ON COLUMN public.appointments.dropoff_time IS
  'Tekmetric `dropoffTime`. Semantics: customer dropped off their vehicle (pre-service).';

COMMENT ON COLUMN public.appointments.created_date IS
  'Tekmetric `createdDate`. When the appointment record was created in Tekmetric. Separate from our local `created_at` which is when the row was synced into our shadow.';

COMMENT ON COLUMN public.appointments.updated_date IS
  'Tekmetric `updatedDate`. When the appointment record was last edited in Tekmetric.';

COMMENT ON COLUMN public.appointments.confirmation_status IS
  'Tekmetric `confirmationStatus`. Empirical enum: NONE | CONFIRMED. Read-only via the Tekmetric API (POST/PATCH writes are silently dropped per 2026-05-16 testing). Only flips to CONFIRMED via Tekmetric internal flow (SMS reply / staff confirm). V2.1 will use this signal to PATCH the appointment title to prepend "CONFIRMED " for advisor visibility.';

COMMENT ON COLUMN public.appointments.raw_payload IS
  'Full Tekmetric appointment JSON, stored verbatim. Defense against future Tekmetric field additions — new fields land here without requiring a schema migration. Caller does NOT have to read this for routine queries; it''s a safety net.';

COMMENT ON COLUMN public.appointments.parse_version IS
  'Schema version of the parser that wrote this row. 1 = pre-Phase-9d (typed only a subset of fields, appointmentStatus parsed from non-existent .code attribute → always "NONE"). 2 = Phase 9d (typed all fields, appointmentStatus is bare string, raw_payload populated). Used to detect rows that need re-sync after a parser upgrade.';

-- ---------------------------------------------------------------------
-- 2. appointments — appointment_type CHECK INTENTIONALLY NOT CHANGED
-- ---------------------------------------------------------------------
-- (See header note.) The color-derived classifier maps orange tow-in
-- appointments to 'dropoff' for capacity tracking, since they consume
-- a service bay just like a regular dropoff. Widening the CHECK to add
-- 'towed' would orphan rows in scheduler-slots.ts and availability.ts
-- readers that filter by .eq("appointment_type", ...) — that's a v2.1
-- coordinated upgrade, not a v2 launch concern.

-- ---------------------------------------------------------------------
-- 3. appointments — index on raw_payload (GIN) for ad-hoc field queries
-- ---------------------------------------------------------------------

-- GIN with jsonb_path_ops is the standard pattern for "find rows where
-- raw_payload @> '{...}'" queries. Useful for debugging future Tekmetric
-- shape drift.
CREATE INDEX IF NOT EXISTS appointments_raw_payload_gin_idx
  ON public.appointments USING GIN (raw_payload jsonb_path_ops);

COMMENT ON INDEX appointments_raw_payload_gin_idx IS
  'Phase 9d 2026-05-16: GIN index for ad-hoc containment queries against the verbatim Tekmetric payload. Not used by the main sync loop; supports debugging + future shape-discovery work.';

-- ---------------------------------------------------------------------
-- 4. appointments — index on (shop_id, confirmation_status) for the
--    V2.1 CONFIRMED-title-prefix webhook handler's lookup
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS appointments_confirmation_status_idx
  ON public.appointments (shop_id, confirmation_status)
  WHERE confirmation_status IS NOT NULL;

COMMENT ON INDEX appointments_confirmation_status_idx IS
  'Phase 9d 2026-05-16: partial index for the V2.1 webhook handler that PATCHes the title to prepend "CONFIRMED " when confirmation_status flips from NONE to CONFIRMED.';

-- ---------------------------------------------------------------------
-- 5. Bump parse_version on every existing row to 1 (already the default,
--    but make it explicit so downstream code can rely on it being non-null)
-- ---------------------------------------------------------------------

UPDATE public.appointments
SET parse_version = 1
WHERE parse_version IS NULL;

COMMIT;
