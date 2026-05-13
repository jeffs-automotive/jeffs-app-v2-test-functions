-- Scheduler Phase 1 — fix two bugs in hold_waiter_slot RPC
-- Date: 2026-05-13
--
-- Bugs caught when the F5-full booking ladder first invoked the RPC for real
-- (commit 9f98336 + scheduler-booking-direct redeploy):
--
-- 1. Ambiguous `expires_at` reference. The RPC has OUT parameter
--    `expires_at timestamp with time zone` which shadows
--    `appointment_holds.expires_at` inside the plpgsql body. PostgreSQL
--    raises `column reference "expires_at" is ambiguous` on the
--    `WHERE expires_at > now()` predicate. Qualify it as
--    `appointment_holds.expires_at`.
--
-- 2. `appointments` table reference uses non-existent columns. The original
--    function queried `WHERE scheduled_date = p_scheduled_date AND
--    scheduled_time = p_scheduled_time AND appointment_type = p_appointment_type`
--    against `appointments`, but that table doesn't have scheduled_date /
--    scheduled_time columns — it has `start_time TIMESTAMPTZ`. The waiter
--    slot times are encoded into start_time (8 AM EDT = 12:00 UTC, 9 AM EDT =
--    13:00 UTC during DST). Match on start_time directly.
--
-- Note: the start_time comparison uses an EDT offset (-04:00) hard-coded
-- for Phase 1 testing. This is the same shortcut the confirmAppointment
-- helper uses (scheduler-slots.ts line 764). Revisit when DST switches in
-- the fall — should compute via Intl.DateTimeFormat('America/New_York').

CREATE OR REPLACE FUNCTION public.hold_waiter_slot(
  p_shop_id integer,
  p_session_id uuid,
  p_customer_id integer,
  p_vehicle_id integer,
  p_scheduled_date date,
  p_scheduled_time time without time zone,
  p_appointment_type text,
  p_service_summary text
)
RETURNS TABLE(hold_id uuid, expires_at timestamp with time zone, ok boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lock_key BIGINT;
  v_hold_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_held_count INT;
  v_capacity INT;
  v_dow INT;
  v_is_closed BOOLEAN;
  v_blocked BOOLEAN;
  v_start_time TIMESTAMPTZ;
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

  -- Compose the EDT moment that corresponds to (p_scheduled_date,
  -- p_scheduled_time) so we can match it against appointments.start_time
  -- (which is stored as TIMESTAMPTZ). Phase 1 hard-codes a -04:00 offset
  -- (EDT); revisit on DST.
  v_start_time := (p_scheduled_date::TEXT || 'T' || p_scheduled_time::TEXT || '-04:00')::TIMESTAMPTZ;

  -- Count active holds + booked appointments for this slot.
  -- IMPORTANT: qualify `appointment_holds.expires_at` to avoid the
  -- OUT-param shadow that triggers `column reference "expires_at" is
  -- ambiguous` (PostgreSQL plpgsql 14+).
  -- IMPORTANT: appointments has no scheduled_date/scheduled_time columns;
  -- match on start_time instead.
  SELECT
    (SELECT COUNT(*)::INT FROM appointment_holds h
       WHERE h.shop_id = p_shop_id
         AND h.scheduled_date = p_scheduled_date
         AND h.scheduled_time = p_scheduled_time
         AND h.appointment_type = p_appointment_type
         AND h.released_at IS NULL
         AND h.expires_at > now())
    +
    (SELECT COUNT(*)::INT FROM appointments a
       WHERE a.shop_id = p_shop_id
         AND a.start_time = v_start_time
         AND a.appointment_type = p_appointment_type
         AND a.deleted_at IS NULL
         AND a.appointment_status <> 'CANCELED')
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
$function$;
