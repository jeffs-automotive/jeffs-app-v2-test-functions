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
month_gp_without_fees_cents, spiff_count, shop_hours, sales_goal_cents, leave_rate_cents_per_hour,
shop_hour_goal` (round-5 #32)

## Round-3 amendments (2026-07-10 late — extraction doc #22–27; supersede conflicting text above)

- **SA tier semantics:** salesGoal = PRIOR-YEAR same-month subtotal, auto-derived
  (`priorYearMonthSubtotalCents`), override key `sales_goal_cents` wins; `pay_config.sales_goal_cents`
  (SA family) is now a legacy manual fallback used only when derivation returns no data.
  Tiering: beat = sales > salesGoal (strict); tier3 = beat AND gpWithFees ≥ gpGoal2;
  tier2 = beat AND gpWithFees ≥ gpGoal1; tier1 = NOT beat AND gpWithFees ≥ gpGoal1; else 0.
  GP comparisons ≥ (Chris's example: GPwith exactly at goal2 ⇒ tier3; payout = GPwithout × pct).
  Office-manager bonus unchanged (fixed pay_config.sales_goal_cents, excess × pct).
- **Leave pay basis (technician + shop_foreman only):** PTO/Holiday/Bereavement hours × the employee's
  AVERAGE HOURLY RATE WITHOUT BONUS; Training hours × base hourly rate. The basis rate =
  Σ(base+OT+billed+efficiency pay) ÷ Σ(clock hours) over the last 12 COMPLETED runs (from snapshots);
  fallback with no history = the same ratio over the current run (ex-bonus, ex-leave); override key
  `leave_rate_cents_per_hour` wins over both. The rate + its provenance (window used, run count) are
  part of SheetComputation + the snapshot. Other families: leave at base hourly (support/office-manager),
  hours-only (SA). Foreman's shop bonus and all bonuses/spiffs/manual incentives are EXCLUDED from the basis.
- **Avg-hourly metrics (summary.ts):** `avg_hourly_without_bonus_cents` (everyone) and
  `avg_hourly_with_bonus_cents` (non-null ONLY for SA/office_manager/shop_foreman), last-12-completed-runs,
  clock-hour denominator.
- **Write-through:** a run-level `pay_config` patch via updateEntry ALSO updates the employee master's
  `pay_config` (same values, separate `qteklink_payroll_upsert_employee` call + audit rows) so future
  runs prefill it. Run-scoped-only fields (`rates_w2`) do NOT write through.

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
  RETURNS void                                -- whitelisted: bonus_period (bool) + bonus_month (round-5 #33
                                              -- explicit first-of-month date; only while bonus is/becoming on;
                                              -- wins over derivation). Slider ON derives bonus_month =
                                              -- date_trunc month of PERIOD_END - 1 month (the pay date);
                                              -- a re-sent ON keeps an explicit pick; OFF nulls it. Open only
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

## Round-4 amendments (2026-07-10 — extraction #24/#28 area; supersede conflicting text above)

- **Monthly sales INCLUDE fees (extraction #28):** month sales = Σ(totalSales − taxes) over ROs
  posted in month (`totalSalesMinusTaxesCents`) — fees are NOT subtracted. Go-forward decision; the
  historical workbook sheets matched the fee-excluded number (#21). ALREADY implemented in
  `derive.ts` / `payroll-compute.ts` / `derive.aggregators.test.ts`.
- **Leave-rate SEED HISTORY (Chris: Marie's pre-qteklink average-pay figures are seeded via a
  script run by Chris+Claude, NOT in-app; qteklink runs take over as they accumulate):**
  - `pay_config` (technician + shop_foreman only) gains two OPTIONAL fields:
    `leave_rate_seed_cents_per_hour` (int cents ≥ 0 — the single-rate fallback) and
    `leave_rate_seed_history` (array, max 26 = a year of bi-weekly periods; each entry is EXACTLY
    `{ period_start: "YYYY-MM-DD" (valid date), work_pay_cents: int ≥ 0, clock_hours: number ≥ 0 }`;
    unknown entry keys rejected). Validated in the DAL Zod (`LeaveRateSeedEntrySchema`) AND in the
    SQL validator (`qteklink_payroll_validate_pay_config`: the two keys are allowed for the
    technician/shop_foreman families only; the rate rides the `_cents_per_hour` numeric rule; the
    history gets a structural block — array ≤ 26, exact keys, regex + `::date` validity, integer
    cents, hours ≥ 0).
  - **Merge window (`mergeLeaveRateWindow`, pure — `src/lib/dal/payroll-leave-rate.ts`):**
    `fetchLeaveRateHistory` collects PER-EMPLOYEE per-period entries `{periodStart, payCents, hours}`
    from up to 26 completed runs (more than the 12-window so an employee who missed shop runs isn't
    starved); the merge unions run entries with the employee's seed entries — a completed-run entry
    WINS over a seed with the same `period_start` (seeds age out as real runs accumulate) — sorts
    newest-first, takes 12, and reports `{payCents, hours, runs, seededEntries}`.
  - **Precedence (`resolveLeaveRate`):** `overrides.leave_rate_cents_per_hour` ('override') →
    merged window with hours > 0 ('history'; windowRuns + seededEntries in the snapshot provenance
    `leave_rates` map) → `leave_rate_seed_cents_per_hour` ('seed') → current-run ex-bonus ex-leave
    ratio ('current_run') → base hourly rate ('base_rate'). `LeaveRateSource` gains `'seed'`
    (SheetComputation/DerivedInputs/snapshot enums follow).
  - **Seeding tool:** `qteklink-app/scripts/payroll-seed-leave-rates.mjs` — input JSON
    `[{ employee, entries?: [{period_start, work_pay_dollars, clock_hours}], seed_rate_dollars_per_hour? }]`
    (≥ 1 of entries/seed_rate per employee); DRY-RUN by default (resolved match + merged pay_config
    diff + the average the seeds imply), `--apply` writes via `qteklink_payroll_upsert_employee`
    (`p_actor_label = 'seed-script (Chris + Claude)'`, `p_actor_user_id = null`). Matches by
    case-insensitive display_name within `--shop` (default 7476); ambiguous/missing = per-employee
    error. **UPDATE-ONLY (Chris hard rule): the tool NEVER creates an employee and never touches
    archived ones.** READ + RPC only (the payroll tables are RPC-write-only).

## Round-5 amendments (2026-07-11 — extraction #32/#33; supersede conflicting text above)

- **Foreman shop-hour goal auto-derives (#32):** goal = PRIOR-YEAR same-month TOTAL SHOP BILLED
  HOURS (`priorYearShopBilledHours(shopId, month)` in derive.ts — priorYearMonth + the
  shopBilledHours rollup; roCount 0 = no data), mirroring the SA sales-goal pattern. Precedence:
  `overrides.shop_hour_goal` ('override') → prior-year derivation ('prior_year', roCount > 0) →
  legacy `pay_config.shop_hour_goal` ('config'). Derived only for bonus runs with a foreman on the
  roster (incl. other open runs feeding GP labor proration). calc keeps the STRICT `>` cliff
  (beating last year by ≥ 0.01h at 2dp ≡ strict >); the sheet + DerivedInputs + snapshot carry
  `shop_hour_goal` + `shop_hour_goal_source` ('override' | 'prior_year' | 'config') for
  provenance. CALC_VERSION → 3.
- **Bonus month derives from the PAY DATE (#33, bug fix):** update_run's derivation is
  `date_trunc('month', period_END) - 1 month` — the 6/28–7/11 run is paid in July ⇒ June (the old
  period_start rule wrongly gave May). NEW patch key `bonus_month` (explicit first-of-month date,
  the office-manager escape hatch): validated (string, real date, first of month), only while
  bonus_period is true/becoming true, wins over derivation, never clobbered by an idempotent
  bonus_period=true re-send; clearing the slider still nulls it. Migration
  `20260711160000_qteklink_payroll_bonus_month_paydate.sql` — which also ships a guarded one-time
  data correction: open bonus runs whose stored bonus_month still matches the OLD period_start
  derivation (the live 6/28–7/11 run: May) are re-derived from period_end (June) + audited
  (`run_updated`, actor `migration:20260711160000`), because the new derivation only fires on an
  OFF→ON transition and an idempotent re-send keeps the stored month (explicit picks can't exist
  pre-migration, so the matched shape is provably machine-derived).

## Round-6 amendments (2026-07-11 — extraction #36/#37/#38; supersede conflicting text above)

- **Month sales display AFTER FEES (#36 — REVERSES the round-4 #28 amendment):** month sales
  (the bonus panels' current month AND the prior-year auto sales goal #22/#23) =
  Σ(totalSales − taxes − FEES) over posted ROs — the original backtest-pinned (#21) subtotal
  (June 2026 = $273,061.13). `aggregateMonthSubtotalCents` + `priorYearMonthSubtotalCents`
  subtract fees again; payroll-compute's `month.salesCents` follows. The fee-INCLUSIVE
  Σ(totalSales − taxes) figure survives ONLY as the internal GP base
  (`month.salesInclFeesCents`, snapshot key `month_sales_incl_fees_cents`) — never displayed as
  "month sales".
- **Parts cost formula (#37, pinned penny-exact vs Chris's June breakdown):**
  `monthPartsCostCents` = Σ round(part.cost_cents × coalesce(quantity, 1)) over AUTHORIZED jobs
  (PER-LINE rounding, half away from zero; tires + batteries live in the parts table)
  + Σ tekmetric_ro_sublet_items.cost_cents joined through tekmetric_ro_sublets on ROs posted in
  the month (sublets are RO-level; no authorized flag in the pinned formula). June:
  69,080.90 + 290.00 = $69,370.90 exactly. The old un-weighted Σ cost_cents variant AND the
  separate "qty-weighted candidate" export are REMOVED — #37 IS the definition
  (`aggregateAuthorizedPartsCostCents` is qty-weighted per line; `aggregateSubletCostCents` is
  the sublet half).
- **GP composition (#38 — SUPERSEDES #35's direct-QBO-GP):** QBO supplies ONLY the technician
  cost; sales/parts stay Tekmetric. Per bonus month, gp_with_fees precedence:
  `overrides.month_gp_with_fees_cents` (per-employee, wins) →
  `monthSalesInclFees − monthPartsCost(#37) − QBO 6010 tech cost` (source `qbo_tech_cost`) →
  the pre-#38 computed path with prorated labor (source `computed`) — the labeled fallback ONLY
  when the QBO fetch throws: caught once in payroll-compute (the single sanctioned catch),
  `Sentry.captureException` with the `shop_id` tag, then fall back (the fallback also feeds the
  fee-INCLUSIVE sales base, never the #36 display value).
  `gp_without_fees = gp_with_fees − monthFees` on every path (override still wins per employee).
  June acceptance: 286,290.76 − 69,370.90 − 48,740.72 = **168,179.14** with fees;
  − 13,229.63 = **154,949.51** without.
- **QBO technician-cost fetch (`src/lib/qbo/reports.ts`):**
  `qboMonthTechnicianCostCents(shopId, month)` → realm via `resolveRealmForShop` →
  `GET /v3/company/{realm}/reports/ProfitAndLoss?start_date&end_date&accounting_method=Accrual`
  (Accrual pinned explicitly — the June proof's basis; no prior report idiom existed) via the
  existing QboClient (token refresh, 429/5xx retry, typed Faults) → PURE parser
  `parsePnlTechnicianCostCents` walks the Rows tree and matches the row by the qbo_accounts
  mirror id for acct_num '6010' (used only when the lookup yields exactly one account) AND/OR
  the label (`^6010(\s|$)` or contains "Technicians") — the two flavors must agree on ONE row;
  NO hardcoded QBO account id (a re-mapped chart still matches). Absent/ambiguous row,
  disagreeing matches, missing/non-numeric amount, empty tree, DB error on the mirror lookup,
  or no connection → THROW with clear text (no silent fallback inside the fetcher).
- **Snapshot/UI provenance (round-6):** new keys `month_gp_source` ('qbo_tech_cost' | 'computed'),
  `month_qbo_tech_cost_cents` (+ `month_qbo_tech_cost_account`), `month_sales_incl_fees_cents`;
  `month_labor_pay_prorated_cents` is null unless the computed fallback ran. The bonus-month
  card itemizes the tech-cost line ("Technician cost (QBO 6010)") when the QBO path ran and
  shows the prorated-labor line only otherwise; the GP-with-fees AutoValue wording is
  "Tekmetric − QuickBooks tech cost" / "computed fallback"; month-sales wording is
  "totals minus taxes and fees". CALC_VERSION → 4 (formula-input change, pinned like v3).

## Round-7 amendments (2026-07-11 — extraction #39–#42; supersede conflicting text above)

- **#39 HOURS basis = RO COMPLETED date (shop-local):** `billedHoursByTechnician`,
  `shopBilledHours`, and `priorYearShopBilledHours` bucket ROs by `completed_date`
  (TIMESTAMPTZ → `toShopLocalDate`), INCLUDING completed-but-not-yet-posted ROs
  (`fetchCompletedRos` in derive.ts; pure exact-bucketing filter `rosInLocalRange`
  is exported + boundary-tested: completed 2026-07-04T23:30 ET = 7/5 03:30Z buckets
  to 7/4). Money rollups (sales/fees/parts/GP inputs/spiffs) STAY posted-basis.
  Acceptance (comment-pinned in derive.ts): 6/28–7/11 w2 Trilli 55.05 / Fuhrer
  49.43 / Vasiliou 45.90 / Stoneback 11.87. `MirrorRoRow`/RO_COLS gain
  `completed_date`; migration 20260711200000 adds the
  `tekmetric_ros (shop_id, completed_date)` index.

- **#40/#41 LIVE snapshot (display cache; migration
  `20260711200000_qteklink_payroll_live_snapshot.sql`):** `qteklink_payroll_runs`
  gains `live_snapshot jsonb`, `live_snapshot_at timestamptz`,
  `live_snapshot_stale boolean not null default true`,
  `live_snapshot_invalidated_at timestamptz` (the lost-invalidation race guard).
  Two RPCs (usual grant idiom):
  - `qteklink_payroll_store_live_snapshot(p_run_id uuid, p_snapshot jsonb,
    p_computed_at timestamptz, p_compute_started_at timestamptz)` — OPEN runs only
    (RAISEs otherwise; FOR NO KEY UPDATE serializes against complete/void). Stores
    the snapshot ALWAYS, but clears stale ONLY when `live_snapshot_invalidated_at`
    is not newer than `p_compute_started_at` (captured just before
    buildOpenRunSnapshot): a mark landing mid-recompute (mirror reads + a QBO P&L
    call span seconds) re-marked the run for data the snapshot cannot contain, so
    it stays stale for the next trigger. `p_compute_started_at` is REQUIRED
    (RAISEs on NULL). NEVER bumps `updated_at` (the Pattern S state hash covers
    it — a display-cache write must not invalidate an in-flight preview; pgTAP
    asserts hash + updated_at unmoved, plus both race branches).
  - `qteklink_payroll_mark_open_runs_stale(p_shop_id int) RETURNS int` — sets
    stale=true AND stamps `live_snapshot_invalidated_at=now()` on EVERY open run
    (already-stale runs re-stamped — required by the race guard); returns runs
    newly invalidated (fresh→stale).
  - DOCUMENTED DEPARTURE: neither RPC writes an audit row (display cache, not
    business state — webhook-driven recomputes would flood the audit log).

- **#40 webhook → mirror → recompute pipeline:**
  - `qteklink-webhook` edge fn: after a NEW RO-family event
    (`ro_created|ro_status_updated|ro_posted|ro_unposted|ro_sent_to_ar|ro_work_approved`)
    is durably stored, fire-and-forget POST `{event_ids:[id]}` to the app route —
    the 200 never waits on it; failures log + Sentry-capture; nightly ingest +
    dry-run are the backstops. Config: fn secrets `QTL_MIRROR_APPLY_URL` +
    `QTL_MIRROR_APPLY_SECRET`; unset = notify skipped with a structured log.
  - `app/api/payroll/mirror-apply/route.ts` (POST; `Authorization: Bearer
    ${PAYROLL_MIRROR_APPLY_SECRET}` — the CRON_SECRET idiom; body
    `{event_ids: uuid[] (1..100)}`): loads the events' `raw_body` from
    qteklink_events (ordered by `received_at` ASC), applies FULL RO payloads
    (numeric `data.id` + `data.jobs` ARRAY — partial payloads are SKIPPED, never
    run through the delete-then-insert child sync) via the SAME mirror-ingest
    mappers (`upsertPage`/`flushAlerts` now exported; payload-only, no Tekmetric
    call), marks the shop's open runs stale, recomputes them DEBOUNCED (skip when
    `live_snapshot_at` < 60s old — stays stale for the next trigger). Per-shop
    failures isolated + reported.
  - **Payload recency guards** (payload-based writes are the only mirror path
    that can regress — the nightly API ingest always fetches current): (a) per-RO
    DEDUPE within a batch keeping the NEWEST payload (`updatedDate`; ties/absent
    fall to received_at order) — duplicate ids in one upsert are a Postgres 21000
    + duplicate child PKs after the delete-then-insert (the RO would read ZERO
    until the nightly heals); (b) a payload whose `updatedDate` is strictly OLDER
    than the mirror row's `updated_date` is dropped (unordered fire-and-forget
    notifies must never regress posted/completed dates or money). Dropped payloads
    count in `MirrorApplyShopResult.payloadsStale`; the runs are still marked
    stale.
  - `src/lib/dal/payroll-live.ts` owns the substrate: read-through
    `computePayrollRun` (open runs: fresh cache → serve; stale/absent/unparseable/
    older-CALC_VERSION → compute once + store + serve; store failure on the read
    path is Sentry-captured and the computed snapshot still returns — the stale
    flag backstops), `recomputeAndStoreLiveSnapshot`, `recomputeStaleOpenRuns`,
    `refreshLiveSnapshotAfterMutation`, `applyMirrorEventsAndRecompute`,
    `markPayrollOpenRunsStale`, `extractQboTechCostMemo`.
  - **Mutations recompute INLINE:** `updatePayrollEntry` / `updatePayrollRun` /
    `syncPayrollRunRoster` call `refreshLiveSnapshotAfterMutation` after the RPC
    commits (mark shop-wide stale + recompute THAT run; capture-not-throw — the
    committed edit is never misreported, the stale flag guarantees a later
    recompute). `refreshRunTekmetricData` + the nightly (`runNightlySync` step
    2b-2) mark-stale + recompute with `freshQbo` (no memo, no debounce);
    failures in the manual refresh PROPAGATE, the nightly isolates
    (`payrollSnapshots` result field). `updatePayrollSettings` (the direct
    settings-page write, incl. `discoverAndMergePayrollCategories`) marks the
    shop's open runs stale after the settings RPC commits (spiff-category edits
    change SA spiff pay; capture-not-throw — the committed save is never
    misreported).
  - **Completion NEVER reads the live snapshot:** `completePayrollRun` keeps its
    fresh no-memo `buildOpenRunSnapshot` + in-transaction hash (asserted by
    payroll.test.ts); completed/voided runs render exclusively from the frozen
    `snapshot`. The dashboard summaries (`listPayrollRunsWithSummaries`) read
    through the same cache for open runs.

