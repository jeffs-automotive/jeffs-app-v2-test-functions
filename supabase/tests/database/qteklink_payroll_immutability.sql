-- =====================================================================
-- pgTAP — QTekLink payroll IMMUTABILITY (20260710210000)
-- =====================================================================
-- The GUC-pattern immutability wall + append-only audit + integrity constraints,
-- exercised with DIRECT table writes (no RPCs — the rpcs suite covers those):
--   - tables + lock triggers exist; RLS enabled
--   - completed/voided runs (and their entry rows) reject direct UPDATE/DELETE [P0001];
--     open runs stay editable/deletable; values proven unchanged after blocked writes
--   - GUC bypass (qteklink.payroll_lock_bypass='on') admits the write, and re-arming
--     ('off') blocks again — set_config is transaction-scoped, so the test re-arms itself
--   - audit log rejects UPDATE/DELETE ALWAYS (even with the GUC on)
--   - status-consistency / period-length / bonus-month CHECKs [23514]
--   - partial uniques: (shop, period_start) + (shop, bonus_month) ignore voided [23505]
--   - composite shop-tie FKs on run_employees [23503]
--   - service_role: SELECT-only (writes 42501 at the privilege layer, before triggers)
--
-- Runs as the BYPASSRLS migration role. Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

-- ─── Existence + RLS + triggers ─────────────────────────────────────────
SELECT has_table('public', 'qteklink_payroll_employees', 'employees table exists');
SELECT has_table('public', 'qteklink_payroll_runs', 'runs table exists');
SELECT has_table('public', 'qteklink_payroll_run_employees', 'run_employees table exists');
SELECT has_table('public', 'qteklink_payroll_confirm_tokens', 'confirm_tokens table exists');
SELECT has_table('public', 'qteklink_payroll_audit_log', 'audit_log table exists');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='qteklink_payroll_employees' AND relnamespace='public'::regnamespace), true, 'RLS on employees');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='qteklink_payroll_runs' AND relnamespace='public'::regnamespace), true, 'RLS on runs');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='qteklink_payroll_run_employees' AND relnamespace='public'::regnamespace), true, 'RLS on run_employees');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='qteklink_payroll_confirm_tokens' AND relnamespace='public'::regnamespace), true, 'RLS on confirm_tokens');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='qteklink_payroll_audit_log' AND relnamespace='public'::regnamespace), true, 'RLS on audit_log');
SELECT has_trigger('public', 'qteklink_payroll_runs', 'qteklink_payroll_runs_lock', 'runs lock trigger exists');
SELECT has_trigger('public', 'qteklink_payroll_run_employees', 'qteklink_payroll_run_employees_lock', 'run_employees lock trigger exists');
SELECT has_trigger('public', 'qteklink_payroll_audit_log', 'qteklink_payroll_audit_log_append_only', 'audit append-only trigger exists');

-- ─── Seed (direct, as the owner role — payroll has no qbo_connections FK) ─
INSERT INTO public.qteklink_payroll_employees (id, shop_id, display_name, role, pay_config)
VALUES ('33333333-3333-4333-8333-333333333301', 7476, 'Direct Tech', 'technician', '{}'::jsonb);

INSERT INTO public.qteklink_payroll_runs (id, shop_id, period_start, period_end, status)
VALUES ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa01', 7476, '2026-06-28', '2026-07-11', 'open');

INSERT INTO public.qteklink_payroll_runs
  (id, shop_id, period_start, period_end, status, snapshot, completed_at, completed_by_label)
VALUES
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa02', 7476, '2026-07-12', '2026-07-25', 'completed',
   '{"snapshot_version":1}'::jsonb, now(), 'chris@jeffsautomotive.com');

-- voided run reusing the OPEN run's period — proves the period partial unique ignores voided.
INSERT INTO public.qteklink_payroll_runs
  (id, shop_id, period_start, period_end, status, snapshot, completed_at, completed_by_label,
   voided_at, voided_by_label, void_reason)
VALUES
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa03', 7476, '2026-06-28', '2026-07-11', 'voided',
   '{"snapshot_version":1}'::jsonb, now(), 'chris@jeffsautomotive.com',
   now(), 'chris@jeffsautomotive.com', 'test void');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_runs WHERE shop_id=7476 AND period_start='2026-06-28'), 2,
  'voided run coexists with an open run for the same period (partial unique ignores voided)');

