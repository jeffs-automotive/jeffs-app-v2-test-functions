-- pgTAP: tekbridge schema (migration 20260722010000)
BEGIN;
SELECT plan(20);

-- ── tables exist ─────────────────────────────────────────────────────────────
SELECT has_table('public', 'tekbridge_session_state', 'session_state exists');
SELECT has_table('public', 'tekbridge_jobs', 'jobs exists');
SELECT has_table('public', 'tekbridge_audit_log', 'audit_log exists');

-- ── key column types (conventions) ───────────────────────────────────────────
SELECT col_type_is('public', 'tekbridge_session_state', 'shop_id', 'bigint', 'session shop_id is bigint');
SELECT col_type_is('public', 'tekbridge_jobs', 'shop_id', 'bigint', 'jobs shop_id is bigint');
SELECT col_type_is('public', 'tekbridge_jobs', 'input', 'jsonb', 'job input is jsonb');
SELECT col_type_is('public', 'tekbridge_jobs', 'idempotency_key', 'text', 'idempotency_key is text');
SELECT col_type_is('public', 'tekbridge_jobs', 'created_at', 'timestamp with time zone', 'timestamps are timestamptz');
SELECT col_type_is('public', 'tekbridge_audit_log', 'outcome', 'text', 'audit outcome is text');
SELECT col_type_is('public', 'tekbridge_audit_log', 'verified', 'boolean', 'audit verified is boolean');

-- ── primary key ──────────────────────────────────────────────────────────────
SELECT col_is_pk('public', 'tekbridge_session_state', 'shop_id', 'session_state PK is shop_id');

-- ── RLS enabled (deny-all: service-role-only surface) ────────────────────────
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tekbridge_session_state'::regclass), 'RLS on session_state');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tekbridge_jobs'::regclass), 'RLS on jobs');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tekbridge_audit_log'::regclass), 'RLS on audit_log');

-- ── zero policies (anon/authenticated denied outright) ───────────────────────
SELECT is((SELECT count(*)::int FROM pg_policies WHERE tablename LIKE 'tekbridge_%'), 0, 'deny-all: zero policies on tekbridge tables');

-- ── constraints behave ───────────────────────────────────────────────────────
SELECT lives_ok(
  $$INSERT INTO public.tekbridge_jobs (shop_id, capability, input, idempotency_key)
    VALUES (7476, 'write_customer_concern', '{}'::jsonb, 'k1')$$,
  'valid job inserts');

SELECT throws_ok(
  $$INSERT INTO public.tekbridge_jobs (shop_id, capability, input, idempotency_key)
    VALUES (7476, 'write_customer_concern', '{}'::jsonb, 'k1')$$,
  '23505',
  NULL,
  'duplicate idempotency_key rejected (UNIQUE)');

SELECT throws_ok(
  $$INSERT INTO public.tekbridge_jobs (shop_id, capability, input, idempotency_key, status)
    VALUES (7476, 'x', '{}'::jsonb, 'k2', 'bogus')$$,
  '23514',
  NULL,
  'invalid job status rejected (CHECK)');

SELECT throws_ok(
  $$INSERT INTO public.tekbridge_audit_log (shop_id, capability, outcome)
    VALUES (7476, 'x', 'bogus')$$,
  '23514',
  NULL,
  'invalid audit outcome rejected (CHECK)');

SELECT lives_ok(
  $$INSERT INTO public.tekbridge_audit_log (shop_id, capability, outcome, verified)
    VALUES (7476, 'write_customer_concern', 'ok', true)$$,
  'valid audit row inserts');

SELECT * FROM finish();
ROLLBACK;
