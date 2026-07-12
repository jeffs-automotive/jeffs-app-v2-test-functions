-- =====================================================================
-- pgTAP — QTekLink payroll PTO + employee management (20260712200000)
-- =====================================================================
-- Round-11 decisions #52-#60. Plan: docs/qteklink/payroll-pto-employee-mgmt-plan-2026-07-12.md
-- (v2 — folds in all 37 regression-check findings). This suite proves the
-- Stage-1 migration behaviours (the plan §7 pgTAP list):
--
--   §2a  the NINE new employee columns exist; the NEW profile RPC's patch
--        semantics (key present = write, JSON null = clear, key absent = keep;
--        pto_grandfathered NOT NULL so JSON null RAISEs; unknown keys RAISE;
--        p_archived flips archived_at; p_archived=false auto-clears
--        termination_date + preserves the cleared value in the audit detail);
--        and — the load-bearing regression lock — the LEGACY 9-arg
--        qteklink_payroll_upsert_employee against a fully-populated row leaves
--        every new column BYTE-IDENTICAL (C2/C3/C18/C24/C30). The legacy PTO
--        pay_config keys are OPTIONAL (a config without them lives_ok) yet
--        still ALLOWED (a config WITH them lives_ok) (C6/C22/N5/N12).
--   §2b  the ledger RPC (qteklink_payroll_adjust_pto): running balance stamped
--        under the shop lock, adjustment REQUIRES a reason, initial does not,
--        the abs(hours) <= 500 bound, kind gate (only initial/adjustment).
--   §2c  email-log (qteklink_payroll_log_email / _transition_email): log_email
--        REFUSES pay_summary; the claim state machine — pending->sent (stamps
--        sent_at, TERMINAL), pending->failed, failed->pending (retry) are the
--        ONLY legal transitions; sent->anything + skipped_no_email as a target
--        RAISE; the pay_summary NULL-dodge CHECK.
--   §2d  a production-shaped payroll settings write with NO PTO keys lives_ok;
--        pto_tenure_tiers: [] lives_ok; a non-zero first tier / unsorted tiers
--        / negative cap / non-string alert email RAISE.
--   §4   the FULL void cycle — complete (accrual + usage rows, running
--        balances) -> void (kind='void_reversal' rows, balance restored, a
--        replayed reversal rejected by UNIQUE(reverses_ledger_id)) -> clone
--        completes cleanly (rollover re-fires exactly once, same value) ->
--        clone voids cleanly; completion RAISE => ZERO ledger rows (atomic);
--        a zero-PTO-config completion (NULL p_pto_entries) succeeds with zero
--        rows and byte-identical legacy behaviour; the completion-idempotency
--        UNIQUE (accrual/usage double-apply); the rollover at-most-once guard.
--   §5   the pay_summary identity rail — ONE row per (run, employee) EVER,
--        pre-inserted pending (personal_email present) / skipped_no_email
--        (blank), recipient bound from the SAME employee row.
--   §sig updated has_function pins for the re-created RPCs + anon/authenticated
--        denial for every new/re-created function.
--
-- Runs as the BYPASSRLS migration role. Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

CREATE TEMP TABLE _ids (k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE _txt (k text PRIMARY KEY, v text);

-- ─── Signatures (contract fidelity) — the re-created + new RPCs ───────────
SELECT has_column('public', 'qteklink_payroll_employees', 'work_email', 'employees.work_email column exists');
SELECT has_column('public', 'qteklink_payroll_employees', 'personal_email', 'employees.personal_email column exists');
SELECT has_column('public', 'qteklink_payroll_employees', 'personal_phone', 'employees.personal_phone column exists');
SELECT has_column('public', 'qteklink_payroll_employees', 'work_phone', 'employees.work_phone column exists');
SELECT has_column('public', 'qteklink_payroll_employees', 'address', 'employees.address column exists');
SELECT has_column('public', 'qteklink_payroll_employees', 'start_date', 'employees.start_date column exists');
SELECT has_column('public', 'qteklink_payroll_employees', 'termination_date', 'employees.termination_date column exists');
SELECT has_column('public', 'qteklink_payroll_employees', 'pto_grandfathered', 'employees.pto_grandfathered column exists');
SELECT has_column('public', 'qteklink_payroll_employees', 'pto_tenure_credit_date', 'employees.pto_tenure_credit_date column exists');
SELECT col_not_null('public', 'qteklink_payroll_employees', 'pto_grandfathered', 'pto_grandfathered is NOT NULL');

SELECT has_table('public', 'qteklink_payroll_pto_ledger', 'pto_ledger table exists');
SELECT has_table('public', 'qteklink_payroll_email_log', 'email_log table exists');
SELECT has_function('public', 'qteklink_payroll_update_employee_profile', ARRAY['integer','uuid','jsonb','boolean','text'], 'update_employee_profile signature');
SELECT has_function('public', 'qteklink_payroll_adjust_pto', ARRAY['integer','uuid','text','numeric','text','text'], 'adjust_pto signature');
SELECT has_function('public', 'qteklink_payroll_log_email', ARRAY['integer','text','text','text','text','uuid','uuid','text'], 'log_email signature');
SELECT has_function('public', 'qteklink_payroll_transition_email', ARRAY['uuid','text','text','text','text'], 'transition_email signature');
-- §4 DROP-then-recreate: complete_run gains a trailing p_pto_entries jsonb;
-- void_run keeps its 7-param form (the reversals are derived from the ledger).
SELECT has_function('public', 'qteklink_payroll_complete_run', ARRAY['uuid','boolean','uuid','text','jsonb','uuid','text','jsonb'], 'complete_run gained the trailing p_pto_entries jsonb (8-param)');
SELECT has_function('public', 'qteklink_payroll_void_run', ARRAY['uuid','text','boolean','uuid','text','uuid','text'], 'void_run keeps its 7-param signature');
-- the OLD 7-param complete_run must be GONE (drop-then-recreate, never an overload)
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname='qteklink_payroll_complete_run'), 1,
  'exactly ONE complete_run overload survives (drop-then-recreate, not an overload)');
-- the byte-untouched upsert keeps its exact 9-param signature (no overload churn)
SELECT has_function('public', 'qteklink_payroll_upsert_employee', ARRAY['integer','uuid','text','text','bigint','jsonb','boolean','uuid','text'], 'upsert_employee signature is byte-untouched (9-param)');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname='qteklink_payroll_upsert_employee'), 1,
  'exactly ONE upsert_employee overload (no signature churn)');

-- ─── Seed: connection + payroll anchor ────────────────────────────────────
INSERT INTO public.qbo_connections (realm_id, shop_id, access_token_expires_at, refresh_token_expires_at)
VALUES ('realm-A', 7476, now() + interval '1 hour', now() + interval '100 days');
SELECT public.qteklink_upsert_settings(7476, 'realm-A', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  '{"anchor_period_start":"2026-06-28"}'::jsonb) AS _;

