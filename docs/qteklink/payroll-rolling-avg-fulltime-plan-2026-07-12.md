# Rolling-26 average hourly pay + full-time PTO gate — plan (2026-07-12, round-12)

> Two employee/PTO changes, built together. Requirements = Chris 2026-07-12 (this session).
> Modifies the JUST-SHIPPED PTO phase + the documented round-3 #24/#25 leave-rate model, and it
> is MONEY (leave pay) — so it runs the full plan → regression-check → build → verify → deploy
> flow. Prior art: docs/qteklink/payroll-pto-employee-mgmt-plan-2026-07-12.md (the PTO phase),
> payroll-workbook-extraction-2026-07-10.md (#24/#25 leave-rate model).

---

## Decisions (Chris, verbatim answers)

- **Averaging = mean of per-period rates, rolling 26** ("the average over 26 pay periods would be
  simpler since we already calculate it"). NOT the current weighted Σpay÷Σhours over 12.
- **Per-period rate = (reg pay + OT pay + incentive) ÷ (reg + OT hours)**, NO bonus ("It is reg
  hours, ot hours, and incentive"). This equals the current leave-basis numerator
  (base+OT+billed+efficiency) over worked hours — only the *aggregation* changes (mean-of-rates,
  window 26) and the *seed shape* (a rate, not pay+hours).
- **Full-time default = true** ("default to full time. Not all current employees are full time"
  — Chris flips the part-timers off).
- **Dashboard avg hourly pay = the same rolling average** ("what is shown on the dashboard should
  be a rolling average, so to keep it consistent calculate those the same way. Those can be
  calculated moving forward"). The dashboard figure switches from weighted-last-12 to the same
  mean-of-per-period-rates over 26.
- **Only technicians (+ the foreman) get PTO paid based on the avg** ("The technicians are the
  only ones that get PTO based on it") — unchanged from the existing model: technician +
  shop_foreman families pay PTO/Holiday/Bereavement at the avg-hourly rate; office_manager +
  support pay leave at their hourly rate; service_advisor is salaried.
- **Seed table:** 5 full-time billed folks (Matt Clark, Joseph Fuhrer, Eli Vasiliou, Charles
  Williams [technician family]; George Trilli [shop_foreman]). TOP ROW = MOST RECENT period
  (period_start 2026-06-14), mapping back bi-weekly (2026-06-14, 2026-05-31, … 26 periods).
  Jeff Cantrel (also billed) is NOT in the table — likely part-time; his leave rate builds from
  real runs / current-run fallback until seeded.

**OPEN before seeding (not blocking the mechanism build):** the image shows what looks like 24
rows but Chris said 26 — resolve the exact row count, and get the 130 values in a reliable
text/CSV form (or transcribe + Chris verifies) since it is money. Seeding is the LAST step.

## Feature A — rolling-26 average hourly pay

### A1. The model change (payroll-leave-rate.ts + calc/compute)

- `LEAVE_RATE_WINDOW`: 12 → **26**.
- The "history" source becomes the **arithmetic mean of the per-period rates** in the merged
  26-period window, NOT Σpay÷Σhours. Each period contributes ONE rate:
  - real completed run: `rate_i = (base+OT+billed+efficiency pay) ÷ (reg+OT hours)` for that run
    (computed from the frozen snapshot; hours>0 else the period is skipped);
  - seed: the stored per-period rate directly.
- `resolveLeaveRate` precedence UNCHANGED in shape: override → **26-window mean** ('history') →
  single-rate seed fallback ('seed') → current-run rate ('current_run') → base rate. Only the
  'history' math changes.
- Rounding: each rate rounds half-away-from-zero to integer cents; the mean rounds once at the end.

### A2. Seed shape change (types.ts LeaveRateSeedEntry + SQL validator)

- `LeaveRateSeedEntry`: `{ period_start, work_pay_cents, clock_hours }` →
  `{ period_start, avg_hourly_pay_cents }` (an integer-cents rate). NO existing seed data exists
  (the seeding step was deferred, never run) — clean cutover, no data migration.
- The SQL validator's `leave_rate_seed_history` block (migration) updates to the new key set.
- `mergeLeaveRateWindow`: collects per-period rates (seed rate OR run rate), real-beats-seed by
  period, newest-26, returns the **mean** + counts (runs/seeded). Return type changes from
  `{payCents, hours}` to `{ meanRateCents | null, runs, seededEntries }` (or the rate list).

### A3. Dashboard (summary.ts + app/payroll/EmployeesCard.tsx)

- `avgHourlyWithoutBonusCents` / `avgHourlyPayCents` change from weighted-over-a-rowset to the
  **mean of per-RUN rates over the last 26 completed runs** (group by run/period, one rate each).
  The DAL must therefore pass per-run rows (not a flattened rowset) OR expose per-run rates.
- The "without bonus" dashboard number == the leave-rate number for tech/foreman (consistency).
  The "with bonus" number = mean of per-run WITH-bonus rates over 26 (real runs only; unseeded,
  so it fills in "moving forward" — n/a until runs accumulate, per Chris).
- No seeding of the dashboard beyond the leave-rate seed (Chris: "calculated moving forward").

## Feature B — full-time PTO gate

### B1. Schema

- `qteklink_payroll_employees.full_time BOOLEAN NOT NULL DEFAULT true` (Chris: default true).
- The employee-PROFILE RPC (qteklink_payroll_update_employee_profile) gains `full_time` in its
  patch key set (present=write, absent=keep — the round-11 patch idiom). The read surface
  (EMPLOYEE_COLS/EmployeeDbRow/employeeFromRow/PayrollEmployee) carries it.

### B2. Engine (pto.ts accrual gate)

- Accrual is written ONLY when `full_time = true`, in ADDITION to the existing eligibility
  (7th-full-period / grandfather) + not-archived/not-terminated gates. A part-time employee:
  accrual = 0, no accrual ledger rows — regardless of tenure/tiers.
- **USAGE unchanged** (plan §3/C37): a `usage` entry is still written for ANY employee with paid
  PTO hours (a part-timer who somehow carries a balance still decrements) — full-time gates
  ACCRUAL only.
- Holiday/bereavement/training pay unaffected by full_time (they are not PTO).
- The pure engine takes `fullTime: boolean` in its per-employee input; the DAL threads it from
  the master row.

### B3. UI (EmployeeContactPanel / the employee form)

- A full-time on/off toggle on the employee form (near the grandfather/tenure controls). Submits
  through updateEmployeeProfileAction (the existing profile-patch path). Default true for new.

## Testing / verify

- pto.ts: full-time gate matrix (part-time ⇒ zero accrual even when eligible+tiered; full-time
  ⇒ accrues; usage still written for a part-timer with paid PTO hours).
- payroll-leave-rate.ts: mean-of-rates over 26 (seed rates + run rates, real-beats-seed,
  window cap, precedence); a single seed rate; current-run fallback; empty window.
- summary.ts: dashboard rolling-26 mean (per-run grouping; with/without bonus; n/a on no runs).
- pgTAP: the profile RPC accepts full_time (patch keep/clear); the seed-history validator accepts
  the new avg_hourly_pay_cents shape and rejects the old one.
- RTL: the full-time toggle on the form.
- Regression locks: the leave-rate model change must not break the existing calc golden suite
  (the golden fixtures use the OLD weighted-12 leave rate — they will need updating or the leave
  rate must be pinned; VERIFY the golden suite's expectations against the new model).

## Rollout

1. Migration (full_time column + profile RPC full_time + seed-history validator new shape) —
   `supabase db push`.
2. TS: engine (pto.ts gate + payroll-leave-rate.ts mean-26 + seed shape) + DAL threading +
   summary.ts dashboard + UI toggle + the seeding script's new seed shape.
3. Verify gauntlet + deploy → Vercel READY.
4. SEED: resolve the 24-vs-26 row count + get the values reliably, then run the (update-only,
   dry-run-first) seeding script for the 5 full-time billed employees; Chris marks the part-time
   employees off.

## Risks flagged for the regression check

- The calc **golden suite** encodes the OLD weighted-12 leave rate — the model change may shift
  golden leave-pay expectations. Must be reconciled.
- The dashboard aggregation currently flattens rows across runs (weighted); switching to
  mean-of-per-run-rates changes the DAL's data shape into summary.ts — find every caller.
- The seed-shape change touches types.ts LeaveRateSeedEntry, the SQL validator, the merge, the
  seeding script, AND any test fixtures that build seed entries the old way.
- full_time added to the profile RPC must follow the round-11 patch semantics (absent=keep) so
  the existing archive/unarchive/profile flows don't wipe it.

---

## v2 AMENDMENTS — regression check (2026-07-12, 5-lens; verify-phase crashed on a wide fan-out,
## findings salvaged from the review transcripts + confirmed by hand against the live code)

These SUPERSEDE the sections above where they conflict.

**1. Leave-rate consumers — there are TWO call sites, in TWO files (not "two calls in
payroll-compute.ts").** The (mergeLeaveRateWindow → resolveLeaveRate) pair + the `LeaveRateEntry`
shape are consumed at **payroll-compute.ts:306** AND **payroll-compute-gp.ts:230** (the GP
labor-pay proration path for other open runs overlapping the bonus month; wrong = SA GP-tier
bonus money regresses). `fetchLeaveRateHistory` (payroll-leave-rate.ts:100) produces the entry
for both. ALL THREE migrate in one commit; both files join the tsc/vitest gate.

**2. Testing target correction — the golden suite is IMMUNE; the real lock is
payroll-leave-rate.test.ts.** calc.golden.test.ts supplies NO leave rate (leave cells are
Quirk-B SKIPPED) — it needs NO edit; VERIFY it stays green. calc.leave.test.ts tests calc.ts's
consumption of an already-resolved rate — also unchanged. The suites that encode the OLD model
and MUST change: **payroll-leave-rate.test.ts** (full rewrite — the {payCents,hours} return
shape at :47/54/63/75/79, the weighted 'history' math at :117, and the {work_pay_cents,
clock_hours} seed fixtures at :30/152/175), **payroll.test.ts:302** (a seed-history fixture),
and **summary.test.ts** (the weighted avgHourly + the family-gate locks at :294/330/353/397).

**3. Seed-shape cutover = a NEW migration + 5 surfaces; verified safe.** 20260712200000 is
ALREADY APPLIED — author a FRESH migration that re-CREATEs qteklink_payroll_validate_pay_config
with the leave_rate_seed_history block requiring `{period_start, avg_hourly_pay_cents}` (int
cents ≥ 0) and rejecting the old keys. Co-edit: (a) types.ts LeaveRateSeedEntrySchema + BOTH
`.max(26)` caps; (b) mergeLeaveRateWindow's seed→rate read; (c) scripts/payroll-seed-leave-rates.mjs
— its INPUT contract (`avg_hourly_pay_dollars` not work_pay_dollars/clock_hours), the dollars→cents
convert, the dry-run "avg" preview, AND its cadence/double-count guard all get re-derived for a
rate-only entry; (d) every seed fixture (payroll-leave-rate.test.ts, payroll.test.ts:302).
**DB-verified 2026-07-12: 0 rows carry leave_rate_seed_history** (employees / run_employees /
run snapshots) → the strict swap cannot break a frozen re-parse (SnapshotEmployeeSchema
re-validates pay_config on every read). Keep the strict shape (no legacy union needed).

**4. Dashboard — don't mutate the shared functions; add per-run ones; keep the numerator; fix
the window everywhere; drop the false equality claim.**
- `avgHourlyPayCents`/`avgHourlyWithoutBonusCents` are DUAL-USE: also called by
  `aggregateLastCompletedRuns` over a FLATTENED cross-run rowset (the shop-wide last-runs card,
  summary.ts:319). Do NOT redefine them in place. Add NEW per-run functions
  (`meanOfPerRunRates(runsRows)`), repoint ONLY `employeeHourlyAverages` (the per-employee card)
  to the per-run mean, and LEAVE the shop-wide card's avg as-is (weighted) unless Chris signs off.
- The dashboard mean needs per-RUN grouping, but page.tsx:245-252 FLATTENS rows across runs
  (period identity lost). Thread per-run groups end-to-end: rowsByEmployee becomes per-employee-
  per-run; update `employeeHourlyAverages`'s signature + EmployeesCard props + summary.test.ts.
- The window is **12 in three places** (page.tsx:243 lastCompletedRuns(…,12); the DAL fetch
  limit:40 → payroll-summaries.ts default 12; summary.ts lastCompletedRuns default 12) — bump the
  dashboard window to 26 AND raise the fetch so ≥26 completed runs are guaranteed.
- **DROP the "without-bonus dashboard == leave-rate" equality claim — it is UNREACHABLE.** The
  dashboard numerator is `total_pay − bonus − spiff − manual` and total_pay INCLUDES leave pay;
  the leave-rate numerator is `(base+OT+billed+efficiency)` and EXCLUDES leave pay. Chris's
  "calculate the same way" = the same METHOD (rolling-26 mean of per-run rates), NOT the same
  number. Keep the dashboard's existing (leave-inclusive) numerator; change only aggregation +
  window. Preserve the WITH_BONUS_FAMILIES gate + EmployeesCard's two distinct n/a reasons.

**5. Full-time — enumerate the whole chain; default-true in the engine; do NOT flip `eligible`;
boolean special-case in the RPC.**
- Threading: full_time BOOLEAN → EMPLOYEE_COLS + EmployeeDbRow + employeeFromRow +
  PayrollEmployee.fullTime (payroll-shared.ts) → **PtoEmployeeFields.full_time (REQUIRED)** →
  ptoFieldsFromEmployee maps it (tsc forces this) → computeAccrual gates on an EXPLICIT boolean
  (never `?? true`). Update the pto.test.ts `emp()` helper to default full_time:true so the whole
  eligibility/tier/usage matrix keeps compiling.
- The gate ZEROES `accrual_hours` but must NOT flip `eligible` (which today means tenure/archive
  eligibility, surfaced in projections). A part-time, tenure-eligible employee reports
  accrual_hours:0 with `eligible` unchanged. **USAGE is still written for part-timers** with paid
  PTO hours (C37) — re-run the archived/terminated/NULL-start usage cases with full_time=false.
- Profile RPC (in the SAME new migration): treat full_time exactly like `pto_grandfathered` — add
  to c_allowed, a boolean type-check branch that REJECTS JSON null (NOT NULL column), and a
  `full_time = CASE WHEN p_patch ? 'full_time' THEN (p_patch->>'full_time')::boolean ELSE
  e.full_time END` arm. TS: EmployeeProfilePatch + PROFILE_PATCH_KEYS gain `full_time?: boolean`.
- pgTAP: extend the byte-identity lock + the all-columns patch test to include full_time; the
  legacy upsert's fixed column list excludes full_time so DEFAULT true survives an archive/unarchive.
- full_time is read LIVE at completion (via ptoFieldsFromEmployee on the master row), matching
  start_date/termination_date — a mid-cycle flip changes that run's accrual. Documented + intended.

**6. LEAVE_RATE_FETCH_RUNS** (payroll-leave-rate.ts:34) is 26 = the new window → zero slack (an
employee who missed a shop run can't fill 26). Bump it to **52** so the fetch exceeds the window.

**7. Live open-run money.** Deploying the MECHANISM alone does not shift leave pay: with no
completed runs + no seeds, the leave rate still resolves via 'current_run'/'base_rate'. The shift
happens at SEEDING (the open 6/28 run's leave rate becomes the seeded 26-mean) — Chris-controlled,
intended. Note it in the seed step.
