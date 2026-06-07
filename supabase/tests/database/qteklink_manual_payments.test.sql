-- =====================================================================
-- pgTAP — QTekLink C6 qteklink_manual_payments (method-pick storage)
-- =====================================================================
-- Covers 20260607050000 (table + SECURITY DEFINER upsert RPC + RLS) +
-- 20260607060000 (the default-privileges REVOKE):
--   - table + RPC exist; RLS enabled
--   - least-privilege GRANT MATRIX: service_role SELECT-only (NO INSERT/UPDATE/
--     DELETE — writes go through the definer RPC); service_role EXECUTE the RPC;
--     anon denied SELECT + EXECUTE
--   - ONE pick per RO: re-classifying the same RO REPLACES (upsert), never forks
--   - validation: negative amount / blank method / non-positive shop all P0001
--   - composite FK: a pick for an unbound (shop,realm) is rejected [23503]
--
-- Runs as the BYPASSRLS migration role. Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

-- ─── Existence + RLS ────────────────────────────────────────────────────
SELECT has_table('public', 'qteklink_manual_payments', 'qteklink_manual_payments table exists');
SELECT has_function('public', 'qteklink_record_manual_payment',
  ARRAY['integer','text','bigint','text','text','bigint','bigint','timestamp with time zone','text'],
  'qteklink_record_manual_payment RPC exists');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='qteklink_manual_payments' AND relnamespace='public'::regnamespace), true, 'RLS on qteklink_manual_payments');

-- ─── Least-privilege grant matrix (post-REVOKE) ─────────────────────────
SELECT ok(has_table_privilege('service_role','public.qteklink_manual_payments','SELECT'), 'service_role CAN SELECT (DAL read)');
SELECT ok(NOT has_table_privilege('service_role','public.qteklink_manual_payments','INSERT'), 'service_role NO INSERT (writes via definer RPC)');
SELECT ok(NOT has_table_privilege('service_role','public.qteklink_manual_payments','UPDATE'), 'service_role NO UPDATE');
SELECT ok(NOT has_table_privilege('service_role','public.qteklink_manual_payments','DELETE'), 'service_role NO DELETE');
SELECT ok(has_function_privilege('service_role','public.qteklink_record_manual_payment(integer,text,bigint,text,text,bigint,bigint,timestamptz,text)','EXECUTE'), 'service_role CAN EXECUTE the RPC');
SELECT ok(NOT has_function_privilege('anon','public.qteklink_record_manual_payment(integer,text,bigint,text,text,bigint,bigint,timestamptz,text)','EXECUTE'), 'anon CANNOT EXECUTE the RPC');

-- ─── Seed a connection (the FK target) ──────────────────────────────────
INSERT INTO public.qbo_connections (realm_id, shop_id, access_token_expires_at, refresh_token_expires_at)
VALUES ('realm-A', 7476, now() + interval '1 hour', now() + interval '100 days');

-- ─── ONE pick per RO: re-classify REPLACES (upsert) ─────────────────────
SELECT isnt(public.qteklink_record_manual_payment(7476,'realm-A',326283459,'Credit Card',NULL,22510,573,'2026-05-11T13:12:42Z'::timestamptz,'chris@x.com'), NULL, 'record a card pick ok');
SELECT isnt(public.qteklink_record_manual_payment(7476,'realm-A',326283459,'Cash',NULL,22510,0,'2026-05-11T13:12:42Z'::timestamptz,'chris@x.com'), NULL, 're-classify the SAME RO ok');
SELECT is((SELECT count(*)::int FROM public.qteklink_manual_payments WHERE shop_id=7476 AND repair_order_id=326283459), 1, 'exactly one pick per RO (upsert replaced, no fork)');
SELECT is((SELECT method FROM public.qteklink_manual_payments WHERE shop_id=7476 AND repair_order_id=326283459), 'Cash', 're-classify replaced method -> Cash');

-- ─── Validation (RPC RAISEs P0001) ──────────────────────────────────────
SELECT throws_ok($$ SELECT public.qteklink_record_manual_payment(7476,'realm-A',1,'Cash',NULL,-5,0,now(),'x@y.com') $$, 'P0001', NULL, 'negative amount rejected');
SELECT throws_ok($$ SELECT public.qteklink_record_manual_payment(7476,'realm-A',1,'   ',NULL,5,0,now(),'x@y.com') $$, 'P0001', NULL, 'blank method rejected');
SELECT throws_ok($$ SELECT public.qteklink_record_manual_payment(0,'realm-A',1,'Cash',NULL,5,0,now(),'x@y.com') $$, 'P0001', NULL, 'non-positive shop rejected');

-- ─── Composite FK: a pick for an unbound (shop,realm) is rejected ────────
SELECT throws_ok($$ SELECT public.qteklink_record_manual_payment(9999,'no-conn',1,'Cash',NULL,5,0,now(),'x@y.com') $$, '23503', NULL, 'pick for an unbound shop/realm is FK-rejected');

-- ─── SECURITY: anon denied SELECT + EXECUTE ─────────────────────────────
SET ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_manual_payments $$, '42501', NULL, 'anon cannot SELECT qteklink_manual_payments');
SELECT throws_ok($$ SELECT public.qteklink_record_manual_payment(7476,'realm-A',1,'Cash',NULL,5,0,now(),'x@y.com') $$, '42501', NULL, 'anon cannot EXECUTE the RPC');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
