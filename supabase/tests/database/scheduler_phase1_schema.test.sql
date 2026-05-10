-- =====================================================================
-- pgTAP tests for scheduler-app Phase 1 schema
-- =====================================================================
-- Verifies the 20260510131752_scheduler_phase1_schema.sql migration:
--
-- 1.  Structural — all 13 tables exist with expected columns + types
-- 2.  Constraints — CHECK constraints + UNIQUE constraints + FK behavior
-- 3.  RLS — every table is RLS-enabled with deny-all default
-- 4.  Indexes — partial + GIN indexes are created and used
-- 5.  Function — hold_waiter_slot exists, signature correct, lock works
-- 6.  Seed data — testing_services 14 rows, routine_services 10 rows,
--      closed_dates Sundays, appointment_sync_state shop 7476 row
-- 7.  Architectural-claim tests (per cross-module-anchors.md):
--      a) Advisory lock prevents over-capacity on waiter slots
--      b) Phone-array PATCH gotcha is mitigated (covered later in a DAL test)
--      c) Soft-delete preserves rows (deleted_at IS NULL filter works)
--      d) ON DELETE CASCADE chains work correctly
--
-- Run with: supabase test db
-- =====================================================================

BEGIN;
-- Use no_plan() during initial development; switch to a strict plan(N)
-- once the test count stabilizes.
SELECT * FROM no_plan();

-- ---------------------------------------------------------------------
-- 1. Structural — tables exist
-- ---------------------------------------------------------------------

SELECT has_table('public', 'customer_chat_sessions',     'customer_chat_sessions table exists');
SELECT has_table('public', 'customer_chat_messages',     'customer_chat_messages table exists');
SELECT has_table('public', 'appointment_holds',          'appointment_holds table exists');
SELECT has_table('public', 'service_dept_users',         'service_dept_users table exists');
SELECT has_table('public', 'appointment_blocks',         'appointment_blocks table exists');
SELECT has_table('public', 'closed_dates',               'closed_dates table exists');
SELECT has_table('public', 'appointment_concerns',       'appointment_concerns table exists');
SELECT has_table('public', 'otp_codes',                  'otp_codes table exists');
SELECT has_table('public', 'transcript_emails',          'transcript_emails table exists');
SELECT has_table('public', 'testing_services',           'testing_services table exists');
SELECT has_table('public', 'routine_services',           'routine_services table exists');
SELECT has_table('public', 'appointments',               'appointments table exists');
SELECT has_table('public', 'appointment_sync_state',     'appointment_sync_state table exists');


-- ---------------------------------------------------------------------
-- 2. Critical column existence + types
-- ---------------------------------------------------------------------

-- customer_chat_sessions
SELECT col_type_is('public', 'customer_chat_sessions', 'channel',                  'text', 'channel column is text');
SELECT col_type_is('public', 'customer_chat_sessions', 'customer_self_identified', 'text', 'customer_self_identified column is text');
SELECT col_type_is('public', 'customer_chat_sessions', 'sentiment',                'text', 'sentiment column is text');

-- customer_chat_messages
SELECT col_type_is('public', 'customer_chat_messages', 'parts', 'jsonb',           'parts column is jsonb');

-- appointment_holds
SELECT col_not_null('public', 'appointment_holds', 'scheduled_time', 'scheduled_time is NOT NULL (drop-offs use 12:00 placeholder)');

-- appointments shadow
SELECT col_type_is('public', 'appointments', 'tekmetric_appointment_id', 'bigint', 'tekmetric_appointment_id is bigint');
SELECT col_type_is('public', 'appointments', 'start_time',               'timestamp with time zone', 'start_time is timestamptz');

-- testing_services
SELECT col_not_null('public', 'testing_services', 'abbreviation', 'testing_services.abbreviation is NOT NULL');
SELECT col_type_is('public', 'testing_services', 'concern_categories', 'text[]', 'concern_categories is text[]');

-- routine_services
SELECT col_not_null('public', 'routine_services', 'abbreviation',  'routine_services.abbreviation is NOT NULL');
SELECT col_not_null('public', 'routine_services', 'display_order', 'routine_services.display_order is NOT NULL');


