-- pgTAP: qteklink_mirror_apply_ro — the ATOMIC per-RO mirror write (migration 20260715140000).
-- Proves: a full RO lands (parent + children); a re-apply FULLY REPLACES (removed line
-- items disappear, grandchildren cascade); a bad child RAISES and rolls back the ENTIRE RO
-- (no partial write — the finding this migration closes); re-applying is idempotent.
-- Runs as the BYPASSRLS migration role. Run with: supabase test db
BEGIN;
SELECT plan(11);

SELECT has_function('public', 'qteklink_mirror_apply_ro', 'atomic per-RO mirror writer exists');

-- ── apply #1: a full RO — parent + 1 job + 1 labor + 1 RO-level fee ──────────────────
SELECT public.qteklink_mirror_apply_ro(
  jsonb_build_object('id', 999001, 'shop_id', 7476, 'total_sales_cents', 5000, 'raw', '{}'::jsonb, 'synced_at', '2026-07-15T00:00:00+00'),
  jsonb_build_array(jsonb_build_object('id', 999101, 'ro_id', 999001, 'shop_id', 7476, 'name', 'JOB A', 'labor_hours', 1.5)),
  jsonb_build_array(jsonb_build_object('id', 999201, 'job_id', 999101, 'ro_id', 999001, 'hours', 1.5)),
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  jsonb_build_array(jsonb_build_object('id', 999301, 'ro_id', 999001, 'name', 'Haz', 'total_cents', 1000)),
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
);
SELECT is((SELECT total_sales_cents FROM public.tekmetric_ros WHERE id = 999001), 5000::bigint, 'parent RO landed');
SELECT is((SELECT count(*)::int FROM public.tekmetric_ro_jobs WHERE ro_id = 999001), 1, '1 job landed');
SELECT is((SELECT count(*)::int FROM public.tekmetric_ro_job_labor WHERE ro_id = 999001), 1, '1 labor landed');
SELECT is((SELECT count(*)::int FROM public.tekmetric_ro_fees WHERE ro_id = 999001), 1, '1 RO fee landed');

-- ── apply #2: re-apply with the job REMOVED (Tekmetric dropped it) + a new parent value ──
SELECT public.qteklink_mirror_apply_ro(
  jsonb_build_object('id', 999001, 'shop_id', 7476, 'total_sales_cents', 7000, 'raw', '{}'::jsonb, 'synced_at', '2026-07-15T01:00:00+00'),
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
);
SELECT is((SELECT total_sales_cents FROM public.tekmetric_ros WHERE id = 999001), 7000::bigint, 're-apply replaced the parent value');
SELECT is((SELECT count(*)::int FROM public.tekmetric_ro_jobs WHERE ro_id = 999001), 0, 'removed job is gone (full replace)');
SELECT is((SELECT count(*)::int FROM public.tekmetric_ro_job_labor WHERE ro_id = 999001), 0, 'its labor cascade-deleted');

-- ── apply #3: a BAD child (labor → non-existent job) RAISES + rolls back the WHOLE RO ──
SELECT throws_ok(
  $$SELECT public.qteklink_mirror_apply_ro(
      jsonb_build_object('id', 999001, 'shop_id', 7476, 'total_sales_cents', 9999, 'raw', '{}'::jsonb, 'synced_at', '2026-07-15T02:00:00+00'),
      '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('id', 999999, 'job_id', 888888, 'ro_id', 999001, 'hours', 1)),
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)$$,
  '23503',
  'a child referencing a non-existent job raises a FK violation');
SELECT is((SELECT total_sales_cents FROM public.tekmetric_ros WHERE id = 999001), 7000::bigint,
  'ATOMIC: the failed apply rolled back entirely — the RO keeps its prior value (the DELETE never persisted)');

-- ── idempotency: applying the same valid RO twice yields exactly one set of rows ──────
SELECT public.qteklink_mirror_apply_ro(
  jsonb_build_object('id', 999002, 'shop_id', 7476, 'total_sales_cents', 100, 'raw', '{}'::jsonb, 'synced_at', '2026-07-15T03:00:00+00'),
  jsonb_build_array(jsonb_build_object('id', 999102, 'ro_id', 999002, 'shop_id', 7476, 'name', 'J')),
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
);
SELECT public.qteklink_mirror_apply_ro(
  jsonb_build_object('id', 999002, 'shop_id', 7476, 'total_sales_cents', 100, 'raw', '{}'::jsonb, 'synced_at', '2026-07-15T04:00:00+00'),
  jsonb_build_array(jsonb_build_object('id', 999102, 'ro_id', 999002, 'shop_id', 7476, 'name', 'J')),
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
);
SELECT is((SELECT count(*)::int FROM public.tekmetric_ro_jobs WHERE ro_id = 999002), 1, 'idempotent: twice-applied RO has exactly 1 job (no dupes)');

SELECT * FROM finish();
ROLLBACK;
