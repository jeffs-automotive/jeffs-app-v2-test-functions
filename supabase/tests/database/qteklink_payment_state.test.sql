-- =====================================================================
-- pgTAP — QTekLink C4 qteklink_payment_state (reducer projection + RPC)
-- =====================================================================
-- Covers 20260606070000_qteklink_payment_state.sql:
--   - table exists; RLS enabled
--   - qteklink_upsert_payment_state: insert + idempotent re-upsert on the
--     (shop, realm, payment_id) key; a void-flip UPDATES the row in place
--   - cross-shop + cross-realm isolation (ROW COUNTS — same payment_id under a
--     different shop/realm is a SEPARATE row)
--   - status CHECK + voided/voided_at consistency CHECK reject bad rows
--   - least privilege: service_role SELECT only (direct INSERT/UPDATE/DELETE
--     denied [42501]); writes succeed ONLY through the SECURITY DEFINER RPC
--   - anon / authenticated cannot SELECT [42501]
--   - RPC input validation (non-array p_states, non-positive shop)
--
-- Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

SELECT has_table('public', 'qteklink_payment_state', 'qteklink_payment_state table exists');
SELECT has_column('public', 'qteklink_payment_state', 'signed_amount_cents', 'has signed_amount_cents');
SELECT has_column('public', 'qteklink_payment_state', 'reduced_from_event_ids', 'has reduced_from_event_ids');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='qteklink_payment_state' AND relnamespace='public'::regnamespace), true, 'RLS enabled');

-- ─── RPC upsert: insert a SUCCEEDED state ───────────────────────────────────
SELECT is(
  (SELECT public.qteklink_upsert_payment_state(7476, 'realm-A',
    $json$[{"payment_id":5001,"signed_amount_cents":11202,"signed_processing_fee_cents":290,
            "status":"succeeded","is_refund":false,"payment_type":"CC","other_payment_type":null,
            "payment_date":"2026-05-28T14:47:22Z","voided_at":null,"repair_order_id":330902500,
            "latest_event_at":"2026-05-28T14:47:22Z",
            "reduced_from_event_ids":["11111111-1111-1111-1111-111111111111"]}]$json$::jsonb)),
  1, 'RPC upserts 1 succeeded state');
SELECT is((SELECT status FROM public.qteklink_payment_state WHERE shop_id=7476 AND realm_id='realm-A' AND payment_id=5001),
  'succeeded', 'state row is succeeded');
SELECT is((SELECT signed_amount_cents FROM public.qteklink_payment_state WHERE shop_id=7476 AND realm_id='realm-A' AND payment_id=5001),
  11202::bigint, 'signed_amount_cents stored');
SELECT is((SELECT array_length(reduced_from_event_ids,1) FROM public.qteklink_payment_state WHERE shop_id=7476 AND realm_id='realm-A' AND payment_id=5001),
  1, 'reduced_from_event_ids stored as uuid[]');

-- ─── RPC re-upsert SAME payment_id flips to VOIDED in place (idempotent key) ─
SELECT is(
  (SELECT public.qteklink_upsert_payment_state(7476, 'realm-A',
    $json$[{"payment_id":5001,"signed_amount_cents":11202,"signed_processing_fee_cents":290,
            "status":"voided","is_refund":false,"payment_type":"CC","other_payment_type":null,
            "payment_date":"2026-05-28T14:47:22Z","voided_at":"2026-05-28T14:47:22Z","repair_order_id":330902500,
            "latest_event_at":"2026-05-28T14:47:22Z",
            "reduced_from_event_ids":["11111111-1111-1111-1111-111111111111","22222222-2222-2222-2222-222222222222"]}]$json$::jsonb)),
  1, 'RPC re-upsert affects 1 row');
SELECT is((SELECT count(*)::int FROM public.qteklink_payment_state WHERE shop_id=7476 AND realm_id='realm-A' AND payment_id=5001),
  1, 'still ONE row for (shop,realm,payment_id) — UNIQUE upsert, not a duplicate');
