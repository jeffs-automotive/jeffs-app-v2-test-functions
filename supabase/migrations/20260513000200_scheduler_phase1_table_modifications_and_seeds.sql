-- =====================================================================
-- Scheduler Phase 1 — table modifications + seed updates + hold TTL fix
-- =====================================================================
-- Created 2026-05-13. Three concerns bundled atomically:
--   1. Add wait_eligible + requires_explanation columns to routine_services
--   2. Add description column to testing_services
--   3. Update hold_waiter_slot RPC TTL: 30 min → 10 min (Chris's call)
--   4. Seed appointment_default_limits + update routine_services flags
--   5. Initial seed of concern_questions catalog (~50 rows)
--   6. Backfill description on existing testing_services rows
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. routine_services: add wait_eligible + requires_explanation
-- ---------------------------------------------------------------------
ALTER TABLE public.routine_services
  ADD COLUMN IF NOT EXISTS wait_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS requires_explanation BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.routine_services.wait_eligible IS
  'When TRUE, customers can pick "Wait while we work" at Step 8 for this service. When FALSE, customers picking this service get drop-off only. Per design, eligible services for Phase 1 seed: state_inspection_emissions, oil_change, tire_rotation, rotate_balance_tires, alignment.';

COMMENT ON COLUMN public.routine_services.requires_explanation IS
  'When TRUE, picking this chip at Step 7.1 triggers a per-concern explanation card at Step 7.2 (customer types prose describing the symptom). Drives the diagnostic Q&A flow. Per design: brake_inspection, check_battery, warning_lights, check_suspension, check_ac all require explanation.';

-- ---------------------------------------------------------------------
-- 2. testing_services: add description
-- ---------------------------------------------------------------------
ALTER TABLE public.testing_services
  ADD COLUMN IF NOT EXISTS description TEXT;

COMMENT ON COLUMN public.testing_services.description IS
  'Customer-facing description shown alongside starting_price on Step 7.5 testing service approval card. Explains what the technician will do for that price. Service advisors manage via the upload_testing_services_md MCP tool.';

-- ---------------------------------------------------------------------
-- 3. hold_waiter_slot: change TTL from 30 min to 10 min
-- ---------------------------------------------------------------------
-- Chris's call (2026-05-13): 30 min is too long; slots should turn over
-- faster. Customer has 10 min after picking date/time to confirm at
-- Step 10 before the hold expires.
--
-- We rewrite the function rather than alter the existing one to ensure
-- the new TTL takes effect immediately. The function signature stays
-- identical so callers don't need changes.

-- First drop the existing function (we'll recreate with new body)
DROP FUNCTION IF EXISTS public.hold_waiter_slot(
  INTEGER, UUID, INTEGER, INTEGER, DATE, TIME, TEXT, TEXT
);

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
  -- Advisory lock keyed on (shop, date, time) so concurrent holds for the
  -- same slot serialize. Lock auto-releases at transaction commit/rollback.
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

-- COMMENT moved to migration 20260513000300_scheduler_phase1_fix_hold_waiter_slot.sql
-- to avoid the "function name is not unique" ambiguity when the legacy 8-arg
-- variant (returns UUID, hardcoded 'waiter') still exists alongside the new one.
-- The fix migration drops both then recreates with the COMMENT signature-qualified.

-- ---------------------------------------------------------------------
-- 4. Seed appointment_default_limits + update routine_services flags
-- ---------------------------------------------------------------------

-- Default capacity per day-of-week for shop 7476
-- Sun=closed; Mon-Fri 2/2/31; Sat 2/2/15 (per design memo + Chris's "TBD" Saturday)
INSERT INTO public.appointment_default_limits (shop_id, day_of_week, is_closed, waiter_8am_slots, waiter_9am_slots, dropoff_total, notes)
VALUES
  (7476, 0, TRUE,  0, 0,  0, 'Sunday — closed'),
  (7476, 1, FALSE, 2, 2, 31, 'Monday'),
  (7476, 2, FALSE, 2, 2, 31, 'Tuesday'),
  (7476, 3, FALSE, 2, 2, 31, 'Wednesday'),
  (7476, 4, FALSE, 2, 2, 31, 'Thursday'),
  (7476, 5, FALSE, 2, 2, 31, 'Friday'),
  (7476, 6, FALSE, 2, 2, 15, 'Saturday — shorter day')
ON CONFLICT (shop_id, day_of_week) DO UPDATE SET
  is_closed = EXCLUDED.is_closed,
  waiter_8am_slots = EXCLUDED.waiter_8am_slots,
  waiter_9am_slots = EXCLUDED.waiter_9am_slots,
  dropoff_total = EXCLUDED.dropoff_total,
  notes = EXCLUDED.notes,
  updated_at = now();

-- Routine services wait_eligible + requires_explanation flags per design
UPDATE public.routine_services SET wait_eligible = TRUE
  WHERE service_key IN (
    'state_inspection_emissions', 'oil_change', 'tire_rotation',
    'rotate_balance_tires', 'alignment'
  );

UPDATE public.routine_services SET requires_explanation = TRUE
  WHERE service_key IN (
    'brake_inspection', 'check_battery', 'warning_lights',
    'check_suspension', 'check_ac'
  );

-- ---------------------------------------------------------------------
-- 5. Seed concern_questions catalog (~50 rows: 3-5 questions per category × 14 categories)
-- ---------------------------------------------------------------------
-- Initial Phase 1 catalog. Service advisors refine via upload_concern_questions_md tool.

INSERT INTO public.concern_questions (shop_id, category, question_text, options, display_order)
VALUES
  -- Noise (5)
  (7476, 'noise', 'Where is the noise coming from?',
   '[{"label":"Front of the car","value":"front"},{"label":"Back of the car","value":"back"},{"label":"Underneath","value":"underneath"},{"label":"I''m not sure","value":"unsure"}]'::jsonb, 1),
  (7476, 'noise', 'When does the noise happen?',
   '[{"label":"While driving","value":"driving"},{"label":"When braking","value":"braking"},{"label":"When turning","value":"turning"},{"label":"While idling","value":"idling"},{"label":"All the time","value":"always"}]'::jsonb, 2),
  (7476, 'noise', 'What does it sound like?',
   '[{"label":"Squeal","value":"squeal"},{"label":"Grind","value":"grind"},{"label":"Clunk","value":"clunk"},{"label":"Rattle","value":"rattle"},{"label":"Tick","value":"tick"},{"label":"I''m not sure","value":"unsure"}]'::jsonb, 3),
  (7476, 'noise', 'How long has this been happening?',
   '[{"label":"Just started today","value":"today"},{"label":"A few days","value":"days"},{"label":"A few weeks","value":"weeks"},{"label":"Longer than that","value":"long"}]'::jsonb, 4),

  -- Vibration (4)
  (7476, 'vibration', 'Where do you feel the vibration?',
   '[{"label":"Steering wheel","value":"steering"},{"label":"Seat","value":"seat"},{"label":"Pedal","value":"pedal"},{"label":"Whole car","value":"whole_car"}]'::jsonb, 1),
  (7476, 'vibration', 'When does it happen?',
   '[{"label":"At highway speeds","value":"highway"},{"label":"At city speeds","value":"city"},{"label":"When braking","value":"braking"},{"label":"While idling","value":"idling"},{"label":"All the time","value":"always"}]'::jsonb, 2),
  (7476, 'vibration', 'Recent tire work?',
   '[{"label":"Yes, recently","value":"recent"},{"label":"No, not recently","value":"no"},{"label":"I''m not sure","value":"unsure"}]'::jsonb, 3),

  -- Pulling (3)
  (7476, 'pulling', 'Which direction does the car pull?',
   '[{"label":"Left","value":"left"},{"label":"Right","value":"right"},{"label":"Sometimes left, sometimes right","value":"alternates"}]'::jsonb, 1),
  (7476, 'pulling', 'When do you notice the pulling?',
   '[{"label":"While driving straight","value":"straight"},{"label":"When braking","value":"braking"},{"label":"On certain roads","value":"some_roads"}]'::jsonb, 2),

  -- Smell (4)
  (7476, 'smell', 'What does the smell remind you of?',
   '[{"label":"Burning","value":"burning"},{"label":"Sweet (like syrup)","value":"sweet"},{"label":"Gasoline","value":"gas"},{"label":"Sulfur (rotten eggs)","value":"sulfur"},{"label":"Musty / mildew","value":"musty"},{"label":"Electrical / plastic","value":"electrical"}]'::jsonb, 1),
  (7476, 'smell', 'Where do you smell it most?',
   '[{"label":"Inside the car","value":"interior"},{"label":"Outside the car","value":"exterior"},{"label":"Both","value":"both"}]'::jsonb, 2),
  (7476, 'smell', 'When does the smell appear?',
   '[{"label":"When AC is on","value":"ac_on"},{"label":"When heat is on","value":"heat_on"},{"label":"While driving","value":"driving"},{"label":"After driving / when parked","value":"after"}]'::jsonb, 3),

  -- Smoke (3)
  (7476, 'smoke', 'What color is the smoke?',
   '[{"label":"White","value":"white"},{"label":"Blue","value":"blue"},{"label":"Black","value":"black"},{"label":"Gray","value":"gray"}]'::jsonb, 1),
  (7476, 'smoke', 'Where is it coming from?',
   '[{"label":"Hood / engine bay","value":"engine"},{"label":"Tailpipe","value":"exhaust"},{"label":"Under the dash","value":"interior"},{"label":"Somewhere else","value":"other"}]'::jsonb, 2),

  -- Leak (4)
  (7476, 'leak', 'What color is the fluid?',
   '[{"label":"Brown / dark amber (oil)","value":"oil"},{"label":"Green or orange (coolant)","value":"coolant"},{"label":"Red or pink (transmission)","value":"trans"},{"label":"Clear (water — AC condensation)","value":"water"},{"label":"I''m not sure","value":"unsure"}]'::jsonb, 1),
  (7476, 'leak', 'Where is the leak coming from?',
   '[{"label":"Front of the car","value":"front"},{"label":"Middle","value":"middle"},{"label":"Back","value":"back"},{"label":"Not sure","value":"unsure"}]'::jsonb, 2),
  (7476, 'leak', 'How big is the leak?',
   '[{"label":"Tiny drops","value":"drops"},{"label":"Small puddle","value":"small_puddle"},{"label":"Big puddle","value":"big_puddle"}]'::jsonb, 3),

  -- Warning light (4)
  (7476, 'warning_light', 'Which light is on?',
   '[{"label":"Check engine","value":"cel"},{"label":"Oil pressure","value":"oil"},{"label":"Battery / alternator","value":"battery"},{"label":"ABS / brake","value":"brake"},{"label":"Tire pressure (TPMS)","value":"tpms"},{"label":"Other / not sure","value":"other"}]'::jsonb, 1),
  (7476, 'warning_light', 'Is it solid or flashing?',
   '[{"label":"Solid","value":"solid"},{"label":"Flashing","value":"flashing"},{"label":"Comes and goes","value":"intermittent"}]'::jsonb, 2),
  (7476, 'warning_light', 'When did it come on?',
   '[{"label":"Today","value":"today"},{"label":"This week","value":"week"},{"label":"Longer ago","value":"old"}]'::jsonb, 3),

  -- Performance (3)
  (7476, 'performance', 'What''s the symptom?',
   '[{"label":"Low power / sluggish acceleration","value":"low_power"},{"label":"Stalling","value":"stalling"},{"label":"Surging / hesitation","value":"surging"},{"label":"Hard to start","value":"hard_start"},{"label":"Won''t start","value":"no_start"}]'::jsonb, 1),
  (7476, 'performance', 'When does it happen?',
   '[{"label":"Cold start (first time of the day)","value":"cold"},{"label":"After warmed up","value":"warm"},{"label":"All the time","value":"always"}]'::jsonb, 2),

  -- Electrical (3)
  (7476, 'electrical', 'What''s acting up?',
   '[{"label":"Lights / dash","value":"lights"},{"label":"Windows / locks","value":"windows_locks"},{"label":"Radio / infotainment","value":"radio"},{"label":"Charging system","value":"charging"},{"label":"Something else","value":"other"}]'::jsonb, 1),
  (7476, 'electrical', 'Does it happen all the time?',
   '[{"label":"All the time","value":"always"},{"label":"Comes and goes","value":"intermittent"},{"label":"Only in certain conditions","value":"conditional"}]'::jsonb, 2),

  -- HVAC (3)
  (7476, 'hvac', 'What''s the issue?',
   '[{"label":"AC not cold","value":"ac_warm"},{"label":"Heat not warm","value":"heat_cold"},{"label":"Fan not working","value":"fan"},{"label":"Smell from vents","value":"smell"},{"label":"Defrost not working","value":"defrost"}]'::jsonb, 1),
  (7476, 'hvac', 'Which side(s)?',
   '[{"label":"Driver side","value":"driver"},{"label":"Passenger side","value":"passenger"},{"label":"Both","value":"both"},{"label":"Rear","value":"rear"}]'::jsonb, 2),

  -- Brakes (4)
  (7476, 'brakes', 'What are you noticing?',
   '[{"label":"Squealing / squeaking","value":"squeal"},{"label":"Grinding","value":"grind"},{"label":"Soft / spongy pedal","value":"soft_pedal"},{"label":"Pulls when braking","value":"pull"},{"label":"Vibration when braking","value":"vibrate"}]'::jsonb, 1),
  (7476, 'brakes', 'When does it happen?',
   '[{"label":"Always when braking","value":"always"},{"label":"Only in cold weather","value":"cold"},{"label":"Only after sitting overnight","value":"overnight"},{"label":"On hard stops","value":"hard"}]'::jsonb, 2),
  (7476, 'brakes', 'Last brake service?',
   '[{"label":"Recently (within 6 months)","value":"recent"},{"label":"More than 6 months ago","value":"old"},{"label":"I don''t remember","value":"unsure"}]'::jsonb, 3),

  -- Steering (3)
  (7476, 'steering', 'What''s the issue?',
   '[{"label":"Hard to turn","value":"hard"},{"label":"Loose / wandering","value":"loose"},{"label":"Pulls to one side","value":"pulls"},{"label":"Noise when turning","value":"noise"},{"label":"Vibration in steering wheel","value":"vibration"}]'::jsonb, 1),
  (7476, 'steering', 'At what speed do you notice it?',
   '[{"label":"Parking lot / low speed","value":"low"},{"label":"City speeds","value":"city"},{"label":"Highway speeds","value":"highway"},{"label":"All speeds","value":"all"}]'::jsonb, 2),

  -- Tires (3)
  (7476, 'tires', 'What''s going on with the tires?',
   '[{"label":"Low pressure warning","value":"tpms"},{"label":"Visible damage / nail","value":"damage"},{"label":"Uneven wear","value":"wear"},{"label":"Vibration","value":"vibration"},{"label":"Going flat","value":"flat"}]'::jsonb, 1),
  (7476, 'tires', 'Which tire(s)?',
   '[{"label":"Driver front","value":"lf"},{"label":"Passenger front","value":"rf"},{"label":"Driver rear","value":"lr"},{"label":"Passenger rear","value":"rr"},{"label":"Not sure","value":"unsure"}]'::jsonb, 2),

  -- Other (2)
  (7476, 'other', 'How urgent does this feel?',
   '[{"label":"Right now — vehicle isn''t safe to drive","value":"urgent"},{"label":"Soon — bothering me but I can still drive","value":"soon"},{"label":"Whenever — just want it checked","value":"whenever"}]'::jsonb, 1),
  (7476, 'other', 'When did this start?',
   '[{"label":"Just today","value":"today"},{"label":"This week","value":"week"},{"label":"A while ago","value":"a_while"}]'::jsonb, 2)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- 6. Backfill description on existing testing_services rows
-- ---------------------------------------------------------------------

UPDATE public.testing_services SET description = CASE service_key
  WHEN 'warning_light_general'      THEN 'Our technician will hook up a scanner, read the diagnostic codes, and explain what they mean. We''ll give you an estimate for any needed repairs.'
  WHEN 'tpms_testing'               THEN 'We''ll inspect the tire pressure sensors, check tire pressures, and identify which sensor (if any) is faulty.'
  WHEN 'suspension_check'           THEN 'A hands-on inspection of struts, bushings, ball joints, and CV components for play or wear. Free unless we recommend any repairs.'
  WHEN 'brake_inspection'           THEN 'We measure pad thickness, inspect rotors and calipers, check brake fluid condition, and recommend any needed work. Waived if you approve any recommended repairs.'
  WHEN 'battery_test'               THEN 'A complete electrical-system test: battery health, alternator output, starter draw. Free of charge.'
  WHEN 'alternator_testing'         THEN 'Tests alternator output under load and inspects related electrical components.'
  WHEN 'electrical_testing_general' THEN 'A general electrical-system diagnostic. We''ll trace the issue and explain what we found.'
  WHEN 'oil_leak_testing'           THEN 'We pressurize the engine, use dye or UV light if needed, and identify the exact source of the leak.'
  WHEN 'coolant_leak_testing'       THEN 'Pressure-test the cooling system, find the leak source, and check related components. Includes top-off coolant.'
  WHEN 'coolant_leak_testing_euro'  THEN 'Same as standard coolant leak testing but covers European vehicles which have more complex cooling systems and require specialized coolant.'
  WHEN 'no_start_testing'           THEN 'We''ll diagnose why your vehicle won''t start — battery, starter, ignition, fuel, or electrical — and give you an estimate.'
  WHEN 'transmission_testing'       THEN 'We''ll road-test the vehicle, scan for transmission codes, and inspect transmission fluid for any signs of internal issues.'
  WHEN 'window_inop_testing'        THEN 'Diagnose why your window isn''t working — switch, motor, regulator, or wiring. Includes tear-down for inspection.'
  WHEN 'windshield_inop_testing'    THEN 'Diagnose windshield-related electrical issues (wipers, washer, rain sensor, HUD).'
  ELSE description
END
WHERE service_key IN (
  'warning_light_general', 'tpms_testing', 'suspension_check',
  'brake_inspection', 'battery_test', 'alternator_testing',
  'electrical_testing_general', 'oil_leak_testing',
  'coolant_leak_testing', 'coolant_leak_testing_euro',
  'no_start_testing', 'transmission_testing',
  'window_inop_testing', 'windshield_inop_testing'
);
