-- =====================================================================
-- pgTAP — QTekLink payroll ISOLATION (20260710210000)
-- =====================================================================
-- Cross-shop + role isolation, asserted by ROW COUNTS (per the RLS-silent-filter
-- rule) wherever a blocked path could silently no-op:
--   - deny-all RLS: enabled on all 5 tables with ZERO policies
--   - create_run / sync_run_roster only ever roster the run's own shop
--   - upsert_employee scoped by (id, shop) — wrong shop is a hard P0001, row untouched
--   - composite shop-tie FKs reject a cross-shop entry row in both directions [23503]
--   - tokens + audit rows stamped with the run's shop
--   - anon + authenticated: no SELECT on any table, no EXECUTE on any RPC [42501]
--   - service_role: reads cross-shop BY DESIGN (BYPASSRLS + app-level scoping);
--     all direct writes denied [42501]
--
-- Runs as the BYPASSRLS migration role. Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

CREATE TEMP TABLE _ids (k text PRIMARY KEY, v uuid);

-- ─── Deny-all RLS: enabled, zero policies ────────────────────────────────
SELECT is((SELECT count(*)::int FROM pg_class c
           WHERE c.relnamespace='public'::regnamespace
             AND c.relname IN ('qteklink_payroll_employees','qteklink_payroll_runs','qteklink_payroll_run_employees',
                               'qteklink_payroll_confirm_tokens','qteklink_payroll_audit_log')
             AND c.relrowsecurity), 5, 'RLS enabled on all 5 payroll tables');
SELECT is((SELECT count(*)::int FROM pg_policies
           WHERE schemaname='public' AND tablename LIKE 'qteklink\_payroll\_%'), 0,
  'deny-all: ZERO policies on the payroll tables (writes only via definer RPCs)');

-- ─── Seed two shops ──────────────────────────────────────────────────────
INSERT INTO public.qbo_connections (realm_id, shop_id, access_token_expires_at, refresh_token_expires_at)
VALUES ('realm-A', 7476, now() + interval '1 hour', now() + interval '100 days'),
       ('realm-B', 8888, now() + interval '1 hour', now() + interval '100 days');
SELECT public.qteklink_upsert_settings(7476, 'realm-A', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  '{"anchor_period_start":"2026-06-28"}'::jsonb) AS _;
SELECT public.qteklink_upsert_settings(8888, 'realm-B', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  '{"anchor_period_start":"2026-06-28"}'::jsonb) AS _;

INSERT INTO _ids VALUES ('a1', public.qteklink_payroll_upsert_employee(
  7476, NULL, 'Shop A Tech', 'technician', 700,
  '{"config_version":1,"pto_balance_hours":0,"pto_accrual_hours_per_period":0,"hourly_rate_cents":2300,"billed_rate_cents":1000}'::jsonb,
  false, NULL, 'chris@jeffsautomotive.com'));
INSERT INTO _ids VALUES ('a2', public.qteklink_payroll_upsert_employee(
  7476, NULL, 'Shop A Support', 'shop_support', NULL,
  '{"config_version":1,"pto_balance_hours":0,"pto_accrual_hours_per_period":0,"hourly_rate_cents":1800}'::jsonb,
  false, NULL, 'chris@jeffsautomotive.com'));
INSERT INTO _ids VALUES ('b1', public.qteklink_payroll_upsert_employee(
  8888, NULL, 'Shop B Tech', 'technician', 700,
  '{"config_version":1,"pto_balance_hours":0,"pto_accrual_hours_per_period":0,"hourly_rate_cents":2500,"billed_rate_cents":1200}'::jsonb,
  false, NULL, 'other@shop-b.example'));
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_employees WHERE tekmetric_employee_id=700), 2,
  'the same tekmetric id may exist in DIFFERENT shops (unique is shop-scoped)');