-- ═══════════════════════════════════════════════════════════════════════════
-- §2a — profile RPC patch semantics + legacy-upsert byte-preservation
-- ═══════════════════════════════════════════════════════════════════════════
-- New employee via the byte-untouched upsert WITHOUT the legacy PTO keys —
-- proves the SQL validator demoted them required -> optional (C6/C22/N5/N12).
-- Immediately archived so it never rosters onto the completion runs below.
INSERT INTO _ids VALUES ('ptoless', public.qteklink_payroll_upsert_employee(7476, NULL, 'PTO-less Config', 'technician', 9101,
  '{"config_version":1,"hourly_rate_cents":2300,"billed_rate_cents":1000}'::jsonb, false, NULL, 'chris@jeffsautomotive.com'));
SELECT ok(TRUE, 'a NEW employee needs NO legacy pto_* keys (demoted required -> optional)');
SELECT public.qteklink_payroll_upsert_employee(7476, (SELECT v FROM _ids WHERE k='ptoless'), 'PTO-less Config', 'technician', 9101,
  '{"config_version":1,"hourly_rate_cents":2300,"billed_rate_cents":1000}'::jsonb, true, NULL, 'chris@jeffsautomotive.com') AS _;
-- ...but a config that STILL carries them is accepted (allowed forever — stored
-- rows / void-cloned entry rows / frozen snapshots are never backfilled).
INSERT INTO _ids VALUES ('e1', public.qteklink_payroll_upsert_employee(7476, NULL, 'Full Profile', 'technician', 9102,
  '{"config_version":1,"pto_balance_hours":40,"pto_accrual_hours_per_period":3.08,"hourly_rate_cents":2300,"billed_rate_cents":1000}'::jsonb,
  false, NULL, 'chris@jeffsautomotive.com'));
SELECT ok(TRUE, 'a config that STILL carries the legacy pto_* keys is accepted (allowed forever)');

-- patch all nine columns + archive in ONE call
SELECT lives_ok($$ SELECT public.qteklink_payroll_update_employee_profile(7476, (SELECT v FROM _ids WHERE k='e1'),
  '{"work_email":"w@x.com","personal_email":"p@x.com","personal_phone":"555-1","work_phone":"555-2","address":"1 Main St","start_date":"2019-05-01","termination_date":"2026-01-01","pto_grandfathered":true,"pto_tenure_credit_date":"2015-01-01"}'::jsonb,
  true, 'chris@jeffsautomotive.com') $$, 'profile patch (all nine cols + archive) accepted');
SELECT is((SELECT work_email||'/'||personal_email||'/'||personal_phone||'/'||work_phone||'/'||address||'/'||start_date::text||'/'||termination_date::text||'/'||pto_grandfathered::text||'/'||pto_tenure_credit_date::text||'/'||(archived_at IS NOT NULL)::text
           FROM public.qteklink_payroll_employees WHERE id=(SELECT v FROM _ids WHERE k='e1')),
  'w@x.com/p@x.com/555-1/555-2/1 Main St/2019-05-01/2026-01-01/true/2015-01-01/true',
  'all nine columns + archived_at stamped exactly as patched');

