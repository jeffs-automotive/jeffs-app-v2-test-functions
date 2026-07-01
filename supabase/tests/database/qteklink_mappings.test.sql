-- =====================================================================
-- pgTAP — QTekLink C2 mappings (hardened: identity + integrity + defense)
-- =====================================================================
-- Covers 20260606010000 + 20260606020000 hardening:
--   - table + RPCs + both compat helpers + the validation trigger exist; RLS on
--   - role<->account_type matrix; kind<->posting_role matrix
--   - set_mapping happy paths (labor->Income, system cc_fee->Expense)
--   - REJECTS: role<->type incompat, INACTIVE account, soft-deleted account,
--     not-in-COA, kind<->role incompat, bad system source_key, system role<>key
--   - ONE ACTIVE per source_key (adding a source_id later does NOT fork)
--   - source_id reuse within a kind is rejected [23505]
--   - deactivate: active -> true, already-inactive -> false
--   - DEFENSE-IN-DEPTH: a direct (non-RPC) insert of a role-incompatible active
--     row is blocked by the TRIGGER [P0001]; a kind<->role violation is blocked
--     by the CHECK [23514]
--   - cross shop/realm isolation; anon/authenticated denied [42501]
--
-- Runs as the BYPASSRLS migration role. Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

-- ─── Existence + RLS + trigger ──────────────────────────────────────────
SELECT has_table('public', 'qteklink_mappings', 'qteklink_mappings table exists');
SELECT has_function('public', 'qteklink_set_mapping', ARRAY['integer','text','text','text','text','text','text','boolean'], 'set_mapping exists (8-arg incl. pass_through)');
SELECT has_function('public', 'qteklink_deactivate_mapping', ARRAY['integer','text','uuid'], 'deactivate_mapping exists');
SELECT has_function('public', 'qteklink_role_accepts_type', ARRAY['text','text'], 'role_accepts_type exists');
SELECT has_function('public', 'qteklink_kind_accepts_role', ARRAY['text','text'], 'kind_accepts_role exists');
SELECT has_trigger('public', 'qteklink_mappings', 'qteklink_mappings_validate_trg', 'validation trigger exists');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='qteklink_mappings' AND relnamespace='public'::regnamespace), true, 'RLS enabled');

