-- =====================================================================
-- pgTAP — scheduler admin direct-write RPCs + message templates
-- =====================================================================
-- Covers 20260702041000 + 20260702042000 (sub-features A + C foundation).
-- Focus: config-write + audit-row ATOMICITY, stale-write rejection,
-- template one-active/fallback resolution, cross-shop template FK guard.
--
-- Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

-- ─── routine service upsert: insert + audit row in one transaction ────────
SELECT lives_ok(
  $$ SELECT public.scheduler_admin_upsert_routine_service(7476, 'tap@jeffsautomotive.com',
       '{"service_key":"tap_probe","display_name":"TAP Probe","abbreviation":"TAPP","display_order":98,"active":true}'::jsonb) $$,
  'routine upsert (insert) succeeds');
SELECT is(
  (SELECT count(*)::int FROM public.scheduler_admin_audit_log
    WHERE shop_id=7476 AND oauth_client_id='admin_app_direct'
      AND table_name='routine_services' AND operation='manual_change'),
  1, 'audit row written atomically with the insert');
SELECT is(
  (SELECT diff_summary->'surfaces'->>0 FROM public.scheduler_admin_audit_log
    WHERE table_name='routine_services' AND oauth_client_id='admin_app_direct'
    ORDER BY id DESC LIMIT 1),
  'routine_services', 'audit diff_summary carries the ADR-021 surface tag');

-- update path + stale-write rejection
SELECT lives_ok(
  $$ SELECT public.scheduler_admin_upsert_routine_service(7476, 'tap@jeffsautomotive.com',
       '{"service_key":"tap_probe","display_name":"TAP Probe v2"}'::jsonb,
       (SELECT updated_at FROM public.routine_services WHERE shop_id=7476 AND service_key='tap_probe')) $$,
  'update with CURRENT updated_at token succeeds');
SELECT throws_ok(
  $$ SELECT public.scheduler_admin_upsert_routine_service(7476, 'tap@jeffsautomotive.com',
       '{"service_key":"tap_probe","display_name":"TAP Probe v3"}'::jsonb,
       '2020-01-01T00:00:00Z'::timestamptz) $$,
  'P0001', NULL, 'STALE updated_at token is rejected (optimistic concurrency)');

-- ─── closed dates: add + duplicate + remove ────────────────────────────────
SELECT lives_ok(
  $$ SELECT public.scheduler_admin_add_closed_date(7476, 'tap@jeffsautomotive.com', '2099-12-30', 'TAP holiday') $$,
  'closed date add succeeds');
SELECT throws_ok(
  $$ SELECT public.scheduler_admin_add_closed_date(7476, 'tap@jeffsautomotive.com', '2099-12-30', 'again') $$,
  'P0001', NULL, 'duplicate closed date rejected');
SELECT lives_ok(
  $$ SELECT public.scheduler_admin_remove_closed_date(7476, 'tap@jeffsautomotive.com', '2099-12-30') $$,
  'closed date remove succeeds');
SELECT is(
  (SELECT count(*)::int FROM public.scheduler_admin_audit_log
    WHERE table_name='closed_dates' AND oauth_client_id='admin_app_direct'),
  2, 'both closed-date ops audited');

