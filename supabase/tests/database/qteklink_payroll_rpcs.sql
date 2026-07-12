-- =====================================================================
-- pgTAP — QTekLink payroll RPCs (20260710210000)
-- =====================================================================
-- The full RPC surface, per the build contract (docs/qteklink/payroll-contract.md):
--   - exact signatures exist; qteklink_settings gained the payroll jsonb key
--   - upsert_employee: create/update/archive; derived tekmetric_id_type; pay_config
--     validation (required keys per family, *_cents integers >= 0, *_pct 0..1,
--     unknown keys rejected, rates_w2 employee-side rejected); tm-id partial unique
--   - create_run: anchor cadence, duplicate period, archived exclusion, roster clone
--   - update_run: bonus slider derives + stores bonus_month from the PAY DATE
--     (first of period_end's month - 1 month, round-5 #33 — 6/28-7/11 pays in
--     July => June); explicit first-of-month bonus_month patch accepted (wins
--     over derivation, malformed/off-slider rejected, never clobbered by an
--     idempotent re-send); bonus-month partial unique collides through the RPC
--     [23505]; whitelisting; January pay date derives prior-year December
--   - update_entry: key whitelisting, per-key audit, overrides shape validation,
--     rates_w2 allowed run-side, table CHECKs surface [23514], locked-run rejection
--   - update_entries (round-8 #43, 20260711220000): ONE atomic batch — happy path
--     applies + audits every row with a SHARED detail.batch_id; one bad row rolls
--     back ALL rows (values + audit rows prove untouched); a row from another run
--     RAISEs (cross-run smuggling); empty/non-array batches RAISE; completed-run
--     rejection; same single validator as update_entry (the shared helper)
--   - sync_run_roster: adds actives, removes ONLY entry-less archived rows, open-only
--   - complete_run: dry-run state hash, stale-hash abort, token scope binding,
--     single-use, expiry, cross-run rejection, snapshot required, final lock
--   - void_run: completed-only, kind-bound token, void-and-clone row integrity
--   - live snapshot (round-7 #40/#41, 20260711200000): store on OPEN only
--     (completed RAISEs), stale-flag semantics, the lost-invalidation race guard
--     (mark stamps invalidated_at on every open run; a store whose compute began
--     before the mark keeps stale=true), and NEITHER RPC moves updated_at / the
--     Pattern S state hash
--   - anon denied on every RPC
--
-- Runs as the BYPASSRLS migration role. Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

CREATE TEMP TABLE _ids (k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE _txt (k text PRIMARY KEY, v text);

-- ─── Signatures (contract fidelity) + settings payroll key ───────────────
SELECT has_function('public', 'qteklink_payroll_upsert_employee', ARRAY['integer','uuid','text','text','bigint','jsonb','boolean','uuid','text'], 'upsert_employee signature');
SELECT has_function('public', 'qteklink_payroll_create_run', ARRAY['integer','date','uuid','text'], 'create_run signature');
SELECT has_function('public', 'qteklink_payroll_sync_run_roster', ARRAY['uuid','uuid','text'], 'sync_run_roster signature');
SELECT has_function('public', 'qteklink_payroll_update_entry', ARRAY['uuid','jsonb','uuid','text'], 'update_entry signature');
-- round-8 #43 batch RPC (20260711220000) + the shared per-row validator helper
SELECT has_function('public', 'qteklink_payroll_update_entries', ARRAY['uuid','jsonb','uuid','text'], 'update_entries signature');
SELECT has_function('public', 'qteklink_payroll_apply_entry_patch', 'apply_entry_patch helper exists (the ONE validator both paths share)');
SELECT has_function('public', 'qteklink_payroll_update_run', ARRAY['uuid','jsonb','uuid','text'], 'update_run signature');
SELECT has_function('public', 'qteklink_payroll_issue_confirm_token', ARRAY['uuid','text','text','uuid','text'], 'issue_confirm_token signature');
SELECT has_function('public', 'qteklink_payroll_complete_run', ARRAY['uuid','boolean','uuid','text','jsonb','uuid','text'], 'complete_run signature');
SELECT has_function('public', 'qteklink_payroll_void_run', ARRAY['uuid','text','boolean','uuid','text','uuid','text'], 'void_run signature');
SELECT has_column('public', 'qteklink_settings', 'payroll', 'qteklink_settings.payroll jsonb key exists');
-- round-7 #40/#41 live-snapshot substrate (20260711200000)
SELECT has_function('public', 'qteklink_payroll_store_live_snapshot', ARRAY['uuid','jsonb','timestamptz','timestamptz'], 'store_live_snapshot signature');
SELECT has_function('public', 'qteklink_payroll_mark_open_runs_stale', ARRAY['integer'], 'mark_open_runs_stale signature');
SELECT has_column('public', 'qteklink_payroll_runs', 'live_snapshot', 'runs.live_snapshot column exists');
SELECT has_column('public', 'qteklink_payroll_runs', 'live_snapshot_at', 'runs.live_snapshot_at column exists');
SELECT has_column('public', 'qteklink_payroll_runs', 'live_snapshot_stale', 'runs.live_snapshot_stale column exists');
SELECT has_column('public', 'qteklink_payroll_runs', 'live_snapshot_invalidated_at', 'runs.live_snapshot_invalidated_at column exists');

-- ─── Seed: connection + payroll anchor via the extended settings upsert ──
INSERT INTO public.qbo_connections (realm_id, shop_id, access_token_expires_at, refresh_token_expires_at)
VALUES ('realm-A', 7476, now() + interval '1 hour', now() + interval '100 days'),
       ('realm-Z', 9999, now() + interval '1 hour', now() + interval '100 days');
SELECT lives_ok($$
  SELECT public.qteklink_upsert_settings(7476, 'realm-A', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    '{"anchor_period_start":"2026-06-28"}'::jsonb) $$,
  'payroll anchor stored via qteklink_upsert_settings');
SELECT public.qteklink_upsert_settings(7476, 'realm-A', true, NULL, NULL, NULL, NULL) AS _; -- 7-arg legacy call
SELECT is((SELECT payroll->>'anchor_period_start' FROM public.qteklink_settings WHERE shop_id=7476 AND realm_id='realm-A'),
  '2026-06-28', 'NULL p_payroll leaves the payroll key unchanged (partial update)');
SELECT throws_ok($$
  SELECT public.qteklink_upsert_settings(7476, 'realm-A', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    '{"anchor_period_start":"not-a-date"}'::jsonb) $$,
  'P0001', NULL, 'garbage anchor_period_start rejected');
-- shop 9999: settings exist but no payroll key (anchor-not-configured case)
SELECT public.qteklink_upsert_settings(9999, 'realm-Z', NULL, NULL, NULL, NULL, NULL) AS _;

-- ─── upsert_employee: creates + derived id type ───────────────────────────
INSERT INTO _ids VALUES ('tech1', public.qteklink_payroll_upsert_employee(
  7476, NULL, 'Jeff Cantrell', 'technician', 501,
  '{"config_version":1,"pto_balance_hours":40,"pto_accrual_hours_per_period":3.08,"hourly_rate_cents":2300,"billed_rate_cents":1000}'::jsonb,
  false, NULL, 'chris@jeffsautomotive.com'));
SELECT is((SELECT tekmetric_id_type FROM public.qteklink_payroll_employees WHERE id=(SELECT v FROM _ids WHERE k='tech1')),
  'technician', 'technician role derives tekmetric_id_type=technician');

INSERT INTO _ids VALUES ('gm1', public.qteklink_payroll_upsert_employee(
  7476, NULL, 'Zane Elshinawi', 'general_manager', 502,
  '{"config_version":1,"pto_balance_hours":40,"pto_accrual_hours_per_period":3.08,"weekly_salary_cents":115384,"gp_goal_1_cents":11500000,"gp_goal_2_cents":12500000,"sales_goal_cents":25769874,"tier1_pct":0.005,"tier2_pct":0.008,"tier3_pct":0.012,"spiff_amount_cents":500}'::jsonb,
  false, NULL, 'chris@jeffsautomotive.com'));
SELECT is((SELECT tekmetric_id_type FROM public.qteklink_payroll_employees WHERE id=(SELECT v FROM _ids WHERE k='gm1')),
  'service_writer', 'general_manager derives tekmetric_id_type=service_writer');

-- ─── upsert_employee: pay_config validation (RPC-side) ───────────────────
SELECT throws_ok($$ SELECT public.qteklink_payroll_upsert_employee(7476, NULL, 'Bad Role', 'janitor', NULL,
  '{"config_version":1,"pto_balance_hours":0,"pto_accrual_hours_per_period":0,"hourly_rate_cents":1000}'::jsonb,
  false, NULL, 'pgtap') $$, 'P0001', NULL, 'invalid role rejected');
SELECT throws_ok($$ SELECT public.qteklink_payroll_upsert_employee(7476, NULL, 'Missing Key', 'technician', NULL,
  '{"config_version":1,"pto_balance_hours":0,"pto_accrual_hours_per_period":0,"hourly_rate_cents":1000}'::jsonb,
  false, NULL, 'pgtap') $$, 'P0001', NULL, 'technician config missing billed_rate_cents rejected');
SELECT throws_ok($$ SELECT public.qteklink_payroll_upsert_employee(7476, NULL, 'Neg Cents', 'technician', NULL,
  '{"config_version":1,"pto_balance_hours":0,"pto_accrual_hours_per_period":0,"hourly_rate_cents":-1,"billed_rate_cents":1000}'::jsonb,
  false, NULL, 'pgtap') $$, 'P0001', NULL, 'negative *_cents rejected');
SELECT throws_ok($$ SELECT public.qteklink_payroll_upsert_employee(7476, NULL, 'Float Cents', 'technician', NULL,
  '{"config_version":1,"pto_balance_hours":0,"pto_accrual_hours_per_period":0,"hourly_rate_cents":23.5,"billed_rate_cents":1000}'::jsonb,
  false, NULL, 'pgtap') $$, 'P0001', NULL, 'non-integer *_cents rejected');
SELECT throws_ok($$ SELECT public.qteklink_payroll_upsert_employee(7476, NULL, 'Pct Too Big', 'service_manager', NULL,
  '{"config_version":1,"pto_balance_hours":0,"pto_accrual_hours_per_period":0,"weekly_salary_cents":96153,"gp_goal_1_cents":11500000,"gp_goal_2_cents":12500000,"sales_goal_cents":25769874,"tier1_pct":0.005,"tier2_pct":0.01,"tier3_pct":1.2,"spiff_amount_cents":500}'::jsonb,
  false, NULL, 'pgtap') $$, 'P0001', NULL, '*_pct > 1 rejected');
SELECT throws_ok($$ SELECT public.qteklink_payroll_upsert_employee(7476, NULL, 'Unknown Key', 'technician', NULL,
  '{"config_version":1,"pto_balance_hours":0,"pto_accrual_hours_per_period":0,"hourly_rate_cents":1000,"billed_rate_cents":1000,"surprise":1}'::jsonb,
  false, NULL, 'pgtap') $$, 'P0001', NULL, 'unknown top-level pay_config key rejected');
SELECT throws_ok($$ SELECT public.qteklink_payroll_upsert_employee(7476, NULL, 'Rates W2 Here', 'technician', NULL,
  '{"config_version":1,"pto_balance_hours":0,"pto_accrual_hours_per_period":0,"hourly_rate_cents":1000,"billed_rate_cents":1000,"rates_w2":{"hourly_rate_cents":1100}}'::jsonb,
  false, NULL, 'pgtap') $$, 'P0001', NULL, 'rates_w2 is run-side only — rejected on the employee record');
SELECT throws_ok($$ SELECT public.qteklink_payroll_upsert_employee(7476, NULL, 'Wrong Version', 'technician', NULL,
  '{"config_version":2,"pto_balance_hours":0,"pto_accrual_hours_per_period":0,"hourly_rate_cents":1000,"billed_rate_cents":1000}'::jsonb,
  false, NULL, 'pgtap') $$, 'P0001', NULL, 'config_version <> 1 rejected');

-- ─── upsert_employee: update / archive / tm-id partial unique ─────────────
SELECT is(public.qteklink_payroll_upsert_employee(
  7476, (SELECT v FROM _ids WHERE k='tech1'), 'Jeff Cantrell Sr', 'technician', 501,
  '{"config_version":1,"pto_balance_hours":40,"pto_accrual_hours_per_period":3.08,"hourly_rate_cents":2300,"billed_rate_cents":1000}'::jsonb,
  false, NULL, 'chris@jeffsautomotive.com'),
  (SELECT v FROM _ids WHERE k='tech1'), 'update returns the same employee id');
SELECT is((SELECT display_name FROM public.qteklink_payroll_employees WHERE id=(SELECT v FROM _ids WHERE k='tech1')),
  'Jeff Cantrell Sr', 'display_name updated');

INSERT INTO _ids VALUES ('dup_src', public.qteklink_payroll_upsert_employee(
  7476, NULL, 'Dup Source', 'office_support', 601,
  '{"config_version":1,"pto_balance_hours":0,"pto_accrual_hours_per_period":0,"hourly_rate_cents":1800}'::jsonb,
  false, NULL, 'chris@jeffsautomotive.com'));
SELECT throws_ok($$ SELECT public.qteklink_payroll_upsert_employee(7476, NULL, 'Dup New', 'shop_support', 601,
  '{"config_version":1,"pto_balance_hours":0,"pto_accrual_hours_per_period":0,"hourly_rate_cents":1800}'::jsonb,
  false, NULL, 'pgtap') $$, '23505', NULL, 'active duplicate tekmetric_employee_id rejected (partial unique)');
SELECT lives_ok($$ SELECT public.qteklink_payroll_upsert_employee(7476, (SELECT v FROM _ids WHERE k='dup_src'), 'Dup Source', 'office_support', 601,
  '{"config_version":1,"pto_balance_hours":0,"pto_accrual_hours_per_period":0,"hourly_rate_cents":1800}'::jsonb,
  true, NULL, 'chris@jeffsautomotive.com') $$, 'archive via p_archived=true');
SELECT ok((SELECT archived_at IS NOT NULL FROM public.qteklink_payroll_employees WHERE id=(SELECT v FROM _ids WHERE k='dup_src')),
  'archived_at stamped');
INSERT INTO _ids VALUES ('dup_new2', public.qteklink_payroll_upsert_employee(
  7476, NULL, 'Dup New Two', 'shop_support', 601,
  '{"config_version":1,"pto_balance_hours":0,"pto_accrual_hours_per_period":0,"hourly_rate_cents":1800}'::jsonb,
  false, NULL, 'chris@jeffsautomotive.com'));
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_employees WHERE shop_id=7476 AND tekmetric_employee_id=601), 2,
  'archived + active may share a tekmetric id (partial unique scoped to active)');
SELECT ok((SELECT count(*) FROM public.qteklink_payroll_audit_log WHERE action='employee_created' AND shop_id=7476) >= 3,
  'employee creates audited');

-- ─── create_run: cadence + duplicates + roster clone + archived exclusion ─
INSERT INTO _ids VALUES ('runA', public.qteklink_payroll_create_run(7476, '2026-06-28'::date, NULL, 'chris@jeffsautomotive.com'));
SELECT is((SELECT period_end::text FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runA')),
  '2026-07-11', 'period_end derived = period_start + 13');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_run_employees WHERE run_id=(SELECT v FROM _ids WHERE k='runA')), 3,
  'run roster = the 3 ACTIVE employees (archived excluded)');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_run_employees
           WHERE run_id=(SELECT v FROM _ids WHERE k='runA') AND employee_id=(SELECT v FROM _ids WHERE k='dup_src')), 0,
  'archived employee not rostered');