-- ─── Runs roster only their own shop ─────────────────────────────────────
INSERT INTO _ids VALUES ('runA', public.qteklink_payroll_create_run(7476, '2026-06-28'::date, NULL, 'chris@jeffsautomotive.com'));
INSERT INTO _ids VALUES ('runB', public.qteklink_payroll_create_run(8888, '2026-06-28'::date, NULL, 'other@shop-b.example'));
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_run_employees WHERE run_id=(SELECT v FROM _ids WHERE k='runA')), 2,
  'shop A run rostered exactly shop A''s 2 actives');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_run_employees WHERE run_id=(SELECT v FROM _ids WHERE k='runB')), 1,
  'shop B run rostered exactly shop B''s 1 active');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_run_employees re
           JOIN public.qteklink_payroll_employees e ON e.id = re.employee_id
           WHERE re.run_id=(SELECT v FROM _ids WHERE k='runA') AND e.shop_id <> 7476), 0,
  'zero cross-shop employees on shop A''s run');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_run_employees WHERE run_id=(SELECT v FROM _ids WHERE k='runA') AND shop_id <> 7476), 0,
  'every shop A entry row is stamped shop A');

-- ─── upsert_employee is (id, shop)-scoped ────────────────────────────────
SELECT throws_ok($$ SELECT public.qteklink_payroll_upsert_employee(8888, (SELECT v FROM _ids WHERE k='a1'), 'Hijacked', 'technician', NULL,
  '{"config_version":1,"pto_balance_hours":0,"pto_accrual_hours_per_period":0,"hourly_rate_cents":1,"billed_rate_cents":1}'::jsonb,
  false, NULL, 'other@shop-b.example') $$,
  'P0001', NULL, 'updating another shop''s employee rejected');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_employees
           WHERE id=(SELECT v FROM _ids WHERE k='a1') AND display_name='Shop A Tech' AND shop_id=7476), 1,
  'shop A employee row untouched by the cross-shop attempt (row count)');

-- ─── roster sync never crosses shops ─────────────────────────────────────
INSERT INTO _ids VALUES ('b2', public.qteklink_payroll_upsert_employee(
  8888, NULL, 'Shop B New Hire', 'office_support', NULL,
  '{"config_version":1,"pto_balance_hours":0,"pto_accrual_hours_per_period":0,"hourly_rate_cents":1600}'::jsonb,
  false, NULL, 'other@shop-b.example'));
SELECT is(jsonb_array_length((public.qteklink_payroll_sync_run_roster((SELECT v FROM _ids WHERE k='runA'), NULL, 'chris@jeffsautomotive.com'))->'added'), 0,
  'shop B''s new hire is NOT added to shop A''s run');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_run_employees WHERE run_id=(SELECT v FROM _ids WHERE k='runA')), 2,
  'shop A roster count unchanged (row count)');
SELECT is(jsonb_array_length((public.qteklink_payroll_sync_run_roster((SELECT v FROM _ids WHERE k='runB'), NULL, 'other@shop-b.example'))->'added'), 1,
  'the new hire lands on shop B''s own run');

-- ─── composite shop-tie FKs (direct owner writes) ────────────────────────
SELECT throws_ok($$
  INSERT INTO public.qteklink_payroll_run_employees (run_id, shop_id, employee_id, role_snapshot, pay_config)
  VALUES ((SELECT v FROM _ids WHERE k='runA'), 7476, (SELECT v FROM _ids WHERE k='b1'), 'technician', '{}'::jsonb) $$,
  '23503', NULL, 'shop B employee cannot ride shop A''s run (employee shop-tie FK)');
SELECT throws_ok($$
  INSERT INTO public.qteklink_payroll_run_employees (run_id, shop_id, employee_id, role_snapshot, pay_config)
  VALUES ((SELECT v FROM _ids WHERE k='runA'), 8888, (SELECT v FROM _ids WHERE k='b1'), 'technician', '{}'::jsonb) $$,
  '23503', NULL, 'shop-B-stamped entry row cannot ride shop A''s run (run shop-tie FK)');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_run_employees WHERE run_id=(SELECT v FROM _ids WHERE k='runA')), 2,
  'shop A roster still 2 after both FK rejections (row count)');