-- ─── appointment type RPC: activation color gate ──────────────────────────
-- 2026-07-02: yellow was WRITE-PROBED (appointment 65743262 → #FCB70D) and
-- joined the verified set — activation now succeeds. The gate itself is
-- still exercised: the table CHECK constrains colors to the classifier
-- vocabulary, and the RPC's v_probed array guards any future addition.
SELECT lives_ok(
  $$ SELECT public.scheduler_set_appointment_type(7476, 'tap@jeffsautomotive.com',
       '{"slug":"tap_yellow2","label":"TapY","tekmetric_color":"yellow","active":true,"sort":97}'::jsonb) $$,
  'ACTIVATING a yellow type (probe-verified 2026-07-02) succeeds');
SELECT lives_ok(
  $$ SELECT public.scheduler_set_appointment_type(7476, 'tap@jeffsautomotive.com',
       '{"slug":"tap_orange","label":"TapO","tekmetric_color":"orange","active":true}'::jsonb) $$,
  'activating a probe-verified color succeeds');
SELECT is(
  (SELECT requires_time_slot FROM public.scheduler_appointment_types WHERE shop_id=7476 AND slug='tap_orange'),
  false, 'custom types are never time-slotted (v1 capacity rule)');

-- ─── message templates: one-active replace + fallback resolution ──────────
SELECT lives_ok(
  $$ SELECT public.scheduler_set_message_template(7476, 'tap@jeffsautomotive.com',
       NULL, 'confirmation', 'sms', NULL,
       'Jeff''s Automotive: v2 body {{appointment_date}}. Reply STOP to opt out.') $$,
  'shop-default template replace succeeds');
SELECT is(
  (SELECT count(*)::int FROM public.scheduler_message_templates
    WHERE shop_id=7476 AND kind='confirmation' AND channel='sms' AND type_id IS NULL AND active),
  1, 'one-active invariant: replaced, not forked');
SELECT is(
  (SELECT count(*)::int FROM public.scheduler_message_templates
    WHERE shop_id=7476 AND kind='confirmation' AND channel='sms' AND type_id IS NULL AND NOT active),
  1, 'history row kept (active=false)');

-- type-specific override wins resolution; default fills the gap
SELECT lives_ok(
  $$ SELECT public.scheduler_set_message_template(7476, 'tap@jeffsautomotive.com',
       (SELECT id FROM public.scheduler_appointment_types WHERE shop_id=7476 AND slug='waiter'),
       'confirmation', 'sms', NULL,
       'Jeff''s Automotive: waiter-specific body. Reply STOP to opt out.') $$,
  'type-specific template saves');
SELECT is(
  (SELECT body FROM public.scheduler_message_templates
    WHERE shop_id=7476 AND kind='confirmation' AND channel='sms' AND active
      AND (type_id = (SELECT id FROM public.scheduler_appointment_types WHERE shop_id=7476 AND slug='waiter') OR type_id IS NULL)
    ORDER BY type_id NULLS LAST LIMIT 1),
  'Jeff''s Automotive: waiter-specific body. Reply STOP to opt out.',
  'resolution rule: type-specific wins over shop default');
SELECT is(
  (SELECT body FROM public.scheduler_message_templates
    WHERE shop_id=7476 AND kind='reminder_24h' AND channel='sms' AND active
      AND (type_id = (SELECT id FROM public.scheduler_appointment_types WHERE shop_id=7476 AND slug='waiter') OR type_id IS NULL)
    ORDER BY type_id NULLS LAST LIMIT 1) LIKE 'Jeff''s Automotive: Reminder%',
  true, 'resolution rule: shop default fills kinds with no override');

-- email/SMS field invariants
SELECT throws_ok(
  $$ INSERT INTO public.scheduler_message_templates (shop_id, kind, channel, subject, body)
     VALUES (7476, 'confirmation', 'email', NULL, 'body without subject') $$,
  '23514', NULL, 'email template without subject rejected');
SELECT throws_ok(
  $$ INSERT INTO public.scheduler_message_templates (shop_id, kind, channel, subject, body)
     VALUES (7476, 'confirmation', 'sms', 'Nope', 'sms with subject') $$,
  '23514', NULL, 'SMS template with subject rejected');

-- cross-shop FK guard: a template cannot point at another shop's type
SELECT throws_ok(
  $$ INSERT INTO public.scheduler_message_templates (shop_id, type_id, kind, channel, subject, body)
     VALUES (9999,
             (SELECT id FROM public.scheduler_appointment_types WHERE shop_id=7476 AND slug='waiter'),
             'confirmation', 'sms', NULL, 'cross-shop probe') $$,
  '23503', NULL, 'composite FK rejects a template referencing another shop''s type');

-- anon/authenticated denial
SET ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.scheduler_message_templates $$, '42501', NULL, 'anon cannot SELECT templates');
SELECT throws_ok(
  $$ SELECT public.scheduler_admin_upsert_routine_service(7476, 'x', '{"service_key":"nope"}'::jsonb) $$,
  '42501', NULL, 'anon cannot execute the write RPCs');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
