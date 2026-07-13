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
