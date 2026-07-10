# Plan — qteklink-payroll

> Replaces the bi-weekly Excel pay-sheet workbook (`Pay Sheets\2026\*.xlsx`) with a Payroll module in
> qteklink-app. Requirements + locked decisions: `docs/qteklink/payroll-workbook-extraction-2026-07-10.md`
> (the extraction doc). Design spec: `.claude/work/design/qteklink-payroll-spec.md` (frontend-design-director).
> PTO accrual engine is explicitly PHASE 2 — this plan ships manual PTO balance/rate fields only.

## Why

Payroll runs today through a 20-sheet Excel template copied per period: office manager keys clock hours,
billed hours are copied by hand from Tekmetric, bonuses are computed from manually-transcribed month
sales/GP, and the roster drifts (the workbook's Summary sheet has been broken since Sept 2024). All the
Tekmetric-side inputs already live in the `tekmetric_ros*` mirror; qteklink already has auth, roles,
config idioms, and an approve/lock workflow culture. The module automates the Tekmetric-derived numbers,
keeps the office manager's manual entry, and makes completed payrolls immutable.

## Locked decisions (Chris, 2026-07-10 — full list in the extraction doc §DECISIONS)

Roles GM/SvcMgr/AsstMgr (all three = service writers, all get spiffs) + OfficeMgr + Foreman + Technician
+ ShopSupport + OfficeSupport; no roster seeding — employees added in-app after ship. GP months prorate
straddling runs by days; "technician pay" in GP = Technician + Foreman + ShopSupport total pay (incl.
PTO etc.). Tier qualifies on GP-with-fees, payout % on GP-without-fees; sales are pre-tax. Foreman bonus
input = total shop billed hours, prior month. Bonus slider = manual per-run toggle ⇒ prior-calendar-month
numbers. OT auto-derived (>40 clock hrs/wk, 1.5× regular rate) — no OT entry field. Billed hours = labor
hours on ROs POSTED in the period, by labor-line technician_id — validated by workbook backtest. 5-packs/
flushes by job category (verified: `tekmetric_ro_jobs.job_category_name`, indexed) — counted set is config.
Avg hourly pay = last 12 runs, clock-hours denominator. Access = existing qteklink allowlist, no extra
gate. PTO balance + accrual rate manual. Periods Sun–Sat bi-weekly anchored 2026-06-28. Completed runs
are IMMUTABLE (snapshot safety net).

## Architecture

### Data model (migration `supabase/migrations/<ts>_qteklink_payroll.sql`)

All new tables follow the qteklink convention — `shop_id integer`, BIGINT cents, TIMESTAMPTZ, UUID PKs,
RLS deny-all, service_role SELECT-only + SECURITY DEFINER write RPCs (`SET search_path = public`).
**Documented departure:** no `realm_id`/QBO-connection FK — payroll is Tekmetric-side, not QBO-side.

1. **`qteklink_payroll_employees`** — id, shop_id, display_name, role (CHECK-constrained TEXT enum),
   tekmetric_employee_id BIGINT NULL, pay_config JSONB (per-role-family shape, Zod-validated in the DAL;
   cents-suffixed integer fields; includes bonus goals/tiers/spiff for SA, sales goal/% for office mgr,
   shop-hour goal/rate for foreman, PTO balance hours + accrual rate), archived_at TIMESTAMPTZ NULL,
   created/updated. JSONB (not sparse columns) because the config shape varies by 4 role families and is
   snapshotted verbatim into runs; every cents field is an integer, schema-versioned (`config_version`).
2. **`qteklink_payroll_runs`** — id, shop_id, period_start DATE, period_end DATE,
   UNIQUE(shop_id, period_start), status TEXT ('open' | 'completed'), bonus_period BOOLEAN default false,
   bonus_month DATE NULL (first-of-month, derived = prior calendar month, stored explicitly),
   snapshot JSONB NULL (written exactly once at completion), completed_at, completed_by_label, timestamps.
3. **`qteklink_payroll_run_employees`** — id, run_id FK, shop_id, employee_id FK, role_snapshot,
   pay_config JSONB (copied from employee at run creation; per-run editable until locked — this is
   "goals editable per payroll" + per-week rate overrides), manual inputs as NUMERIC hours columns:
   clock_hours_w1/w2, pto_w1/w2, holiday_w1/w2, bereavement_w1/w2, training_w1/w2,
   manual_incentive_cents BIGINT NULL, overrides JSONB (optional manual overrides for auto-derived
   numbers: billed hours w1/w2, month sales, GP inputs, spiff count, shop hours — each `{value, note}`),
   UNIQUE(run_id, employee_id).
4. **Settings:** extend `qteklink_settings` (existing partial-upsert RPC) with `payroll` JSONB —
   spiff category set (array of job_category_name strings; UI offers observed values), period anchor date
   (2026-06-28), fee-set definition choice (see Open Questions).

RPCs (all validate + RAISE on completed runs — the immutability wall is in the DATABASE, not just UI):
- `qteklink_payroll_upsert_employee(...)` — create/update/archive (archive = set archived_at; archived
  employees excluded from new runs, retained in history).
- `qteklink_payroll_create_run(shop, period_start)` — validates the date is on the anchor cadence,
  creates run + one run_employee row per active employee with pay_config copied.
- `qteklink_payroll_update_entry(run_employee_id, ...)` — manual hours/incentive/overrides; RAISES if run completed.
- `qteklink_payroll_update_run(run_id, ...)` — bonus slider, per-run config edits; RAISES if completed.
- `qteklink_payroll_complete_run(run_id, expected_confirm_token, dry_run, pre_state_snapshot)` —
  **Pattern S**. The snapshot is computed SERVER-SIDE in the DAL (never client-supplied) in the same
  request as the RPC call; the RPC verifies `pre_state_snapshot` (hash of current run + entries +
  config `updated_at`s) against live DB state inside the transaction and ABORTS on mismatch — no
  stale-preview lock-in. Non-dry-run writes the snapshot JSONB (computed sheets + summary + all inputs +
  Tekmetric-derived values + the settings/spiff-category set used + provenance + calc version), stores
  `completed_by_user_id` + email label, and flips status. No reopen RPC exists — a completed run is
  permanently immutable (Chris's safety-net requirement, taken literally; void-and-clone is open Q5).

### Calc engine (pure TS, Fat-DAL, unit-testable) — `qteklink-app/src/lib/payroll/`

- `types.ts` — Zod schemas: role families, pay_config per family, run snapshot (versioned).
- `calc.ts` — PURE functions replicating the workbook formulas exactly (formula-for-formula mapping to
  the extraction doc). **Clock-hours semantics (explicit):** the office manager enters TOTAL worked clock
  hours per week; reg = min(clock, 40), OT = max(0, clock − 40) at 1.5× (Chris's deliberate change from
  the workbook's separate manual OT entry — a consequence: OT cannot be granted on a <40-hr week).
  Efficiency = max(0, billed − totalClock) — arithmetically identical to the workbook's
  `billed − (clockReg + OT)` since workbook clock was reg-only. Other formulas:
  billed pay, PTO/Hol/Ber/Trn at hourly rate (per-week rate), SA bonus tiers
  (tier by GP-with-fees + sales vs goals; % × GP-without-fees), spiff = count × amount, office-mgr bonus
  = (sales − goal)⁺ × pct, foreman bonus = shopHours > goal ? shopHours × rate : 0 (cliff, as-is),
  totals + metrics (pay/clock-hr, cost/billed-hr, productivity). Salaried: PTO etc. tracked as hours only.
- `derive.ts` — mirror queries: `billedHoursByTechnician(period)` (labor lines joined to ROs by
  posted_date), `monthSalesPreTax(month)`, `monthPartsCost(month)`, `shopBilledHours(month)`,
  `spiffCounts(month, categories)` grouped by service_writer_id. Every derived number carries provenance
  (RO count, date range, as-of timestamp).
  **INVARIANT #1 — THE AUTHORIZED FILTER (verified 772/772 on June 2026, extraction doc #20):** every
  rollup filters jobs to `authorized IS TRUE`; labor lines, parts, and job fees filter through their
  parent job's flag (`selected` is the WRONG flag — 535/772). Stakes: June declined jobs carry 1,269.6
  labor hours vs 1,176.7 authorized — unfiltered billed hours would be >2× wrong. Every derive.ts query
  gets a dedicated unit test asserting declined-job exclusion, and the fees rule is now exact:
  month fees = Σ `tekmetric_ros.fee_total_cents` ≡ Σ authorized-job fees + RO fee lines.
- `gp.ts` — month GP with/without fees: sales − parts − laborPay; laborPay = Σ over runs overlapping the
  month of (run total pay for Technician+Foreman+ShopSupport) × (run days in month ÷ 14). Uses completed
  runs' snapshots; the in-flight run contributes its current computed values (flagged provisional in UI).
- `summary.ts` — per-run summary rows (Reg/OT/Incentive/PTO/Trn/Hol/Ber; n/a where inapplicable),
  dashboard aggregates (last-12-runs card, avg hourly pay = last-12-runs total comp ÷ clock hours).
- **Read path rule:** open runs compute live (mirror + entries); completed runs render EXCLUSIVELY from
  `snapshot` — no recomputation, ever.

### Mirror ingest scheduling

Port the **incremental** path of `scheduler-app/scripts/tekmetric/sync-ros.mjs` (watermark → page
`/repair-orders` → whitelisted upserts into `tekmetric_ros*`, unknown keys → ingest alert) into
`qteklink-app/src/lib/payroll/mirror-ingest.ts`, invoked from the existing nightly cron
(`runNightlySync`). The standalone script stays for backfills. Plus a per-run "Refresh Tekmetric data"
admin action that runs the incremental ingest for the run's date range on demand (matches qteklink's
live-on-view philosophy). Mirror freshness surfaces in the run UI ("data as of …").

### UI (per design spec — `frontend-implementer` executes in implement phase)

- `app/QtlTabs.tsx` — add Payroll tab.
- `app/payroll/page.tsx` — dashboard: employees card + last-12-runs card (open run → run page).
- `app/payroll/employees/page.tsx` (+ client manager components) — add/edit/archive, role picker,
  Tekmetric ID picker (from `GET /api/v1/employees` via the tekmetric client — new `listEmployees()`),
  pay config editor per role family. Admin-gated (moot today — all users admin — but follows convention).
- `app/payroll/runs/[period]/page.tsx` — entry grid (office manager), per-employee sheet views per role
  family with auto/manual/override provenance, bonus slider + bonus panel (per-run goals), summary tab,
  Pattern S complete dialog, locked read-only rendering from snapshot. Print-friendly summary.
- `src/actions/payroll.ts` — thin actions (auth + Zod + DAL), one per RPC + refresh-data.
- Design-spec integration notes: entry-grid totals are SERVER-recomputed on save (no client-side
  business math — matches the breakdown page's force-dynamic model); the spec's `AutoValue` override
  pencil wires to the `overrides` JSONB via `qteklink_payroll_update_entry` (already in this plan);
  print view is `window.print()` + `@media print` CSS, no dedicated print route.

## Cross-verify hardening (accepted findings — Gemini + GPT, 2026-07-10)

Schema/DB:
- **DB-level immutability wall:** BEFORE UPDATE/DELETE triggers on `qteklink_payroll_runs` +
  `_run_employees` reject any change once `status='completed'` (completing transaction excepted via the
  keytag Layer-4 GUC pattern) — RPC RAISE alone doesn't stop future scripts/privileged paths.
- **One bonus run per month:** partial unique index on `(shop_id, bonus_month) WHERE bonus_period` —
  prevents double-paying monthly bonuses.
- **Integrity constraints:** CHECK `period_end = period_start + 13`; run-status consistency CHECKs
  (`completed ⇔ snapshot/completed_at/completed_by NOT NULL`); composite FK ties so run_employee.shop_id
  = run.shop_id = employee.shop_id; UNIQUE `(shop_id, tekmetric_employee_id) WHERE archived_at IS NULL AND
  tekmetric_employee_id IS NOT NULL`; explicit `tekmetric_id_type` column ('technician'|'service_writer',
  derived from role, stored); non-negative + sane-max CHECKs on all hours/cents columns; RPC-side
  pay_config validation mirroring the DAL Zod schema (version-checked, unknown-field-rejecting);
  `REVOKE EXECUTE FROM PUBLIC/anon` on every payroll RPC (existing qteklink convention, stated explicitly).
- **Roster ops on open runs:** `qteklink_payroll_sync_run_roster(run_id)` adds newly-created employees to
  an OPEN run / removes entry-less accidental inclusions (completed runs untouched).
- **Audit trail:** append-only `qteklink_payroll_audit_log` (run_id, actor user id + label, field, old→new,
  at) written by every mutating RPC — open-run edits are compensation-affecting and must be attributable.

Calc/flow:
- **Bonus-run completion guard:** completing a run with `bonus_period=true` requires every run overlapping
  `bonus_month` to be completed (labor-pay side of GP must be final, not provisional); explicit
  admin override with audit entry if Chris ever needs it. GP for >1 open overlapping run sums ALL open
  runs' current values deterministically (provisional display only).
- **Second-run-of-month soft guard:** UI warns when the slider is ON for a run that isn't the month's
  second period, and the dashboard flags a month whose second run completed with no bonus run (manual
  control preserved — warnings only, per Chris).
- **Refresh scope:** the per-run "Refresh Tekmetric data" action fetches by DATE RANGE
  (postedDateStart/End — run period, plus the bonus month when the slider is on), not the incremental
  watermark; nightly stays watermark-incremental. Ingest logic lives in ONE canonical module
  (`mirror-ingest.ts`); the scheduler-app script delegates to or is superseded by it (no duplicated whitelists).
- **Zero-division:** all ratio metrics (pay/clock-hr, cost/billed-hr, productivity, avg hourly pay) return
  null → rendered "n/a" when the denominator is 0.
- **Freshness gate:** completion dialog shows mirror "data as of"; completing with data older than the
  period end requires explicit acknowledgment in the Pattern S dialog.

Tests (adds to Verification): pgTAP cross-shop isolation (read + write, row-count assertions), trigger
immutability under direct UPDATE/DELETE as service_role, bonus-month partial-unique violation; golden
vitest fixtures explicitly enumerate: every role-family formula set, tier boundaries (=goal vs >goal),
OT split edges (exactly 40, <40, PTO-heavy weeks), proration (3/14ths June example), zero-hour employees.

Rejected/already-decided findings (on record): access via existing allowlist = Chris's explicit decision
(everyone in qteklink today is payroll-authorized; revisit only when a non-payroll user is added);
OT auto-derive = Chris's deliberate change (see calc.ts note); GP fee-set = tracked open question gating
phase 3; "RLS/service-role isolation" criticism = reviewer misread of the established qteklink
REVOKE-writes-from-service_role convention (wording clarified above).

## File-by-file change list

| File | Change |
|---|---|
| `supabase/migrations/<ts>_qteklink_payroll.sql` | 3 tables + RPCs + settings key + grants/RLS (new) |
| `supabase/tests/database/qteklink_payroll*.sql` | pgTAP: RPC validation, immutability (row counts), deny-all RLS (new) |
| `qteklink-app/src/lib/payroll/{types,calc,derive,gp,summary,mirror-ingest}.ts` | engine (new) |
| `qteklink-app/src/lib/payroll/__tests__/*` | golden unit tests from workbook fixtures (new) |
| `qteklink-app/src/lib/tekmetric/client.ts` | add `listEmployees()`, incremental RO paging for ingest (edit) |
| `qteklink-app/src/lib/dal/nightly-sync.ts` | call mirror ingest (edit) |
| `qteklink-app/src/lib/dal/payroll.ts` | DAL over the RPCs + reads (new) |
| `qteklink-app/src/actions/payroll.ts` | thin server actions (new) |
| `qteklink-app/app/QtlTabs.tsx` | +Payroll tab (edit) |
| `qteklink-app/app/payroll/**` | dashboard, employees, runs/[period] + client components (new) |
| `test-kit/fixtures/payroll/*` | workbook-derived golden fixtures + backtest expectations (new) |
| `qteklink-app/scripts/payroll-backtest.mjs` | mirror-vs-workbook billed-hours/sales diff report (new) |

## Phasing (commit-sized)

1. **Migration + pgTAP** (tables, RPCs, immutability tests).
2. **Calc engine + golden fixtures** — fixtures extracted from real filled workbooks (python extraction
   session-side → JSON in test-kit); unit tests lock every formula family. TDD: fixtures first.
3. **Derivation DAL + backtest** — `payroll-backtest.mjs` diffs per-tech billed hours + month sales/GP
   against ≥2 filled pay periods (e.g. `6-14-26 - 6-27-26.xlsx`, `5-31-26 - 6-13-26.xlsx`) and a bonus
   month; **results reviewed with Chris before UI work proceeds** — this is the accuracy gate he asked for.
4. **Mirror ingest port** (nightly + on-demand refresh).
5. **Employees management UI** (+ Tekmetric ID picker).
6. **Run UI** (entry grid, sheets, bonus panel, summary, Pattern S complete, locked rendering).
7. **Dashboard** (cards).

## Verification

- `npm run typecheck`, `npm run test` (vitest golden tests), `npm run build` in qteklink-app.
- pgTAP `supabase test db` — immutability asserted by ROW COUNTS + RAISE, per the RLS-silent-filter rule.
- Backtest report (phase 3) — Chris signs off on accuracy before ship.
- `/code-review` gate + design-diff reviews (design-review, wiring-review, dead-code-review,
  behavior-parity-review) at `/feature-verify`; `/feature-cross-verify` on this plan before implement.

## Round-2 decisions folded in (Chris, 2026-07-10 evening — extraction doc §Round-2)

1. **Fees:** authoritative = `tekmetric_ros.fee_total_cents` (Tekmetric's RO-level rollup; verified in
   raw JSON + mirror). Month fees = Σ over posted ROs. GP-with-fees = sales − parts − laborPay;
   GP-without-fees = GP-with-fees − month fees. Phase-3 reconciles feeTotal vs fee-line sums (declined-job
   fees suspected in the 241/772 mismatches) against the workbooks' real GP numbers.
2. **Spiff config + multipliers:** payroll settings card — every observed job category, three-column
   layout, toggle (counted) + numeric dropdown (spiffs-per-job multiplier, e.g. FLUID FLUSH 2 → 2).
   Spiff $ = Σ(counted jobs × multiplier) × spiff amount. **New-category catcher:** nightly (and
   on-demand refresh) diffs distinct `job_category_name` against the known set in settings; unknown values
   are appended (counted=false, multiplier=1, `new` flag) and surface on the card with a "new" badge.
   Settings shape: `payroll.spiff_categories: [{name, counted, multiplier, first_seen, is_new}]`.
3. **OT threshold:** worked clock hours only. (Already in calc.ts semantics.)
4. **Straddle proration (approximation per Chris):** daily hours = week hours ÷ 5 (OT likewise);
   month-side share = daily hours × month's days in the straddling week (capped at 5), valued at the
   employee's rates. Documented as approximation; superseded by the future time module.
5. **Void-and-clone (replaces "no reopen"):** `qteklink_payroll_void_run(run_id, reason, <Pattern S>)` —
   only valid on completed runs; flips status to `voided` via the GUC-excepted path (the run's data stays
   frozen forever — the immutability triggers now guard `completed` AND `voided`), records
   who/when/reason in the audit log, and CLONES all inputs (entries, per-run config, slider state) into a
   new OPEN run for the same period with `cloned_from_run_id` provenance. Uniqueness moves to partial
   indexes: `UNIQUE(shop_id, period_start) WHERE status <> 'voided'` and the bonus-month index gains the
   same predicate. Aggregates (last-12 card, GP labor pay, avg hourly pay) EXCLUDE voided runs. UI:
   voided runs render with the locked treatment + a "Voided — superseded by <run>" banner; clones show
   "Cloned from voided run" provenance.
6. **Email alerts:** two recipient lists on the payroll settings page
   (`payroll.alert_emails: {void_clone: [], completed: []}`); sends via the existing qteklink email
   infra (`src/lib/dal/notify.ts` idiom) on (a) void-and-clone, (b) run completed. Both emails include
   period, actor, and (for voids) the reason.

Additional files this adds to the change list: `qteklink-app/app/payroll/settings/page.tsx` (+ client
cards), spiff-category + alert-email keys in the settings JSONB, `qteklink_payroll_void_run` RPC +
pgTAP (void-only-completed, clone integrity, voided-runs-excluded-from-aggregates row counts), notify
templates. Design-spec addendum requested for: settings page cards, void-and-clone affordance +
voided/cloned provenance treatments.
