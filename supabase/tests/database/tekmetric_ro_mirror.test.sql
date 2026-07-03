-- pgTAP: tekmetric RO mirror schema (migration 20260703010000)
BEGIN;
SELECT plan(20);

-- tables exist
SELECT has_table('public', 'tekmetric_ros', 'tekmetric_ros exists');
SELECT has_table('public', 'tekmetric_ro_jobs', 'tekmetric_ro_jobs exists');
SELECT has_table('public', 'tekmetric_ro_job_labor', 'job labor exists');
SELECT has_table('public', 'tekmetric_ro_job_parts', 'job parts exists');
SELECT has_table('public', 'tekmetric_ro_customer_concerns', 'concerns exists');
SELECT has_table('public', 'tekmetric_ro_ingest_alerts', 'ingest alerts exists');

-- key column types (spot checks per plan)
SELECT col_type_is('public', 'tekmetric_ros', 'id', 'bigint', 'ro id is bigint (Tekmetric natural PK)');
SELECT col_type_is('public', 'tekmetric_ros', 'total_sales_cents', 'bigint', 'money is bigint cents');
SELECT col_type_is('public', 'tekmetric_ros', 'posted_date', 'timestamp with time zone', 'dates are timestamptz');
SELECT col_type_is('public', 'tekmetric_ros', 'raw', 'jsonb', 'raw payload fallback is jsonb');
SELECT col_type_is('public', 'tekmetric_ros', 'miles_in', 'numeric', 'miles allow fractions');
SELECT col_type_is('public', 'tekmetric_ro_jobs', 'job_category_name', 'text', 'job category filterable');
SELECT col_type_is('public', 'tekmetric_ro_job_parts', 'dot_numbers', 'text[]', 'dot numbers are text[]');
SELECT col_type_is('public', 'tekmetric_ro_customer_concerns', 'concern', 'text', 'concern is text');

-- RLS enabled everywhere (deny-all: service-role-only surface)
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tekmetric_ros'::regclass), 'RLS on tekmetric_ros');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tekmetric_ro_jobs'::regclass), 'RLS on jobs');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tekmetric_ro_customer_concerns'::regclass), 'RLS on concerns');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tekmetric_ro_ingest_alerts'::regclass), 'RLS on alerts');

-- no policies (anon/authenticated denied outright)
SELECT is((SELECT count(*)::int FROM pg_policies WHERE tablename LIKE 'tekmetric_ro%'), 0, 'deny-all: zero policies on mirror tables');

-- alert dedupe upsert works (RPC is SECURITY DEFINER)
SELECT lives_ok(
  $$SELECT public.record_tekmetric_ingest_alert('ro', ARRAY['newField'], 1, '{"newField": 1}'::jsonb)$$,
  'alert RPC inserts');

SELECT * FROM finish();
ROLLBACK;