SELECT is((SELECT status FROM public.qteklink_payment_state WHERE shop_id=7476 AND realm_id='realm-A' AND payment_id=5001),
  'voided', 'void flips status in place');
SELECT ok((SELECT voided_at IS NOT NULL FROM public.qteklink_payment_state WHERE shop_id=7476 AND realm_id='realm-A' AND payment_id=5001),
  'voided row carries voided_at');
SELECT is((SELECT array_length(reduced_from_event_ids,1) FROM public.qteklink_payment_state WHERE shop_id=7476 AND realm_id='realm-A' AND payment_id=5001),
  2, 'reduced_from_event_ids updated to both source events');

-- ─── cross-shop + cross-realm isolation (same payment_id, ROW COUNTS) ────────
SELECT public.qteklink_upsert_payment_state(7476, 'realm-B',
  $json$[{"payment_id":5001,"signed_amount_cents":900,"status":"succeeded","reduced_from_event_ids":["33333333-3333-3333-3333-333333333333"]}]$json$::jsonb);
SELECT public.qteklink_upsert_payment_state(7477, 'realm-A',
  $json$[{"payment_id":5001,"signed_amount_cents":700,"status":"succeeded","reduced_from_event_ids":["44444444-4444-4444-4444-444444444444"]}]$json$::jsonb);
SELECT is((SELECT count(*)::int FROM public.qteklink_payment_state WHERE payment_id=5001),
  3, 'same payment_id under (7476,realm-A)+(7476,realm-B)+(7477,realm-A) = 3 rows (shop+realm in identity)');

-- ─── MONOTONIC upsert: a stale snapshot must NOT overwrite a newer one ───────
-- (concurrent reducers read snapshots before the lock; the older one could land
--  last — the latest_event_at guard makes the newest-observed snapshot win.)
SELECT public.qteklink_upsert_payment_state(7476,'realm-A',
  $json$[{"payment_id":5002,"signed_amount_cents":7000,"status":"voided","voided_at":"2026-05-20T12:00:05Z",
          "latest_event_at":"2026-05-20T12:00:05Z","reduced_from_event_ids":["66666666-6666-6666-6666-666666666666"]}]$json$::jsonb);
SELECT is(
  (SELECT public.qteklink_upsert_payment_state(7476,'realm-A',
    $json$[{"payment_id":5002,"signed_amount_cents":7000,"status":"succeeded",
            "latest_event_at":"2026-05-20T12:00:00Z","reduced_from_event_ids":["77777777-7777-7777-7777-777777777777"]}]$json$::jsonb)),
  0, 'a STALE (older latest_event_at) upsert is a no-op (0 rows affected)');
SELECT is((SELECT status FROM public.qteklink_payment_state WHERE shop_id=7476 AND realm_id='realm-A' AND payment_id=5002),
  'voided', 'the newer voided state is preserved against the stale succeeded upsert');
SELECT is(
  (SELECT public.qteklink_upsert_payment_state(7476,'realm-A',
    $json$[{"payment_id":5002,"signed_amount_cents":7000,"status":"voided","voided_at":"2026-05-20T12:00:05Z",
            "latest_event_at":"2026-05-21T09:00:00Z","reduced_from_event_ids":["66666666-6666-6666-6666-666666666666","88888888-8888-8888-8888-888888888888"]}]$json$::jsonb)),
  1, 'a NEWER (later latest_event_at) upsert DOES apply (1 row)');

-- ─── CHECK constraints reject bad rows (direct insert as owner) ──────────────
SELECT throws_ok(
  $$ INSERT INTO public.qteklink_payment_state (shop_id, realm_id, payment_id, signed_amount_cents, status)
     VALUES (7476,'realm-A',6001,100,'bogus') $$,
  '23514', NULL, 'status CHECK rejects an unknown status');
