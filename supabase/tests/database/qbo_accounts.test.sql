-- =====================================================================
-- pgTAP — QTekLink C1 COA sync (true mirror + multi-tenant binding)
-- =====================================================================
-- Covers 20260605060000 + 070000/080000/090000 hardening + 20260606000000
-- true-mirror:
--   - tables + RPCs exist; RLS enabled
--   - qbo_resolve_realm_for_shop binds shop -> realm (NULL when none)
--   - sync upserts valid accounts (blank id/name skipped), records LIVE count in
--     qbo_coa_sync_state, and RETURNS the live count
--   - TRUE MIRROR: an account absent from a later full chart is SOFT-deleted
--     (row kept, deleted_at set); a reappearing account is REVIVED; an empty
--     resync soft-deletes the whole chart (account_count -> 0)
--   - composite FK rejects an unbound (shop_id, realm_id) [23503]
--   - ON DELETE RESTRICT blocks deleting a connection with COA rows [23503]
--   - UNIQUE(shop_id) blocks a 2nd connection for the same shop [23505]
--   - SECURITY: anon + authenticated denied [42501]; service_role can
--
-- Tests run as the BYPASSRLS migration role. Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

-- ─── Existence + RLS ────────────────────────────────────────────────────
SELECT has_table('public', 'qbo_accounts', 'qbo_accounts table exists');
SELECT has_table('public', 'qbo_coa_sync_state', 'qbo_coa_sync_state table exists');
SELECT has_column('public', 'qbo_accounts', 'deleted_at', 'qbo_accounts has deleted_at (soft-delete)');
SELECT has_column('public', 'qbo_accounts', 'acct_num', 'qbo_accounts has acct_num (QBO account number)');
SELECT has_function('public', 'qbo_accounts_sync', ARRAY['integer', 'text', 'jsonb'], 'qbo_accounts_sync exists');
SELECT has_function('public', 'qbo_resolve_realm_for_shop', ARRAY['integer'], 'qbo_resolve_realm_for_shop exists');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='qbo_accounts' AND relnamespace='public'::regnamespace), true, 'RLS on qbo_accounts');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='qbo_coa_sync_state' AND relnamespace='public'::regnamespace), true, 'RLS on qbo_coa_sync_state');

-- ─── Parent connections (FK target) ─────────────────────────────────────
INSERT INTO public.qbo_connections (realm_id, shop_id, access_token_expires_at, refresh_token_expires_at)
VALUES
  ('realm-A', 7476, now() + interval '1 hour', now() + interval '100 days'),
  ('realm-B', 7477, now() + interval '1 hour', now() + interval '100 days');

-- ─── Resolver binds shop -> realm ───────────────────────────────────────
SELECT is(public.qbo_resolve_realm_for_shop(7476), 'realm-A', 'resolver: 7476 -> realm-A');
SELECT is(public.qbo_resolve_realm_for_shop(99999), NULL, 'resolver: no connection -> NULL');

-- ─── Initial sync: 2 valid (blank id + blank name skipped); returns LIVE ─
SELECT is(
  public.qbo_accounts_sync(7476, 'realm-A', $json$[
    {"qbo_account_id":"275","name":"Sales - Labor","account_type":"Income","active":true},
    {"qbo_account_id":"235","name":"ACCOUNTS RECEIVABLE","acct_num":"120","account_type":"Other Current Asset","active":true},
    {"qbo_account_id":"  ","name":"blank id","active":true},
    {"qbo_account_id":"BN","name":"   ","active":true}
  ]$json$::jsonb),
  2, 'initial sync returns live count 2 (blanks skipped)');
SELECT is((SELECT account_count FROM public.qbo_coa_sync_state WHERE shop_id=7476 AND realm_id='realm-A'),
  2, 'sync-state live count = 2');

-- acct_num (the QBO account NUMBER) round-trips; NULL when the payload omits it
SELECT is((SELECT acct_num FROM public.qbo_accounts WHERE realm_id='realm-A' AND qbo_account_id='235'),
  '120', 'acct_num "120" round-trips (235 ACCOUNTS RECEIVABLE)');
SELECT is((SELECT acct_num FROM public.qbo_accounts WHERE realm_id='realm-A' AND qbo_account_id='275'),
  NULL, 'acct_num NULL when the payload omits it (275)');

-- ─── Rename with BOTH present: 275 renamed, both stay live ──────────────
SELECT is(
  public.qbo_accounts_sync(7476, 'realm-A', $json$[
    {"qbo_account_id":"275","name":"Sales - Labor (renamed)","active":true},
    {"qbo_account_id":"235","name":"Accounts Receivable","active":true}
  ]$json$::jsonb),
  2, 'resync with both -> still 2 live');
SELECT is((SELECT name FROM public.qbo_accounts WHERE realm_id='realm-A' AND qbo_account_id='275'),
  'Sales - Labor (renamed)', '275 renamed in place');

