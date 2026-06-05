-- =====================================================================
-- pgTAP tests for QTekLink C0 (qteklink_allowed_users + lookup RPC)
-- =====================================================================
-- Verifies 20260605040000_qteklink_allowed_users.sql:
--   - table + RPC exist; RLS enabled
--   - the RPC resolves an allowed oid (role/shop), returns inactive rows too
--     (so requireQtekUser can distinguish deactivated vs never-listed), and is
--     empty for an unknown oid
--   - role CHECK + UNIQUE(entra_object_id) + non-blank CHECKs hold
--   - SECURITY: anon AND authenticated are HARD-denied on both the table and
--     the RPC (grants revoked → SQLSTATE 42501), while service_role (the
--     requireQtekUser path) CAN execute the RPC
--
-- Tests run as the migration role (BYPASSRLS). The deny model here is
-- REVOKE-grant (like qbo_connections), so the denial shape is a permission
-- ERROR (42501), NOT the silent-filter row-count used for deny_all POLICY
-- tables (scheduler_rls_negative.test.sql). Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

-- ─── Existence + RLS ────────────────────────────────────────────────────
SELECT has_table('public', 'qteklink_allowed_users', 'qteklink_allowed_users table exists');
SELECT has_function(
  'public', 'qteklink_get_allowed_user', ARRAY['text'],
  'qteklink_get_allowed_user(text) exists'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class
     WHERE relname = 'qteklink_allowed_users' AND relnamespace = 'public'::regnamespace),
  true, 'RLS is enabled on qteklink_allowed_users');

-- ─── Fixtures (seeded as the BYPASSRLS migration role) ──────────────────
INSERT INTO public.qteklink_allowed_users
  (shop_id, entra_object_id, entra_tenant_id, email, full_name, role, active)
VALUES
  (7476, 'oid-active-admin',    'tid-1', 'admin@jeffsautomotive.com', 'Active Admin',    'admin',  true),
  (7476, 'oid-inactive-viewer', 'tid-1', 'old@jeffsautomotive.com',   'Inactive Viewer', 'viewer', false);

-- ─── RPC resolves an allowed oid (role + shop + active) ─────────────────
SELECT is(
  (SELECT role FROM public.qteklink_get_allowed_user('oid-active-admin')),
  'admin', 'RPC returns the role for an allowed oid');
SELECT is(
  (SELECT shop_id FROM public.qteklink_get_allowed_user('oid-active-admin')),
  7476, 'RPC returns the shop_id for an allowed oid');
SELECT is(
  (SELECT active FROM public.qteklink_get_allowed_user('oid-active-admin')),
  true, 'RPC marks the active user active');

-- ─── RPC returns inactive rows too (deactivated vs never-listed) ────────
SELECT is(
  (SELECT active FROM public.qteklink_get_allowed_user('oid-inactive-viewer')),
  false, 'RPC returns the inactive row so the caller can flag deactivated access');

-- ─── Unknown oid → empty (rejected) ─────────────────────────────────────
SELECT is_empty(
  $$ SELECT * FROM public.qteklink_get_allowed_user('oid-not-on-list') $$,
  'unknown oid returns no rows (rejected)');

-- ─── Constraints ────────────────────────────────────────────────────────
SELECT throws_ok(
  $$ INSERT INTO public.qteklink_allowed_users (shop_id, entra_object_id, email, role)
     VALUES (7476, 'oid-bad-role', 'x@y.com', 'superuser') $$,
  '23514', NULL, 'role CHECK rejects an unknown role');

SELECT throws_ok(
  $$ INSERT INTO public.qteklink_allowed_users (shop_id, entra_object_id, email, role)
     VALUES (7476, 'oid-active-admin', 'dup@y.com', 'viewer') $$,
  '23505', NULL, 'UNIQUE(entra_object_id) rejects a duplicate oid');

SELECT throws_ok(
  $$ INSERT INTO public.qteklink_allowed_users (shop_id, entra_object_id, email, role)
     VALUES (7476, '   ', 'x@y.com', 'viewer') $$,
  '23514', NULL, 'blank entra_object_id rejected by CHECK');

-- ─── SECURITY: anon hard-denied on table + RPC (grants revoked → 42501) ──
SET ROLE anon;
SELECT throws_ok(
  $$ SELECT 1 FROM public.qteklink_allowed_users $$,
  '42501', NULL, 'anon cannot SELECT the allowlist (grant revoked)');
SELECT throws_ok(
  $$ SELECT * FROM public.qteklink_get_allowed_user('oid-active-admin') $$,
  '42501', NULL, 'anon cannot EXECUTE qteklink_get_allowed_user (revoked)');
RESET ROLE;

-- ─── SECURITY: authenticated (browser session role) equally denied ──────
SET ROLE authenticated;
SELECT throws_ok(
  $$ SELECT 1 FROM public.qteklink_allowed_users $$,
  '42501', NULL, 'authenticated cannot SELECT the allowlist (grant revoked)');
SELECT throws_ok(
  $$ SELECT * FROM public.qteklink_get_allowed_user('oid-active-admin') $$,
  '42501', NULL, 'authenticated cannot EXECUTE qteklink_get_allowed_user (revoked)');
RESET ROLE;

-- ─── SECURITY: service_role (the requireQtekUser path) CAN execute ──────
SET ROLE service_role;
SELECT isnt_empty(
  $$ SELECT 1 FROM public.qteklink_get_allowed_user('oid-active-admin') $$,
  'service_role CAN execute qteklink_get_allowed_user (the auth path is intact)');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