-- ─── Compat matrices (pure) ─────────────────────────────────────────────
SELECT ok(public.qteklink_role_accepts_type('income','Income'), 'role: income accepts Income');
SELECT ok(NOT public.qteklink_role_accepts_type('income','Expense'), 'role: income rejects Expense');
SELECT ok(public.qteklink_role_accepts_type('cc_fee','Expense'), 'role: cc_fee accepts Expense');
SELECT ok(public.qteklink_role_accepts_type('accounts_receivable','Other Current Asset'), 'role: accounts_receivable accepts Other Current Asset (bulk customer-less A/R)');
SELECT ok(NOT public.qteklink_role_accepts_type('accounts_receivable','Accounts Receivable'), 'role: accounts_receivable REJECTS a true Accounts Receivable type (it would force a per-line Customer Entity)');
SELECT ok(public.qteklink_role_accepts_type('accounts_receivable', NULL::text) IS FALSE, 'role matrix is NULL-safe: accounts_receivable vs NULL type -> FALSE (not NULL)');
SELECT ok(public.qteklink_role_accepts_type('income', NULL::text) IS FALSE, 'role matrix is NULL-safe: income vs NULL type -> FALSE (not NULL)');
SELECT ok(public.qteklink_kind_accepts_role('labor','income'), 'kind: labor accepts income');
SELECT ok(NOT public.qteklink_kind_accepts_role('labor','cc_fee'), 'kind: labor rejects cc_fee');
SELECT ok(public.qteklink_kind_accepts_role('tax','sales_tax_payable'), 'kind: tax accepts sales_tax_payable');
SELECT ok(NOT public.qteklink_kind_accepts_role('tax','income'), 'kind: tax rejects income');
SELECT ok(public.qteklink_kind_accepts_role('system','cc_fee'), 'kind: system accepts cc_fee');
SELECT ok(public.qteklink_role_accepts_type('store_credit','Other Current Liability'), 'role: store_credit accepts Other Current Liability');
SELECT ok(NOT public.qteklink_role_accepts_type('store_credit','Expense'), 'role: store_credit rejects Expense');
SELECT ok(NOT public.qteklink_role_accepts_type('store_credit','Other Current Asset'), 'role: store_credit rejects Other Current Asset (it is a liability, not Undeposited)');
SELECT ok(public.qteklink_role_accepts_type('store_credit', NULL::text) IS FALSE, 'role matrix is NULL-safe: store_credit vs NULL type -> FALSE');
SELECT ok(public.qteklink_kind_accepts_role('system','store_credit'), 'kind: system accepts store_credit');
SELECT ok(public.qteklink_role_accepts_type('fee_expense','Expense'), 'role: fee_expense accepts Expense');
SELECT ok(public.qteklink_role_accepts_type('fee_expense','Other Expense'), 'role: fee_expense accepts Other Expense');
SELECT ok(NOT public.qteklink_role_accepts_type('fee_expense','Income'), 'role: fee_expense rejects Income (an expense-offset fee must credit an expense account)');
SELECT ok(public.qteklink_role_accepts_type('fee_expense', NULL::text) IS FALSE, 'role matrix is NULL-safe: fee_expense vs NULL type -> FALSE');
SELECT ok(public.qteklink_kind_accepts_role('fee','income'), 'kind: fee accepts income');
SELECT ok(public.qteklink_kind_accepts_role('fee','fee_expense'), 'kind: fee accepts fee_expense (an expense-offset fee)');
SELECT ok(NOT public.qteklink_kind_accepts_role('labor','fee_expense'), 'kind: labor rejects fee_expense (only a fee may be expense-offset)');

-- ─── Seed connections + COA (active, inactive, soft-deleted) ────────────
INSERT INTO public.qbo_connections (realm_id, shop_id, access_token_expires_at, refresh_token_expires_at)
VALUES ('realm-A', 7476, now() + interval '1 hour', now() + interval '100 days'),
       ('realm-B', 7477, now() + interval '1 hour', now() + interval '100 days');

INSERT INTO public.qbo_accounts (shop_id, realm_id, qbo_account_id, name, account_type, active, deleted_at)
VALUES
  (7476,'realm-A','275','Sales - Labor','Income',true,NULL),
  (7476,'realm-A','276','Sales - Sublet','Income',true,NULL),
  (7476,'realm-A','235','ACCOUNTS RECEIVABLE','Other Current Asset',true,NULL),  -- acct# 120; the bulk A/R target (OCA, not a true A/R type)
  (7476,'realm-A','236','True A/R (synthetic)','Accounts Receivable',true,NULL), -- a real A/R-TYPE acct: must be REJECTED for the accounts_receivable role
  (7476,'realm-A','237','No-Type Account',NULL,true,NULL),                        -- account_type NULL: must be unmappable for any role (NULL-safe gate)
  (7476,'realm-A','309','Bank/CC Fees','Expense',true,NULL),
  (7476,'realm-A','400','Inactive Income','Income',false,NULL),       -- INACTIVE
  (7476,'realm-A','999','Removed Income','Income',true,now()),        -- soft-deleted
  (7476,'realm-A','260','Customer Store Credit','Other Current Liability',true,NULL), -- the store_credit target
  (7477,'realm-B','275','Sales - Labor (shop B)','Income',true,NULL);

