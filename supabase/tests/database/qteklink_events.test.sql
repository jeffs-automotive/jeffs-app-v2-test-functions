-- =====================================================================
-- pgTAP — QTekLink C3 qteklink_events (whole-body dedup + append-only)
-- =====================================================================
-- Covers 20260606040000 + 050000 + 060000 (whole-body hash):
--   - table exists; RLS enabled
--   - event_hash = sha256(raw_body::text)
--   - WHOLE-BODY dedup: identical canonical body -> 23505; a body that differs in
--     ANY field -> distinct
--   - the EXACT original collision: a refund + a void BOTH classify `unknown` with
--     the SAME source_id + SAME event_time_raw (which collided under the old
--     kind|source_id|event_time hash) — now BOTH stored (bodies differ)
--   - cross-realm isolation
--   - APPEND-ONLY: service_role SELECT+INSERT; UPDATE/DELETE/TRUNCATE denied [42501]
--   - anon/authenticated cannot SELECT [42501]
--
-- Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

SELECT has_table('public', 'qteklink_events', 'qteklink_events table exists');
SELECT has_column('public', 'qteklink_events', 'event_hash', 'has generated event_hash');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='qteklink_events' AND relnamespace='public'::regnamespace), true, 'RLS enabled');

-- ─── event_hash = sha256(raw_body::text) ────────────────────────────────
INSERT INTO public.qteklink_events (shop_id, realm_id, event_kind, source_id, event_time_raw, payment_id, tekmetric_ro_id, raw_body)
VALUES (7476,'realm-A','payment_made','57840743','2026-05-09T18:54:38',57840743,318590708,
  '{"event":"Payment made by X","data":{"id":57840743,"paymentDate":"2026-05-09T18:54:38","refund":false,"voided":false}}'::jsonb);
SELECT is(
  (SELECT event_hash FROM public.qteklink_events WHERE realm_id='realm-A' AND source_id='57840743' AND event_kind='payment_made'),
  encode(extensions.digest('{"event":"Payment made by X","data":{"id":57840743,"paymentDate":"2026-05-09T18:54:38","refund":false,"voided":false}}'::jsonb::text, 'sha256'), 'hex'),
  'event_hash = sha256(raw_body::text)');

-- identical canonical body -> dedup
SELECT throws_ok(
  $$ INSERT INTO public.qteklink_events (shop_id, realm_id, event_kind, source_id, event_time_raw, payment_id, tekmetric_ro_id, raw_body)
     VALUES (7476,'realm-A','payment_made','57840743','2026-05-09T18:54:38',57840743,318590708,
       '{"event":"Payment made by X","data":{"id":57840743,"paymentDate":"2026-05-09T18:54:38","refund":false,"voided":false}}'::jsonb) $$,
  '23505', NULL, 'identical canonical body is deduped');

-- THE EXACT ORIGINAL COLLISION: refund + void, BOTH `unknown`, SAME source_id +
-- SAME event_time_raw, differing only in the body's refund/voided flags. The old
-- kind|source_id|event_time hash collided these (one lost); whole-body keeps both.
INSERT INTO public.qteklink_events (shop_id, realm_id, event_kind, source_id, event_time_raw, payment_id, tekmetric_ro_id, raw_body)
VALUES (7476,'realm-A','unknown','99001','2026-05-09T20:00:00',99001,318590708,
  '{"event":"refund/void","data":{"id":99001,"paymentDate":"2026-05-09T20:00:00","refund":true,"voided":false}}'::jsonb);
INSERT INTO public.qteklink_events (shop_id, realm_id, event_kind, source_id, event_time_raw, payment_id, tekmetric_ro_id, raw_body)
VALUES (7476,'realm-A','unknown','99001','2026-05-09T20:00:00',99001,318590708,
  '{"event":"refund/void","data":{"id":99001,"paymentDate":"2026-05-09T20:00:00","refund":false,"voided":true}}'::jsonb);
SELECT is((SELECT count(*)::int FROM public.qteklink_events WHERE realm_id='realm-A' AND payment_id=99001),
  2, 'refund + void (same unknown kind/source_id/event_time, different body) BOTH stored — collision fixed');

-- cross-realm isolation: same body under a different realm -> separate row
INSERT INTO public.qteklink_events (shop_id, realm_id, event_kind, source_id, event_time_raw, payment_id, tekmetric_ro_id, raw_body)
VALUES (7476,'realm-B','payment_made','57840743','2026-05-09T18:54:38',57840743,318590708,
  '{"event":"Payment made by X","data":{"id":57840743,"paymentDate":"2026-05-09T18:54:38","refund":false,"voided":false}}'::jsonb);
SELECT is((SELECT count(*)::int FROM public.qteklink_events WHERE source_id='57840743' AND event_kind='payment_made'),
  2, 'same body under realm-A + realm-B = 2 rows (cross-realm isolation)');

-- ─── APPEND-ONLY: service_role SELECT + INSERT, no UPDATE/DELETE/TRUNCATE ─
SET ROLE service_role;
SELECT lives_ok(
  $$ INSERT INTO public.qteklink_events (shop_id, realm_id, event_kind, source_id, raw_body)
     VALUES (7476,'realm-A','ro_posted','999','{"event":"posted","data":{"id":999}}'::jsonb) $$,
  'service_role CAN INSERT');
SELECT throws_ok($$ UPDATE public.qteklink_events SET event_kind='x' WHERE source_id='999' $$, '42501', NULL, 'service_role CANNOT UPDATE');
SELECT throws_ok($$ DELETE FROM public.qteklink_events WHERE source_id='999' $$, '42501', NULL, 'service_role CANNOT DELETE');
SELECT throws_ok($$ TRUNCATE public.qteklink_events $$, '42501', NULL, 'service_role CANNOT TRUNCATE');
RESET ROLE;

-- ─── anon / authenticated denied ────────────────────────────────────────
SET ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_events $$, '42501', NULL, 'anon cannot SELECT');
RESET ROLE;
SET ROLE authenticated;
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_events $$, '42501', NULL, 'authenticated cannot SELECT');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