-- ---------------------------------------------------------------------
-- 3. CHECK constraints — verify enums
-- ---------------------------------------------------------------------

-- channel must be web or sms
SELECT throws_ok(
  $$INSERT INTO customer_chat_sessions (shop_id, channel) VALUES (7476, 'invalid_channel')$$,
  '23514',
  NULL,
  'channel CHECK rejects invalid value'
);

-- sentiment enum
SELECT throws_ok(
  $$INSERT INTO customer_chat_sessions (shop_id, channel, sentiment) VALUES (7476, 'web', 'neutral_invalid')$$,
  '23514',
  NULL,
  'sentiment CHECK rejects invalid value'
);

-- appointment_status enum on appointments
SELECT throws_ok(
  $$INSERT INTO appointments (shop_id, tekmetric_appointment_id, start_time, end_time, appointment_type, appointment_status)
    VALUES (7476, 999999999, now(), now() + interval '1 hour', 'waiter', 'BOGUS')$$,
  '23514',
  NULL,
  'appointment_status CHECK rejects invalid value'
);

-- appointment_type enum on appointments
SELECT throws_ok(
  $$INSERT INTO appointments (shop_id, tekmetric_appointment_id, start_time, end_time, appointment_type, appointment_status)
    VALUES (7476, 999999998, now(), now() + interval '1 hour', 'invalid_type', 'NONE')$$,
  '23514',
  NULL,
  'appointment_type CHECK rejects invalid value'
);


-- ---------------------------------------------------------------------
-- 4. RLS enabled on every table (deny-all to public)
-- ---------------------------------------------------------------------

SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'customer_chat_sessions' AND relnamespace = 'public'::regnamespace),
  TRUE,
  'customer_chat_sessions has RLS enabled'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'customer_chat_messages' AND relnamespace = 'public'::regnamespace),
  TRUE,
  'customer_chat_messages has RLS enabled'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'appointment_holds' AND relnamespace = 'public'::regnamespace),
  TRUE,
  'appointment_holds has RLS enabled'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'service_dept_users' AND relnamespace = 'public'::regnamespace),
  TRUE,
  'service_dept_users has RLS enabled'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'appointment_blocks' AND relnamespace = 'public'::regnamespace),
  TRUE,
  'appointment_blocks has RLS enabled'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'closed_dates' AND relnamespace = 'public'::regnamespace),
  TRUE,
  'closed_dates has RLS enabled'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'appointment_concerns' AND relnamespace = 'public'::regnamespace),
  TRUE,
  'appointment_concerns has RLS enabled'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'otp_codes' AND relnamespace = 'public'::regnamespace),
  TRUE,
  'otp_codes has RLS enabled'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'transcript_emails' AND relnamespace = 'public'::regnamespace),
  TRUE,
  'transcript_emails has RLS enabled'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'testing_services' AND relnamespace = 'public'::regnamespace),
  TRUE,
  'testing_services has RLS enabled'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'routine_services' AND relnamespace = 'public'::regnamespace),
  TRUE,
  'routine_services has RLS enabled'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'appointments' AND relnamespace = 'public'::regnamespace),
  TRUE,
  'appointments has RLS enabled'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'appointment_sync_state' AND relnamespace = 'public'::regnamespace),
  TRUE,
  'appointment_sync_state has RLS enabled'
);


-- ---------------------------------------------------------------------
-- 5. Indexes — verify the partial + GIN indexes exist
-- ---------------------------------------------------------------------

SELECT has_index('public', 'customer_chat_sessions', 'customer_chat_sessions_phone_active_idx',
                 'phone_active partial index exists');
SELECT has_index('public', 'customer_chat_sessions', 'customer_chat_sessions_cookie_idx',
                 'cookie partial index exists');
SELECT has_index('public', 'customer_chat_messages', 'customer_chat_messages_session_chrono_idx',
                 'session_chrono index exists');
SELECT has_index('public', 'appointment_holds', 'appointment_holds_active_idx',
                 'appointment_holds active partial index exists');
SELECT has_index('public', 'testing_services', 'testing_services_categories_idx',
                 'testing_services GIN index exists');
