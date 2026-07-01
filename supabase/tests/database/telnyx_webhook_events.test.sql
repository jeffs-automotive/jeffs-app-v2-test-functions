-- =====================================================================
-- pgTAP — telnyx_webhook_events: shape, dedup, deny-all RLS, append-only
-- =====================================================================
-- Covers 20260701232000_telnyx_webhook_events.sql.
--
-- RLS testing per cross-module-anchors.md: assert ROW COUNTS / error codes,
-- not exceptions-from-RLS (a blocked RLS UPDATE/DELETE silently filters).
-- Here anon/authenticated have NO grants at all → 42501, and service_role
-- is append-only → 42501 on UPDATE/DELETE/TRUNCATE.
--
-- Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

-- ─── shape ───────────────────────────────────────────────────────────────
SELECT has_table('public', 'telnyx_webhook_events', 'table exists');
SELECT has_column('public', 'telnyx_webhook_events', 'telnyx_event_id', 'has telnyx_event_id');
SELECT has_column('public', 'telnyx_webhook_events', 'event_type', 'has event_type');
SELECT has_column('public', 'telnyx_webhook_events', 'signature_verified', 'has signature_verified');
SELECT has_column('public', 'telnyx_webhook_events', 'payload', 'has payload');
SELECT col_type_is('public', 'telnyx_webhook_events', 'occurred_at', 'timestamp with time zone', 'occurred_at is timestamptz');
SELECT col_type_is('public', 'telnyx_webhook_events', 'received_at', 'timestamp with time zone', 'received_at is timestamptz');

-- RLS enabled (deny-all: zero policies)
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.telnyx_webhook_events'::regclass),
  true, 'RLS is enabled');
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND tablename='telnyx_webhook_events'),
  0, 'zero policies (deny-all; service_role bypasses RLS)');

-- ─── dedup on telnyx_event_id ────────────────────────────────────────────
INSERT INTO public.telnyx_webhook_events (telnyx_event_id, event_type, payload)
VALUES ('evt-aaaa-1111', 'message.received', '{"data":{"id":"evt-aaaa-1111","event_type":"message.received"}}'::jsonb);

-- Telnyx retry (same data.id) → 23505
SELECT throws_ok(
  $$ INSERT INTO public.telnyx_webhook_events (telnyx_event_id, event_type, payload)
     VALUES ('evt-aaaa-1111', 'message.received', '{"data":{"id":"evt-aaaa-1111","event_type":"message.received"}}'::jsonb) $$,
  '23505', NULL, 'redelivery of the same telnyx_event_id is deduped');

-- Distinct event id → stored
INSERT INTO public.telnyx_webhook_events (telnyx_event_id, event_type, payload)
VALUES ('evt-bbbb-2222', 'message.finalized', '{"data":{"id":"evt-bbbb-2222"}}'::jsonb);
SELECT is(
  (SELECT count(*)::int FROM public.telnyx_webhook_events WHERE telnyx_event_id LIKE 'evt-%'),
  2, 'distinct event ids both stored');

-- NULL event id rows are exempt from the partial unique index (unknown shapes
-- are stored for diagnosis, undeduped)
INSERT INTO public.telnyx_webhook_events (telnyx_event_id, event_type, payload)
VALUES (NULL, 'unknown', '{"weird":true}'::jsonb);
INSERT INTO public.telnyx_webhook_events (telnyx_event_id, event_type, payload)
VALUES (NULL, 'unknown', '{"weird":true}'::jsonb);
SELECT is(
  (SELECT count(*)::int FROM public.telnyx_webhook_events WHERE telnyx_event_id IS NULL),
  2, 'NULL-id rows are exempt from dedup (both stored)');

-- ─── append-only: service_role INSERT+SELECT, no UPDATE/DELETE/TRUNCATE ──
SET ROLE service_role;
SELECT lives_ok(
  $$ INSERT INTO public.telnyx_webhook_events (telnyx_event_id, event_type, payload)
     VALUES ('evt-cccc-3333', 'campaign.suspended', '{"data":{"id":"evt-cccc-3333"}}'::jsonb) $$,
  'service_role CAN INSERT');
SELECT is(
  (SELECT count(*)::int FROM public.telnyx_webhook_events WHERE telnyx_event_id='evt-cccc-3333'),
  1, 'service_role CAN SELECT');
SELECT throws_ok($$ UPDATE public.telnyx_webhook_events SET event_type='x' WHERE telnyx_event_id='evt-cccc-3333' $$, '42501', NULL, 'service_role CANNOT UPDATE (append-only)');
SELECT throws_ok($$ DELETE FROM public.telnyx_webhook_events WHERE telnyx_event_id='evt-cccc-3333' $$, '42501', NULL, 'service_role CANNOT DELETE (append-only)');
SELECT throws_ok($$ TRUNCATE public.telnyx_webhook_events $$, '42501', NULL, 'service_role CANNOT TRUNCATE (append-only)');
RESET ROLE;

-- ─── anon / authenticated denied entirely ────────────────────────────────
SET ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.telnyx_webhook_events $$, '42501', NULL, 'anon cannot SELECT');
SELECT throws_ok(
  $$ INSERT INTO public.telnyx_webhook_events (event_type, payload) VALUES ('x', '{}'::jsonb) $$,
  '42501', NULL, 'anon cannot INSERT');
RESET ROLE;
SET ROLE authenticated;
SELECT throws_ok($$ SELECT 1 FROM public.telnyx_webhook_events $$, '42501', NULL, 'authenticated cannot SELECT');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