-- ─── Happy paths ────────────────────────────────────────────────────────
SELECT isnt(public.qteklink_set_mapping(7476,'realm-A','labor','Labor',NULL,'275','income'), NULL, 'labor->275 ok');
SELECT isnt(public.qteklink_set_mapping(7476,'realm-A','system','cc_fee',NULL,'309','cc_fee'), NULL, 'system cc_fee->309 ok');
SELECT isnt(public.qteklink_set_mapping(7476,'realm-A','system','accounts_receivable',NULL,'235','accounts_receivable'), NULL, 'system accounts_receivable -> 235 (Other Current Asset, acct# 120) ok');
SELECT isnt(public.qteklink_set_mapping(7476,'realm-A','system','store_credit',NULL,'260','store_credit'), NULL, 'system store_credit -> 260 (Other Current Liability) ok');

-- ─── pass_through (C5): fee-only flag, excluded from the discount waterfall ──
SELECT isnt(public.qteklink_set_mapping(7476,'realm-A','fee','State Communication Fee',NULL,'276','income',true), NULL, 'pass-through fee mapping ok');
SELECT is((SELECT pass_through FROM public.qteklink_mappings WHERE shop_id=7476 AND realm_id='realm-A' AND kind='fee' AND source_key='State Communication Fee' AND active), true, 'pass_through stored true on the fee mapping');
SELECT throws_ok($$ SELECT public.qteklink_set_mapping(7476,'realm-A','labor','Labor2',NULL,'275','income',true) $$, 'P0001', NULL, 'RPC guard: pass_through rejected on a non-fee kind');
SELECT throws_ok($$ INSERT INTO public.qteklink_mappings (shop_id,realm_id,kind,source_key,qbo_account_id,posting_role,pass_through,active) VALUES (7476,'realm-A','labor','LX','275','income',true,true) $$, '23514', NULL, 'CHECK: pass_through rejected on a non-fee direct insert');

-- ─── fee_expense (a fee may credit an Expense account = contra-expense offset) ──
-- The SUCCESSFUL Gas->309 insert PROVES role_valid admits fee_expense (the gate the
-- store-credit rollout forgot -> a fee_expense insert would raise 23514 if it were missing).
SELECT isnt(public.qteklink_set_mapping(7476,'realm-A','fee','Gas',NULL,'309','fee_expense'), NULL, 'fee Gas -> 309 (Expense) role fee_expense ok');
SELECT is((SELECT posting_role FROM public.qteklink_mappings WHERE shop_id=7476 AND realm_id='realm-A' AND kind='fee' AND source_key='Gas' AND active), 'fee_expense', 'fee_expense role stored on the Gas mapping');
SELECT isnt(public.qteklink_set_mapping(7476,'realm-A','fee','ShopSupplies',NULL,'275','income'), NULL, 'fee -> Income account role income still ok (fees are dual-role)');
SELECT throws_ok($$ SELECT public.qteklink_set_mapping(7476,'realm-A','fee','GasBad',NULL,'275','fee_expense') $$, 'P0001', NULL, 'fee_expense REJECTS an Income account (275) — trigger role<->type');
SELECT throws_ok($$ SELECT public.qteklink_set_mapping(7476,'realm-A','fee','GasBad2',NULL,'309','income') $$, 'P0001', NULL, 'income still REJECTS an Expense account (309) for a fee — trigger role<->type');
SELECT throws_ok($$ SELECT public.qteklink_set_mapping(7476,'realm-A','labor','LaborExp',NULL,'309','fee_expense') $$, 'P0001', NULL, 'kind<->role: a non-fee kind cannot use fee_expense (RPC)');
SELECT throws_ok($$ INSERT INTO public.qteklink_mappings (shop_id,realm_id,kind,source_key,qbo_account_id,posting_role,active) VALUES (7476,'realm-A','labor','LaborExpDirect','309','fee_expense',true) $$, '23514', NULL, 'kind<->role CHECK blocks a non-fee kind + fee_expense on direct insert (trigger passes: fee_expense accepts Expense)');
SELECT lives_ok($$ INSERT INTO public.qteklink_mappings (shop_id,realm_id,kind,source_key,qbo_account_id,posting_role,active) VALUES (7476,'realm-A','fee','DirectGas','309','fee_expense',true) $$, 'direct insert of a fee_expense mapping to an Expense account passes all CHECKs + the trigger');