-- unknown key RAISEs
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_employee_profile(7476, (SELECT v FROM _ids WHERE k='e1'),
  '{"surprise":"x"}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'unknown profile key rejected');
-- an email that is not email-shaped RAISEs
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_employee_profile(7476, (SELECT v FROM _ids WHERE k='e1'),
  '{"personal_email":"not-an-email"}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'malformed personal_email rejected');
-- a date that is not YYYY-MM-DD RAISEs
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_employee_profile(7476, (SELECT v FROM _ids WHERE k='e1'),
  '{"start_date":"05/01/2019"}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'malformed start_date rejected');
-- pto_grandfathered NOT NULL: JSON null RAISEs (does not clear)
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_employee_profile(7476, (SELECT v FROM _ids WHERE k='e1'),
  '{"pto_grandfathered":null}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'JSON null on the NOT-NULL pto_grandfathered rejected');
-- nothing-to-update (empty patch, no p_archived) RAISEs
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_employee_profile(7476, (SELECT v FROM _ids WHERE k='e1'),
  '{}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'empty patch + NULL p_archived rejected');
-- blank actor RAISEs
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_employee_profile(7476, (SELECT v FROM _ids WHERE k='e1'),
  '{"address":"2 Main"}'::jsonb, NULL, '  ') $$, 'P0001', NULL, 'blank p_actor rejected');
-- setting a non-null termination_date while unarchiving is a contradiction -> RAISE
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_employee_profile(7476, (SELECT v FROM _ids WHERE k='e1'),
  '{"termination_date":"2026-02-01"}'::jsonb, false, 'pgtap') $$, 'P0001', NULL,
  'cannot set a termination_date while unarchiving (p_archived=false clears it)');
-- wrong shop -> not found
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_employee_profile(8888, (SELECT v FROM _ids WHERE k='e1'),
  '{"address":"x"}'::jsonb, NULL, 'pgtap') $$, 'P0001', NULL, 'profile update for the wrong shop rejected');

-- ── the load-bearing regression lock: the LEGACY 9-arg upsert against the
-- fully-populated row leaves EVERY new column byte-identical (C2/C3/C18/C24/C30).
INSERT INTO _txt VALUES ('profile_before',
  (SELECT work_email||'|'||personal_email||'|'||personal_phone||'|'||work_phone||'|'||address||'|'||start_date::text||'|'||termination_date::text||'|'||pto_grandfathered::text||'|'||pto_tenure_credit_date::text
   FROM public.qteklink_payroll_employees WHERE id=(SELECT v FROM _ids WHERE k='e1')));
SELECT public.qteklink_payroll_upsert_employee(7476, (SELECT v FROM _ids WHERE k='e1'), 'Full Profile', 'technician', 9102,
  '{"config_version":1,"hourly_rate_cents":2400,"billed_rate_cents":1100}'::jsonb, true, NULL, 'chris@jeffsautomotive.com') AS _;
SELECT is((SELECT work_email||'|'||personal_email||'|'||personal_phone||'|'||work_phone||'|'||address||'|'||start_date::text||'|'||termination_date::text||'|'||pto_grandfathered::text||'|'||pto_tenure_credit_date::text
           FROM public.qteklink_payroll_employees WHERE id=(SELECT v FROM _ids WHERE k='e1')),
  (SELECT v FROM _txt WHERE k='profile_before'),
  'the legacy 9-arg upsert leaves every NEW profile column byte-identical');
SELECT is((SELECT pay_config->>'hourly_rate_cents' FROM public.qteklink_payroll_employees WHERE id=(SELECT v FROM _ids WHERE k='e1')),
  '2400', 'the legacy upsert still updates the fields it OWNS (pay_config)');

-- unarchive (p_archived=false) auto-clears termination_date and preserves the
-- cleared value in the audit detail (C8/C23/C36).
SELECT lives_ok($$ SELECT public.qteklink_payroll_update_employee_profile(7476, (SELECT v FROM _ids WHERE k='e1'),
  '{}'::jsonb, false, 'chris@jeffsautomotive.com') $$, 'unarchive via p_archived=false accepted');
SELECT ok((SELECT termination_date IS NULL AND archived_at IS NULL FROM public.qteklink_payroll_employees WHERE id=(SELECT v FROM _ids WHERE k='e1')),
  'unarchive cleared termination_date and archived_at');
SELECT is((SELECT detail->>'termination_date_cleared' FROM public.qteklink_payroll_audit_log
           WHERE employee_id=(SELECT v FROM _ids WHERE k='e1') AND action='employee_profile_updated'
             AND detail ? 'termination_date_cleared' ORDER BY id DESC LIMIT 1),
  '2026-01-01', 'the auto-cleared termination_date is preserved in the audit detail');

-- JSON null clears a nullable column; an absent key keeps its sibling.
SELECT public.qteklink_payroll_update_employee_profile(7476, (SELECT v FROM _ids WHERE k='e1'),
  '{"work_email":null}'::jsonb, NULL, 'chris@jeffsautomotive.com') AS _;
SELECT ok((SELECT work_email IS NULL AND personal_email = 'p@x.com' FROM public.qteklink_payroll_employees WHERE id=(SELECT v FROM _ids WHERE k='e1')),
  'JSON null clears work_email; the absent personal_email is kept (patch semantics)');

-- absent key keeps pto_grandfathered (a patch of ONLY address leaves the flag true)
SELECT public.qteklink_payroll_update_employee_profile(7476, (SELECT v FROM _ids WHERE k='e1'),
  '{"address":"3 Main"}'::jsonb, NULL, 'chris@jeffsautomotive.com') AS _;
SELECT ok((SELECT pto_grandfathered FROM public.qteklink_payroll_employees WHERE id=(SELECT v FROM _ids WHERE k='e1')),
  'an address-only patch leaves pto_grandfathered untouched (absent = keep)');

-- ═══════════════════════════════════════════════════════════════════════════
-- §2b — adjust_pto: running balance under the shop lock, reason gate, bounds
-- ═══════════════════════════════════════════════════════════════════════════
-- the RPC returns a bare numeric in its jsonb (40, 33.5); the STORED column is
-- numeric(8,2) (40.00, 33.50). Both are asserted.
SELECT is((public.qteklink_payroll_adjust_pto(7476, (SELECT v FROM _ids WHERE k='e1'), 'initial', 40, NULL, 'chris@jeffsautomotive.com'))->>'balance_after_hours',
  '40', 'initial adjustment returns balance_after_hours = 40');
SELECT is((SELECT balance_after_hours::text FROM public.qteklink_payroll_pto_ledger
           WHERE employee_id=(SELECT v FROM _ids WHERE k='e1') AND kind='initial'),
  '40.00', 'the stored balance_after_hours column is numeric(8,2)');
SELECT is((public.qteklink_payroll_adjust_pto(7476, (SELECT v FROM _ids WHERE k='e1'), 'adjustment', -6.5, 'used a half day', 'chris@jeffsautomotive.com'))->>'balance_after_hours',
  '33.50', 'a signed adjustment returns the running balance (40 - 6.5 = 33.50; numeric(7,2) sum carries scale)');
SELECT is((SELECT sum(hours)::text FROM public.qteklink_payroll_pto_ledger WHERE employee_id=(SELECT v FROM _ids WHERE k='e1')),
  '33.50', 'balance = sum(hours) matches the last stamped running balance');
-- adjustment REQUIRES a reason; initial does not
SELECT throws_ok($$ SELECT public.qteklink_payroll_adjust_pto(7476, (SELECT v FROM _ids WHERE k='e1'), 'adjustment', 5, NULL, 'pgtap') $$,
  'P0001', NULL, 'adjustment without a reason rejected (CHECK-mirrored guard)');
SELECT throws_ok($$ SELECT public.qteklink_payroll_adjust_pto(7476, (SELECT v FROM _ids WHERE k='e1'), 'adjustment', 5, '   ', 'pgtap') $$,
  'P0001', NULL, 'adjustment with a blank reason rejected');
-- zero + over-bound hours
SELECT throws_ok($$ SELECT public.qteklink_payroll_adjust_pto(7476, (SELECT v FROM _ids WHERE k='e1'), 'initial', 0, NULL, 'pgtap') $$,
  'P0001', NULL, 'zero-hour adjustment rejected');
SELECT throws_ok($$ SELECT public.qteklink_payroll_adjust_pto(7476, (SELECT v FROM _ids WHERE k='e1'), 'initial', 501, NULL, 'pgtap') $$,
  'P0001', NULL, 'abs(hours) > 500 rejected (fat-finger bound)');
-- kind gate: run-driven kinds are refused by the standalone RPC
SELECT throws_ok($$ SELECT public.qteklink_payroll_adjust_pto(7476, (SELECT v FROM _ids WHERE k='e1'), 'accrual', 3, NULL, 'pgtap') $$,
  'P0001', NULL, 'adjust_pto refuses run-driven kinds (accrual)');
SELECT throws_ok($$ SELECT public.qteklink_payroll_adjust_pto(7476, (SELECT v FROM _ids WHERE k='e1'), 'void_reversal', 3, NULL, 'pgtap') $$,
  'P0001', NULL, 'adjust_pto refuses void_reversal');
-- unknown employee
SELECT throws_ok($$ SELECT public.qteklink_payroll_adjust_pto(7476, gen_random_uuid(), 'initial', 3, NULL, 'pgtap') $$,
  'P0001', NULL, 'adjust_pto on an unknown employee rejected');
-- the adjustment audit rows land
SELECT ok((SELECT count(*) FROM public.qteklink_payroll_audit_log WHERE action='pto_adjusted' AND employee_id=(SELECT v FROM _ids WHERE k='e1')) >= 2,
  'PTO adjustments are audited');
-- adjustment-reason table CHECK (defense in depth): a DIRECT insert (owner role)
-- of kind='adjustment' with a NULL reason is rejected by the CHECK constraint.
SELECT throws_ok($$
  INSERT INTO public.qteklink_payroll_pto_ledger (shop_id, employee_id, kind, hours, balance_after_hours, reason, created_by_label)
  VALUES (7476, (SELECT v FROM _ids WHERE k='e1'), 'adjustment', 1, 1, NULL, 'pgtap') $$,
  '23514', NULL, 'a kind=adjustment ledger row with a NULL reason is rejected by the table CHECK');

-- ═══════════════════════════════════════════════════════════════════════════
-- §2c — email-log: log_email refuses pay_summary; the claim state machine
-- ═══════════════════════════════════════════════════════════════════════════
SELECT throws_ok($$ SELECT public.qteklink_payroll_log_email(7476, 'pay_summary', 'x@y.com', 's') $$,
  'P0001', NULL, 'log_email REFUSES pay_summary (those rows are born inside complete_run)');
INSERT INTO _ids VALUES ('em1', public.qteklink_payroll_log_email(7476, 'pto_adjustment', 'a@b.com', 'PTO adjusted', 'pending', NULL, NULL, NULL));
SELECT is((public.qteklink_payroll_transition_email((SELECT v FROM _ids WHERE k='em1'), 'sent', NULL, NULL, 'delivered'))->>'status',
  'sent', 'pending -> sent transition');
SELECT ok((SELECT sent_at IS NOT NULL FROM public.qteklink_payroll_email_log WHERE id=(SELECT v FROM _ids WHERE k='em1')),
  'sent stamps sent_at');
-- sent is TERMINAL
SELECT throws_ok($$ SELECT public.qteklink_payroll_transition_email((SELECT v FROM _ids WHERE k='em1'), 'failed') $$,
  'P0001', NULL, 'sent -> failed rejected (sent is terminal — the never-double-send guarantee)');
SELECT throws_ok($$ SELECT public.qteklink_payroll_transition_email((SELECT v FROM _ids WHERE k='em1'), 'pending') $$,
  'P0001', NULL, 'sent -> pending rejected (sent is terminal)');
-- failed -> pending (retry) then pending -> failed
INSERT INTO _ids VALUES ('em2', public.qteklink_payroll_log_email(7476, 'pto_negative', 'c@d.com', 'Negative balance', 'failed', NULL, NULL, 'rate limited'));
SELECT is((public.qteklink_payroll_transition_email((SELECT v FROM _ids WHERE k='em2'), 'pending'))->>'status',
  'pending', 'failed -> pending (explicit retry)');
SELECT is((public.qteklink_payroll_transition_email((SELECT v FROM _ids WHERE k='em2'), 'failed', NULL, NULL, 'again'))->>'status',
  'failed', 'pending -> failed');
-- skipped_no_email is never a legal target
SELECT throws_ok($$ SELECT public.qteklink_payroll_transition_email((SELECT v FROM _ids WHERE k='em2'), 'skipped_no_email') $$,
  'P0001', NULL, 'skipped_no_email is never a legal transition target');
-- log_email rejects a blank recipient + a bad status
SELECT throws_ok($$ SELECT public.qteklink_payroll_log_email(7476, 'pto_adjustment', '  ', 's') $$,
  'P0001', NULL, 'log_email rejects a blank recipient');
SELECT throws_ok($$ SELECT public.qteklink_payroll_log_email(7476, 'pto_adjustment', 'a@b.com', 's', 'skipped_no_email') $$,
  'P0001', NULL, 'log_email rejects a skipped_no_email status (that kind is completion-only)');
-- the pay_summary NULL-dodge CHECK: a DIRECT insert (owner role) of a
-- pay_summary row with a NULL run_id/employee_id is rejected (it would dodge
-- the exactly-once identity rail).
SELECT throws_ok($$
  INSERT INTO public.qteklink_payroll_email_log (shop_id, kind, status)
  VALUES (7476, 'pay_summary', 'pending') $$,
  '23514', NULL, 'a pay_summary row with NULL run_id/employee_id is rejected by the identity CHECK');

-- ═══════════════════════════════════════════════════════════════════════════
-- §2d — settings validator: PTO keys validated only-when-present
-- ═══════════════════════════════════════════════════════════════════════════
-- a production-shaped payroll write with NO PTO keys still lives_ok (C1 family)
SELECT lives_ok($$ SELECT public.qteklink_upsert_settings(7476, 'realm-A', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  '{"anchor_period_start":"2026-06-28","spiff_categories":[],"alert_emails":{"void_clone":[],"completed":[]}}'::jsonb) $$,
  'a full payroll settings object with NO PTO keys is valid (unconfigured)');
-- empty tiers valid
SELECT lives_ok($$ SELECT public.qteklink_upsert_settings(7476, 'realm-A', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  '{"anchor_period_start":"2026-06-28","pto_tenure_tiers":[]}'::jsonb) $$, 'pto_tenure_tiers: [] is valid (unconfigured)');
-- null values are valid "unconfigured" for every key
SELECT lives_ok($$ SELECT public.qteklink_upsert_settings(7476, 'realm-A', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  '{"anchor_period_start":"2026-06-28","pto_tenure_tiers":null,"pto_rollover_cap_hours":null,"pto_adjustment_alert_emails":null,"pto_negative_alert_admin_emails":null}'::jsonb) $$,
  'all four PTO keys as JSON null are valid (unconfigured)');
-- a well-formed, sorted, 0-anchored tier set + cap + email lists
SELECT lives_ok($$ SELECT public.qteklink_upsert_settings(7476, 'realm-A', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  '{"anchor_period_start":"2026-06-28","pto_tenure_tiers":[{"min_years":0,"hours_per_period":3.08},{"min_years":5,"hours_per_period":4.62}],"pto_rollover_cap_hours":80,"pto_adjustment_alert_emails":["ops@x.com"],"pto_negative_alert_admin_emails":["admin@x.com"]}'::jsonb) $$,
  'a well-formed PTO tier config is accepted');
-- a non-zero first tier (sorted, first is min_years > 0) RAISEs
SELECT throws_ok($$ SELECT public.qteklink_upsert_settings(7476, 'realm-A', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  '{"pto_tenure_tiers":[{"min_years":1,"hours_per_period":3}]}'::jsonb) $$,
  'P0001', NULL, 'tiers must start with a min_years 0 tier when non-empty');
-- unsorted / duplicate min_years RAISEs
SELECT throws_ok($$ SELECT public.qteklink_upsert_settings(7476, 'realm-A', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  '{"pto_tenure_tiers":[{"min_years":0,"hours_per_period":3},{"min_years":0,"hours_per_period":4}]}'::jsonb) $$,
  'P0001', NULL, 'duplicate min_years rejected');
SELECT throws_ok($$ SELECT public.qteklink_upsert_settings(7476, 'realm-A', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  '{"pto_tenure_tiers":[{"min_years":0,"hours_per_period":3},{"min_years":5,"hours_per_period":4},{"min_years":2,"hours_per_period":5}]}'::jsonb) $$,
  'P0001', NULL, 'unsorted min_years rejected');
-- negative hours / cap / bad tier key
SELECT throws_ok($$ SELECT public.qteklink_upsert_settings(7476, 'realm-A', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  '{"pto_tenure_tiers":[{"min_years":0,"hours_per_period":-1}]}'::jsonb) $$,
  'P0001', NULL, 'negative hours_per_period rejected');
SELECT throws_ok($$ SELECT public.qteklink_upsert_settings(7476, 'realm-A', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  '{"pto_tenure_tiers":[{"min_years":0,"hours_per_period":3,"extra":1}]}'::jsonb) $$,
  'P0001', NULL, 'unknown tier entry key rejected');
SELECT throws_ok($$ SELECT public.qteklink_upsert_settings(7476, 'realm-A', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  '{"pto_rollover_cap_hours":-5}'::jsonb) $$,
  'P0001', NULL, 'negative rollover cap rejected');
-- a non-string / blank alert email RAISEs
SELECT throws_ok($$ SELECT public.qteklink_upsert_settings(7476, 'realm-A', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  '{"pto_adjustment_alert_emails":[42]}'::jsonb) $$,
  'P0001', NULL, 'non-string alert email rejected');
SELECT throws_ok($$ SELECT public.qteklink_upsert_settings(7476, 'realm-A', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  '{"pto_negative_alert_admin_emails":["  "]}'::jsonb) $$,
  'P0001', NULL, 'blank alert email rejected');

-- ═══════════════════════════════════════════════════════════════════════════
-- §4 + §5 — completion PTO writes, the pay_summary rail, the full void cycle
-- ═══════════════════════════════════════════════════════════════════════════
-- Two rostered employees: e1 (has a personal_email), e2 (NO personal_email ->
-- skipped_no_email). Re-set e1's personal_email (a null-clear test above may
-- have left it) and seed an initial balance.
SELECT public.qteklink_payroll_update_employee_profile(7476, (SELECT v FROM _ids WHERE k='e1'),
  '{"personal_email":"p@x.com"}'::jsonb, NULL, 'chris@jeffsautomotive.com') AS _;
INSERT INTO _ids VALUES ('e2', public.qteklink_payroll_upsert_employee(7476, NULL, 'No Email Tech', 'technician', 9103,
  '{"config_version":1,"hourly_rate_cents":2100,"billed_rate_cents":900}'::jsonb, false, NULL, 'chris@jeffsautomotive.com'));

INSERT INTO _ids VALUES ('run1', public.qteklink_payroll_create_run(7476, '2026-06-28'::date, NULL, 'chris@jeffsautomotive.com'));
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_run_employees WHERE run_id=(SELECT v FROM _ids WHERE k='run1')), 2,
  'run1 rostered exactly the 2 active employees (e1 + e2; the PTO-less tech is archived)');

