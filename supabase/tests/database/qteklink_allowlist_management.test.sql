-- =====================================================================
-- pgTAP — QTekLink allowlist management (20260611120000)
-- =====================================================================
-- Covers: manual add (pending row, email lowercased, dup/bad-input rejection),
-- BIND-ON-FIRST-LOGIN in qteklink_resolve_allowed_user (seeded auth.users +
-- auth.identities; oid stamped onto the pending row; oid path wins afterwards),
-- the last-active-admin lockout guards (deactivate + demote), pending-only
-- remove, and the anon denial matrix.
--
-- Runnable --local AND --linked (SET ROLE postgres — the CLI's NOINHERIT login
-- role can't see pgTAP or the service_role-only RPCs). Synthetic tenant 424244
-- (the live shop 7476 must never collide). Run: supabase test db
-- =====================================================================

BEGIN;
SET ROLE postgres;
SET LOCAL search_path TO public, extensions;
SELECT * FROM no_plan();

-- ─── Existence ────────────────────────────────────────────────────────────
SELECT has_function('public', 'qteklink_add_allowed_user', ARRAY['integer','text','text','text','text'], 'add RPC exists');
SELECT has_function('public', 'qteklink_set_allowed_user_active', ARRAY['integer','uuid','boolean'], 'set_active RPC exists');
SELECT has_function('public', 'qteklink_set_allowed_user_role', ARRAY['integer','uuid','text'], 'set_role RPC exists');
SELECT has_function('public', 'qteklink_remove_allowed_user', ARRAY['integer','uuid'], 'remove RPC exists');
SELECT has_index('public', 'qteklink_allowed_users', 'qteklink_allowed_users_shop_email_key', 'per-shop unique email index exists');

-- ─── Add: pending row, lowercased; duplicates + bad input rejected ────────
SELECT ok(public.qteklink_add_allowed_user(424244, 'Boss@JeffsAutomotive.com', 'admin', 'The Boss', 'pgtap') IS NOT NULL, 'add admin returns an id');
SELECT is((SELECT email FROM public.qteklink_allowed_users WHERE shop_id = 424244 AND role = 'admin'), 'boss@jeffsautomotive.com', 'email stored lowercased');
SELECT is((SELECT entra_object_id FROM public.qteklink_allowed_users WHERE shop_id = 424244 AND role = 'admin'), NULL, 'manually-added row is PENDING (no oid yet)');
SELECT is((SELECT active FROM public.qteklink_allowed_users WHERE shop_id = 424244 AND role = 'admin'), true, 'added active');
SELECT ok(public.qteklink_add_allowed_user(424244, 'helper@jeffsautomotive.com', 'viewer', NULL, 'pgtap') IS NOT NULL, 'add viewer ok');
SELECT throws_ok($$ SELECT public.qteklink_add_allowed_user(424244, 'BOSS@jeffsautomotive.com', 'viewer', NULL, 'pgtap') $$, 'P0001', NULL, 'duplicate email (case-insensitive) rejected');
SELECT throws_ok($$ SELECT public.qteklink_add_allowed_user(424244, 'not-an-email', 'viewer', NULL, 'pgtap') $$, 'P0001', NULL, 'invalid email rejected');
SELECT throws_ok($$ SELECT public.qteklink_add_allowed_user(424244, 'x@y.com', 'superuser', NULL, 'pgtap') $$, 'P0001', NULL, 'invalid role rejected');

-- ─── Bind-on-first-login: the auth gate claims the pending row ────────────
-- Seed a provider-managed identity the way Supabase's Azure provider stores it.
INSERT INTO auth.users (instance_id, id, aud, role, email)
VALUES ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-4244-4244-4244-aaaaaaaaaaaa', 'authenticated', 'authenticated', 'boss@jeffsautomotive.com');
INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES (gen_random_uuid(), 'oid-pgtap-424244', 'aaaaaaaa-4244-4244-4244-aaaaaaaaaaaa',
        jsonb_build_object('sub', 'oid-pgtap-424244', 'email', 'Boss@JeffsAutomotive.com', 'name', 'The Boss',
                           'custom_claims', jsonb_build_object('oid', 'oid-pgtap-424244', 'tid', 'tenant-pgtap')),
        'azure', now(), now(), now());

SELECT is((SELECT r.role FROM public.qteklink_resolve_allowed_user('aaaaaaaa-4244-4244-4244-aaaaaaaaaaaa') r), 'admin', 'first sign-in resolves via the email match');
SELECT is((SELECT entra_object_id FROM public.qteklink_allowed_users WHERE shop_id = 424244 AND role = 'admin'), 'oid-pgtap-424244', 'the oid was BOUND onto the pending row');
SELECT is((SELECT entra_tenant_id FROM public.qteklink_allowed_users WHERE shop_id = 424244 AND role = 'admin'), 'tenant-pgtap', 'tenant id captured at bind');
SELECT is((SELECT r.email FROM public.qteklink_resolve_allowed_user('aaaaaaaa-4244-4244-4244-aaaaaaaaaaaa') r), 'boss@jeffsautomotive.com', 'second resolve returns the SAME row (oid path)');
SELECT is((SELECT count(*)::int FROM public.qteklink_allowed_users WHERE shop_id = 424244), 2, 'no extra rows created by resolving');

-- ─── Lockout guards: the only active admin is protected ───────────────────
SELECT throws_ok($$ SELECT public.qteklink_set_allowed_user_active(424244,
  (SELECT id FROM public.qteklink_allowed_users WHERE shop_id = 424244 AND role = 'admin'), false) $$,
  'P0001', NULL, 'deactivating the only active admin is blocked');
SELECT throws_ok($$ SELECT public.qteklink_set_allowed_user_role(424244,
  (SELECT id FROM public.qteklink_allowed_users WHERE shop_id = 424244 AND role = 'admin'), 'viewer') $$,
  'P0001', NULL, 'demoting the only active admin is blocked');

-- promote the helper → the original admin becomes demotable/deactivatable
SELECT is(public.qteklink_set_allowed_user_role(424244,
  (SELECT id FROM public.qteklink_allowed_users WHERE shop_id = 424244 AND email = 'helper@jeffsautomotive.com'), 'admin'),
  true, 'promoting a second admin works');
SELECT is(public.qteklink_set_allowed_user_active(424244,
  (SELECT id FROM public.qteklink_allowed_users WHERE shop_id = 424244 AND email = 'boss@jeffsautomotive.com'), false),
  true, 'with a second active admin, deactivation works');
SELECT throws_ok($$ SELECT public.qteklink_set_allowed_user_active(424244,
  (SELECT id FROM public.qteklink_allowed_users WHERE shop_id = 424244 AND email = 'helper@jeffsautomotive.com'), false) $$,
  'P0001', NULL, 'the guard follows: helper is now the only active admin');
SELECT is(public.qteklink_set_allowed_user_active(424244,
  (SELECT id FROM public.qteklink_allowed_users WHERE shop_id = 424244 AND email = 'boss@jeffsautomotive.com'), true),
  true, 'reactivation works');
SELECT is(public.qteklink_set_allowed_user_active(424244,
  (SELECT id FROM public.qteklink_allowed_users WHERE shop_id = 424244 AND email = 'boss@jeffsautomotive.com'), true),
  false, 'a no-change set_active reports false');

-- a deactivated user resolves with active=false (the app rejects distinctly)
SELECT is(public.qteklink_set_allowed_user_role(424244,
  (SELECT id FROM public.qteklink_allowed_users WHERE shop_id = 424244 AND email = 'boss@jeffsautomotive.com'), 'admin'),
  false, 'no-change set_role reports false');

-- ─── Remove: pending rows only ─────────────────────────────────────────────
SELECT ok(public.qteklink_add_allowed_user(424244, 'typo@jeffsautomotive.com', 'viewer', NULL, 'pgtap') IS NOT NULL, 'add a typo row');
SELECT is(public.qteklink_remove_allowed_user(424244,
  (SELECT id FROM public.qteklink_allowed_users WHERE shop_id = 424244 AND email = 'typo@jeffsautomotive.com')),
  true, 'a PENDING row can be removed');
SELECT is((SELECT count(*)::int FROM public.qteklink_allowed_users WHERE shop_id = 424244 AND email = 'typo@jeffsautomotive.com'), 0, 'typo row gone');
SELECT is(public.qteklink_remove_allowed_user(424244,
  (SELECT id FROM public.qteklink_allowed_users WHERE shop_id = 424244 AND email = 'boss@jeffsautomotive.com')),
  false, 'a BOUND row cannot be removed (deactivate instead)');

-- ─── SECURITY: anon denied ────────────────────────────────────────────────
SET ROLE anon;
SELECT throws_ok($$ SELECT public.qteklink_add_allowed_user(424244, 'x@y.com', 'viewer', NULL, 'anon') $$, '42501', NULL, 'anon cannot EXECUTE add');
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_allowed_users $$, '42501', NULL, 'anon cannot SELECT the allowlist');
SET ROLE postgres;

SELECT * FROM finish();
ROLLBACK;