INSERT INTO public.qteklink_payroll_run_employees (id, run_id, shop_id, employee_id, role_snapshot, pay_config, clock_hours_w1)
VALUES
  ('bbbbbbbb-1111-4111-8111-bbbbbbbbbb01', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa01', 7476, '33333333-3333-4333-8333-333333333301', 'technician', '{}'::jsonb, 38.5),
  ('bbbbbbbb-1111-4111-8111-bbbbbbbbbb02', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa02', 7476, '33333333-3333-4333-8333-333333333301', 'technician', '{}'::jsonb, 40);

-- ─── Integrity CHECKs ────────────────────────────────────────────────────
SELECT throws_ok($$
  INSERT INTO public.qteklink_payroll_runs (shop_id, period_start, period_end, status)
  VALUES (7476, '2026-09-06', '2026-09-19', 'completed') $$,
  '23514', NULL, 'completed without snapshot/stamps violates the status-consistency CHECK');
SELECT throws_ok($$
  INSERT INTO public.qteklink_payroll_runs (shop_id, period_start, period_end, status, snapshot)
  VALUES (7476, '2026-09-06', '2026-09-19', 'open', '{}'::jsonb) $$,
  '23514', NULL, 'open with a snapshot violates the status-consistency CHECK');
SELECT throws_ok($$
  INSERT INTO public.qteklink_payroll_runs (shop_id, period_start, period_end, bonus_period)
  VALUES (7476, '2026-09-06', '2026-09-19', true) $$,
  '23514', NULL, 'bonus_period without bonus_month is CHECK-rejected');
SELECT throws_ok($$
  INSERT INTO public.qteklink_payroll_runs (shop_id, period_start, period_end)
  VALUES (7476, '2026-09-06', '2026-09-20') $$,
  '23514', NULL, 'period_end <> period_start + 13 is CHECK-rejected');
SELECT throws_ok($$
  INSERT INTO public.qteklink_payroll_runs (shop_id, period_start, period_end, bonus_period, bonus_month)
  VALUES (7476, '2026-09-06', '2026-09-19', true, '2026-08-15') $$,
  '23514', NULL, 'bonus_month not first-of-month is CHECK-rejected');
SELECT throws_ok($$
  INSERT INTO public.qteklink_payroll_runs (shop_id, period_start, period_end)
  VALUES (7476, '2026-06-28', '2026-07-11') $$,
  '23505', NULL, 'second non-voided run for the same (shop, period_start) is rejected');

-- bonus-month partial unique: two non-voided bonus runs for one month collide; voided does not.
INSERT INTO public.qteklink_payroll_runs (id, shop_id, period_start, period_end, bonus_period, bonus_month)
VALUES ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa04', 7476, '2026-08-09', '2026-08-22', true, '2026-07-01');
SELECT throws_ok($$
  INSERT INTO public.qteklink_payroll_runs (shop_id, period_start, period_end, bonus_period, bonus_month)
  VALUES (7476, '2026-08-23', '2026-09-05', true, '2026-07-01') $$,
  '23505', NULL, 'second non-voided bonus run for the same (shop, bonus_month) is rejected');
SELECT lives_ok($$
  INSERT INTO public.qteklink_payroll_runs
    (shop_id, period_start, period_end, status, bonus_period, bonus_month, snapshot, completed_at, completed_by_label,
     voided_at, voided_by_label, void_reason)
  VALUES (7476, '2026-08-23', '2026-09-05', 'voided', true, '2026-07-01',
          '{}'::jsonb, now(), 'chris@jeffsautomotive.com', now(), 'chris@jeffsautomotive.com', 'dup bonus test') $$,
  'a VOIDED bonus run for the same month is admitted (partial unique ignores voided)');

-- composite shop-tie FKs
SELECT throws_ok($$
  INSERT INTO public.qteklink_payroll_run_employees (run_id, shop_id, employee_id, role_snapshot, pay_config)
  VALUES ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa01', 9999, '33333333-3333-4333-8333-333333333301', 'technician', '{}'::jsonb) $$,
  '23503', NULL, 'entry row whose shop_id matches neither its run nor its employee is FK-rejected');

-- ─── The immutability wall (owner-level direct writes → trigger P0001) ───
SELECT lives_ok($$
  UPDATE public.qteklink_payroll_runs SET updated_at = now() WHERE id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa01' $$,
  'OPEN run accepts a direct UPDATE');
SELECT throws_ok($$
  UPDATE public.qteklink_payroll_runs SET updated_at = now() WHERE id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa02' $$,
  'P0001', NULL, 'COMPLETED run rejects direct UPDATE');
SELECT throws_ok($$
  UPDATE public.qteklink_payroll_runs SET snapshot = '{"tampered":true}'::jsonb WHERE id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa02' $$,
  'P0001', NULL, 'COMPLETED run rejects snapshot tampering');
SELECT throws_ok($$
  DELETE FROM public.qteklink_payroll_runs WHERE id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa02' $$,
  'P0001', NULL, 'COMPLETED run rejects direct DELETE');
SELECT throws_ok($$
  UPDATE public.qteklink_payroll_runs SET void_reason = 'rewrite' WHERE id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa03' $$,
  'P0001', NULL, 'VOIDED run rejects direct UPDATE');
SELECT throws_ok($$
  DELETE FROM public.qteklink_payroll_runs WHERE id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa03' $$,
  'P0001', NULL, 'VOIDED run rejects direct DELETE');
SELECT is((SELECT snapshot->>'snapshot_version' FROM public.qteklink_payroll_runs WHERE id='aaaaaaaa-1111-4111-8111-aaaaaaaaaa02'), '1',
  'completed snapshot is byte-for-byte unchanged after the blocked writes');

SELECT lives_ok($$
  UPDATE public.qteklink_payroll_run_employees SET clock_hours_w1 = 40 WHERE id = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbb01' $$,
  'entry row of an OPEN run accepts a direct UPDATE');
SELECT throws_ok($$
  UPDATE public.qteklink_payroll_run_employees SET clock_hours_w1 = 80 WHERE id = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbb02' $$,
  'P0001', NULL, 'entry row of a COMPLETED run rejects direct UPDATE');
SELECT throws_ok($$
  DELETE FROM public.qteklink_payroll_run_employees WHERE id = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbb02' $$,
  'P0001', NULL, 'entry row of a COMPLETED run rejects direct DELETE');
SELECT is((SELECT clock_hours_w1::text FROM public.qteklink_payroll_run_employees WHERE id='bbbbbbbb-1111-4111-8111-bbbbbbbbbb02'), '40.00',
  'locked entry hours unchanged after the blocked writes');

-- ─── GUC bypass admits the trusted path, re-arming blocks again ──────────
SELECT set_config('qteklink.payroll_lock_bypass', 'on', true) AS _;
SELECT lives_ok($$
  UPDATE public.qteklink_payroll_runs SET updated_at = now() WHERE id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa02' $$,
  'GUC bypass (payroll_lock_bypass=on) admits an UPDATE on a completed run');
SELECT set_config('qteklink.payroll_lock_bypass', 'off', true) AS _;
SELECT throws_ok($$
  UPDATE public.qteklink_payroll_runs SET updated_at = now() WHERE id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa02' $$,
  'P0001', NULL, 're-armed (payroll_lock_bypass=off) blocks again');

-- ─── Audit log: append-only, NO bypass ───────────────────────────────────
INSERT INTO public.qteklink_payroll_audit_log (shop_id, actor_label, action, detail)
VALUES (7476, 'pgtap', 'test_seed', '{}'::jsonb);
SELECT throws_ok($$
  UPDATE public.qteklink_payroll_audit_log SET action = 'rewritten' WHERE action = 'test_seed' $$,
  'P0001', NULL, 'audit log rejects UPDATE');
SELECT throws_ok($$
  DELETE FROM public.qteklink_payroll_audit_log WHERE action = 'test_seed' $$,
  'P0001', NULL, 'audit log rejects DELETE');
SELECT set_config('qteklink.payroll_lock_bypass', 'on', true) AS _;
SELECT throws_ok($$
  UPDATE public.qteklink_payroll_audit_log SET action = 'rewritten' WHERE action = 'test_seed' $$,
  'P0001', NULL, 'audit log rejects UPDATE even with the GUC on (no bypass)');
SELECT throws_ok($$
  DELETE FROM public.qteklink_payroll_audit_log WHERE action = 'test_seed' $$,
  'P0001', NULL, 'audit log rejects DELETE even with the GUC on (no bypass)');
SELECT set_config('qteklink.payroll_lock_bypass', 'off', true) AS _;
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_audit_log WHERE action='test_seed'), 1,
  'audit row intact after every blocked write');