SELECT throws_ok(
  $$ INSERT INTO public.qteklink_payment_state (shop_id, realm_id, payment_id, signed_amount_cents, status, voided_at)
     VALUES (7476,'realm-A',6002,100,'voided',NULL) $$,
  '23514', NULL, 'voided status requires a voided_at');
SELECT throws_ok(
  $$ INSERT INTO public.qteklink_payment_state (shop_id, realm_id, payment_id, signed_amount_cents, status, voided_at)
     VALUES (7476,'realm-A',6003,100,'succeeded', now()) $$,
  '23514', NULL, 'succeeded status forbids a voided_at');
SELECT throws_ok(
  $$ INSERT INTO public.qteklink_payment_state (shop_id, realm_id, payment_id, signed_amount_cents, status)
     VALUES (7476,'realm-A',-1,100,'succeeded') $$,
  '23514', NULL, 'payment_id must be positive');
SELECT throws_ok(
  $$ INSERT INTO public.qteklink_payment_state (shop_id, realm_id, payment_id, signed_amount_cents, signed_processing_fee_cents, status)
     VALUES (7476,'realm-A',6004,100,-5,'succeeded') $$,
  '23514', NULL, 'signed_processing_fee_cents must be >= 0');

-- ─── RPC input validation ───────────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT public.qteklink_upsert_payment_state(7476,'realm-A','{"not":"an array"}'::jsonb) $$,
  'P0001', NULL, 'RPC rejects a non-array p_states');
SELECT throws_ok(
  $$ SELECT public.qteklink_upsert_payment_state(0,'realm-A','[]'::jsonb) $$,
  'P0001', NULL, 'RPC rejects a non-positive shop_id');

-- ─── least privilege: service_role SELECT only; writes via the definer RPC ───
SET ROLE service_role;
SELECT lives_ok($$ SELECT 1 FROM public.qteklink_payment_state $$, 'service_role CAN SELECT');
SELECT lives_ok(
  $$ SELECT public.qteklink_upsert_payment_state(7476,'realm-A',
       $json$[{"payment_id":7001,"signed_amount_cents":500,"status":"succeeded","reduced_from_event_ids":["55555555-5555-5555-5555-555555555555"]}]$json$::jsonb) $$,
  'service_role CAN write THROUGH the SECURITY DEFINER RPC');
SELECT throws_ok(
  $$ INSERT INTO public.qteklink_payment_state (shop_id, realm_id, payment_id, signed_amount_cents, status)
     VALUES (7476,'realm-A',7002,1,'succeeded') $$,
  '42501', NULL, 'service_role CANNOT INSERT directly');
SELECT throws_ok($$ UPDATE public.qteklink_payment_state SET signed_amount_cents=0 WHERE payment_id=5001 $$,
  '42501', NULL, 'service_role CANNOT UPDATE directly');
SELECT throws_ok($$ DELETE FROM public.qteklink_payment_state WHERE payment_id=5001 $$,
  '42501', NULL, 'service_role CANNOT DELETE directly');
RESET ROLE;

-- ─── anon / authenticated denied ────────────────────────────────────────────
SET ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_payment_state $$, '42501', NULL, 'anon cannot SELECT');
-- The write path is the SECURITY DEFINER RPC — anon must not be able to EXECUTE it.
SELECT throws_ok(
  $$ SELECT public.qteklink_upsert_payment_state(7476,'realm-A','[]'::jsonb) $$,
  '42501', NULL, 'anon cannot EXECUTE the upsert RPC');
RESET ROLE;
SET ROLE authenticated;
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_payment_state $$, '42501', NULL, 'authenticated cannot SELECT');
SELECT throws_ok(
  $$ SELECT public.qteklink_upsert_payment_state(7476,'realm-A','[]'::jsonb) $$,
  '42501', NULL, 'authenticated cannot EXECUTE the upsert RPC');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