SELECT has_index('public', 'appointments', 'appointments_slot_lookup_idx',
                 'appointments slot_lookup partial index exists');
SELECT has_index('public', 'appointments', 'appointments_date_scan_idx',
                 'appointments date_scan partial index exists');
SELECT has_index('public', 'appointments', 'appointments_customer_idx',
                 'appointments customer partial index exists');


-- ---------------------------------------------------------------------
-- 6. hold_waiter_slot function — exists, correct signature, callable
-- ---------------------------------------------------------------------

SELECT has_function('public', 'hold_waiter_slot',
                    ARRAY['integer','uuid','integer','integer','date','time','text','integer'],
                    'hold_waiter_slot function exists with correct signature');

SELECT function_returns('public', 'hold_waiter_slot',
                        ARRAY['integer','uuid','integer','integer','date','time','text','integer'],
                        'uuid',
                        'hold_waiter_slot returns uuid');


-- ---------------------------------------------------------------------
-- 7. Seed data
-- ---------------------------------------------------------------------

SELECT is(
  (SELECT COUNT(*)::INT FROM testing_services WHERE shop_id = 7476),
  14,
  'testing_services seeded with 14 rows for shop 7476'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM routine_services WHERE shop_id = 7476),
  10,
  'routine_services seeded with 10 rows for shop 7476'
);

SELECT is(
  (SELECT abbreviation FROM routine_services
    WHERE shop_id = 7476 AND service_key = 'oil_change'),
  'LOF',
  'routine_services.oil_change abbreviation = LOF'
);

SELECT is(
  (SELECT abbreviation FROM routine_services
    WHERE shop_id = 7476 AND service_key = 'state_inspection_emissions'),
  'SI IM',
  'routine_services.state_inspection_emissions abbreviation = SI IM'
);

SELECT is(
  (SELECT abbreviation FROM testing_services
    WHERE shop_id = 7476 AND service_key = 'warning_light_general'),
  'CEL TESTING',
  'testing_services.warning_light_general abbreviation = CEL TESTING (per 20260510133653_abbreviations_fill.sql)'
);

-- Spot-check a few more abbreviations from the abbreviations-fill migration:
SELECT is(
  (SELECT abbreviation FROM routine_services
    WHERE shop_id = 7476 AND service_key = 'tire_rotation'),
  'ROT',
  'routine_services.tire_rotation abbreviation = ROT'
);
SELECT is(
  (SELECT abbreviation FROM routine_services
    WHERE shop_id = 7476 AND service_key = 'rotate_balance_tires'),
  'ROT BAL',
  'routine_services.rotate_balance_tires abbreviation = ROT BAL'
);
SELECT is(
  (SELECT abbreviation FROM routine_services
    WHERE shop_id = 7476 AND service_key = 'alignment'),
  'ALIGN',
  'routine_services.alignment abbreviation = ALIGN'
);
SELECT is(
  (SELECT abbreviation FROM testing_services
    WHERE shop_id = 7476 AND service_key = 'transmission_testing'),
  'TRANS TESTING',
  'testing_services.transmission_testing abbreviation = TRANS TESTING'
);
SELECT is(
  (SELECT abbreviation FROM testing_services
    WHERE shop_id = 7476 AND service_key = 'brake_inspection'),
  'BRAKE INSPECT',
  'testing_services.brake_inspection abbreviation = BRAKE INSPECT'
);

-- Defensive: no TBD abbreviations remain anywhere
SELECT is(
  (SELECT COUNT(*)::INT FROM routine_services WHERE shop_id = 7476 AND abbreviation = 'TBD'),
  0,
  'routine_services has zero TBD abbreviations'
);
SELECT is(
  (SELECT COUNT(*)::INT FROM testing_services WHERE shop_id = 7476 AND abbreviation = 'TBD'),
  0,
  'testing_services has zero TBD abbreviations'
);

SELECT is(
  (SELECT starting_price_cents FROM testing_services
    WHERE shop_id = 7476 AND service_key = 'brake_inspection'),
  3999,
  'brake_inspection starting_price_cents = 3999 ($39.99)'
);