SELECT is((SELECT pay_config->>'hourly_rate_cents' FROM public.qteklink_payroll_run_employees
           WHERE run_id=(SELECT v FROM _ids WHERE k='runA') AND employee_id=(SELECT v FROM _ids WHERE k='tech1')),
  '2300', 'pay_config cloned into the run row');
SELECT throws_ok($$ SELECT public.qteklink_payroll_create_run(7476, '2026-07-01'::date, NULL, 'pgtap') $$,
  'P0001', NULL, 'off-cadence period_start rejected');
SELECT throws_ok($$ SELECT public.qteklink_payroll_create_run(7476, '2026-06-28'::date, NULL, 'pgtap') $$,
  'P0001', NULL, 'duplicate (non-voided) period rejected');
SELECT throws_ok($$ SELECT public.qteklink_payroll_create_run(9999, '2026-06-28'::date, NULL, 'pgtap') $$,
  'P0001', NULL, 'shop without payroll.anchor_period_start configured rejected');

-- ─── update_entry: whitelisting + validation + per-key audit ──────────────
INSERT INTO _ids
SELECT 'reA_tech1', re.id FROM public.qteklink_payroll_run_employees re
WHERE re.run_id=(SELECT v FROM _ids WHERE k='runA') AND re.employee_id=(SELECT v FROM _ids WHERE k='tech1');

