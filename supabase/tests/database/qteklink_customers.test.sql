-- =====================================================================
-- pgTAP — QTekLink qteklink_customers (Tekmetric customer-name cache + RPC)
-- =====================================================================
-- Covers 20260616190000_qteklink_customers.sql:
--   - table exists; RLS enabled
--   - qteklink_upsert_customers: insert + idempotent re-upsert on the
--     (shop_id, tekmetric_customer_id) key (a re-fetch UPDATES the name in place)
--   - cross-shop isolation (ROW COUNTS — same customer id under a different shop
--     is a SEPARATE row)
--   - CHECK constraints reject a non-positive shop / customer id
--   - least privilege: service_role SELECT only (direct INSERT/UPDATE/DELETE
--     denied [42501]); writes succeed ONLY through the SECURITY DEFINER RPC
--   - anon / authenticated cannot SELECT or EXECUTE the RPC [42501]
--   - RPC input validation (non-array p_customers, non-positive shop)
--
-- Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

SELECT has_table('public', 'qteklink_customers', 'qteklink_customers table exists');
SELECT has_column('public', 'qteklink_customers', 'display_name', 'has display_name');
SELECT has_column('public', 'qteklink_customers', 'tekmetric_customer_id', 'has tekmetric_customer_id');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='qteklink_customers' AND relnamespace='public'::regnamespace), true, 'RLS enabled');

-- ─── RPC upsert: insert one customer ────────────────────────────────────────
SELECT is(
  (SELECT public.qteklink_upsert_customers(7476,
    $json$[{"tekmetric_customer_id":44695835,"display_name":"John Smith","first_name":"John","last_name":"Smith"}]$json$::jsonb)),
  1, 'RPC upserts 1 customer');
SELECT is((SELECT display_name FROM public.qteklink_customers WHERE shop_id=7476 AND tekmetric_customer_id=44695835),
  'John Smith', 'display_name stored');

-- ─── re-upsert SAME id UPDATES the name in place (idempotent key) ────────────
SELECT is(
  (SELECT public.qteklink_upsert_customers(7476,
    $json$[{"tekmetric_customer_id":44695835,"display_name":"Carmax","first_name":"Carmax","last_name":null}]$json$::jsonb)),
  1, 'RPC re-upsert affects 1 row');
SELECT is((SELECT count(*)::int FROM public.qteklink_customers WHERE shop_id=7476 AND tekmetric_customer_id=44695835),
  1, 'still ONE row for (shop, customer) — UNIQUE upsert, not a duplicate');
SELECT is((SELECT display_name FROM public.qteklink_customers WHERE shop_id=7476 AND tekmetric_customer_id=44695835),
  'Carmax', 're-fetch updates the name in place');

-- ─── cross-shop isolation (same customer id, ROW COUNTS) ────────────────────
SELECT public.qteklink_upsert_customers(7477,
  $json$[{"tekmetric_customer_id":44695835,"display_name":"Other Shop Cust"}]$json$::jsonb);
SELECT is((SELECT count(*)::int FROM public.qteklink_customers WHERE tekmetric_customer_id=44695835),
  2, 'same customer id under shop 7476 + 7477 = 2 rows (shop_id in identity)');

-- ─── CHECK constraints reject bad rows (direct insert as owner) ─────────────
SELECT throws_ok(
  $$ INSERT INTO public.qteklink_customers (shop_id, tekmetric_customer_id) VALUES (0, 1) $$,
  '23514', NULL, 'shop_id must be positive');
SELECT throws_ok(
  $$ INSERT INTO public.qteklink_customers (shop_id, tekmetric_customer_id) VALUES (7476, -1) $$,
  '23514', NULL, 'tekmetric_customer_id must be positive');

-- ─── RPC input validation ───────────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT public.qteklink_upsert_customers(7476,'{"not":"an array"}'::jsonb) $$,
  'P0001', NULL, 'RPC rejects a non-array p_customers');
SELECT throws_ok(
  $$ SELECT public.qteklink_upsert_customers(0,'[]'::jsonb) $$,
  'P0001', NULL, 'RPC rejects a non-positive shop_id');

-- ─── least privilege: service_role SELECT only; writes via the definer RPC ───
SET ROLE service_role;
SELECT lives_ok($$ SELECT 1 FROM public.qteklink_customers $$, 'service_role CAN SELECT');
SELECT lives_ok(
  $$ SELECT public.qteklink_upsert_customers(7476,
       $json$[{"tekmetric_customer_id":7001,"display_name":"RPC Write"}]$json$::jsonb) $$,
  'service_role CAN write THROUGH the SECURITY DEFINER RPC');
SELECT throws_ok(
  $$ INSERT INTO public.qteklink_customers (shop_id, tekmetric_customer_id, display_name)
     VALUES (7476, 7002, 'x') $$,
  '42501', NULL, 'service_role CANNOT INSERT directly');
SELECT throws_ok($$ UPDATE public.qteklink_customers SET display_name='y' WHERE tekmetric_customer_id=44695835 $$,
  '42501', NULL, 'service_role CANNOT UPDATE directly');
SELECT throws_ok($$ DELETE FROM public.qteklink_customers WHERE tekmetric_customer_id=44695835 $$,
  '42501', NULL, 'service_role CANNOT DELETE directly');
RESET ROLE;

-- ─── anon / authenticated denied ────────────────────────────────────────────
SET ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_customers $$, '42501', NULL, 'anon cannot SELECT');
SELECT throws_ok(
  $$ SELECT public.qteklink_upsert_customers(7476,'[]'::jsonb) $$,
  '42501', NULL, 'anon cannot EXECUTE the upsert RPC');
RESET ROLE;
SET ROLE authenticated;
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_customers $$, '42501', NULL, 'authenticated cannot SELECT');
SELECT throws_ok(
  $$ SELECT public.qteklink_upsert_customers(7476,'[]'::jsonb) $$,
  '42501', NULL, 'authenticated cannot EXECUTE the upsert RPC');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
