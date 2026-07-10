-- =====================================================================
-- pgTAP — QTekLink C8b qteklink_settings + qteklink_ro_state (§3)
-- =====================================================================
-- Covers 20260607090000: both tables + their SECURITY DEFINER upsert RPCs + RLS +
-- the folded-in default-privileges REVOKE:
--   - tables + RPCs exist; RLS enabled
--   - least-privilege: service_role SELECT-only + EXECUTE the RPCs; anon denied
--   - settings: defaults on insert; PARTIAL upsert preserves untouched fields;
--     negative tax rate / settle window rejected [P0001]
--   - ro_state: insert + partial upsert preserves; one row per (shop,realm,ro);
--     invalid status rejected [P0001]
--   - composite FK -> qbo_connections [23503]
--
-- Runs as the BYPASSRLS migration role. Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

-- ─── Existence + RLS ────────────────────────────────────────────────────
SELECT has_table('public', 'qteklink_settings', 'qteklink_settings exists');
SELECT has_table('public', 'qteklink_ro_state', 'qteklink_ro_state exists');
SELECT has_function('public', 'qteklink_upsert_settings', ARRAY['integer','text','boolean','integer','text','integer','integer','text','text','jsonb'], 'upsert_settings RPC exists (10-param incl. notification recipients + payroll jsonb)');
SELECT has_function('public', 'qteklink_upsert_ro_state', ARRAY['integer','text','bigint','text','bigint','date','text','text','text','text'], 'upsert_ro_state RPC exists');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='qteklink_settings' AND relnamespace='public'::regnamespace), true, 'RLS on qteklink_settings');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='qteklink_ro_state' AND relnamespace='public'::regnamespace), true, 'RLS on qteklink_ro_state');

-- ─── Least-privilege ────────────────────────────────────────────────────
SELECT ok(has_table_privilege('service_role','public.qteklink_settings','SELECT'), 'service_role SELECT settings');
SELECT ok(NOT has_table_privilege('service_role','public.qteklink_settings','UPDATE'), 'service_role NO UPDATE settings');
SELECT ok(NOT has_table_privilege('service_role','public.qteklink_ro_state','INSERT'), 'service_role NO INSERT ro_state');
SELECT ok(has_function_privilege('service_role','public.qteklink_upsert_settings(integer,text,boolean,integer,text,integer,integer,text,text,jsonb)','EXECUTE'), 'service_role EXECUTE upsert_settings');

-- ─── Seed a connection (FK target) ──────────────────────────────────────
INSERT INTO public.qbo_connections (realm_id, shop_id, access_token_expires_at, refresh_token_expires_at)
VALUES ('realm-A', 7476, now() + interval '1 hour', now() + interval '100 days');

-- ─── settings: defaults + partial-preserve + validation ─────────────────
SELECT lives_ok($$ SELECT public.qteklink_upsert_settings(7476,'realm-A',NULL,NULL,NULL,NULL,NULL) $$, 'insert settings with defaults');
SELECT is((SELECT auto_post::text||'/'||shop_timezone||'/'||sales_tax_rate_bps FROM public.qteklink_settings WHERE shop_id=7476), 'false/America/New_York/600', 'defaults applied');
SELECT public.qteklink_upsert_settings(7476,'realm-A',true,NULL,NULL,NULL,NULL) AS _; -- only auto_post
SELECT is((SELECT auto_post::text||'/'||shop_timezone||'/'||sales_tax_rate_bps FROM public.qteklink_settings WHERE shop_id=7476), 'true/America/New_York/600', 'partial upsert preserved tz + rate');
SELECT throws_ok($$ SELECT public.qteklink_upsert_settings(7476,'realm-A',NULL,NULL,NULL,-5,NULL) $$, 'P0001', NULL, 'negative tax rate rejected');
SELECT throws_ok($$ SELECT public.qteklink_upsert_settings(7476,'realm-A',NULL,-1,NULL,NULL,NULL) $$, 'P0001', NULL, 'negative settle window rejected');

-- ─── ro_state: insert + partial-preserve + one-per-RO + validation ───────
SELECT isnt(public.qteklink_upsert_ro_state(7476,'realm-A',152805,'RO-152805',11202,'2026-05-19'::date,'h1',NULL,NULL,'pending'), NULL, 'ro_state insert ok');
SELECT public.qteklink_upsert_ro_state(7476,'realm-A',152805,NULL,NULL,NULL,NULL,'QBO-1','0','posted') AS _; -- the poster's writeback
SELECT is((SELECT count(*)::int FROM public.qteklink_ro_state WHERE tekmetric_ro_id=152805), 1, 'one row per RO (upsert)');
SELECT is((SELECT ro_number||'/'||sale_qbo_je_id||'/'||status FROM public.qteklink_ro_state WHERE tekmetric_ro_id=152805), 'RO-152805/QBO-1/posted', 'partial upsert preserved ro_number + recorded JE id');
SELECT throws_ok($$ SELECT public.qteklink_upsert_ro_state(7476,'realm-A',1,NULL,NULL,NULL,NULL,NULL,NULL,'bogus') $$, 'P0001', NULL, 'invalid status rejected');

-- ─── Composite FK ───────────────────────────────────────────────────────
SELECT throws_ok($$ SELECT public.qteklink_upsert_settings(9999,'no-conn',NULL,NULL,NULL,NULL,NULL) $$, '23503', NULL, 'settings for an unbound shop/realm FK-rejected');
SELECT throws_ok($$ SELECT public.qteklink_upsert_ro_state(9999,'no-conn',1,NULL,NULL,NULL,NULL,NULL,NULL,NULL) $$, '23503', NULL, 'ro_state for an unbound shop/realm FK-rejected');

-- ─── anon denied ────────────────────────────────────────────────────────
SET ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_settings $$, '42501', NULL, 'anon cannot SELECT settings');
SELECT throws_ok($$ SELECT public.qteklink_upsert_settings(7476,'realm-A',true,NULL,NULL,NULL,NULL) $$, '42501', NULL, 'anon cannot EXECUTE upsert_settings');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