SELECT lives_ok($$ SELECT public.qteklink_payroll_update_entry((SELECT v FROM _ids WHERE k='reA_tech1'),
  '{"clock_hours_w1": 41.25, "pto_w1": 8}'::jsonb, NULL, 'marie@jeffsautomotive.com') $$, 'hours patch accepted');
SELECT is((SELECT clock_hours_w1::text || '/' || pto_w1::text FROM public.qteklink_payroll_run_employees WHERE id=(SELECT v FROM _ids WHERE k='reA_tech1')),
  '41.25/8.00', 'hour values stored');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_entry((SELECT v FROM _ids WHERE k='reA_tech1'),
  '{"ot_hours_w1": 2}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'non-whitelisted key rejected');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_entry((SELECT v FROM _ids WHERE k='reA_tech1'),
  '{"clock_hours_w1": "forty"}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'non-numeric hour value rejected');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_entry((SELECT v FROM _ids WHERE k='reA_tech1'),
  '{"clock_hours_w1": 200}'::jsonb, NULL, 'pgtap') $$, '23514', NULL, 'hour value over 120 hits the table CHECK');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_entry((SELECT v FROM _ids WHERE k='reA_tech1'),
  '{"manual_incentive_cents": -5}'::jsonb, NULL, 'pgtap') $$, '23514', NULL, 'negative incentive hits the table CHECK');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_entry((SELECT v FROM _ids WHERE k='reA_tech1'),
  '{"manual_incentive_cents": 10.5}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'non-integer incentive rejected');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_entry((SELECT v FROM _ids WHERE k='reA_tech1'),
  '{}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'empty patch rejected');

SELECT lives_ok($$ SELECT public.qteklink_payroll_update_entry((SELECT v FROM _ids WHERE k='reA_tech1'),
  '{"overrides": {"billed_hours_w1": {"value": 38.5, "note": "from workbook"}}}'::jsonb, NULL, 'marie@jeffsautomotive.com') $$,
  'valid overrides patch accepted');
SELECT is((SELECT overrides->'billed_hours_w1'->>'value' FROM public.qteklink_payroll_run_employees WHERE id=(SELECT v FROM _ids WHERE k='reA_tech1')),
  '38.5', 'override value stored');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_entry((SELECT v FROM _ids WHERE k='reA_tech1'),
  '{"overrides": {"surprise_field": {"value": 1}}}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'unknown overrides key rejected');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_entry((SELECT v FROM _ids WHERE k='reA_tech1'),
  '{"overrides": {"spiff_count": {"note": "no value"}}}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'override without value rejected');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_entry((SELECT v FROM _ids WHERE k='reA_tech1'),
  '{"overrides": {"spiff_count": {"value": 3, "who": "x"}}}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'extra key inside an override entry rejected');

SELECT lives_ok($$ SELECT public.qteklink_payroll_update_entry((SELECT v FROM _ids WHERE k='reA_tech1'),
  '{"pay_config": {"config_version":1,"pto_balance_hours":40,"pto_accrual_hours_per_period":3.08,"hourly_rate_cents":2300,"billed_rate_cents":1000,"rates_w2":{"hourly_rate_cents":2400}}}'::jsonb,
  NULL, 'chris@jeffsautomotive.com') $$, 'run-side pay_config patch with rates_w2 accepted');
SELECT is((SELECT pay_config->'rates_w2'->>'hourly_rate_cents' FROM public.qteklink_payroll_run_employees WHERE id=(SELECT v FROM _ids WHERE k='reA_tech1')),
  '2400', 'rates_w2 stored on the run row');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_entry((SELECT v FROM _ids WHERE k='reA_tech1'),
  '{"pay_config": {"config_version":1,"pto_balance_hours":40,"pto_accrual_hours_per_period":3.08,"hourly_rate_cents":2300,"billed_rate_cents":1000,"foo":1}}'::jsonb,
  NULL, 'pgtap') $$, 'P0001', NULL, 'run-side pay_config still rejects unknown keys');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_audit_log
           WHERE action='entry_updated' AND run_employee_id=(SELECT v FROM _ids WHERE k='reA_tech1')), 4,
  'entry edits audited old->new PER KEY (2 hours + overrides + pay_config = 4 rows)');

-- round-5 #32: shop_hour_goal joins the overrides whitelist (the foreman goal is
-- auto-derived from prior-year shop hours and must be overridable per run). The
-- RPC replaces overrides WHOLE, so the earlier billed_hours_w1 override rides along.
SELECT lives_ok($$ SELECT public.qteklink_payroll_update_entry((SELECT v FROM _ids WHERE k='reA_tech1'),
  '{"overrides": {"billed_hours_w1": {"value": 38.5, "note": "from workbook"},
                  "shop_hour_goal": {"value": 1180.25, "note": "use adjusted 2025 June hours"}}}'::jsonb,
  NULL, 'marie@jeffsautomotive.com') $$, 'shop_hour_goal override accepted (round-5 #32 whitelist)');
SELECT is((SELECT overrides->'shop_hour_goal'->>'value' FROM public.qteklink_payroll_run_employees WHERE id=(SELECT v FROM _ids WHERE k='reA_tech1')),
  '1180.25', 'shop_hour_goal override stored');

-- ─── update_run: bonus slider + pay-date derivation + explicit month ──────
SELECT lives_ok($$ SELECT public.qteklink_payroll_update_run((SELECT v FROM _ids WHERE k='runA'),
  '{"bonus_period": true}'::jsonb, NULL, 'chris@jeffsautomotive.com') $$, 'bonus slider ON accepted');