-- ── completion RAISE => ZERO ledger rows (atomicity): a bad p_pto_entries
-- element (unknown employee on this run) must roll back the WHOLE completion.
INSERT INTO _txt VALUES ('h1', (public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='run1'), true, NULL, NULL, NULL, NULL, 'chris@jeffsautomotive.com'))->>'state_hash');
INSERT INTO _ids VALUES ('tkBad', (SELECT token_id FROM public.qteklink_payroll_issue_confirm_token((SELECT v FROM _ids WHERE k='run1'),'complete_run',(SELECT v FROM _txt WHERE k='h1'),NULL,'chris@jeffsautomotive.com')));
SELECT throws_ok($$ SELECT public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='run1'), false,
  (SELECT v FROM _ids WHERE k='tkBad'), (SELECT v FROM _txt WHERE k='h1'), '{"snapshot_version":1}'::jsonb, NULL, 'chris@jeffsautomotive.com',
  jsonb_build_array(
    jsonb_build_object('employee_id',(SELECT v FROM _ids WHERE k='e1'),'kind','accrual','hours',3.08),
    jsonb_build_object('employee_id', gen_random_uuid(), 'kind','accrual','hours',3.08))) $$,
  'P0001', NULL, 'a p_pto_entries employee not on the run aborts the whole completion');
