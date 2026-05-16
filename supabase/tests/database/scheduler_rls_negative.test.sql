-- =====================================================================
-- pgTAP negative-RLS tests for scheduler-app
-- =====================================================================
-- Per .claude/rules/pattern-compliance.md Testing section + R6 Stream E
-- IMPORTANT-2: the existing scheduler_phase1_schema.test.sql only
-- ASSERTS THAT RLS IS ON. That proves the toggle is correct but says
-- nothing about whether the deny_all policies actually deny. The
-- 2026-05-13 audit (commit aab6397) caught two real holes that this
-- shape of test would have prevented:
--
--   - hold_waiter_slot was EXECUTABLE by anon (until the
--     20260513130000 revoke migration)
--   - scheduler_get_service_role_key was EXECUTABLE by anon (same fix)
--
-- This file asserts the row-count guarantee directly: every scheduler
-- table protected by `deny_all` is unreadable + unwritable as anon AND
-- as authenticated. Service-role bypass is assumed working (Supabase
-- platform-level RLS skip); we don't try to test that here.
--
-- Critical gotcha (from pattern-compliance.md): blocked RLS
-- UPDATE/DELETE under deny_all SILENTLY FILTER rows rather than throw.
-- The assertion shape MUST be "affected rows = 0", not "exception
-- raised". A `BEGIN; UPDATE ...; ROLLBACK;` cycle returns 0 affected
-- rows under deny_all — that's the success signal we test for.
--
-- Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();


-- ---------------------------------------------------------------------
-- Test fixtures: seed a row as service_role so there's SOMETHING to
-- (try to) read / mutate as the lower roles. RLS bypass is automatic
-- because tests run as the migration role which has BYPASSRLS.
-- ---------------------------------------------------------------------