SELECT is((SELECT bonus_month::text FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runA')),
  '2026-06-01', 'bonus_month derived from the PAY DATE = first of (period_end month - 1): 6/28-7/11 pays in July => June (round-5 #33)');

-- explicit office-manager month pick (round-5 #33): wins over the derivation,
-- survives an idempotent slider re-send, and every malformed shape RAISEs.
SELECT lives_ok($$ SELECT public.qteklink_payroll_update_run((SELECT v FROM _ids WHERE k='runA'),
  '{"bonus_month": "2026-04-01"}'::jsonb, NULL, 'marie@jeffsautomotive.com') $$,
  'explicit first-of-month bonus_month accepted while the slider is on');
SELECT is((SELECT bonus_month::text FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runA')),
  '2026-04-01', 'explicit bonus_month stored (wins over the derivation)');
SELECT lives_ok($$ SELECT public.qteklink_payroll_update_run((SELECT v FROM _ids WHERE k='runA'),
  '{"bonus_period": true}'::jsonb, NULL, 'chris@jeffsautomotive.com') $$, 'idempotent bonus_period=true re-send accepted');
SELECT is((SELECT bonus_month::text FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runA')),
  '2026-04-01', 'a re-sent ON slider keeps the explicit month (no re-derivation clobber)');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_run((SELECT v FROM _ids WHERE k='runA'),
  '{"bonus_month": "2026-04-15"}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'mid-month bonus_month rejected (must be the first of a month)');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_run((SELECT v FROM _ids WHERE k='runA'),
  '{"bonus_month": "not-a-date"}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'malformed bonus_month string rejected');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_run((SELECT v FROM _ids WHERE k='runA'),
  '{"bonus_month": "2026-13-01"}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'impossible calendar month rejected');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_run((SELECT v FROM _ids WHERE k='runA'),
  '{"bonus_month": 42}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'non-string bonus_month rejected');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_run((SELECT v FROM _ids WHERE k='runA'),
  '{"bonus_period": false, "bonus_month": "2026-04-01"}'::jsonb, NULL, 'pgtap') $$,
  'P0001', NULL, 'bonus_month rejected while the slider is turning OFF in the same patch');

SELECT lives_ok($$ SELECT public.qteklink_payroll_update_run((SELECT v FROM _ids WHERE k='runA'),
  '{"bonus_period": false}'::jsonb, NULL, 'chris@jeffsautomotive.com') $$, 'bonus slider OFF accepted');
SELECT ok((SELECT bonus_month IS NULL FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runA')),
  'bonus_month cleared with the slider (explicit pick included)');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_run((SELECT v FROM _ids WHERE k='runA'),
  '{"bonus_month": "2026-04-01"}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'bonus_month rejected while the slider is off');
SELECT lives_ok($$ SELECT public.qteklink_payroll_update_run((SELECT v FROM _ids WHERE k='runA'),
  '{"bonus_period": true}'::jsonb, NULL, 'chris@jeffsautomotive.com') $$, 'slider back ON after a clear');
SELECT is((SELECT bonus_month::text FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runA')),
  '2026-06-01', 'turning the slider back on re-derives the pay-date month (the cleared explicit pick is gone)');
SELECT public.qteklink_payroll_update_run((SELECT v FROM _ids WHERE k='runA'), '{"bonus_period": false}'::jsonb, NULL, 'chris@jeffsautomotive.com') AS _;
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_run((SELECT v FROM _ids WHERE k='runA'),
  '{"status": "completed"}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'update_run rejects non-whitelisted keys');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_run((SELECT v FROM _ids WHERE k='runA'),
  '{"bonus_period": "yes"}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'update_run rejects a non-boolean slider');

-- ─── sync_run_roster ──────────────────────────────────────────────────────
INSERT INTO _ids VALUES ('e5', public.qteklink_payroll_upsert_employee(
  7476, NULL, 'New Hire Five', 'technician', NULL,
  '{"config_version":1,"pto_balance_hours":0,"pto_accrual_hours_per_period":0,"hourly_rate_cents":2000,"billed_rate_cents":900}'::jsonb,
  false, NULL, 'chris@jeffsautomotive.com'));
INSERT INTO _txt VALUES ('sync1',
  (public.qteklink_payroll_sync_run_roster((SELECT v FROM _ids WHERE k='runA'), NULL, 'chris@jeffsautomotive.com'))::text);
SELECT is(jsonb_array_length(((SELECT v FROM _txt WHERE k='sync1'))::jsonb->'added'), 1, 'sync added the new employee');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_run_employees WHERE run_id=(SELECT v FROM _ids WHERE k='runA')), 4,
  'roster grew to 4');
SELECT lives_ok($$ SELECT public.qteklink_payroll_upsert_employee(7476, (SELECT v FROM _ids WHERE k='e5'), 'New Hire Five', 'technician', NULL,
  '{"config_version":1,"pto_balance_hours":0,"pto_accrual_hours_per_period":0,"hourly_rate_cents":2000,"billed_rate_cents":900}'::jsonb,
  true, NULL, 'chris@jeffsautomotive.com') $$, 'archive the entry-less new hire');
INSERT INTO _txt VALUES ('sync2',
  (public.qteklink_payroll_sync_run_roster((SELECT v FROM _ids WHERE k='runA'), NULL, 'chris@jeffsautomotive.com'))::text);
SELECT is(jsonb_array_length(((SELECT v FROM _txt WHERE k='sync2'))::jsonb->'removed'), 1, 'sync removed the entry-less archived row');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_run_employees WHERE run_id=(SELECT v FROM _ids WHERE k='runA')), 3,
  'roster back to 3');

INSERT INTO _ids VALUES ('e6', public.qteklink_payroll_upsert_employee(
  7476, NULL, 'Support Six', 'shop_support', NULL,
  '{"config_version":1,"pto_balance_hours":0,"pto_accrual_hours_per_period":0,"hourly_rate_cents":1700}'::jsonb,
  false, NULL, 'chris@jeffsautomotive.com'));
SELECT public.qteklink_payroll_sync_run_roster((SELECT v FROM _ids WHERE k='runA'), NULL, 'chris@jeffsautomotive.com') AS _;
INSERT INTO _ids
SELECT 'reA_e6', re.id FROM public.qteklink_payroll_run_employees re
WHERE re.run_id=(SELECT v FROM _ids WHERE k='runA') AND re.employee_id=(SELECT v FROM _ids WHERE k='e6');
SELECT public.qteklink_payroll_update_entry((SELECT v FROM _ids WHERE k='reA_e6'), '{"clock_hours_w1": 10}'::jsonb, NULL, 'marie@jeffsautomotive.com') AS _;
SELECT lives_ok($$ SELECT public.qteklink_payroll_upsert_employee(7476, (SELECT v FROM _ids WHERE k='e6'), 'Support Six', 'shop_support', NULL,
  '{"config_version":1,"pto_balance_hours":0,"pto_accrual_hours_per_period":0,"hourly_rate_cents":1700}'::jsonb,
  true, NULL, 'chris@jeffsautomotive.com') $$, 'archive the employee WITH entered data');
INSERT INTO _txt VALUES ('sync3',
  (public.qteklink_payroll_sync_run_roster((SELECT v FROM _ids WHERE k='runA'), NULL, 'chris@jeffsautomotive.com'))::text);
SELECT is(jsonb_array_length(((SELECT v FROM _txt WHERE k='sync3'))::jsonb->'removed'), 0,
  'a row WITH entries is never removed by roster sync');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_run_employees WHERE run_id=(SELECT v FROM _ids WHERE k='runA')), 4,
  'roster holds at 4 (archived-with-data row kept)');
SELECT throws_ok($$ SELECT public.qteklink_payroll_sync_run_roster(gen_random_uuid(), NULL, 'pgtap') $$,
  'P0001', NULL, 'sync on an unknown run rejected');

-- ─── bonus-month collision through the RPC (two runs, same derived month) ─
-- Pay-date derivation: 7/26-8/8 AND 8/9-8/22 both END in August => both derive July.
INSERT INTO _ids VALUES ('runC', public.qteklink_payroll_create_run(7476, '2026-08-09'::date, NULL, 'chris@jeffsautomotive.com'));
INSERT INTO _ids VALUES ('runD', public.qteklink_payroll_create_run(7476, '2026-07-26'::date, NULL, 'chris@jeffsautomotive.com'));
SELECT lives_ok($$ SELECT public.qteklink_payroll_update_run((SELECT v FROM _ids WHERE k='runC'),
  '{"bonus_period": true}'::jsonb, NULL, 'chris@jeffsautomotive.com') $$, 'first run PAID in August takes the July bonus month');
SELECT is((SELECT bonus_month::text FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runC')),
  '2026-07-01', 'runC (8/9-8/22, paid in August) derives July');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_run((SELECT v FROM _ids WHERE k='runD'),
  '{"bonus_period": true}'::jsonb, NULL, 'pgtap') $$, '23505', NULL,
  'second bonus run deriving the same month rejected (partial unique via RPC)');
SELECT public.qteklink_payroll_update_run((SELECT v FROM _ids WHERE k='runC'), '{"bonus_period": false}'::jsonb, NULL, 'chris@jeffsautomotive.com') AS _;

-- ─── New-Year straddle: a run PAID in January pays prior-year December ────
INSERT INTO _ids VALUES ('runNY', public.qteklink_payroll_create_run(7476, '2026-12-27'::date, NULL, 'chris@jeffsautomotive.com'));
SELECT lives_ok($$ SELECT public.qteklink_payroll_update_run((SELECT v FROM _ids WHERE k='runNY'),
  '{"bonus_period": true}'::jsonb, NULL, 'chris@jeffsautomotive.com') $$, 'New-Year-straddling run takes the slider');
SELECT is((SELECT bonus_month::text FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runNY')),
  '2026-12-01', 'period_end 2027-01-09 (paid in January) derives prior-year December');
SELECT public.qteklink_payroll_update_run((SELECT v FROM _ids WHERE k='runNY'), '{"bonus_period": false}'::jsonb, NULL, 'chris@jeffsautomotive.com') AS _;

-- ─── update_entries: the round-8 #43 atomic batch ─────────────────────────
-- Rows used: reA_tech1 (already keyed), plus gm1 + dup_new2's runA rows. The
-- happy-path patches deliberately avoid the fields the void-and-clone section
-- asserts later (clock/pto/overrides/rates_w2 on reA_tech1 stay untouched).
INSERT INTO _ids
SELECT 'reA_gm1', re.id FROM public.qteklink_payroll_run_employees re
WHERE re.run_id=(SELECT v FROM _ids WHERE k='runA') AND re.employee_id=(SELECT v FROM _ids WHERE k='gm1');
INSERT INTO _ids
SELECT 'reA_dup2', re.id FROM public.qteklink_payroll_run_employees re
WHERE re.run_id=(SELECT v FROM _ids WHERE k='runA') AND re.employee_id=(SELECT v FROM _ids WHERE k='dup_new2');
INSERT INTO _ids
SELECT 'reC_tech1', re.id FROM public.qteklink_payroll_run_employees re
WHERE re.run_id=(SELECT v FROM _ids WHERE k='runC') AND re.employee_id=(SELECT v FROM _ids WHERE k='tech1');

-- happy batch: 3 rows in ONE call → all applied, {updated: 3}
INSERT INTO _txt VALUES ('batch1',
  (public.qteklink_payroll_update_entries(
     (SELECT v FROM _ids WHERE k='runA'),
     jsonb_build_array(
       jsonb_build_object('run_employee_id', (SELECT v FROM _ids WHERE k='reA_tech1'), 'patch', '{"training_w1": 2}'::jsonb),
       jsonb_build_object('run_employee_id', (SELECT v FROM _ids WHERE k='reA_gm1'),   'patch', '{"clock_hours_w1": 40, "pto_w2": 4}'::jsonb),
       jsonb_build_object('run_employee_id', (SELECT v FROM _ids WHERE k='reA_dup2'),  'patch', '{"manual_incentive_cents": 2500}'::jsonb)
     ), NULL, 'marie@jeffsautomotive.com'))::text);
SELECT is(((SELECT v FROM _txt WHERE k='batch1')::jsonb)->>'updated', '3', 'batch returns {updated: 3}');
SELECT is((SELECT training_w1::text FROM public.qteklink_payroll_run_employees WHERE id=(SELECT v FROM _ids WHERE k='reA_tech1')),
  '2.00', 'batch row 1 applied (training_w1)');
SELECT is((SELECT clock_hours_w1::text || '/' || pto_w2::text FROM public.qteklink_payroll_run_employees WHERE id=(SELECT v FROM _ids WHERE k='reA_gm1')),
  '40.00/4.00', 'batch row 2 applied (two keys)');
SELECT is((SELECT manual_incentive_cents::text FROM public.qteklink_payroll_run_employees WHERE id=(SELECT v FROM _ids WHERE k='reA_dup2')),
  '2500', 'batch row 3 applied (manual_incentive_cents)');
-- per-row audit preserved: same entry_updated per-key old->new shape, PLUS one
-- SHARED batch_id across all four key rows (1 + 2 + 1 keys).
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_audit_log
           WHERE action='entry_updated' AND run_id=(SELECT v FROM _ids WHERE k='runA') AND detail ? 'batch_id'), 4,
  'batch audited per key (1+2+1 = 4 rows carrying batch_id)');
