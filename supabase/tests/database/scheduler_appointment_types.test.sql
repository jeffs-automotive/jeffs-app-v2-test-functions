-- =====================================================================
-- pgTAP — scheduler_appointment_types: shape, seeds, uniques, triggers, RLS
-- =====================================================================
-- Covers 20260702031500_scheduler_appointment_types.sql (sub-feature B expand
-- step; plan docs/scheduler/config-webforms-comms-types-plan-2026-07-02.md).
-- RLS per cross-module-anchors.md: assert ROW COUNTS / error codes.
--
-- Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

-- ─── shape ───────────────────────────────────────────────────────────────
SELECT has_table('public', 'scheduler_appointment_types', 'table exists');
SELECT col_type_is('public', 'scheduler_appointment_types', 'updated_at', 'timestamp with time zone', 'updated_at is timestamptz');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.scheduler_appointment_types'::regclass),
  true, 'RLS is enabled');
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND tablename='scheduler_appointment_types'),
  0, 'zero policies (deny-all; service_role bypasses)');

-- ─── seeds ───────────────────────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.scheduler_appointment_types WHERE shop_id=7476),
  4, 'shop 7476 seeded with 4 types');
SELECT is(
  (SELECT count(*)::int FROM public.scheduler_appointment_types WHERE shop_id=7476 AND active),
  2, 'exactly waiter+dropoff active (loaner/tow_in classifiable, not bookable)');
SELECT is(
  (SELECT requires_time_slot FROM public.scheduler_appointment_types WHERE shop_id=7476 AND slug='waiter'),
  true, 'waiter is the time-slotted lane');
SELECT is(
  (SELECT label FROM public.scheduler_appointment_types WHERE shop_id=7476 AND slug='dropoff'),
  'Drop-off', 'dropoff short label matches the transcript convention');

-- ─── CHECKs ──────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$ INSERT INTO public.scheduler_appointment_types (shop_id, slug, label, card_title, tekmetric_color)
     VALUES (7476, 'Bad Slug!', 'X', 'X', 'red') $$,
  '23514', NULL, 'slug format CHECK rejects invalid slug');
SELECT throws_ok(
  $$ INSERT INTO public.scheduler_appointment_types (shop_id, slug, label, card_title, tekmetric_color)
     VALUES (7476, 'purple_type', 'X', 'X', 'purple') $$,
  '23514', NULL, 'color CHECK rejects unprobed/unknown color');
SELECT throws_ok(
  $$ INSERT INTO public.scheduler_appointment_types (shop_id, slug, label, card_title, tekmetric_color, requires_time_slot)
     VALUES (7476, 'second_waitable', 'X', 'X', 'orange', true) $$,
  '23514', NULL, 'v1 capacity CHECK: non-system rows cannot be time-slotted');

-- ─── uniques ─────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$ INSERT INTO public.scheduler_appointment_types (shop_id, slug, label, card_title, tekmetric_color)
     VALUES (7476, 'waiter', 'Dup', 'Dup', 'orange') $$,
  '23505', NULL, 'slug is unique per shop (ever, not just active)');
SELECT throws_ok(
  $$ INSERT INTO public.scheduler_appointment_types (shop_id, slug, label, card_title, tekmetric_color, active)
     VALUES (7476, 'valet', 'Valet', 'Valet service', 'red', true) $$,
  '23505', NULL, 'two ACTIVE types cannot share a color (classification channel)');
-- ...but an INACTIVE row may share a color (historical classification)
SELECT lives_ok(
  $$ INSERT INTO public.scheduler_appointment_types (shop_id, slug, label, card_title, tekmetric_color, active)
     VALUES (7476, 'valet', 'Valet', 'Valet service', 'red', false) $$,
  'inactive rows may share an active row''s color');

-- ─── protection trigger ──────────────────────────────────────────────────
SELECT throws_ok(
  $$ DELETE FROM public.scheduler_appointment_types WHERE shop_id=7476 AND slug='valet' $$,
  'P0001', NULL, 'DELETE is always refused (deactivate instead)');
SELECT throws_ok(
  $$ UPDATE public.scheduler_appointment_types SET slug='waiter2' WHERE shop_id=7476 AND slug='waiter' $$,
  'P0001', NULL, 'slug is immutable');
SELECT throws_ok(
  $$ UPDATE public.scheduler_appointment_types SET is_system=false WHERE shop_id=7476 AND slug='waiter' $$,
  'P0001', NULL, 'is_system is immutable');
SELECT throws_ok(
  $$ UPDATE public.scheduler_appointment_types SET tekmetric_color='orange' WHERE shop_id=7476 AND slug='waiter' $$,
  'P0001', NULL, 'system color is frozen');
SELECT throws_ok(
  $$ UPDATE public.scheduler_appointment_types SET active=false WHERE shop_id=7476 AND slug='dropoff' $$,
  'P0001', NULL, 'system types cannot deactivate');
SELECT lives_ok(
  $$ UPDATE public.scheduler_appointment_types SET card_description='Updated copy.' WHERE shop_id=7476 AND slug='waiter' $$,
  'system copy fields ARE editable');

-- updated_at maintenance (staleness-check substrate)
SELECT is(
  (SELECT updated_at > created_at FROM public.scheduler_appointment_types WHERE shop_id=7476 AND slug='waiter'),
  true, 'updated_at bumps on UPDATE (trigger-maintained)');

-- non-system rows: color editable, deactivate allowed
SELECT lives_ok(
  $$ UPDATE public.scheduler_appointment_types SET active=false WHERE shop_id=7476 AND slug='valet' AND active=false $$,
  'non-system rows accept updates');

-- ─── role denial ─────────────────────────────────────────────────────────
SET ROLE service_role;
SELECT lives_ok(
  $$ UPDATE public.scheduler_appointment_types SET sort=11 WHERE shop_id=7476 AND slug='waiter' $$,
  'service_role CAN UPDATE');
SELECT throws_ok(
  $$ DELETE FROM public.scheduler_appointment_types WHERE shop_id=7476 AND slug='valet' $$,
  '42501', NULL, 'service_role has no DELETE grant (belt over the trigger)');
RESET ROLE;
SET ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.scheduler_appointment_types $$, '42501', NULL, 'anon cannot SELECT');
RESET ROLE;
SET ROLE authenticated;
SELECT throws_ok($$ SELECT 1 FROM public.scheduler_appointment_types $$, '42501', NULL, 'authenticated cannot SELECT');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