- **#41 QBO tech-cost memo:** the month tech cost rides the snapshot provenance
  (`month_qbo_tech_cost_fetched_at` + `month_qbo_tech_cost_realm_id` join the
  round-6 keys). `resolveMonthGp` accepts `qboTechCostMemo` and reuses it ONLY when
  (realm, month) match and it is < 6h old (`QBO_TECH_COST_MEMO_MAX_AGE_MS`;
  realm re-checked via `resolveRealmForShop` — one DB read vs a P&L fetch); the
  memo'd `fetched_at` carries through so age accrues from the ORIGINAL fetch.
  Debounced/inline/read-through recomputes pass the memo; dry-run / nightly /
  manual refresh / completion always fetch fresh.

- **#41 INSTANT TABS (`app/payroll/runs/[period]`):** ONE server render computes
  everything (a single `computePayrollRun` live-snapshot read) and carries ALL
  THREE tab panels; `RunViewTabs` (client, `app/payroll/runs/[period]/RunViewTabs.tsx`)
  toggles panel visibility — tab switches make NO navigation / router.refresh /
  server round-trip. `?view=` stays in sync via native `history.replaceState`
  (App-Router shallow update); the tab pills remain real `<a href>` deep links
  (middle/ctrl-click = fresh server render; the server still resolves `?view=`
  for first-render landing). Preserved contracts: nav `aria-label="Run views"` +
  `aria-current="page"`, the summary panel ALWAYS in the DOM for print (`hidden
  print:block` when inactive; a placeholder-only empty run never prints), entry
  + sheets panels `print:hidden`, completed/voided runs still render the frozen
  snapshot. All panels stay mounted, so unsaved entry-grid edits survive tab
  peeks; entry-grid SAVES keep their server round-trip (they must recompute).
  RTL contract: `app/payroll/runs/[period]/__tests__/RunViewTabs.test.tsx`.