-- ─── TRUE MIRROR: omit 235 -> 235 soft-deleted (row kept), live = 1 ─────
SELECT is(
  public.qbo_accounts_sync(7476, 'realm-A',
    '[{"qbo_account_id":"275","name":"Sales - Labor (renamed)","active":true}]'::jsonb),
  1, 'resync without 235 -> live count 1');
SELECT isnt((SELECT deleted_at FROM public.qbo_accounts WHERE realm_id='realm-A' AND qbo_account_id='235'),
  NULL, '235 is SOFT-deleted (deleted_at set)');
SELECT is((SELECT count(*)::int FROM public.qbo_accounts WHERE realm_id='realm-A' AND qbo_account_id='235'),
  1, '235 row is KEPT (soft, not physical delete)');
SELECT is((SELECT account_count FROM public.qbo_coa_sync_state WHERE shop_id=7476 AND realm_id='realm-A'),
  1, 'sync-state live count = 1 after soft-delete');

-- ─── Reappear: 235 returns -> REVIVED (deleted_at NULL), live = 2 ───────
SELECT is(
  public.qbo_accounts_sync(7476, 'realm-A', $json$[
    {"qbo_account_id":"275","name":"Sales - Labor (renamed)","active":true},
    {"qbo_account_id":"235","name":"Accounts Receivable","active":true}
  ]$json$::jsonb),
  2, 'reappearing 235 -> live count back to 2');
SELECT is((SELECT deleted_at FROM public.qbo_accounts WHERE realm_id='realm-A' AND qbo_account_id='235'),
  NULL, '235 revived (deleted_at cleared)');

-- ─── Empty resync: whole chart soft-deleted, rows kept, live = 0 ────────
SELECT is(public.qbo_accounts_sync(7476, 'realm-A', '[]'::jsonb), 0, 'empty resync -> live count 0');
SELECT is((SELECT count(*)::int FROM public.qbo_accounts WHERE realm_id='realm-A' AND deleted_at IS NULL),
  0, 'no live accounts after empty resync');
SELECT is((SELECT count(*)::int FROM public.qbo_accounts WHERE realm_id='realm-A'),
  2, 'both rows KEPT (soft-deleted) after empty resync');
SELECT is((SELECT account_count FROM public.qbo_coa_sync_state WHERE shop_id=7476 AND realm_id='realm-A'),
  0, 'sync-state live count = 0 after empty resync (distinguishes from never-synced)');

-- ─── Cross shop/realm isolation ─────────────────────────────────────────
SELECT is(public.qbo_accounts_sync(7477, 'realm-B',
  '[{"qbo_account_id":"275","name":"Other shop labor","active":true}]'::jsonb), 1,
  'same qbo id under a different shop/realm -> separate row');

-- ─── FK rejects an unbound (shop_id, realm_id) ──────────────────────────
SELECT throws_ok(
  $$ SELECT public.qbo_accounts_sync(9999, 'no-conn', '[{"qbo_account_id":"X","name":"x","active":true}]'::jsonb) $$,
  '23503', NULL, 'sync for a shop/realm with no connection is FK-rejected');

-- ─── ON DELETE RESTRICT: cannot delete a connection that has COA rows ───
SELECT throws_ok(
  $$ DELETE FROM public.qbo_connections WHERE shop_id = 7476 AND realm_id = 'realm-A' $$,
  '23503', NULL, 'deleting a connection with COA rows is blocked (ON DELETE RESTRICT)');

-- ─── UNIQUE(shop_id): a shop can have at most one connection ────────────
SELECT throws_ok(
  $$ INSERT INTO public.qbo_connections (realm_id, shop_id, access_token_expires_at, refresh_token_expires_at)
     VALUES ('realm-A2', 7476, now() + interval '1 hour', now() + interval '100 days') $$,
  '23505', NULL, 'a second connection for the same shop is rejected (UNIQUE shop_id)');

-- ─── Bad payloads ───────────────────────────────────────────────────────
SELECT throws_ok($$ SELECT public.qbo_accounts_sync(7476, 'realm-A', '{"x":1}'::jsonb) $$, 'P0001', NULL, 'non-array payload raises');
SELECT throws_ok($$ SELECT public.qbo_accounts_sync(0, 'realm-A', '[]'::jsonb) $$, 'P0001', NULL, 'non-positive shop_id raises');

-- ─── SECURITY: anon + authenticated denied; service_role can ────────────
SET ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.qbo_accounts $$, '42501', NULL, 'anon cannot SELECT qbo_accounts');
SELECT throws_ok($$ SELECT public.qbo_accounts_sync(7476,'realm-A','[]'::jsonb) $$, '42501', NULL, 'anon cannot EXECUTE qbo_accounts_sync');
RESET ROLE;
SET ROLE authenticated;
SELECT throws_ok($$ SELECT public.qbo_resolve_realm_for_shop(7476) $$, '42501', NULL, 'authenticated cannot EXECUTE the resolver');
RESET ROLE;
SET ROLE service_role;
SELECT is(public.qbo_resolve_realm_for_shop(7476), 'realm-A', 'service_role CAN resolve (DAL path intact)');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