SELECT ok((SELECT status = 'open' FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='run1')),
  'the run stays OPEN after the aborted completion');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_pto_ledger WHERE run_id=(SELECT v FROM _ids WHERE k='run1')), 0,
  'ZERO ledger rows survive the rolled-back completion (atomic — the valid accrual rolled back too)');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_email_log WHERE run_id=(SELECT v FROM _ids WHERE k='run1')), 0,
  'ZERO email-log rows survive the rolled-back completion');
SELECT ok((SELECT consumed_at IS NULL FROM public.qteklink_payroll_confirm_tokens WHERE id=(SELECT v FROM _ids WHERE k='tkBad')),
  'the token is NOT consumed by the rolled-back completion');

-- ── the real completion: accrual (e1 +3.08) + usage (e1 -8) + accrual (e2 +3.08)
-- + a rollover_forfeit for 2026. e1 got an initial 40 (then -6.5 = 33.5 above).
INSERT INTO _txt VALUES ('h1b', (public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='run1'), true, NULL, NULL, NULL, NULL, 'chris@jeffsautomotive.com'))->>'state_hash');
INSERT INTO _ids VALUES ('tk1', (SELECT token_id FROM public.qteklink_payroll_issue_confirm_token((SELECT v FROM _ids WHERE k='run1'),'complete_run',(SELECT v FROM _txt WHERE k='h1b'),NULL,'chris@jeffsautomotive.com')));
INSERT INTO _txt VALUES ('compres', (public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='run1'), false,
  (SELECT v FROM _ids WHERE k='tk1'), (SELECT v FROM _txt WHERE k='h1b'), '{"snapshot_version":1}'::jsonb, NULL, 'chris@jeffsautomotive.com',
  jsonb_build_array(
    jsonb_build_object('employee_id',(SELECT v FROM _ids WHERE k='e1'),'kind','accrual','hours',3.08),
    jsonb_build_object('employee_id',(SELECT v FROM _ids WHERE k='e1'),'kind','usage','hours',-8),
    jsonb_build_object('employee_id',(SELECT v FROM _ids WHERE k='e1'),'kind','rollover_forfeit','hours',-2,'boundary_year',2026),
    jsonb_build_object('employee_id',(SELECT v FROM _ids WHERE k='e2'),'kind','accrual','hours',3.08)
  )))::text);
SELECT is(((SELECT v FROM _txt WHERE k='compres')::jsonb)->>'completed', 'true', 'completion returned {completed: true}');
SELECT is(((SELECT v FROM _txt WHERE k='compres')::jsonb)->>'pto_entries_written', '4', 'four ledger rows written');
SELECT is(((SELECT v FROM _txt WHERE k='compres')::jsonb)->>'pay_summary_pending', '1', 'one pay_summary pending (e1 has a personal_email)');
SELECT is(((SELECT v FROM _txt WHERE k='compres')::jsonb)->>'pay_summary_skipped_no_email', '1', 'one pay_summary skipped_no_email (e2 has none)');
SELECT is((SELECT status FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='run1')), 'completed', 'run1 completed');
-- e1 balance: 33.5 + 3.08 - 8 - 2 = 26.58
SELECT is((SELECT sum(hours)::text FROM public.qteklink_payroll_pto_ledger WHERE employee_id=(SELECT v FROM _ids WHERE k='e1')),
  '26.58', 'e1 balance = 33.5 + 3.08 - 8 - 2 = 26.58 (running balances stamped in-RPC)');
SELECT is((SELECT sum(hours)::text FROM public.qteklink_payroll_pto_ledger WHERE employee_id=(SELECT v FROM _ids WHERE k='e2')),
  '3.08', 'e2 balance = 3.08 (accrual only, no prior rows)');