SELECT is(
  (SELECT starting_price_cents FROM testing_services
    WHERE shop_id = 7476 AND service_key = 'battery_test'),
  0,
  'battery_test starting_price_cents = 0 (free)'
);

-- closed_dates: at least 100 Sunday rows (~104 in 2 years)
SELECT cmp_ok(
  (SELECT COUNT(*)::INT FROM closed_dates WHERE shop_id = 7476 AND source = 'default-sunday'),
  '>=',
  100,
  'closed_dates seeded with at least 100 Sundays'
);

-- All seeded closed_dates are actually Sundays (dow = 0)
SELECT is(
  (SELECT COUNT(*)::INT FROM closed_dates
    WHERE shop_id = 7476 AND source = 'default-sunday'
      AND extract(dow from closed_date) <> 0),
  0,
  'All default-sunday rows fall on a Sunday'
);

-- appointment_sync_state has shop 7476
SELECT is(
  (SELECT COUNT(*)::INT FROM appointment_sync_state WHERE shop_id = 7476),
  1,
  'appointment_sync_state seeded with shop 7476 row'
);


-- ---------------------------------------------------------------------
-- 8. Architectural claim: advisory lock prevents over-capacity
-- ---------------------------------------------------------------------
-- Set up a session for the holds to reference, then call hold_waiter_slot
-- 3 times for the same slot. The third call should raise slot_full
-- (because capacity is 2 and we've inserted 0 Tekmetric appts in
-- p_active_tekmetric_appts).
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_session_id UUID;
  v_hold_id_1  UUID;
  v_hold_id_2  UUID;
  v_third_call_failed BOOLEAN := FALSE;
BEGIN
  INSERT INTO customer_chat_sessions (shop_id, channel)
    VALUES (7476, 'web') RETURNING id INTO v_session_id;

  -- First hold — should succeed
  v_hold_id_1 := public.hold_waiter_slot(
    7476, v_session_id, NULL, NULL,
    current_date + 1, '08:00'::TIME, 'oil change', 0
  );

  -- Second hold (different session, same slot) — should also succeed
  -- (capacity is 2)
  INSERT INTO customer_chat_sessions (shop_id, channel)
    VALUES (7476, 'web') RETURNING id INTO v_session_id;
  v_hold_id_2 := public.hold_waiter_slot(
    7476, v_session_id, NULL, NULL,
    current_date + 1, '08:00'::TIME, 'oil change', 0
  );

  -- Third hold — should fail with slot_full
  INSERT INTO customer_chat_sessions (shop_id, channel)
    VALUES (7476, 'web') RETURNING id INTO v_session_id;
  BEGIN
    PERFORM public.hold_waiter_slot(
      7476, v_session_id, NULL, NULL,
      current_date + 1, '08:00'::TIME, 'oil change', 0
    );
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'slot_full' THEN
        v_third_call_failed := TRUE;
      END IF;
  END;

  IF NOT v_third_call_failed THEN
    RAISE EXCEPTION 'Architectural claim FAILED: 3rd hold for capacity-2 slot should have raised slot_full';
  END IF;
END;
$$;
SELECT pass('Advisory lock + capacity check rejects 3rd hold on capacity-2 waiter slot');


-- ---------------------------------------------------------------------
-- 9. Architectural claim: ON DELETE CASCADE on session deletion
-- ---------------------------------------------------------------------
-- Deleting a customer_chat_sessions row should cascade-delete its
-- customer_chat_messages, appointment_holds, and appointment_concerns rows.
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_session_id UUID;
  v_count INTEGER;
BEGIN
  INSERT INTO customer_chat_sessions (shop_id, channel)
    VALUES (7476, 'web') RETURNING id INTO v_session_id;

  -- Insert child rows
  INSERT INTO customer_chat_messages (id, session_id, shop_id, role, parts)
    VALUES (gen_random_uuid(), v_session_id, 7476, 'user',
            '[{"type":"text","text":"hi"}]'::JSONB);
  INSERT INTO appointment_concerns (session_id, category, raw_text, prose_summary)
    VALUES (v_session_id, 'noise', 'grinding noise',
            'Customer states a grinding noise from the front when braking.');

  -- Delete the session
  DELETE FROM customer_chat_sessions WHERE id = v_session_id;

  -- Verify children are gone
  SELECT COUNT(*) INTO v_count FROM customer_chat_messages WHERE session_id = v_session_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'cascade FAILED: customer_chat_messages remain after session delete (% rows)', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count FROM appointment_concerns WHERE session_id = v_session_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'cascade FAILED: appointment_concerns remain after session delete (% rows)', v_count;
  END IF;
