-- =====================================================================
-- pgTAP tests for qbo-api-client C3 (qbo_connections + Vault RPCs)
-- =====================================================================
-- Verifies 20260602140000_qbo_connections.sql:
--   - table + both RPCs exist; RLS enabled
--   - qbo_persist_tokens → qbo_get_connection round-trips the DECRYPTED
--     tokens + expiries (Vault-backed); rotation updates them
--   - p_realm_id NULL → the single connection; unknown realm → no rows
--
-- Tests run as the migration role (BYPASSRLS). Vault secrets created here are
-- rolled back with the txn. Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

-- ─── Existence + RLS ────────────────────────────────────────────────────
SELECT has_table('public', 'qbo_connections', 'qbo_connections table exists');
SELECT has_function(
  'public', 'qbo_get_connection', ARRAY['text'],
  'qbo_get_connection(text) exists'
);
SELECT has_function(
  'public', 'qbo_persist_tokens',
  ARRAY['text', 'text', 'text', 'timestamptz', 'timestamptz'],
  'qbo_persist_tokens(...) exists'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class
     WHERE relname = 'qbo_connections' AND relnamespace = 'public'::regnamespace),
  true, 'RLS is enabled on qbo_connections');

-- ─── Round-trip: persist → get returns decrypted tokens + expiries ───────
SELECT lives_ok(
  $$ SELECT public.qbo_persist_tokens(
       'test-realm-123', 'access-abc', 'refresh-xyz',
       '2026-07-01T00:00:00Z'::timestamptz, '2026-10-01T00:00:00Z'::timestamptz) $$,
  'qbo_persist_tokens seeds a connection');

SELECT is(
  (SELECT access_token FROM public.qbo_get_connection('test-realm-123')),
  'access-abc', 'get returns the decrypted access token');
SELECT is(
  (SELECT refresh_token FROM public.qbo_get_connection('test-realm-123')),
  'refresh-xyz', 'get returns the decrypted refresh token');
SELECT is(
  (SELECT access_token_expires_at FROM public.qbo_get_connection('test-realm-123')),
  '2026-07-01T00:00:00Z'::timestamptz, 'access expiry round-trips');

-- ─── Rotation: re-persist updates the stored tokens ─────────────────────
SELECT public.qbo_persist_tokens(
  'test-realm-123', 'access-2', 'refresh-2',
  '2026-08-01T00:00:00Z'::timestamptz, '2026-11-01T00:00:00Z'::timestamptz);
SELECT is(
  (SELECT refresh_token FROM public.qbo_get_connection('test-realm-123')),
  'refresh-2', 'rotation updates the refresh token');

-- ─── NULL realm → the single (most-recent) connection ───────────────────
SELECT is(
  (SELECT realm_id FROM public.qbo_get_connection(NULL)),
  'test-realm-123', 'NULL realm returns the most-recent connection');

-- ─── Unknown realm → empty result set (caller maps to reconnect_required) ─
SELECT is_empty(
  $$ SELECT * FROM public.qbo_get_connection('nonexistent-realm') $$,
  'unknown realm returns no rows');

SELECT * FROM finish();
ROLLBACK;
