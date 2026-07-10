# qteklink-payroll — BUILD CONTRACT (single source of truth for all build agents)

> Exact schemas + signatures. Where this conflicts with prose in the plan, THIS wins. Conventions:
> follow `supabase/migrations/20260607090000_qteklink_settings_ro_state.sql` (grants/RLS/RPC idiom)
> and the keytag GUC trigger (`supabase/migrations/20260511210000_keytag_ar_lockdown_trigger.sql`).

## Roles + families

`role` values: `general_manager | service_manager | asst_manager | office_manager | shop_foreman | technician | shop_support | office_support`

| family | roles | tekmetric_id_type | pay model |
|---|---|---|---|
| service_advisor | general_manager, service_manager, asst_manager | service_writer | salary + GP-tier bonus + spiff |
| office_manager | office_manager | service_writer | hourly + monthly sales-excess bonus |
| shop_foreman | shop_foreman | technician | technician sheet + shop-hours cliff bonus |
| technician | technician | technician | hourly + billed/efficiency |
| support | shop_support, office_support | technician | plain hourly + optional manual incentive |

## Tables (all: RLS enabled deny-all; `GRANT SELECT TO service_role`; `REVOKE INSERT,UPDATE,DELETE,TRUNCATE FROM service_role`; writes only via SECURITY DEFINER RPCs with `SET search_path = public`; `REVOKE EXECUTE ... FROM PUBLIC, anon` on every fn)

### qteklink_payroll_employees
`id uuid pk default gen_random_uuid(), shop_id integer not null, display_name text not null,
role text not null CHECK (role in (…8 values…)), tekmetric_employee_id bigint,
tekmetric_id_type text CHECK (tekmetric_id_type in ('technician','service_writer')),
pay_config jsonb not null, archived_at timestamptz, created_at/updated_at timestamptz default now(),
created_by_label text, updated_by_label text`
- Partial unique: `(shop_id, tekmetric_employee_id) WHERE archived_at IS NULL AND tekmetric_employee_id IS NOT NULL`
- CHECK: tekmetric_id_type must match role family table above when tekmetric_employee_id is not null.

### qteklink_payroll_runs
`id uuid pk, shop_id integer not null, period_start date not null, period_end date not null,
status text not null default 'open' CHECK (status in ('open','completed','voided')),
bonus_period boolean not null default false, bonus_month date,
snapshot jsonb, completed_at timestamptz, completed_by_user_id uuid, completed_by_label text,
voided_at timestamptz, voided_by_user_id uuid, voided_by_label text, void_reason text,
cloned_from_run_id uuid references qteklink_payroll_runs(id), created_at/updated_at`
- CHECK `period_end = period_start + 13`
- Partial unique `(shop_id, period_start) WHERE status <> 'voided'`
- Partial unique `(shop_id, bonus_month) WHERE bonus_period AND status <> 'voided'`
- CHECK status consistency: `completed ⇒ snapshot/completed_at/completed_by_label NOT NULL`;
  `voided ⇒ voided_at/void_reason NOT NULL (and snapshot etc. still present)`; `open ⇒ all of those NULL
  except clone lineage`. `bonus_period ⇒ bonus_month NOT NULL`.

### qteklink_payroll_run_employees
`id uuid pk, run_id uuid not null references qteklink_payroll_runs(id) on delete cascade,
shop_id integer not null, employee_id uuid not null references qteklink_payroll_employees(id),
role_snapshot text not null, pay_config jsonb not null,
clock_hours_w1 numeric(6,2), clock_hours_w2 numeric(6,2),
pto_w1/pto_w2/holiday_w1/holiday_w2/bereavement_w1/bereavement_w2/training_w1/training_w2 numeric(6,2),
manual_incentive_cents bigint, overrides jsonb not null default '{}', created_at/updated_at`
- UNIQUE (run_id, employee_id). All hour columns CHECK `>= 0 AND <= 120`. manual_incentive_cents CHECK
  `>= 0 AND <= 5000000`.

### qteklink_payroll_confirm_tokens  (Pattern S support)
`id uuid pk default gen_random_uuid(), shop_id integer not null, action_kind text not null
CHECK (action_kind in ('complete_run','void_run')), scope_hash text not null, run_id uuid not null,
created_at timestamptz default now(), expires_at timestamptz not null, consumed_at timestamptz`
(5-minute TTL; consume = atomic single-use inside the acting RPC.)

### qteklink_payroll_audit_log (append-only; INSERT via RPCs only)
`id bigserial pk, shop_id integer not null, run_id uuid, run_employee_id uuid, employee_id uuid,
actor_user_id uuid, actor_label text not null, action text not null, detail jsonb not null default '{}',
created_at timestamptz default now()`