SELECT is((SELECT count(DISTINCT detail->>'batch_id')::int FROM public.qteklink_payroll_audit_log
           WHERE action='entry_updated' AND run_id=(SELECT v FROM _ids WHERE k='runA') AND detail ? 'batch_id'), 1,
  'all four audit rows share ONE batch_id');
SELECT is((SELECT detail->>'key' || '/' || (detail->'old')::text || '/' || (detail->'new')::text
           FROM public.qteklink_payroll_audit_log
           WHERE action='entry_updated' AND run_employee_id=(SELECT v FROM _ids WHERE k='reA_dup2') AND detail ? 'batch_id'),
  'manual_incentive_cents/null/2500', 'batch audit detail keeps the single-update {key, old, new} shape');

-- one bad row rolls back ALL (atomic): capture pre-state, attempt a 2-row batch
-- whose second row is invalid, prove NOTHING moved (values + audit row counts).
INSERT INTO _txt VALUES ('audit_n_before',
  (SELECT count(*)::text FROM public.qteklink_payroll_audit_log WHERE action='entry_updated'));
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_entries(
  (SELECT v FROM _ids WHERE k='runA'),
  jsonb_build_array(
    jsonb_build_object('run_employee_id', (SELECT v FROM _ids WHERE k='reA_tech1'), 'patch', '{"training_w2": 3}'::jsonb),
    jsonb_build_object('run_employee_id', (SELECT v FROM _ids WHERE k='reA_gm1'),   'patch', '{"clock_hours_w1": "forty"}'::jsonb)
  ), NULL, 'pgtap') $$, 'P0001', NULL, 'one invalid row aborts the whole batch');
SELECT ok((SELECT training_w2 IS NULL FROM public.qteklink_payroll_run_employees WHERE id=(SELECT v FROM _ids WHERE k='reA_tech1')),
  'the VALID first row was rolled back too (training_w2 untouched)');
SELECT is((SELECT clock_hours_w1::text FROM public.qteklink_payroll_run_employees WHERE id=(SELECT v FROM _ids WHERE k='reA_gm1')),
  '40.00', 'the invalid row itself is untouched');
SELECT is((SELECT count(*)::text FROM public.qteklink_payroll_audit_log WHERE action='entry_updated'),
  (SELECT v FROM _txt WHERE k='audit_n_before'), 'no audit rows survive the rolled-back batch');

-- cross-run smuggling: a row from runC inside a runA batch RAISEs and rolls
-- back the batch's valid rows.
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_entries(
  (SELECT v FROM _ids WHERE k='runA'),
  jsonb_build_array(
    jsonb_build_object('run_employee_id', (SELECT v FROM _ids WHERE k='reA_tech1'), 'patch', '{"holiday_w1": 1}'::jsonb),
    jsonb_build_object('run_employee_id', (SELECT v FROM _ids WHERE k='reC_tech1'), 'patch', '{"holiday_w1": 1}'::jsonb)
  ), NULL, 'pgtap') $$, 'P0001', NULL, 'a row belonging to ANOTHER run rejects the batch (no cross-run smuggling)');
SELECT ok((SELECT holiday_w1 IS NULL FROM public.qteklink_payroll_run_employees WHERE id=(SELECT v FROM _ids WHERE k='reA_tech1')),
  'the cross-run batch applied nothing (valid row rolled back)');
SELECT ok((SELECT holiday_w1 IS NULL FROM public.qteklink_payroll_run_employees WHERE id=(SELECT v FROM _ids WHERE k='reC_tech1')),
  'the smuggled other-run row is untouched');