- **#42 DRY RUN (bottom of the pay-sheets tab; admin, open runs only):**
  - DAL `dryRunPayrollRefresh(shopId, runId)` (`src/lib/dal/payroll-dry-run.ts`,
    re-exported from `@/lib/dal/payroll`): (a) BEFORE = `getOrComputeLiveSnapshot`
    (what the screen shows), (b) LIVE Tekmetric re-fetch via range-mode mirror
    ingest — the period's posted window PLUS `updatedDateStart = period_start`
    (a SECOND pass; catches completed-but-unposted ROs the #39 hours basis
    buckets) PLUS the bonus month's posted window when the slider is on,
    (c) `markPayrollOpenRunsStale` (shop-wide) then
    `recomputeAndStoreLiveSnapshot(…, { freshQbo: true })` — the refreshed
    snapshot is COMMITTED here (fresh QBO 6010 fetch, never the memo), (d) the
    structured diff. Open-run-only (validation error otherwise); a completion
    racing the recompute surfaces as a validation error (the mirror refresh
    stands, the run is untouched). Failures PROPAGATE — the user asked.
  - `MirrorIngestOpts` range mode gains optional `updatedDateStart` (ISO-validated).
    Tekmetric API contract (tested 2026-07-11): page size hard-capped at 100, NO
    batch-by-ids param, unknown params SILENTLY IGNORED (would return the full
    148k dataset) — only supported filters are ever passed.
  - Diff builder `buildDryRunDiff(before, after)` (`src/lib/payroll/dry-run-diff.ts`,
    PURE): per-tech billed hours w1/w2 (EFFECTIVE inputs — an overridden value
    diffs as unchanged), month derivations (sales / fees / parts cost / GP with +
    without fees / QBO tech cost / shop hours) + per-SA spiff counts, and
    per-employee total-pay deltas — ONLY changed fields (null↔number counts),
    plus before/after `as_of` stamps and a `changed` flag. Employees matched by
    employee_id; a missing side reports null (roster drift never crashes).
  - Action `dryRunPayrollAction` (`src/actions/payroll.ts`): admin-gated thin
    wrapper → `QboActionResult<PayrollDryRunResult>` (`{ diff, rosChecked }`).
  - UI `DryRunButton` (`app/payroll/runs/[period]/DryRunButton.tsx`), mounted by
    RunViewTabs under the sheets panel: pending = "Checking N repair orders…"
    (N = the snapshot's `ro_count`); success opens the qteklink Dialog listing
    the diff GROUPED (per-tech hours / month numbers / pay totals; tabular-nums,
    old → new, delta colored green-up/red-down), empty state "Everything is up
    to date — no differences."; HONESTY: the numbers are already live when the
    modal opens (`router.refresh()` re-renders the page underneath; the subtext
    says so) — Accept only acknowledges + client-switches to the Summary tab,
    Cancel/close stays on the pay sheet with the same refreshed numbers. Tests:
    `__tests__/DryRunButton.test.tsx` + `payroll-dry-run.test.ts` +
    `dry-run-diff.test.ts` + the mirror-ingest range-pass tests.

## Round-8 amendments (2026-07-11 — extraction #43; supersede conflicting text above)

- **#43 BATCH RPC (migration `20260711220000_qteklink_payroll_batch_entries.sql`):**
  `qteklink_payroll_update_entries(p_run_id uuid, p_patches jsonb, p_actor_user_id
  uuid, p_actor_label text) RETURNS jsonb` — `{updated: n}`. `p_patches` = a JSON
  ARRAY of `{run_employee_id, patch}` (exactly those two keys per element); each
  `patch` uses EXACTLY the update_entry whitelist semantics. ALL rows apply in ONE
  transaction (the plpgsql body): any invalid patch RAISEs and rolls back
  EVERYTHING — values AND audit rows (the non-atomic-multi-write invariant,
  pgTAP-proven). The open-run guard (`FOR KEY SHARE` against complete/void's
  `FOR UPDATE`) is taken ONCE on the run row, not per row; every row must belong
  to `p_run_id` (cross-run smuggling RAISEs). Empty/non-array batches RAISE.
  Usual grant idiom (REVOKE PUBLIC/anon/authenticated; GRANT service_role).

- **ONE VALIDATOR (single-validator note):** the per-row validate/apply/audit body
  of `qteklink_payroll_update_entry` was extracted into the internal helper
  `qteklink_payroll_apply_entry_patch(p_row qteklink_payroll_run_employees,
  p_patch jsonb, p_actor_user_id uuid, p_actor_label text, p_fn text,
  p_batch_id uuid)` (REVOKE-only, like the two validators), and `update_entry`
  was RE-CREATED in 20260711220000 to delegate to it — single and batch share one
  code path; there is NO forked validation logic. `p_fn` prefixes the error
  messages; `p_batch_id` is NULL on the single path. Per-row audit is preserved:
  the same `entry_updated` action + per-key `{key, old, new}` detail, PLUS
  `detail.batch_id` (one uuid per batch call) linking a batch's audit rows.

- **DAL `updatePayrollEntriesBatch(shopId, runId, patches[], actor)`**
  (`src/lib/dal/payroll-entries-batch.ts`, re-exported from `@/lib/dal/payroll`):
  Zod-validates each patch with the SAME value rules as the single path, calls the
  RPC ONCE, then ONE `refreshLiveSnapshotAfterMutation` (mark shop-wide stale +
  recompute THIS run — the round-7 #41 hook; it runs even if the RPC's return
  body is malformed, since the batch committed). Batchable keys = the grid's
  fields ONLY (the ten hour columns + `manual_incentive_cents`); `pay_config` and
  `overrides` are REJECTED with a validation error — they keep their single-entry
  editors (`pay_config` carries the round-3 #26 write-through, which must never
  silently fork into a batch path without it). Thin action
  `updatePayrollEntriesAction` (admin gate; FormData `run_id` + `patches` JSON
  array; strict element shape).

- **GRID SAVE MODEL (`app/payroll/runs/[period]/EntryGrid.tsx`):** per-row/per-cell
  submission is GONE. Cells edit LOCAL state (an `edits` map of ONLY the touched
  cells; a cell edited back to the server value stops counting as dirty); the
  existing per-cell range validation (0–120 hours, $0–50,000 incentive) stays
  local at save time, now prefixed with the employee name. ONE sticky footer Save
  bar under the table: "Save N changes", disabled when pristine or pending,
  submits ONLY dirty rows' changed keys. Success → clear ALL dirty state +
  `router.refresh()` (the server already ran the ONE recompute); failure → keep
  ALL dirty state (nothing was applied — atomic) + the error shows prominently in
  the bar (`role="alert"`). Dirty cells get an amber ring + `data-dirty`;
  the footer carries the unsaved-count indicator. Read-only/locked grids
  (`canEdit=false` / EntryGridReadOnly) are unaffected — no inputs, no Save bar.

- **LEAVE GUARD:** (a) `beforeunload` when dirty (EntryGrid); (b) the round-7
  client-side tab switch is gated: `unsaved-entries.ts` (module-singleton
  registry — EntryGrid writes the dirty count, zeroes on unmount/save) +
  RunViewTabs reads it IMPERATIVELY inside its plain-left-click handler, between
  its `preventDefault()` and `selectView(...)`: leaving the ENTRY tab with
  unsaved cells requires `window.confirm` (cancel stays). HOW the <a> click path
  is intercepted: the tab pills are real `<a href>` deep links whose plain-click
  path already preventDefaults for the client switch — the guard slots into that
  exact branch; modified/middle clicks keep native behavior (a new tab never
  destroys this page's state) and the DryRunButton Accept (sheets → summary)
  bypasses it by design. NOTE: panels stay mounted (#41), so the edits SURVIVE a
  confirmed switch — the confirm is a you-haven't-saved checkpoint, not a
  data-loss barrier (the wording says so).

- **Tests:** pgTAP (qteklink_payroll_rpcs.sql — happy batch with shared batch_id,
  one-bad-row full rollback, cross-run RAISE, completed-run RAISE, empty/shape
  RAISEs, anon denied); DAL `payroll-entries-batch.test.ts` (one RPC call, one
  recompute, key rejections, P0001 surfacing, commit-then-malformed-body still
  refreshes); RTL `run-detail.test.tsx` (dirty tracking across rows, ONE batch
  action with changed-keys-only patches, failure keeps dirty + shows error,
  pending/pristine/read-only button states) + `RunViewTabs.test.tsx` (#43 leave
  guard: cancel stays, OK proceeds, pristine/non-entry switches never prompt).

## Round-9 amendments (2026-07-11 late — extraction #44/#45/#46; supersede conflicting text above)

- **#44 EFFICIENCY GUARD (calc.ts):** per WEEK, efficiency hours/pay = 0 unless
  that week's WORKED clock hours (reg + derived OT) are STRICTLY > 1 — the guard
  against the inflated-efficiency case (near-zero clock + real billed hours →
  phantom efficiency = billed − ~0). Technician + shop_foreman families (the
  only ones with an efficiency concept); billed PAY is untouched; exactly 1.00
  clock hour still pays none; the presplit (golden) seam is guarded identically.
  **CALC_VERSION → 5** (with #45; the live-snapshot read-through recomputes open
  runs on the version drift — that is how #44/#45/#46 roll out to the open run).
  Locked by `calc.efficiency-guard.test.ts` (clock 0 / 0.5 / 1.0 / 1.01 /
  normal / per-week independence / presplit / foreman). GOLDEN NOTE: exactly one
  real workbook week hits the guard — Clark 5-17 w2 (clock 0, billed 2, $45.32
  efficiency hand-paid) — documented as **Quirk C** SKIP entries in
  `calc.golden.test.ts` (#44 deliberately supersedes the workbook there; the
  engine was NOT bent, the fixture was NOT edited).

- **#45 MONTH SALES REVERT (supersedes the round-6 #36 amendment; restores the
  #28 sales number):** month sales — the bonus panels' display, the SA tier's
  "beat last year" side, AND the prior-year auto sales goal (#22/#23) — =
  **Σ(totalSales − taxes) over posted ROs, FEES STAY IN** (June 2026 =
  $286,290.76). The with/without-fees split applies to GP ONLY (#38 unchanged:
  GP_with = salesInclFees − parts(#37) − QBO 6010 tech cost; GP_without = GP_with
  − monthFees; June: 286,290.76 − 69,370.90 − 48,740.72 = 168,179.14 with;
  − 13,229.63 = 154,949.51 without). Implementation:
  `aggregateMonthSubtotalCents` + `priorYearMonthSubtotalCents` no longer
  subtract fees; payroll-compute's `month.salesCents` now EQUALS
  `month.salesInclFeesCents` — **both snapshot keys are kept, equal** (the
  documented pick: pre-#45 frozen snapshots, where the two differ, keep parsing
  and display as stored; the dry-run diff keys `month_sales_cents` /
  `month_sales_incl_fees_cents` stay stable) rather than collapsing to one key.
  UI wording drops "& fees" ("Month sales (less tax)" / "totals minus taxes").

- **#46 RUN TOTALS CARD (replaces the summary table's TOTAL footer row —
  approved contract change):** `buildRunSummary` now returns `{ rows, totals }`;
  the new `buildRunTotals(rows)` (summary.ts, pure) produces the run-level
  block: `total_pay_cents` (grand total); `reg_pay/ot_pay/incentive_pay` +
  `pto_pay/holiday_pay/bereavement_pay/training_pay` (cents; n/a-safe — null
  components count 0, an ALL-null category stays null → "n/a", never $0.00);
  hours `reg/ot/pto/holiday/bereavement/training` (2dp-settled) + `billed`
  (nullable like the pay categories); `cost_per_clock_hour_cents` = total pay ÷
  (reg + OT) clock hours, null on a zero denominator. Schema:
  `RunTotalsSchema` (types.ts); the snapshot gains **`summary_totals`
  (OPTIONAL)** — backward-compatible: frozen snapshots completed before the
  feature lack it and still parse. UI: `PayrollTotalsCard`
  (`app/payroll/runs/[period]/PayrollTotalsCard.tsx`, mounted by SummaryView
  AFTER the table, inside the printable region, break-inside-avoid) — qteklink
  card idiom, grouped Pay / Hours / Metrics, tabular-nums, dollars $X,XXX.XX,
  hours 2dp. The card renders ONLY when the block exists — the UI computes
  NOTHING client-side; an old frozen run shows a subtle "totals unavailable —
  completed before the totals feature" note (an open run missing the block —
  transient only — renders nothing; the CALC_VERSION-5 recompute backfills it).
  Tests: `summary.test.ts` (totals math: mixed/all-null categories, zero-clock
  null cost, empty run, 2dp settling) + `SummaryView.test.tsx` (grouped card
  values, tfoot GONE, old-snapshot note, open-run silence; the SummaryView
  suites moved there from run-detail.test.tsx — 500-line policy).

- **#47 COST PER BILLED HOUR (round-9 addendum, Chris verbatim: "Include all
  pay in this like you would the cost per clock hour"):** `buildRunTotals`
  gains `cost_per_billed_hour_cents` = **total pay (ALL pay — same numerator
  as cost per clock hour)** ÷ total billed hours; null (never Infinity) when
  billed hours are null or zero. `RunTotalsSchema` adds the key with
  `.default(null)` so `summary_totals` blocks stored before the key still
  parse (they render "n/a" until recompute). CALC_VERSION bumped **5 → 6** so
  open runs recompute on next view and backfill the metric. UI: a second
  Metrics item on `PayrollTotalsCard` ("Cost per billed hour", `$X.XX/hr`,
  n/a-titled "No billed hours in this run"). Tests: summary.test.ts
  (246,100 ÷ 45 → 5,469¢; all-null → null; empty run → null) +
  SummaryView.test.tsx ($42.10/hr from the base row; salaried-only run → n/a).