-- ─── Rejections (RPC + trigger) ─────────────────────────────────────────
SELECT throws_ok($$ SELECT public.qteklink_set_mapping(7476,'realm-A','labor','L1',NULL,'309','income') $$, 'P0001', NULL, 'role<->type: income rejects an Expense account (trigger)');
SELECT throws_ok($$ SELECT public.qteklink_set_mapping(7476,'realm-A','part_category','Tires',NULL,'400','income') $$, 'P0001', NULL, 'INACTIVE account is rejected (trigger)');
SELECT throws_ok($$ SELECT public.qteklink_set_mapping(7476,'realm-A','fee','Old',NULL,'999','income') $$, 'P0001', NULL, 'soft-deleted account is rejected (trigger)');
SELECT throws_ok($$ SELECT public.qteklink_set_mapping(7476,'realm-A','fee','X',NULL,'NOPE','income') $$, 'P0001', NULL, 'account not in COA is rejected (trigger)');
SELECT throws_ok($$ SELECT public.qteklink_set_mapping(7476,'realm-A','labor','L2',NULL,'275','cc_fee') $$, 'P0001', NULL, 'kind<->role: labor cannot use cc_fee (RPC)');
SELECT throws_ok($$ SELECT public.qteklink_set_mapping(7476,'realm-A','system','bogus',NULL,'235','accounts_receivable') $$, 'P0001', NULL, 'system bogus source_key rejected (RPC)');
SELECT throws_ok($$ SELECT public.qteklink_set_mapping(7476,'realm-A','system','cc_fee',NULL,'309','accounts_receivable') $$, 'P0001', NULL, 'system role must equal source_key (RPC)');
SELECT throws_ok($$ SELECT public.qteklink_set_mapping(7476,'realm-A','system','accounts_receivable',NULL,'236','accounts_receivable') $$, 'P0001', NULL, 'A/R role REJECTS a true Accounts-Receivable-TYPE account (236) — bulk A/R must be Other Current Asset');
SELECT throws_ok($$ SELECT public.qteklink_set_mapping(7476,'realm-A','system','undeposited_funds',NULL,'237','undeposited_funds') $$, 'P0001', NULL, 'NULL account_type is unmappable for any role (NULL-safe role<->type gate)');
SELECT throws_ok($$ SELECT public.qteklink_set_mapping(7476,'realm-A','system','store_credit',NULL,'235','store_credit') $$, 'P0001', NULL, 'store_credit role REJECTS a non-liability account (235 is Other Current Asset)');
-- the rejected attempts left the original labor->275 untouched
SELECT is((SELECT qbo_account_id FROM public.qteklink_mappings WHERE shop_id=7476 AND realm_id='realm-A' AND kind='labor' AND source_key='Labor' AND active), '275', 'labor->275 unchanged after rejections');

-- ─── ONE ACTIVE per source_key: adding a source_id later does NOT fork ──
SELECT isnt(public.qteklink_set_mapping(7476,'realm-A','labor','Labor','123','276','income'), NULL, 're-map Labor (now with source_id) ok');
SELECT is((SELECT count(*)::int FROM public.qteklink_mappings WHERE shop_id=7476 AND realm_id='realm-A' AND kind='labor' AND source_key='Labor' AND active), 1, 'still exactly one active Labor mapping (no fork)');
SELECT is((SELECT qbo_account_id FROM public.qteklink_mappings WHERE shop_id=7476 AND realm_id='realm-A' AND kind='labor' AND source_key='Labor' AND active), '276', 'active Labor mapping now -> 276');
SELECT is((SELECT source_id FROM public.qteklink_mappings WHERE shop_id=7476 AND realm_id='realm-A' AND kind='labor' AND source_key='Labor' AND active), '123', 'active Labor mapping carries source_id 123');
SELECT is((SELECT count(*)::int FROM public.qteklink_mappings WHERE shop_id=7476 AND realm_id='realm-A' AND kind='labor' AND source_key='Labor'), 2, 'history kept (2 Labor rows)');