### Immutability triggers (GUC pattern)
BEFORE UPDATE/DELETE on runs + run_employees: if the OLD run status is `completed` or `voided`,
RAISE EXCEPTION unless `current_setting('qteklink.payroll_lock_bypass', true) = 'on'`. ONLY
`qteklink_payroll_void_run` (the completed→voided status flip, which genuinely trips the trigger)
sets the GUC (`set_config(..., true)` local) around its own statement. `qteklink_payroll_complete_run`
runs UNBYPASSED (amended 2026-07-10, double-complete race review finding): an open→completed flip never
trips the trigger, so the bypass there only served to let a lost double-complete overwrite a frozen
snapshot. run_employees resolves its run's status via the FK. Also BEFORE UPDATE/DELETE on audit_log:
always RAISE (append-only, no bypass).

### Concurrency locking (amended 2026-07-10, same review)
`complete_run`/`void_run` read the run row `FOR UPDATE` (a racing second complete/void blocks, re-reads
the flipped status, RAISEs). `update_entry` + `sync_run_roster` read the run status `FOR KEY SHARE`,
`update_run` reads it `FOR NO KEY UPDATE` (it updates the row itself) — open-run edits serialize against
an in-flight completion instead of landing on a just-frozen run.

## pay_config JSONB (config_version: 1) — validated in DAL (Zod) AND in RPC (SQL checks: required keys per family, integers ≥ 0 for *_cents, numeric 0–1 for *_pct)

Common: `{ "config_version": 1, "pto_balance_hours": number, "pto_accrual_hours_per_period": number }`
- technician / shop_foreman: + `hourly_rate_cents int, billed_rate_cents int`
- shop_foreman: + `shop_hour_goal number, shop_hour_bonus_cents_per_hour int`
- service_advisor: + `weekly_salary_cents int, gp_goal_1_cents int, gp_goal_2_cents int,
  sales_goal_cents int, tier1_pct num, tier2_pct num, tier3_pct num, spiff_amount_cents int`
- office_manager: + `hourly_rate_cents int, sales_goal_cents int, bonus_pct num`
- support: + `hourly_rate_cents int`
- optional per-run (run_employees.pay_config only): `"rates_w2": { hourly_rate_cents?, billed_rate_cents?,
  weekly_salary_cents? }` (mid-period change; week 1 uses the base fields).

## overrides JSONB (run_employees) — every key optional; shape `{ "value": number, "note": string }`
`billed_hours_w1, billed_hours_w2, month_sales_cents, month_gp_with_fees_cents,
month_gp_without_fees_cents, spiff_count, shop_hours`

## settings (qteklink_settings, new `payroll` JSONB key via existing qteklink_upsert_settings partial-update)
`{ "anchor_period_start": "2026-06-28",
   "spiff_categories": [ { "name": str, "counted": bool, "multiplier": int(1..9), "first_seen": iso, "is_new": bool } ],
   "alert_emails": { "void_clone": [str], "completed": [str] } }`

## RPCs (exact signatures — Wire agent + migration agent MUST match)

```sql
qteklink_payroll_upsert_employee(p_shop_id int, p_employee_id uuid, p_display_name text, p_role text,
  p_tekmetric_employee_id bigint, p_pay_config jsonb, p_archived boolean, p_actor_user_id uuid,
  p_actor_label text) RETURNS uuid            -- p_employee_id null = create; derives tekmetric_id_type
qteklink_payroll_create_run(p_shop_id int, p_period_start date, p_actor_user_id uuid,
  p_actor_label text) RETURNS uuid            -- validates anchor cadence ((p_period_start - anchor) % 14 = 0),
                                              -- clones active employees' pay_config into run rows
qteklink_payroll_sync_run_roster(p_run_id uuid, p_actor_user_id uuid, p_actor_label text)
  RETURNS jsonb                               -- {added: [], removed: []}; open runs only; removes only entry-less rows
qteklink_payroll_update_entry(p_run_employee_id uuid, p_patch jsonb, p_actor_user_id uuid,
  p_actor_label text) RETURNS void            -- whitelisted keys: the hour columns, manual_incentive_cents,
                                              -- overrides, pay_config; open runs only; audits old→new per key
qteklink_payroll_update_run(p_run_id uuid, p_patch jsonb, p_actor_user_id uuid, p_actor_label text)
  RETURNS void                                -- whitelisted: bonus_period (bool; derives+stores bonus_month
                                              -- = date_trunc month of period_start - 1 month); open only
qteklink_payroll_issue_confirm_token(p_run_id uuid, p_action_kind text, p_scope_hash text,
  p_actor_user_id uuid, p_actor_label text) RETURNS TABLE(token_id uuid, expires_at timestamptz)
qteklink_payroll_complete_run(p_run_id uuid, p_dry_run boolean, p_confirm_token uuid,
  p_state_hash text, p_snapshot jsonb, p_actor_user_id uuid, p_actor_label text) RETURNS jsonb
  -- state_hash = md5 built INSIDE the RPC over (run.updated_at, count(entries), max(entries.updated_at),
  -- run.bonus_period, run.bonus_month); dry_run: recompute + return {state_hash}; caller then issues token.
  -- non-dry: recompute hash, compare p_state_hash, validate+consume token (kind complete_run, scope=hash,
  -- unexpired, unconsumed), require snapshot jsonb non-null, write snapshot+status+completed_* (UNBYPASSED —
  -- open→completed never trips the lock trigger; see §Concurrency locking), audit, RETURNS {completed: true}
qteklink_payroll_void_run(p_run_id uuid, p_reason text, p_dry_run boolean, p_confirm_token uuid,
  p_state_hash text, p_actor_user_id uuid, p_actor_label text) RETURNS jsonb
  -- completed runs only; same token dance (kind void_run); GUC-flip to voided (+voided_*/reason);
  -- CLONE: insert new open run (same period, cloned_from_run_id = old id) + copy all run_employees rows
  -- (entries + pay_config + overrides); audit both; RETURNS {voided: true, clone_run_id}
```