-- the completion-idempotency UNIQUE (run, employee, kind) WHERE accrual/usage:
-- a direct duplicate accrual insert for the same (run, e1) is rejected.
SELECT throws_ok($$
  INSERT INTO public.qteklink_payroll_pto_ledger (shop_id, employee_id, run_id, kind, hours, balance_after_hours, created_by_label)
  VALUES (7476, (SELECT v FROM _ids WHERE k='e1'), (SELECT v FROM _ids WHERE k='run1'), 'accrual', 1, 1, 'pgtap') $$,
  '23505', NULL, 'a duplicate (run, employee, accrual) row is rejected by the completion-idempotency UNIQUE');

-- ── the pay_summary identity rail (§5)
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_email_log WHERE run_id=(SELECT v FROM _ids WHERE k='run1') AND kind='pay_summary'), 2,
  'exactly ONE pay_summary row per rostered employee (2)');
SELECT is((SELECT status||'/'||recipient FROM public.qteklink_payroll_email_log
           WHERE run_id=(SELECT v FROM _ids WHERE k='run1') AND kind='pay_summary' AND employee_id=(SELECT v FROM _ids WHERE k='e1')),
  'pending/p@x.com', 'e1 pay_summary is pending with the recipient bound from e1''s own row');
SELECT is((SELECT status||'/'||recipient FROM public.qteklink_payroll_email_log
           WHERE run_id=(SELECT v FROM _ids WHERE k='run1') AND kind='pay_summary' AND employee_id=(SELECT v FROM _ids WHERE k='e2')),
  'skipped_no_email/', 'e2 pay_summary is skipped_no_email with a blank recipient');
-- ONE row per (run, employee) EVER: a duplicate pay_summary insert is rejected
SELECT throws_ok($$
  INSERT INTO public.qteklink_payroll_email_log (shop_id, run_id, employee_id, kind, recipient, status)
  VALUES (7476, (SELECT v FROM _ids WHERE k='run1'), (SELECT v FROM _ids WHERE k='e1'), 'pay_summary', 'p@x.com', 'pending') $$,
  '23505', NULL, 'a second pay_summary row for the same (run, employee) is rejected (identity rail)');

-- ── the FULL void cycle: void restores the balance via void_reversal rows
INSERT INTO _txt VALUES ('e1_bal_before_void', (SELECT sum(hours)::text FROM public.qteklink_payroll_pto_ledger WHERE employee_id=(SELECT v FROM _ids WHERE k='e1')));
INSERT INTO _txt VALUES ('hv', (public.qteklink_payroll_void_run((SELECT v FROM _ids WHERE k='run1'), NULL, true, NULL, NULL, NULL, 'chris@jeffsautomotive.com'))->>'state_hash');
INSERT INTO _ids VALUES ('tkV1', (SELECT token_id FROM public.qteklink_payroll_issue_confirm_token((SELECT v FROM _ids WHERE k='run1'),'void_run',(SELECT v FROM _txt WHERE k='hv'),NULL,'chris@jeffsautomotive.com')));
INSERT INTO _txt VALUES ('voidres', (public.qteklink_payroll_void_run((SELECT v FROM _ids WHERE k='run1'), 'wrong hours', false,
  (SELECT v FROM _ids WHERE k='tkV1'), (SELECT v FROM _txt WHERE k='hv'), NULL, 'chris@jeffsautomotive.com')::text));
SELECT is(((SELECT v FROM _txt WHERE k='voidres')::jsonb)->>'voided', 'true', 'void returned {voided: true}');
SELECT is(((SELECT v FROM _txt WHERE k='voidres')::jsonb)->>'pto_entries_reversed', '4', 'all four ledger rows reversed');
INSERT INTO _ids VALUES ('clone1', (((SELECT v FROM _txt WHERE k='voidres')::jsonb)->>'clone_run_id')::uuid);
-- balance restored: the reversals net the run's entries back out
SELECT is((SELECT sum(hours)::text FROM public.qteklink_payroll_pto_ledger WHERE employee_id=(SELECT v FROM _ids WHERE k='e1')),
  '33.50', 'e1 balance restored to the pre-completion 33.5 after the void reversals');
SELECT is((SELECT sum(hours)::text FROM public.qteklink_payroll_pto_ledger WHERE employee_id=(SELECT v FROM _ids WHERE k='e2')),
  '0.00', 'e2 balance restored to 0 after the void reversals');
-- the reversal rows are kind='void_reversal' carrying the voided run's run_id
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_pto_ledger WHERE run_id=(SELECT v FROM _ids WHERE k='run1') AND kind='void_reversal'), 4,
  'four void_reversal rows carry the voided run''s run_id');
-- a REPLAYED reversal is impossible (UNIQUE(reverses_ledger_id)): re-inserting a
-- reversal for an already-reversed row is rejected.
SELECT throws_ok($$
  INSERT INTO public.qteklink_payroll_pto_ledger (shop_id, employee_id, run_id, kind, hours, balance_after_hours, reverses_ledger_id, created_by_label)
  SELECT 7476, l.employee_id, l.run_id, 'void_reversal', -l.hours, 0, l.id, 'pgtap'
  FROM public.qteklink_payroll_pto_ledger l
  WHERE l.run_id=(SELECT v FROM _ids WHERE k='run1') AND l.kind='accrual' LIMIT 1 $$,
  '23505', NULL, 'a replayed reversal is rejected by UNIQUE(reverses_ledger_id)');

-- ── the clone completes cleanly: the rollover re-fires EXACTLY once (same value)
SELECT is((SELECT status FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='clone1')), 'open', 'the clone is open');
INSERT INTO _txt VALUES ('h2', (public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='clone1'), true, NULL, NULL, NULL, NULL, 'chris@jeffsautomotive.com'))->>'state_hash');
INSERT INTO _ids VALUES ('tk2', (SELECT token_id FROM public.qteklink_payroll_issue_confirm_token((SELECT v FROM _ids WHERE k='clone1'),'complete_run',(SELECT v FROM _txt WHERE k='h2'),NULL,'chris@jeffsautomotive.com')));
SELECT lives_ok($$ SELECT public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='clone1'), false,
  (SELECT v FROM _ids WHERE k='tk2'), (SELECT v FROM _txt WHERE k='h2'), '{"snapshot_version":1}'::jsonb, NULL, 'chris@jeffsautomotive.com',
  jsonb_build_array(
    jsonb_build_object('employee_id',(SELECT v FROM _ids WHERE k='e1'),'kind','accrual','hours',3.08),
    jsonb_build_object('employee_id',(SELECT v FROM _ids WHERE k='e1'),'kind','usage','hours',-8),
    jsonb_build_object('employee_id',(SELECT v FROM _ids WHERE k='e1'),'kind','rollover_forfeit','hours',-2,'boundary_year',2026),
    jsonb_build_object('employee_id',(SELECT v FROM _ids WHERE k='e2'),'kind','accrual','hours',3.08)
  )) $$, 'the clone completes cleanly (void re-armed the accrual/usage idempotency)');