-- ─── source_id reuse within a kind is rejected ─────────────────────────
SELECT isnt(public.qteklink_set_mapping(7476,'realm-A','fee','FeeA','SHARED','275','income'), NULL, 'fee FeeA w/ source_id SHARED ok');
SELECT throws_ok($$ SELECT public.qteklink_set_mapping(7476,'realm-A','fee','FeeB','SHARED','275','income') $$, '23505', NULL, 'reusing source_id SHARED within kind=fee is rejected');
-- blank source_id ('') is NULLed (action `|| null` + RPC nullif(btrim,'')) — never collides
SELECT isnt(public.qteklink_set_mapping(7476,'realm-A','fee','FeeBlank1','','275','income'), NULL, 'blank source_id mapping 1 ok');
SELECT isnt(public.qteklink_set_mapping(7476,'realm-A','fee','FeeBlank2','','275','income'), NULL, 'blank source_id mapping 2 ok (blank is not a shared id)');

-- ─── deactivate: active -> true, already-inactive -> false ──────────────
SELECT is(public.qteklink_deactivate_mapping(7476,'realm-A',
  (SELECT id FROM public.qteklink_mappings WHERE shop_id=7476 AND realm_id='realm-A' AND kind='labor' AND source_key='Labor' AND active)), true, 'deactivate active -> true');
SELECT is(public.qteklink_deactivate_mapping(7476,'realm-A',
  (SELECT id FROM public.qteklink_mappings WHERE shop_id=7476 AND realm_id='realm-A' AND kind='labor' AND qbo_account_id='275' AND NOT active LIMIT 1)), false, 'deactivate inactive -> false');

-- ─── DEFENSE IN DEPTH: direct (non-RPC) writes are still guarded ────────
-- trigger blocks a role-incompatible active row (income role + Expense account)
SELECT throws_ok($$
  INSERT INTO public.qteklink_mappings (shop_id, realm_id, kind, source_key, qbo_account_id, posting_role, active)
  VALUES (7476,'realm-A','labor','DirectBad','309','income',true) $$,
  'P0001', NULL, 'direct insert of a role-incompatible active row is blocked (trigger)');
-- CHECK blocks a kind<->role violation that passes the trigger (cc_fee + Expense)
SELECT throws_ok($$
  INSERT INTO public.qteklink_mappings (shop_id, realm_id, kind, source_key, qbo_account_id, posting_role, active)
  VALUES (7476,'realm-A','labor','DirectBad2','309','cc_fee',true) $$,
  '23514', NULL, 'direct insert violating kind<->role is blocked (CHECK)');

-- ─── Cross shop/realm isolation ─────────────────────────────────────────
SELECT isnt(public.qteklink_set_mapping(7477,'realm-B','labor','Labor',NULL,'275','income'), NULL, 'same kind/source under a different shop/realm -> separate row');

-- ─── SECURITY: anon + authenticated denied ──────────────────────────────
SET ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_mappings $$, '42501', NULL, 'anon cannot SELECT qteklink_mappings');
SELECT throws_ok($$ SELECT public.qteklink_set_mapping(7476,'realm-A','labor','Labor',NULL,'275','income') $$, '42501', NULL, 'anon cannot EXECUTE set_mapping');
RESET ROLE;
SET ROLE authenticated;
SELECT throws_ok($$ SELECT public.qteklink_deactivate_mapping(7476,'realm-A',gen_random_uuid()) $$, '42501', NULL, 'authenticated cannot EXECUTE deactivate_mapping');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