Errors: `RAISE EXCEPTION` with clear text (P0001 → surfaced as QboClientError per app convention).
Every mutating RPC writes ≥1 audit row.

## TS module layout (qteklink-app)

- `src/lib/payroll/types.ts` — Zod: PayConfig (discriminated per family), Overrides, RunStatus,
  SheetComputation, RunSnapshot (`snapshot_version: 1`, per-employee sheets + summary rows + derived
  provenance + settings.spiff_categories used + calc_version).
- `src/lib/payroll/calc.ts` — pure. `splitClock(total) → {reg: min(40,total), ot: max(0,total−40)}` per
  week; `computeSheet(family, payConfig, entries, derived) → SheetComputation`. Money int cents; each
  component = round-half-away-from-zero to cents of exact float math; hours 2dp. Formula source of truth:
  extraction doc §Pay math (+ §DECISIONS 2,3,5,6,17). Metrics: null (never Infinity/NaN) on 0 denominators.
- `src/lib/payroll/derive.ts` — fetchers (admin client, batched) + PURE aggregators.
  **INVARIANT #1: jobs filtered `authorized IS TRUE`; labor/parts/job-fees filter through parent job.**
  Fns: `billedHoursByTechnician(shopId, start, end)`, `monthSalesPreTaxCents(month)` (Σ authorized job
  subtotals? NO — Σ tekmetric_ros totals minus taxes: use ro.total_sales_cents − Σ ro taxes; VERIFY in
  backtest; keep both variants exported), `monthFeesCents(month)` = Σ ro.fee_total_cents,
  `monthPartsCostCents(month)` = Σ authorized-job parts cost_cents, `shopBilledHours(month)`,
  `spiffCountsByServiceWriter(month, categories[])` (Σ multiplier per counted category, authorized only,
  ROs posted in month), `discoverNewCategories(knownNames[])`.
- `src/lib/payroll/gp.ts` — GP w/ fees = monthSales − monthPartsCost − laborPayProrated; GP w/o =
  that − monthFees. laborPayProrated: for each run overlapping the month (status completed → snapshot
  totals; open → live compute; voided → skip), roles technician+shop_foreman+shop_support+office_support?
  NO — technician + shop_foreman + shop_support ONLY (decision #1). Per straddling week: daily = week
  hours ÷ 5, month share = daily × min(5, month-days in that week) valued at rates (decision #17).
- `src/lib/payroll/summary.ts` — summary rows + dashboard aggregates (exclude voided; avg hourly pay =
  Σ total pay ÷ Σ clock hours over last 12 completed runs, null-safe).
- `src/lib/payroll/mirror-ingest.ts` — port of scheduler-app/scripts/tekmetric/sync-ros.mjs incremental
  path (same whitelists + alert behavior), param `{mode: 'incremental'} | {mode: 'range', start, end}`;
  wired into `runNightlySync` + exported for the refresh action.
- `src/lib/dal/payroll.ts` — Fat DAL: employees CRUD via RPC, runs list/detail, entry updates, run
  compute assembly (calc + derive + overrides precedence: override.value beats derived), snapshot builder,
  complete/void orchestration (dry-run → hash → token → confirm), settings read/update (spiff categories,
  alert emails), email alerts via existing notify idiom (`src/lib/dal/notify.ts`).
- `src/actions/payroll.ts` — thin wrappers, `requireQtekUser()` + role gate (admin for mutations),
  Zod inputs, return app-standard result shape.
- Tests: `src/lib/payroll/__tests__/calc.golden.test.ts` (fixtures ../../../../test-kit/fixtures/payroll/*.json,
  tolerance ±1 cent/component), `calc.split.test.ts`, `derive.aggregators.test.ts` (declined-job
  exclusion!), `gp.test.ts` (proration), `summary.test.ts`.
- Golden note: fixture inputs use the OLD manual-OT model → feed formulas the workbook's (clock, ot)
  as the split directly; the splitter has separate synthetic tests. Trilli fixture PTO-pay cells may
  reflect workbook quirks — if a golden mismatch traces to a workbook formula bug, EXCLUDE that cell
  with a comment, don't bend the engine.