-- rollover at-most-once: exactly ONE un-reversed rollover_forfeit for (e1, 2026)
-- across the whole cycle (the run1 forfeit was reversed; the clone re-fired one).
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_pto_ledger f
           WHERE f.employee_id=(SELECT v FROM _ids WHERE k='e1') AND f.kind='rollover_forfeit' AND f.boundary_year=2026
             AND NOT EXISTS (SELECT 1 FROM public.qteklink_payroll_pto_ledger r WHERE r.reverses_ledger_id=f.id)), 1,
  'exactly ONE un-reversed rollover_forfeit for (e1, 2026) survives the void->clone cycle');
-- final e1 balance after the clone completes: 33.5 + 3.08 - 8 - 2 = 26.58 again
SELECT is((SELECT sum(hours)::text FROM public.qteklink_payroll_pto_ledger WHERE employee_id=(SELECT v FROM _ids WHERE k='e1')),
  '26.58', 'e1 balance after the clone completes matches the original completion (net, order-independent)');

-- ── the clone voids cleanly (a second full trip)
INSERT INTO _txt VALUES ('hv2', (public.qteklink_payroll_void_run((SELECT v FROM _ids WHERE k='clone1'), NULL, true, NULL, NULL, NULL, 'chris@jeffsautomotive.com'))->>'state_hash');
INSERT INTO _ids VALUES ('tkV2', (SELECT token_id FROM public.qteklink_payroll_issue_confirm_token((SELECT v FROM _ids WHERE k='clone1'),'void_run',(SELECT v FROM _txt WHERE k='hv2'),NULL,'chris@jeffsautomotive.com')));
SELECT lives_ok($$ SELECT public.qteklink_payroll_void_run((SELECT v FROM _ids WHERE k='clone1'), 'redo again', false,
  (SELECT v FROM _ids WHERE k='tkV2'), (SELECT v FROM _txt WHERE k='hv2'), NULL, 'chris@jeffsautomotive.com') $$,
  'the clone voids cleanly (a second reversal set nets the balance back)');
SELECT is((SELECT sum(hours)::text FROM public.qteklink_payroll_pto_ledger WHERE employee_id=(SELECT v FROM _ids WHERE k='e1')),
  '33.50', 'e1 balance restored to 33.5 again after the clone void');

-- ── a zero-PTO-config completion (NULL p_pto_entries) succeeds with zero rows
-- and byte-identical legacy behaviour (the LIVE app between db push and TS deploy).
INSERT INTO _ids VALUES ('runZ', public.qteklink_payroll_create_run(7476, '2026-07-12'::date, NULL, 'chris@jeffsautomotive.com'));
INSERT INTO _txt VALUES ('hz', (public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='runZ'), true, NULL, NULL, NULL, NULL, 'chris@jeffsautomotive.com'))->>'state_hash');
INSERT INTO _ids VALUES ('tkZ', (SELECT token_id FROM public.qteklink_payroll_issue_confirm_token((SELECT v FROM _ids WHERE k='runZ'),'complete_run',(SELECT v FROM _txt WHERE k='hz'),NULL,'chris@jeffsautomotive.com')));
-- NO p_pto_entries here (7-arg-equivalent call via the DEFAULT)
INSERT INTO _txt VALUES ('zres', (public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='runZ'), false,
  (SELECT v FROM _ids WHERE k='tkZ'), (SELECT v FROM _txt WHERE k='hz'), '{"snapshot_version":1}'::jsonb, NULL, 'chris@jeffsautomotive.com'))::text);
SELECT is(((SELECT v FROM _txt WHERE k='zres')::jsonb)->>'completed', 'true', 'a NULL-p_pto_entries completion returns {completed: true} (legacy byte-identical)');
SELECT ok(((SELECT v FROM _txt WHERE k='zres')::jsonb) ? 'completed' AND NOT (((SELECT v FROM _txt WHERE k='zres')::jsonb) ? 'pto_entries_written'),
  'the legacy-shape result has NO pto/email counters (byte-identical to the pre-round-11 return)');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_pto_ledger WHERE run_id=(SELECT v FROM _ids WHERE k='runZ')), 0,
  'a NULL-p_pto_entries completion writes ZERO ledger rows');
SELECT is((SELECT count(*)::int FROM public.qteklink_payroll_email_log WHERE run_id=(SELECT v FROM _ids WHERE k='runZ')), 0,
  'a NULL-p_pto_entries completion writes ZERO email-log rows');
-- and its void reverses zero rows cleanly
INSERT INTO _txt VALUES ('hzv', (public.qteklink_payroll_void_run((SELECT v FROM _ids WHERE k='runZ'), NULL, true, NULL, NULL, NULL, 'chris@jeffsautomotive.com'))->>'state_hash');
INSERT INTO _ids VALUES ('tkZV', (SELECT token_id FROM public.qteklink_payroll_issue_confirm_token((SELECT v FROM _ids WHERE k='runZ'),'void_run',(SELECT v FROM _txt WHERE k='hzv'),NULL,'chris@jeffsautomotive.com')));
INSERT INTO _txt VALUES ('zvoid', (public.qteklink_payroll_void_run((SELECT v FROM _ids WHERE k='runZ'), 'nothing here', false,
  (SELECT v FROM _ids WHERE k='tkZV'), (SELECT v FROM _txt WHERE k='hzv'), NULL, 'chris@jeffsautomotive.com')::text));
SELECT is(((SELECT v FROM _txt WHERE k='zvoid')::jsonb)->>'pto_entries_reversed', '0', 'voiding a zero-ledger run reverses zero rows (success, not an error)');

-- ── p_pto_entries shape validation (a few representative RAISEs)
INSERT INTO _ids VALUES ('run2', public.qteklink_payroll_create_run(7476, '2026-07-26'::date, NULL, 'chris@jeffsautomotive.com'));
INSERT INTO _txt VALUES ('h3', (public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='run2'), true, NULL, NULL, NULL, NULL, 'chris@jeffsautomotive.com'))->>'state_hash');
INSERT INTO _ids VALUES ('tk3', (SELECT token_id FROM public.qteklink_payroll_issue_confirm_token((SELECT v FROM _ids WHERE k='run2'),'complete_run',(SELECT v FROM _txt WHERE k='h3'),NULL,'chris@jeffsautomotive.com')));
-- an 'initial'/'adjustment' kind is NOT allowed in p_pto_entries (run-driven only)
SELECT throws_ok($$ SELECT public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='run2'), false,
  (SELECT v FROM _ids WHERE k='tk3'), (SELECT v FROM _txt WHERE k='h3'), '{"snapshot_version":1}'::jsonb, NULL, 'chris@jeffsautomotive.com',
  jsonb_build_array(jsonb_build_object('employee_id',(SELECT v FROM _ids WHERE k='e1'),'kind','initial','hours',3))) $$,
  'P0001', NULL, 'p_pto_entries only accepts accrual/usage/rollover_forfeit (initial rejected)');