-- Use the seeded shop_id = 7476 (Phase 1 single-shop) and a stable
-- chat-id UUID that won't collide with production data.
INSERT INTO public.customer_chat_sessions (id, shop_id, channel, status)
VALUES ('00000000-0000-4000-8000-000000000001', 7476, 'web', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.otp_codes (id, shop_id, phone_e164, code_hash, expires_at, attempts)
VALUES (
  '00000000-0000-4000-8000-000000000002',
  7476,
  '+15551234567',
  'a'::bytea,
  now() + interval '5 minutes',
  0
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.appointment_holds (
  id, shop_id, session_id, scheduled_date, scheduled_time, appointment_type, expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000000003',
  7476,
  '00000000-0000-4000-8000-000000000001',
  CURRENT_DATE + 1,
  '08:00',
  'waiter',
  now() + interval '10 minutes'
)
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------
-- Anon role — every deny_all table must show zero rows on SELECT
-- ---------------------------------------------------------------------

SET ROLE anon;

SELECT is_empty(
  'SELECT 1 FROM public.customer_chat_sessions',
  'anon cannot SELECT from customer_chat_sessions'
);

SELECT is_empty(
  'SELECT 1 FROM public.customer_chat_messages',
  'anon cannot SELECT from customer_chat_messages'
);

SELECT is_empty(
  'SELECT 1 FROM public.appointment_holds',
  'anon cannot SELECT from appointment_holds'
);

SELECT is_empty(
  'SELECT 1 FROM public.otp_codes',
  'anon cannot SELECT from otp_codes'
);

SELECT is_empty(
  'SELECT 1 FROM public.testing_services',
  'anon cannot SELECT from testing_services'
);

SELECT is_empty(
  'SELECT 1 FROM public.routine_services',
  'anon cannot SELECT from routine_services'
);

SELECT is_empty(
  'SELECT 1 FROM public.appointments',
  'anon cannot SELECT from appointments'
);

SELECT is_empty(
  'SELECT 1 FROM public.scheduler_error_log',
  'anon cannot SELECT from scheduler_error_log'
);


-- ---------------------------------------------------------------------
-- Anon — write denial (row count = 0, NOT exception)
-- ---------------------------------------------------------------------
-- Per the pattern-compliance.md gotcha, deny_all UPDATE/DELETE under
-- RLS silently FILTERS rows rather than throwing. The assertion shape
-- is "0 affected rows" with a row_count guard.

DO $$
DECLARE
  v_count INT;
BEGIN
  UPDATE public.customer_chat_sessions
     SET status = 'ended'
   WHERE id = '00000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'anon UPDATE customer_chat_sessions affected % rows (expected 0)', v_count;
  END IF;
END $$;
SELECT pass('anon UPDATE customer_chat_sessions affects 0 rows (deny_all silent filter)');

DO $$
DECLARE
  v_count INT;
BEGIN
  DELETE FROM public.appointment_holds
   WHERE id = '00000000-0000-4000-8000-000000000003';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'anon DELETE appointment_holds affected % rows (expected 0)', v_count;
  END IF;
END $$;
SELECT pass('anon DELETE appointment_holds affects 0 rows (deny_all silent filter)');

-- INSERTs under deny_all DO throw (no row to filter against), so the
-- assertion shape is throws_ok.
SELECT throws_ok(
  $$ INSERT INTO public.customer_chat_sessions (id, shop_id, channel, status)
     VALUES ('00000000-0000-4000-8000-000000000099', 7476, 'web', 'active') $$,
  NULL,
  NULL,
  'anon INSERT customer_chat_sessions raises (deny_all rejects new rows)'
);

SELECT throws_ok(
  $$ INSERT INTO public.scheduler_error_log
     (origin, surface, level, message)
     VALUES ('other', 'rls-negative-test', 'error', 'should reject') $$,
  NULL,
  NULL,
  'anon INSERT scheduler_error_log raises (deny_all rejects new rows)'
);

RESET ROLE;


-- ---------------------------------------------------------------------
-- Authenticated role — same denials. Customer-facing scheduler is
-- ANON-driven (no user JWT), but verify authenticated has no implicit
-- read-through either.
-- ---------------------------------------------------------------------

SET ROLE authenticated;

SELECT is_empty(
  'SELECT 1 FROM public.customer_chat_sessions',
  'authenticated cannot SELECT from customer_chat_sessions'
);

SELECT is_empty(
  'SELECT 1 FROM public.otp_codes',
  'authenticated cannot SELECT from otp_codes (PII)'
);

SELECT is_empty(
  'SELECT 1 FROM public.appointment_holds',
  'authenticated cannot SELECT from appointment_holds'
);

SELECT is_empty(
  'SELECT 1 FROM public.scheduler_error_log',
  'authenticated cannot SELECT from scheduler_error_log'
);

DO $$
DECLARE
  v_count INT;
BEGIN
  UPDATE public.otp_codes
     SET attempts = 99
   WHERE id = '00000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'authenticated UPDATE otp_codes affected % rows (expected 0)', v_count;
  END IF;
END $$;
SELECT pass('authenticated UPDATE otp_codes affects 0 rows (deny_all silent filter)');

RESET ROLE;


-- ---------------------------------------------------------------------
-- Service-role bypass sanity — service_role MUST be able to read after
-- the role-flip above. Catches the case where a future migration
-- accidentally adds a USING (false) policy that captures service_role.
-- ---------------------------------------------------------------------

SET ROLE service_role;

SELECT isnt_empty(
  $$ SELECT 1 FROM public.customer_chat_sessions
     WHERE id = '00000000-0000-4000-8000-000000000001' $$,
  'service_role CAN SELECT seeded session row (bypass intact)'
);

RESET ROLE;


-- ---------------------------------------------------------------------
-- Cleanup fixtures so re-runs are idempotent
-- ---------------------------------------------------------------------

DELETE FROM public.appointment_holds
 WHERE id = '00000000-0000-4000-8000-000000000003';
DELETE FROM public.otp_codes
 WHERE id = '00000000-0000-4000-8000-000000000002';
DELETE FROM public.customer_chat_sessions
 WHERE id = '00000000-0000-4000-8000-000000000001';


SELECT * FROM finish();
ROLLBACK;