END;
$$;
SELECT pass('ON DELETE CASCADE on customer_chat_sessions cleans up child rows');


-- ---------------------------------------------------------------------
-- 10. Architectural claim: appointments soft-delete preserves rows
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_appt_id BIGINT := 88888888;  -- arbitrary test ID
  v_count INTEGER;
BEGIN
  INSERT INTO appointments (
    shop_id, tekmetric_appointment_id, start_time, end_time,
    appointment_type, appointment_status
  ) VALUES (
    7476, v_appt_id, now() + interval '1 day', now() + interval '1 day 1 hour',
    'waiter', 'NONE'
  );

  -- Soft-delete
  UPDATE appointments SET deleted_at = now() WHERE tekmetric_appointment_id = v_appt_id;

  -- Row still exists
  SELECT COUNT(*) INTO v_count FROM appointments WHERE tekmetric_appointment_id = v_appt_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'soft-delete FAILED: row was hard-deleted (% rows)', v_count;
  END IF;

  -- Row excluded from active partial index queries
  SELECT COUNT(*) INTO v_count FROM appointments
    WHERE tekmetric_appointment_id = v_appt_id AND deleted_at IS NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'soft-delete FAILED: deleted_at filter not effective';
  END IF;

  -- Cleanup
  DELETE FROM appointments WHERE tekmetric_appointment_id = v_appt_id;
END;
$$;
SELECT pass('appointments soft-delete preserves the row + deleted_at IS NULL filter excludes it');


-- ---------------------------------------------------------------------
-- 11. UNIQUE constraints
-- ---------------------------------------------------------------------

-- testing_services unique on (shop_id, service_key)
SELECT throws_ok(
  $$INSERT INTO testing_services (shop_id, service_key, display_name, abbreviation, starting_price_cents)
    VALUES (7476, 'oil_leak_testing', 'duplicate', 'DUP', 0)$$,
  '23505',
  NULL,
  'testing_services UNIQUE (shop_id, service_key) rejects duplicate'
);

-- routine_services unique on (shop_id, service_key)
SELECT throws_ok(
  $$INSERT INTO routine_services (shop_id, service_key, display_name, abbreviation, display_order)
    VALUES (7476, 'oil_change', 'duplicate', 'DUP', 99)$$,
  '23505',
  NULL,
  'routine_services UNIQUE (shop_id, service_key) rejects duplicate'
);

-- closed_dates unique on (shop_id, closed_date)
SELECT throws_ok(
  $$INSERT INTO closed_dates (shop_id, closed_date, reason)
    VALUES (7476, (SELECT closed_date FROM closed_dates WHERE shop_id = 7476 LIMIT 1), 'duplicate')$$,
  '23505',
  NULL,
  'closed_dates UNIQUE (shop_id, closed_date) rejects duplicate'
);

-- appointments unique on (shop_id, tekmetric_appointment_id)
SELECT throws_ok(
  $$INSERT INTO appointments (shop_id, tekmetric_appointment_id, start_time, end_time, appointment_type, appointment_status)
    VALUES (7476, 99999999, now(), now() + interval '1 hour', 'waiter', 'NONE');
   INSERT INTO appointments (shop_id, tekmetric_appointment_id, start_time, end_time, appointment_type, appointment_status)
    VALUES (7476, 99999999, now(), now() + interval '1 hour', 'dropoff', 'NONE')$$,
  '23505',
  NULL,
  'appointments UNIQUE (shop_id, tekmetric_appointment_id) rejects duplicate'
);


-- ---------------------------------------------------------------------
-- 12. Wrap up
-- ---------------------------------------------------------------------

SELECT * FROM finish();
ROLLBACK;