-- ─── tokens + audit rows carry the run's shop ────────────────────────────
SELECT lives_ok($$ SELECT * FROM public.qteklink_payroll_issue_confirm_token(
  (SELECT v FROM _ids WHERE k='runA'), 'complete_run', 'isolation-probe-hash', NULL, 'chris@jeffsautomotive.com') $$,
  'token issued for shop A''s run');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_confirm_tokens
           WHERE run_id=(SELECT v FROM _ids WHERE k='runA') AND shop_id <> 7476), 0,
  'token stamped with the run''s shop (no cross-shop stamps)');
SELECT ok((SELECT count(*) FROM public.qteklink_payroll_confirm_tokens
           WHERE run_id=(SELECT v FROM _ids WHERE k='runA') AND shop_id = 7476) >= 1,
  'token row exists under shop A');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_audit_log
           WHERE run_id=(SELECT v FROM _ids WHERE k='runA') AND shop_id <> 7476), 0,
  'every audit row for shop A''s run is stamped shop A');

-- ─── anon + authenticated: fully denied ──────────────────────────────────
SET ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_payroll_employees $$, '42501', NULL, 'anon cannot SELECT employees');
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_payroll_runs $$, '42501', NULL, 'anon cannot SELECT runs');
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_payroll_run_employees $$, '42501', NULL, 'anon cannot SELECT run_employees');
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_payroll_confirm_tokens $$, '42501', NULL, 'anon cannot SELECT confirm_tokens');
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_payroll_audit_log $$, '42501', NULL, 'anon cannot SELECT audit_log');
SELECT throws_ok($$ SELECT public.qteklink_payroll_create_run(7476, '2026-07-12'::date, NULL, 'x') $$, '42501', NULL, 'anon cannot EXECUTE create_run');
RESET ROLE;

SET ROLE authenticated;
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_payroll_employees $$, '42501', NULL, 'authenticated cannot SELECT employees');
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_payroll_runs $$, '42501', NULL, 'authenticated cannot SELECT runs');
SELECT throws_ok($$ SELECT public.qteklink_payroll_upsert_employee(7476, NULL, 'x', 'technician', NULL, '{}'::jsonb, false, NULL, 'x') $$,
  '42501', NULL, 'authenticated cannot EXECUTE upsert_employee');
SELECT throws_ok($$ SELECT public.qteklink_payroll_complete_run(gen_random_uuid(), true, NULL, NULL, NULL, NULL, 'x') $$,
  '42501', NULL, 'authenticated cannot EXECUTE complete_run');
RESET ROLE;

-- ─── service_role: cross-shop reads BY DESIGN, zero direct writes ─────────
SET ROLE service_role;
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_runs), 2,
  'service_role reads BOTH shops (BYPASSRLS by design — the app scopes by shop_id)');
SELECT throws_ok($$ UPDATE public.qteklink_payroll_employees SET display_name='x' WHERE shop_id=7476 $$,
  '42501', NULL, 'service_role cannot UPDATE employees directly');
SELECT throws_ok($$ INSERT INTO public.qteklink_payroll_runs (shop_id, period_start, period_end) VALUES (7476, '2026-07-12', '2026-07-25') $$,
  '42501', NULL, 'service_role cannot INSERT runs directly');
SELECT throws_ok($$ DELETE FROM public.qteklink_payroll_run_employees WHERE shop_id=7476 $$,
  '42501', NULL, 'service_role cannot DELETE run_employees directly');
SELECT throws_ok($$ INSERT INTO public.qteklink_payroll_audit_log (shop_id, actor_label, action) VALUES (7476, 'x', 'x') $$,
  '42501', NULL, 'service_role cannot INSERT audit rows directly (RPCs only)');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