-- ─── service_role: SELECT-only (privilege layer fires before the trigger) ─
SET ROLE service_role;
SELECT ok((SELECT count(*) FROM public.qteklink_payroll_runs) >= 3, 'service_role can SELECT runs (BYPASSRLS read path)');
SELECT throws_ok($$
  UPDATE public.qteklink_payroll_runs SET updated_at = now() WHERE id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa02' $$,
  '42501', NULL, 'service_role direct UPDATE on runs denied (privilege)');
SELECT throws_ok($$
  DELETE FROM public.qteklink_payroll_runs WHERE id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa02' $$,
  '42501', NULL, 'service_role direct DELETE on runs denied (privilege)');
SELECT throws_ok($$
  INSERT INTO public.qteklink_payroll_runs (shop_id, period_start, period_end) VALUES (7476, '2026-09-20', '2026-10-03') $$,
  '42501', NULL, 'service_role direct INSERT on runs denied (privilege)');
SELECT throws_ok($$
  UPDATE public.qteklink_payroll_run_employees SET clock_hours_w1 = 1 WHERE id = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbb01' $$,
  '42501', NULL, 'service_role direct UPDATE on run_employees denied (privilege)');
SELECT throws_ok($$
  UPDATE public.qteklink_payroll_audit_log SET action = 'x' WHERE action = 'test_seed' $$,
  '42501', NULL, 'service_role direct UPDATE on audit_log denied (privilege)');
SELECT throws_ok($$
  UPDATE public.qteklink_payroll_employees SET display_name = 'x' WHERE id = '33333333-3333-4333-8333-333333333301' $$,
  '42501', NULL, 'service_role direct UPDATE on employees denied (privilege)');
RESET ROLE;

-- ─── Open runs remain deletable; cascade passes the entry trigger ─────────
SELECT lives_ok($$
  DELETE FROM public.qteklink_payroll_runs WHERE id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa01' $$,
  'an OPEN run can be deleted (owner path)');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_run_employees WHERE run_id='aaaaaaaa-1111-4111-8111-aaaaaaaaaa01'), 0,
  'delete cascaded to the open run''s entry rows');

SELECT * FROM finish();
ROLLBACK;