-- batch shape validation
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_entries((SELECT v FROM _ids WHERE k='runA'),
  '[]'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'empty batch rejected');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_entries((SELECT v FROM _ids WHERE k='runA'),
  '{"run_employee_id": "x"}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'non-array p_patches rejected');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_entries((SELECT v FROM _ids WHERE k='runA'),
  jsonb_build_array(jsonb_build_object('run_employee_id', (SELECT v FROM _ids WHERE k='reA_tech1'),
                                       'patch', '{"training_w1": 1}'::jsonb, 'surprise', 1)),
  NULL, 'pgtap') $$, 'P0001', NULL, 'unexpected batch element key rejected');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_entries((SELECT v FROM _ids WHERE k='runA'),
  '[{"run_employee_id": "not-a-uuid", "patch": {"training_w1": 1}}]'::jsonb,
  NULL, 'pgtap') $$, 'P0001', NULL, 'malformed run_employee_id rejected');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_entries((SELECT v FROM _ids WHERE k='runA'),
  jsonb_build_array(jsonb_build_object('run_employee_id', (SELECT v FROM _ids WHERE k='reA_tech1'), 'patch', '{}'::jsonb)),
  NULL, 'pgtap') $$, 'P0001', NULL, 'empty per-row patch rejected (the shared validator)');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_entries((SELECT v FROM _ids WHERE k='runA'),
  jsonb_build_array(jsonb_build_object('run_employee_id', (SELECT v FROM _ids WHERE k='reA_tech1'), 'patch', '{"ot_hours_w1": 2}'::jsonb)),
  NULL, 'pgtap') $$, 'P0001', NULL, 'non-whitelisted key rejected through the batch (same validator as update_entry)');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_entries(gen_random_uuid(),
  '[{"run_employee_id": "00000000-0000-4000-8000-000000000001", "patch": {"training_w1": 1}}]'::jsonb,
  NULL, 'pgtap') $$, 'P0001', NULL, 'unknown run rejected');

-- ─── complete_run: the Pattern S token dance ──────────────────────────────
INSERT INTO _txt VALUES ('hashA',
  (public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='runA'), true, NULL, NULL, NULL, NULL, 'chris@jeffsautomotive.com'))->>'state_hash');
SELECT is(length((SELECT v FROM _txt WHERE k='hashA')), 32, 'dry run returns an md5 state hash');
SELECT throws_ok($$ SELECT public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='runA'), false, NULL,
  'deadbeef', '{"snapshot_version":1}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'wrong state hash aborts');

INSERT INTO _ids
SELECT 'tokT1', f.token_id FROM public.qteklink_payroll_issue_confirm_token(
  (SELECT v FROM _ids WHERE k='runA'), 'complete_run', (SELECT v FROM _txt WHERE k='hashA'), NULL, 'chris@jeffsautomotive.com') AS f;
SELECT ok((SELECT expires_at FROM public.qteklink_payroll_confirm_tokens WHERE id=(SELECT v FROM _ids WHERE k='tokT1'))
          BETWEEN now() + interval '4 minutes' AND now() + interval '6 minutes', 'token carries the 5-minute TTL');

-- state moves between preview and confirm -> stale-hash abort
SELECT public.qteklink_payroll_update_run((SELECT v FROM _ids WHERE k='runA'), '{"bonus_period": true}'::jsonb, NULL, 'chris@jeffsautomotive.com') AS _;
SELECT throws_ok($$ SELECT public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='runA'), false,
  (SELECT v FROM _ids WHERE k='tokT1'), (SELECT v FROM _txt WHERE k='hashA'), '{"snapshot_version":1}'::jsonb, NULL, 'pgtap') $$,
  'P0001', NULL, 'stale state hash aborts the completion');
INSERT INTO _txt VALUES ('hashA2',
  (public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='runA'), true, NULL, NULL, NULL, NULL, 'chris@jeffsautomotive.com'))->>'state_hash');
SELECT isnt((SELECT v FROM _txt WHERE k='hashA2'), (SELECT v FROM _txt WHERE k='hashA'), 'the bonus toggle changed the state hash');
SELECT throws_ok($$ SELECT public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='runA'), false,
  (SELECT v FROM _ids WHERE k='tokT1'), (SELECT v FROM _txt WHERE k='hashA2'), '{"snapshot_version":1}'::jsonb, NULL, 'pgtap') $$,
  'P0001', NULL, 'token issued against the OLD hash is scope-rejected');

INSERT INTO _ids
SELECT 'tokT2', f.token_id FROM public.qteklink_payroll_issue_confirm_token(
  (SELECT v FROM _ids WHERE k='runA'), 'complete_run', (SELECT v FROM _txt WHERE k='hashA2'), NULL, 'chris@jeffsautomotive.com') AS f;
SELECT throws_ok($$ SELECT public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='runA'), false,
  (SELECT v FROM _ids WHERE k='tokT2'), (SELECT v FROM _txt WHERE k='hashA2'), NULL, NULL, 'pgtap') $$,
  'P0001', NULL, 'non-dry completion without a snapshot rejected');
SELECT ok((SELECT consumed_at IS NULL FROM public.qteklink_payroll_confirm_tokens WHERE id=(SELECT v FROM _ids WHERE k='tokT2')),
  'token untouched by the failed (snapshot-less) attempt');

-- token bound to a DIFFERENT run is rejected
INSERT INTO _ids
SELECT 'tokOther', f.token_id FROM public.qteklink_payroll_issue_confirm_token(
  (SELECT v FROM _ids WHERE k='runC'), 'complete_run', (SELECT v FROM _txt WHERE k='hashA2'), NULL, 'chris@jeffsautomotive.com') AS f;
SELECT throws_ok($$ SELECT public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='runA'), false,
  (SELECT v FROM _ids WHERE k='tokOther'), (SELECT v FROM _txt WHERE k='hashA2'), '{"snapshot_version":1}'::jsonb, NULL, 'pgtap') $$,
  'P0001', NULL, 'token issued for another run rejected');

-- single-use: a consumed token never validates again
INSERT INTO _ids
SELECT 'tokT3', f.token_id FROM public.qteklink_payroll_issue_confirm_token(
  (SELECT v FROM _ids WHERE k='runA'), 'complete_run', (SELECT v FROM _txt WHERE k='hashA2'), NULL, 'chris@jeffsautomotive.com') AS f;
UPDATE public.qteklink_payroll_confirm_tokens SET consumed_at = now() WHERE id = (SELECT v FROM _ids WHERE k='tokT3');
SELECT throws_ok($$ SELECT public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='runA'), false,
  (SELECT v FROM _ids WHERE k='tokT3'), (SELECT v FROM _txt WHERE k='hashA2'), '{"snapshot_version":1}'::jsonb, NULL, 'pgtap') $$,
  'P0001', NULL, 'consumed token rejected (single-use)');

-- expiry
INSERT INTO _ids
SELECT 'tokT4', f.token_id FROM public.qteklink_payroll_issue_confirm_token(
  (SELECT v FROM _ids WHERE k='runA'), 'complete_run', (SELECT v FROM _txt WHERE k='hashA2'), NULL, 'chris@jeffsautomotive.com') AS f;
UPDATE public.qteklink_payroll_confirm_tokens SET expires_at = now() - interval '1 second' WHERE id = (SELECT v FROM _ids WHERE k='tokT4');
SELECT throws_ok($$ SELECT public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='runA'), false,
  (SELECT v FROM _ids WHERE k='tokT4'), (SELECT v FROM _txt WHERE k='hashA2'), '{"snapshot_version":1}'::jsonb, NULL, 'pgtap') $$,
  'P0001', NULL, 'expired token rejected');

-- the real completion
INSERT INTO _txt VALUES ('compres',
  (public.qteklink_payroll_complete_run(
     (SELECT v FROM _ids WHERE k='runA'), false,
     (SELECT v FROM _ids WHERE k='tokT2'),
     (SELECT v FROM _txt WHERE k='hashA2'),
     '{"snapshot_version":1,"note":"pgtap"}'::jsonb,
     NULL, 'chris@jeffsautomotive.com'))::text);