SELECT ok((SELECT status='open' FROM public.qteklink_payroll_runs WHERE id=(SELECT v FROM _ids WHERE k='run2')), 'run2 still open after the rejected shape');
-- a rollover_forfeit WITHOUT a boundary_year RAISEs
SELECT throws_ok($$ SELECT public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='run2'), false,
  (SELECT v FROM _ids WHERE k='tk3'), (SELECT v FROM _txt WHERE k='h3'), '{"snapshot_version":1}'::jsonb, NULL, 'chris@jeffsautomotive.com',
  jsonb_build_array(jsonb_build_object('employee_id',(SELECT v FROM _ids WHERE k='e1'),'kind','rollover_forfeit','hours',-2))) $$,
  'P0001', NULL, 'rollover_forfeit without a boundary_year rejected');
-- a positive usage RAISEs (the ledger decrements)
SELECT throws_ok($$ SELECT public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='run2'), false,
  (SELECT v FROM _ids WHERE k='tk3'), (SELECT v FROM _txt WHERE k='h3'), '{"snapshot_version":1}'::jsonb, NULL, 'chris@jeffsautomotive.com',
  jsonb_build_array(jsonb_build_object('employee_id',(SELECT v FROM _ids WHERE k='e1'),'kind','usage','hours',8))) $$,
  'P0001', NULL, 'positive usage hours rejected (usage decrements)');
-- ABSENT-key hardening (the `? ` presence test leads the type check so an absent
-- key RAISEs a clean P0001 instead of silently falling through to a table
-- constraint): a missing hours key, a missing employee_id key.
SELECT throws_ok($$ SELECT public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='run2'), false,
  (SELECT v FROM _ids WHERE k='tk3'), (SELECT v FROM _txt WHERE k='h3'), '{"snapshot_version":1}'::jsonb, NULL, 'chris@jeffsautomotive.com',
  jsonb_build_array(jsonb_build_object('employee_id',(SELECT v FROM _ids WHERE k='e1'),'kind','accrual'))) $$,
  'P0001', NULL, 'a p_pto_entries element with NO hours key rejected (clean P0001, not a downstream NOT NULL)');
SELECT throws_ok($$ SELECT public.qteklink_payroll_complete_run((SELECT v FROM _ids WHERE k='run2'), false,
  (SELECT v FROM _ids WHERE k='tk3'), (SELECT v FROM _txt WHERE k='h3'), '{"snapshot_version":1}'::jsonb, NULL, 'chris@jeffsautomotive.com',
  jsonb_build_array(jsonb_build_object('kind','accrual','hours',3.08))) $$,
  'P0001', NULL, 'a p_pto_entries element with NO employee_id key rejected (clean P0001)');

-- ═══════════════════════════════════════════════════════════════════════════
-- Deny-all RLS on the two new tables + anon/authenticated denial on every
-- new/re-created RPC.
-- ═══════════════════════════════════════════════════════════════════════════
SELECT is((SELECT count(*)::int FROM pg_class c
           WHERE c.relnamespace='public'::regnamespace
             AND c.relname IN ('qteklink_payroll_pto_ledger','qteklink_payroll_email_log')
             AND c.relrowsecurity), 2, 'RLS enabled on both new PTO tables');
SELECT is((SELECT count(*)::int FROM pg_policies
           WHERE schemaname='public' AND tablename IN ('qteklink_payroll_pto_ledger','qteklink_payroll_email_log')), 0,
  'deny-all: ZERO policies on the new PTO tables');

SET ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_payroll_pto_ledger $$, '42501', NULL, 'anon cannot SELECT the ledger');
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_payroll_email_log $$, '42501', NULL, 'anon cannot SELECT the email log');
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_employee_profile(7476, gen_random_uuid(), '{}'::jsonb, NULL, 'x') $$, '42501', NULL, 'anon cannot update_employee_profile');
SELECT throws_ok($$ SELECT public.qteklink_payroll_adjust_pto(7476, gen_random_uuid(), 'initial', 1, NULL, 'x') $$, '42501', NULL, 'anon cannot adjust_pto');
SELECT throws_ok($$ SELECT public.qteklink_payroll_log_email(7476, 'pto_adjustment', 'a@b.com', 's') $$, '42501', NULL, 'anon cannot log_email');
SELECT throws_ok($$ SELECT public.qteklink_payroll_transition_email(gen_random_uuid(), 'sent') $$, '42501', NULL, 'anon cannot transition_email');
-- the re-created RPCs (8-arg complete_run + the extended void_run) also deny anon
SELECT throws_ok($$ SELECT public.qteklink_payroll_complete_run(gen_random_uuid(), true, NULL, NULL, NULL, NULL, 'x', NULL) $$, '42501', NULL, 'anon cannot complete_run (8-arg form)');
SELECT throws_ok($$ SELECT public.qteklink_payroll_void_run(gen_random_uuid(), 'x', true, NULL, NULL, NULL, 'x') $$, '42501', NULL, 'anon cannot void_run');
RESET ROLE;

SET ROLE authenticated;
SELECT throws_ok($$ SELECT public.qteklink_payroll_update_employee_profile(7476, gen_random_uuid(), '{}'::jsonb, NULL, 'x') $$, '42501', NULL, 'authenticated cannot update_employee_profile');
SELECT throws_ok($$ SELECT public.qteklink_payroll_adjust_pto(7476, gen_random_uuid(), 'initial', 1, NULL, 'x') $$, '42501', NULL, 'authenticated cannot adjust_pto');
SELECT throws_ok($$ SELECT public.qteklink_payroll_transition_email(gen_random_uuid(), 'sent') $$, '42501', NULL, 'authenticated cannot transition_email');
SELECT throws_ok($$ SELECT public.qteklink_payroll_complete_run(gen_random_uuid(), true, NULL, NULL, NULL, NULL, 'x', NULL) $$, '42501', NULL, 'authenticated cannot complete_run (8-arg form)');
RESET ROLE;

-- ═══════════════════════════════════════════════════════════════════════════
-- service_role: direct writes to the new tables are denied (RPC-write-only).
-- ═══════════════════════════════════════════════════════════════════════════
SET ROLE service_role;
SELECT throws_ok($$ INSERT INTO public.qteklink_payroll_pto_ledger (shop_id, employee_id, kind, hours, balance_after_hours, created_by_label)
  VALUES (7476, gen_random_uuid(), 'initial', 1, 1, 'x') $$, '42501', NULL, 'service_role cannot INSERT ledger rows directly');
SELECT throws_ok($$ INSERT INTO public.qteklink_payroll_email_log (shop_id, kind, status)
  VALUES (7476, 'pto_adjustment', 'pending') $$, '42501', NULL, 'service_role cannot INSERT email-log rows directly');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
