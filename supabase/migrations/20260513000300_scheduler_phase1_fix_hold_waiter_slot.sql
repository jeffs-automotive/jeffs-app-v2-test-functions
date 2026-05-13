-- =====================================================================
-- Scheduler Phase 1 — fix hold_waiter_slot ambiguity
-- =====================================================================
-- Created 2026-05-13. Migration 20260513000200 attempted to replace
-- hold_waiter_slot but the DROP statement had the wrong signature, so
-- both the old (8-arg, returns UUID) and new (8-arg different shape,
-- returns TABLE) functions coexisted, causing the trailing COMMENT to
-- fail with "function name is not unique."
--
-- This migration:
--   1. Drops BOTH variants explicitly with their full signatures
--   2. Recreates the new one (10-minute TTL, returns result table)
--   3. Adds the COMMENT (now unambiguous)
-- =====================================================================

-- Drop the legacy 8-arg version (returns UUID, hardcoded waiter type, 30-min TTL)
DROP FUNCTION IF EXISTS public.hold_waiter_slot(
  INTEGER,    -- p_shop_id
  UUID,       -- p_session_id
  INTEGER,    -- p_customer_id
  INTEGER,    -- p_vehicle_id
  DATE,       -- p_scheduled_date
  TIME,       -- p_scheduled_time
  TEXT,       -- p_service_summary
  INTEGER     -- p_active_tekmetric_appts
);

-- Drop the new variant if it exists (was just created by the previous migration; safe re-drop)
DROP FUNCTION IF EXISTS public.hold_waiter_slot(
  INTEGER,    -- p_shop_id
  UUID,       -- p_session_id
  INTEGER,    -- p_customer_id
  INTEGER,    -- p_vehicle_id
  DATE,       -- p_scheduled_date
  TIME,       -- p_scheduled_time
  TEXT,       -- p_appointment_type
  TEXT        -- p_service_summary
);

-- Create the canonical Phase 1 version: 10-minute TTL, supports waiter + dropoff,
-- returns result table with diagnostic reason on failure.
CREATE OR REPLACE FUNCTION public.hold_waiter_slot(
  p_shop_id          INTEGER,
  p_session_id       UUID,
  p_customer_id      INTEGER,
  p_vehicle_id       INTEGER,
  p_scheduled_date   DATE,
  p_scheduled_time   TIME,
  p_appointment_type TEXT,
  p_service_summary  TEXT
)
RETURNS TABLE (
  hold_id      UUID,
  expires_at   TIMESTAMPTZ,
  ok           BOOLEAN,
  reason       TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key BIGINT;
  v_hold_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_held_count INT;
  v_capacity INT;
  v_dow INT;
  v_is_closed BOOLEAN;
  v_blocked BOOLEAN;
BEGIN
  -- Advisory lock keyed on (shop, date, time, type) so concurrent holds
  -- for the same slot serialize. Lock auto-releases at txn commit/rollback.
  v_lock_key := hashtextextended(
    p_shop_id::text || ':' || p_scheduled_date::text || ':' ||
    p_scheduled_time::text || ':' || p_appointment_type,
    0
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Check closed_dates
  IF EXISTS (
    SELECT 1 FROM closed_dates
    WHERE shop_id = p_shop_id AND closed_date = p_scheduled_date
  ) THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TIMESTAMPTZ, FALSE, 'closed_date'::TEXT;
    RETURN;
  END IF;

  -- Check appointment_blocks (date-specific overrides)
  SELECT TRUE INTO v_blocked
  FROM appointment_blocks
  WHERE shop_id = p_shop_id
    AND blocked_date = p_scheduled_date
    AND (blocked_type IS NULL OR blocked_type = p_appointment_type)
    AND (blocked_time IS NULL OR blocked_time = p_scheduled_time)
  LIMIT 1;
  IF v_blocked THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TIMESTAMPTZ, FALSE, 'date_blocked'::TEXT;
    RETURN;
  END IF;

  -- Look up default capacity for this day-of-week + slot
  v_dow := EXTRACT(DOW FROM p_scheduled_date)::INT;
  SELECT
    CASE
      WHEN is_closed THEN 0
      WHEN p_appointment_type = 'waiter' AND p_scheduled_time = '08:00'::TIME THEN waiter_8am_slots
      WHEN p_appointment_type = 'waiter' AND p_scheduled_time = '09:00'::TIME THEN waiter_9am_slots
      WHEN p_appointment_type = 'dropoff' THEN dropoff_total
      ELSE 0
    END,
    is_closed
  INTO v_capacity, v_is_closed
  FROM appointment_default_limits
  WHERE shop_id = p_shop_id AND day_of_week = v_dow;

  IF v_is_closed OR COALESCE(v_capacity, 0) <= 0 THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TIMESTAMPTZ, FALSE, 'no_capacity_for_day'::TEXT;
    RETURN;
  END IF;

  -- Count active holds + booked appointments for this slot
  SELECT
    (SELECT COUNT(*)::INT FROM appointment_holds
       WHERE shop_id = p_shop_id
         AND scheduled_date = p_scheduled_date
         AND scheduled_time = p_scheduled_time
         AND appointment_type = p_appointment_type
         AND released_at IS NULL
         AND expires_at > now())
    +
    (SELECT COUNT(*)::INT FROM appointments
       WHERE shop_id = p_shop_id
         AND scheduled_date = p_scheduled_date
         AND scheduled_time = p_scheduled_time
         AND appointment_type = p_appointment_type
         AND deleted_at IS NULL)
  INTO v_held_count;

  IF v_held_count >= v_capacity THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TIMESTAMPTZ, FALSE, 'slot_full'::TEXT;
    RETURN;
  END IF;

  -- Insert the hold (10-minute TTL per Chris's 2026-05-13 directive)
  v_expires_at := now() + interval '10 minutes';
  INSERT INTO appointment_holds (
    shop_id, session_id, customer_id, vehicle_id,
    scheduled_date, scheduled_time, appointment_type,
    service_summary, expires_at
  ) VALUES (
    p_shop_id, p_session_id, p_customer_id, p_vehicle_id,
    p_scheduled_date, p_scheduled_time, p_appointment_type,
    p_service_summary, v_expires_at
  )
  RETURNING id INTO v_hold_id;

  RETURN QUERY SELECT v_hold_id, v_expires_at, TRUE, NULL::TEXT;
END;
$$;

COMMENT ON FUNCTION public.hold_waiter_slot(
  INTEGER, UUID, INTEGER, INTEGER, DATE, TIME, TEXT, TEXT
) IS
  'Atomically holds an appointment slot using advisory-lock pattern. 10-minute TTL (changed from 30 min on 2026-05-13). Validates closed_dates, appointment_blocks, and capacity from appointment_default_limits + existing holds/appointments. Returns hold_id + expires_at on success; ok=FALSE with reason on failure (reasons: closed_date, date_blocked, no_capacity_for_day, slot_full).';