SELECT is(((SELECT v FROM _txt WHERE k='compres')::jsonb)->>'completed', 'true', 'complete_run returned {completed: true}');
SELECT is((SELECT status || '/' || (snapshot->>'snapshot_version') || '/' || completed_by_label
           FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runA')),
  'completed/1/chris@jeffsautomotive.com', 'status + snapshot + completion stamps written');
SELECT ok((SELECT consumed_at IS NOT NULL FROM public.qteklink_payroll_confirm_tokens WHERE id=(SELECT v FROM _ids WHERE k='tokT2')),
  'winning token consumed atomically');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_audit_log
           WHERE action='run_completed' AND run_id=(SELECT v FROM _ids WHERE k='runA')), 1, 'completion audited');
SELECT throws_ok($$ SELECT public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='runA'), false,
  (SELECT v FROM _ids WHERE k='tokT2'), (SELECT v FROM _txt WHERE k='hashA2'), '{"snapshot_version":1}'::jsonb, NULL, 'pgtap') $$,
  'P0001', NULL, 'a completed run cannot be completed again');

-- completed run is locked against every open-run RPC
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_entry((SELECT v FROM _ids WHERE k='reA_tech1'),
  '{"clock_hours_w1": 12}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'update_entry rejected on a completed run');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_entries((SELECT v FROM _ids WHERE k='runA'),
  jsonb_build_array(jsonb_build_object('run_employee_id', (SELECT v FROM _ids WHERE k='reA_tech1'), 'patch', '{"training_w1": 1}'::jsonb)),
  NULL, 'pgtap') $$, 'P0001', NULL, 'update_entries (batch) rejected on a completed run');
SELECT is((SELECT training_w1::text FROM public.qteklink_payroll_run_employees WHERE id=(SELECT v FROM _ids WHERE k='reA_tech1')),
  '2.00', 'the completed run''s entry values are untouched by the rejected batch');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_run((SELECT v FROM _ids WHERE k='runA'),
  '{"bonus_period": false}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'update_run rejected on a completed run');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_run((SELECT v FROM _ids WHERE k='runA'),
  '{"bonus_month": "2026-06-01"}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'bonus_month patch rejected on a completed run');
SELECT throws_ok($$ SELECT public.qteklink_payroll_sync_run_roster((SELECT v FROM _ids WHERE k='runA'), NULL, 'pgtap') $$,
  'P0001', NULL, 'sync_run_roster rejected on a completed run');

-- ─── live snapshot (round-7 #40/#41): store on open only; mark-stale flips open ──
-- runA is COMPLETED here; runC/runD/runNY are OPEN. Neither RPC may move the
-- Pattern S state hash or updated_at (a display-cache write must never
-- invalidate an in-flight complete/void preview).
INSERT INTO _txt VALUES ('lhashC', public.qteklink_payroll_state_hash((SELECT v FROM _ids WHERE k='runC')));
INSERT INTO _txt VALUES ('lupdC', (SELECT updated_at::text FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runC')));
SELECT ok((SELECT live_snapshot_stale FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runC')),
  'live_snapshot_stale defaults to true (no snapshot stored yet)');
SELECT lives_ok($$ SELECT public.qteklink_payroll_store_live_snapshot((SELECT v FROM _ids WHERE k='runC'),
  '{"snapshot_version":1,"note":"live-pgtap"}'::jsonb, '2026-07-11T12:00:00Z'::timestamptz, now()) $$,
  'store_live_snapshot accepted on an OPEN run');
SELECT is((SELECT (live_snapshot->>'note') || '/' || live_snapshot_stale::text || '/' || live_snapshot_at::text
           FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runC')),
  'live-pgtap/false/' || '2026-07-11T12:00:00Z'::timestamptz::text,
  'live snapshot + computed_at stored; stale cleared');
SELECT is((SELECT updated_at::text FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runC')),
  (SELECT v FROM _txt WHERE k='lupdC'), 'store_live_snapshot does NOT bump updated_at');
SELECT is(public.qteklink_payroll_state_hash((SELECT v FROM _ids WHERE k='runC')),
  (SELECT v FROM _txt WHERE k='lhashC'), 'store_live_snapshot does NOT move the Pattern S state hash');
SELECT throws_ok($$ SELECT public.qteklink_payroll_store_live_snapshot((SELECT v FROM _ids WHERE k='runA'),
  '{"snapshot_version":1}'::jsonb, now(), now()) $$, 'P0001', NULL,
  'store_live_snapshot RAISEs on a COMPLETED run (frozen snapshot governs)');
SELECT ok((SELECT live_snapshot IS NULL FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runA')),
  'the completed run''s live_snapshot stays untouched (NULL)');
SELECT throws_ok($$ SELECT public.qteklink_payroll_store_live_snapshot(gen_random_uuid(),
  '{"snapshot_version":1}'::jsonb, now(), now()) $$, 'P0001', NULL, 'store_live_snapshot RAISEs on an unknown run');
SELECT throws_ok($$ SELECT public.qteklink_payroll_store_live_snapshot((SELECT v FROM _ids WHERE k='runC'),
  NULL, now(), now()) $$, 'P0001', NULL, 'store_live_snapshot rejects a NULL snapshot');
SELECT throws_ok($$ SELECT public.qteklink_payroll_store_live_snapshot((SELECT v FROM _ids WHERE k='runC'),
  '[1,2]'::jsonb, now(), now()) $$, 'P0001', NULL, 'store_live_snapshot rejects a non-object snapshot');
SELECT throws_ok($$ SELECT public.qteklink_payroll_store_live_snapshot((SELECT v FROM _ids WHERE k='runC'),
  '{"snapshot_version":1}'::jsonb, now(), NULL) $$, 'P0001', NULL,
  'store_live_snapshot rejects a NULL p_compute_started_at (the race guard is mandatory)');

-- mark-stale: flips ONLY open runs (count = newly invalidated, i.e. fresh -> stale)
-- and stamps live_snapshot_invalidated_at on EVERY open run (even already-stale —
-- the lost-invalidation race guard). Fresh open runs right now: runC (stale=false
-- after the store); runD/runNY are open but already stale (default) — so exactly
-- 1 flips.
SELECT ok((SELECT live_snapshot_invalidated_at IS NULL FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runC')),
  'live_snapshot_invalidated_at starts NULL (never marked)');
SELECT is(public.qteklink_payroll_mark_open_runs_stale(7476), 1,
  'mark_open_runs_stale flips exactly the ONE fresh open run');
SELECT ok((SELECT live_snapshot_stale FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runC')),
  'the stored-fresh open run is stale again after mark');
SELECT ok((SELECT live_snapshot_invalidated_at IS NOT NULL FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runC')),
  'mark stamps live_snapshot_invalidated_at');
SELECT ok((SELECT live_snapshot_invalidated_at IS NOT NULL FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runD')),
  'mark stamps invalidated_at on ALREADY-STALE open runs too (the race guard substrate)');
SELECT is((SELECT live_snapshot->>'note' FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runC')),
  'live-pgtap', 'mark-stale keeps the cached snapshot itself (only the flag flips)');
SELECT is(public.qteklink_payroll_mark_open_runs_stale(7476), 0,
  'a second mark newly-invalidates nothing (count counts fresh -> stale only)');
SELECT throws_ok($$ SELECT public.qteklink_payroll_mark_open_runs_stale(0) $$, 'P0001', NULL,
  'mark_open_runs_stale rejects a non-positive shop id');
SELECT is((SELECT updated_at::text FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runC')),
  (SELECT v FROM _txt WHERE k='lupdC'), 'mark_open_runs_stale does NOT bump updated_at either');

-- the lost-invalidation race: a store whose compute began BEFORE the mark
-- (invalidated_at = the mark's now()) stores the snapshot but must NOT clear the
-- stale flag — the mark fired for mirror data that snapshot cannot contain.
SELECT lives_ok($$ SELECT public.qteklink_payroll_store_live_snapshot((SELECT v FROM _ids WHERE k='runC'),
  '{"snapshot_version":1,"note":"raced-compute"}'::jsonb, now(), now() - interval '1 minute') $$,
  'a store from a compute that began BEFORE the mark is accepted');
SELECT is((SELECT (live_snapshot->>'note') || '/' || live_snapshot_stale::text
           FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runC')),
  'raced-compute/true',
  'the raced store keeps stale=TRUE while still storing the snapshot (invalidation never lost)');
SELECT lives_ok($$ SELECT public.qteklink_payroll_store_live_snapshot((SELECT v FROM _ids WHERE k='runC'),
  '{"snapshot_version":1,"note":"post-mark-compute"}'::jsonb, now(), now()) $$,
  'a store from a compute that began AT/AFTER the mark is accepted');
SELECT is((SELECT (live_snapshot->>'note') || '/' || live_snapshot_stale::text
           FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runC')),
  'post-mark-compute/false',
  'a compute that began after the last mark clears the stale flag as before');

-- ─── void_run: completed-only + kind-bound token + void-and-clone ─────────
SELECT throws_ok($$ SELECT public.qteklink_payroll_void_run((SELECT v FROM _ids WHERE k='runC'),
  'nope', true, NULL, NULL, NULL, 'pgtap') $$, 'P0001', NULL, 'void_run rejected on an OPEN run');
INSERT INTO _txt VALUES ('hashV',
  (public.qteklink_payroll_void_run((SELECT v FROM _ids WHERE k='runA'), NULL, true, NULL, NULL, NULL, 'chris@jeffsautomotive.com'))->>'state_hash');
SELECT is(length((SELECT v FROM _txt WHERE k='hashV')), 32, 'void dry run returns an md5 state hash');
SELECT throws_ok($$ SELECT public.qteklink_payroll_void_run((SELECT v FROM _ids WHERE k='runA'),
  '   ', false, NULL, (SELECT v FROM _txt WHERE k='hashV'), NULL, 'pgtap') $$,
  'P0001', NULL, 'void without a reason rejected');

INSERT INTO _ids
SELECT 'tokK1', f.token_id FROM public.qteklink_payroll_issue_confirm_token(
  (SELECT v FROM _ids WHERE k='runA'), 'complete_run', (SELECT v FROM _txt WHERE k='hashV'), NULL, 'chris@jeffsautomotive.com') AS f;
SELECT throws_ok($$ SELECT public.qteklink_payroll_void_run((SELECT v FROM _ids WHERE k='runA'),
  'wrong clock hours entered', false, (SELECT v FROM _ids WHERE k='tokK1'), (SELECT v FROM _txt WHERE k='hashV'), NULL, 'pgtap') $$,
  'P0001', NULL, 'a complete_run token cannot authorize a void (kind-bound)');

INSERT INTO _ids
SELECT 'tokV1', f.token_id FROM public.qteklink_payroll_issue_confirm_token(
  (SELECT v FROM _ids WHERE k='runA'), 'void_run', (SELECT v FROM _txt WHERE k='hashV'), NULL, 'chris@jeffsautomotive.com') AS f;
INSERT INTO _txt VALUES ('voidres',
  (public.qteklink_payroll_void_run(
     (SELECT v FROM _ids WHERE k='runA'), 'wrong clock hours entered', false,
     (SELECT v FROM _ids WHERE k='tokV1'), (SELECT v FROM _txt WHERE k='hashV'),
     NULL, 'chris@jeffsautomotive.com'))::text);
SELECT is(((SELECT v FROM _txt WHERE k='voidres')::jsonb)->>'voided', 'true', 'void_run returned {voided: true}');
INSERT INTO _ids VALUES ('cloneA', (((SELECT v FROM _txt WHERE k='voidres'))::jsonb->>'clone_run_id')::uuid);

SELECT is((SELECT status || '/' || void_reason || '/' || voided_by_label FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runA')),
  'voided/wrong clock hours entered/chris@jeffsautomotive.com', 'void stamps recorded; run stays forever');
SELECT is((SELECT snapshot->>'note' FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='runA')),
  'pgtap', 'the voided run''s snapshot is untouched (frozen record)');
SELECT is((SELECT status || '/' || period_start::text || '/' || period_end::text || '/' || bonus_period::text || '/' || bonus_month::text
           FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='cloneA')),
  'open/2026-06-28/2026-07-11/true/2026-06-01', 'clone: open, same period, slider state (pay-date month) copied');
SELECT is((SELECT cloned_from_run_id FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='cloneA')),
  (SELECT v FROM _ids WHERE k='runA'), 'clone lineage set (cloned_from_run_id)');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_run_employees WHERE run_id=(SELECT v FROM _ids WHERE k='cloneA')),
  (SELECT count(*)::int FROM public.qteklink_payroll_run_employees WHERE run_id=(SELECT v FROM _ids WHERE k='runA')),
  'every entry row was cloned');
SELECT is((SELECT clock_hours_w1::text || '/' || pto_w1::text || '/' || (overrides->'billed_hours_w1'->>'value') || '/' || (pay_config->'rates_w2'->>'hourly_rate_cents')
           FROM public.qteklink_payroll_run_employees
           WHERE run_id=(SELECT v FROM _ids WHERE k='cloneA') AND employee_id=(SELECT v FROM _ids WHERE k='tech1')),
  '41.25/8.00/38.5/2400', 'cloned entry carries hours + overrides + run-side pay_config verbatim');
SELECT ok((SELECT consumed_at IS NOT NULL FROM public.qteklink_payroll_confirm_tokens WHERE id=(SELECT v FROM _ids WHERE k='tokV1')),
  'void token consumed');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_audit_log WHERE action='run_voided' AND run_id=(SELECT v FROM _ids WHERE k='runA')), 1, 'void audited');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_audit_log WHERE action='run_cloned' AND run_id=(SELECT v FROM _ids WHERE k='cloneA')), 1, 'clone audited');
SELECT throws_ok($$ SELECT public.qteklink_payroll_create_run(7476, '2026-06-28'::date, NULL, 'pgtap') $$,
  'P0001', NULL, 'the clone occupies the period — create_run for it still rejected');

-- ─── anon denied on every payroll RPC ─────────────────────────────────────
SET ROLE anon;
SELECT throws_ok($$ SELECT public.qteklink_payroll_upsert_employee(7476, NULL, 'x', 'technician', NULL, '{}'::jsonb, false, NULL, 'x') $$, '42501', NULL, 'anon cannot upsert_employee');
SELECT throws_ok($$ SELECT public.qteklink_payroll_create_run(7476, '2026-06-28'::date, NULL, 'x') $$, '42501', NULL, 'anon cannot create_run');
SELECT throws_ok($$ SELECT public.qteklink_payroll_sync_run_roster(gen_random_uuid(), NULL, 'x') $$, '42501', NULL, 'anon cannot sync_run_roster');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_entry(gen_random_uuid(), '{}'::jsonb, NULL, 'x') $$, '42501', NULL, 'anon cannot update_entry');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_entries(gen_random_uuid(), '[]'::jsonb, NULL, 'x') $$, '42501', NULL, 'anon cannot update_entries');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_run(gen_random_uuid(), '{}'::jsonb, NULL, 'x') $$, '42501', NULL, 'anon cannot update_run');
SELECT throws_ok($$ SELECT * FROM public.qteklink_payroll_issue_confirm_token(gen_random_uuid(), 'complete_run', 'h', NULL, 'x') $$, '42501', NULL, 'anon cannot issue_confirm_token');
SELECT throws_ok($$ SELECT public.qteklink_payroll_complete_run(gen_random_uuid(), true, NULL, NULL, NULL, NULL, 'x') $$, '42501', NULL, 'anon cannot complete_run');
SELECT throws_ok($$ SELECT public.qteklink_payroll_void_run(gen_random_uuid(), 'x', true, NULL, NULL, NULL, 'x') $$, '42501', NULL, 'anon cannot void_run');
SELECT throws_ok($$ SELECT public.qteklink_payroll_store_live_snapshot(gen_random_uuid(), '{}'::jsonb, now(), now()) $$, '42501', NULL, 'anon cannot store_live_snapshot');
SELECT throws_ok($$ SELECT public.qteklink_payroll_mark_open_runs_stale(7476) $$, '42501', NULL, 'anon cannot mark_open_runs_stale');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
