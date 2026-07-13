/**
 * Payroll summary layer — per-run summary rows (extraction requirement #6), the
 * run-level TOTALS block (round-9 decision #46 — the summary page's totals card,
 * server-computed and stored on the snapshot), and the dashboard aggregates
 * (requirement #7): the shop-wide last-runs card and the null-safe average hourly
 * pay, plus the two per-EMPLOYEE variants (round-3 decision #25): WITHOUT-bonus for
 * everyone and WITH-bonus for the bonus families only (SA/office_manager/shop_foreman).
 * Contract: docs/qteklink/payroll-contract.md §summary.ts.
 *
 * Round-12 (2026-07-12): the per-EMPLOYEE dashboard averages switch from weighted
 * (Σpay ÷ Σhours over a flattened rowset, last 12) to the MEAN OF PER-RUN RATES over
 * the last {@link DASHBOARD_WINDOW} = 26 completed runs — each run contributes one
 * rate, and the rates are averaged (matching the leave-rate model's rolling-26
 * mean-of-rates method; docs/qteklink/payroll-rolling-avg-fulltime-plan-2026-07-12.md
 * §A3). The per-run numerator is UNCHANGED (total_pay − bonus − spiff − manual, i.e.
 * leave-INCLUSIVE) — only the aggregation (mean of per-run rates) and the window (26)
 * change; the "without bonus" figure is NOT the same NUMBER as the leave rate (which
 * excludes leave pay), only the same METHOD. The SHOP-WIDE last-runs card
 * ({@link aggregateLastCompletedRuns}) stays WEIGHTED over its own 12-run window.
 *
 * PURE — rows in, rows/aggregates out. Voided runs are EXCLUDED from every aggregate
 * (round-2 decision #18); open runs are excluded from the "completed" window too (the
 * in-flight run is provisional by definition). "n/a" renders as null throughout:
 * a support-family row with no manual incentive entered has incentive_cents = null,
 * salaried leave-pay fields are null, and an aggregate window with zero clock hours
 * (or zero runs) has avg_hourly_pay_cents = null — never Infinity/NaN.
 */
import { round2, roundCents } from "./calc";
import type { Family, Role, RunStatus, RunTotals, SheetComputation, SummaryRow } from "./types";

/** One employee's computed sheet plus identity — the DAL assembles these per run. */
export interface EmployeeSheet {
  employee_id: string;
  display_name: string;
  role: Role;
  family: Family;
  sheet: SheetComputation;
}

const TECH_FAMILIES: readonly Family[] = ["technician", "shop_foreman"];

/** buildRunSummary's result: the per-employee rows + the run-level totals block
 *  (round-9 #46) — both ride the snapshot. */
export interface RunSummary {
  rows: SummaryRow[];
  totals: RunTotals;
}

/**
 * Build the per-run summary: the rows (one per employee, sorted by display name)
 * plus the run-level TOTALS block (round-9 #46 — see {@link buildRunTotals}).
 * Row column applicability per family:
 *   - billed hours/pay: technician + shop_foreman only (null elsewhere);
 *   - incentive: null ("n/a") ONLY for a support row with no manual incentive entered —
 *     every other family always has a numeric incentive (0 when nothing was earned);
 *   - leave pay: null for the salaried family (hours still tracked).
 */
export function buildRunSummary(sheets: EmployeeSheet[]): RunSummary {
  const rows = sheets
    .map((e): SummaryRow => {
      const s = e.sheet;
      const isTech = TECH_FAMILIES.includes(e.family);
      const billedPay =
        s.week1.billed_pay_cents === null && s.week2.billed_pay_cents === null
          ? null
          : (s.week1.billed_pay_cents ?? 0) + (s.week2.billed_pay_cents ?? 0);
      return {
        employee_id: e.employee_id,
        display_name: e.display_name,
        role: e.role,
        family: e.family,
        reg_hours: s.reg_hours,
        ot_hours: s.ot_hours,
        reg_pay_cents: s.week1.base_pay_cents + s.week2.base_pay_cents,
        ot_pay_cents: s.week1.ot_pay_cents + s.week2.ot_pay_cents,
        billed_hours: isTech ? s.billed_hours_total : null,
        billed_pay_cents: isTech ? billedPay : null,
        incentive_cents:
          e.family === "support" && s.manual_incentive_cents === null ? null : s.incentive_cents,
        bonus_cents: s.bonus_cents,
        spiff_cents: s.spiff_cents,
        pto_hours: s.pto_hours,
        pto_pay_cents: s.pto_pay_cents,
        training_hours: s.training_hours,
        training_pay_cents: s.training_pay_cents,
        holiday_hours: s.holiday_hours,
        holiday_pay_cents: s.holiday_pay_cents,
        bereavement_hours: s.bereavement_hours,
        bereavement_pay_cents: s.bereavement_pay_cents,
        total_pay_cents: s.total_pay_cents,
      };
    })
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
  return { rows, totals: buildRunTotals(rows) };
}

/** Null-safe category sum: null components count 0, but an ALL-null category
 *  stays null → renders "n/a", never $0.00 (round-9 #46). */
function addNullable(acc: number | null, v: number | null): number | null {
  return v === null ? acc : (acc ?? 0) + v;
}

/**
 * The run-level TOTALS block (round-9 decision #46 — replaces the summary
 * table's TOTAL row): grand total pay; reg/OT/incentive pay; the four leave
 * pays (n/a-safe); reg/OT/PTO/Holiday/Bereavement/Training/billed hours; and
 * cost per clock hour = total pay ÷ (reg + OT) hours, null on a zero
 * denominator (never Infinity/NaN). Pure display aggregation of the rows'
 * numbers — no pay math. Hours settle back to 2dp (float noise).
 */
export function buildRunTotals(rows: SummaryRow[]): RunTotals {
  let totalPay = 0;
  let regPay = 0;
  let otPay = 0;
  let incentivePay: number | null = null;
  let ptoPay: number | null = null;
  let holidayPay: number | null = null;
  let bereavementPay: number | null = null;
  let trainingPay: number | null = null;
  let regHours = 0;
  let otHours = 0;
  let ptoHours = 0;
  let holidayHours = 0;
  let bereavementHours = 0;
  let trainingHours = 0;
  let billedHours: number | null = null;
  for (const r of rows) {
    totalPay += r.total_pay_cents;
    regPay += r.reg_pay_cents;
    otPay += r.ot_pay_cents;
    incentivePay = addNullable(incentivePay, r.incentive_cents);
    ptoPay = addNullable(ptoPay, r.pto_pay_cents);
    holidayPay = addNullable(holidayPay, r.holiday_pay_cents);
    bereavementPay = addNullable(bereavementPay, r.bereavement_pay_cents);
    trainingPay = addNullable(trainingPay, r.training_pay_cents);
    regHours += r.reg_hours;
    otHours += r.ot_hours;
    ptoHours += r.pto_hours;
    holidayHours += r.holiday_hours;
    bereavementHours += r.bereavement_hours;
    trainingHours += r.training_hours;
    billedHours = addNullable(billedHours, r.billed_hours);
  }
  const clockHours = round2(regHours + otHours);
  return {
    total_pay_cents: totalPay,
    reg_pay_cents: regPay,
    ot_pay_cents: otPay,
    incentive_pay_cents: incentivePay,
    pto_pay_cents: ptoPay,
    holiday_pay_cents: holidayPay,
    bereavement_pay_cents: bereavementPay,
    training_pay_cents: trainingPay,
    reg_hours: round2(regHours),
    ot_hours: round2(otHours),
    pto_hours: round2(ptoHours),
    holiday_hours: round2(holidayHours),
    bereavement_hours: round2(bereavementHours),
    training_hours: round2(trainingHours),
    billed_hours: billedHours === null ? null : round2(billedHours),
    cost_per_clock_hour_cents: clockHours > 0 ? roundCents(totalPay / clockHours) : null,
    // Round-9 addendum (Chris): ALL pay ÷ total billed hours — same numerator as
    // cost per clock hour; null (never Infinity) when the run has no billed hours.
    cost_per_billed_hour_cents:
      billedHours !== null && billedHours > 0 ? roundCents(totalPay / billedHours) : null,
  };
}

// ── Dashboard aggregates (last-completed-runs card + per-employee rolling-26) ───

/**
 * The rolling window for the per-EMPLOYEE dashboard averages (round-12): the last 26
 * completed runs, one rate each, meaned. A year of bi-weekly periods. The shop-wide
 * card ({@link aggregateLastCompletedRuns}) keeps its own explicit 12-run window.
 */
export const DASHBOARD_WINDOW = 26;

/** A run's summary rows + enough metadata to window/order. Completed runs read rows
 *  from the frozen snapshot; open/voided runs are filtered out here regardless. */
export interface RunForAggregation {
  status: RunStatus;
  /** ISO date (period start) — the ordering key for "last N runs". */
  period_start: string;
  rows: SummaryRow[];
}

export interface LastRunsAggregate {
  /** Completed runs actually aggregated (≤ limit). */
  run_count: number;
  reg_hours: number;
  reg_pay_cents: number;
  ot_hours: number;
  ot_pay_cents: number;
  billed_hours: number;
  billed_pay_cents: number;
  /** Σ non-null row incentives (tech billed/efficiency pay + bonuses + spiffs + manual). */
  incentive_cents: number;
  /** "Total bonus pay or n/a": Σ (bonus + spiff) — null when NO row in the window had
   *  either (e.g. no bonus run completed yet). */
  bonus_pay_cents: number | null;
  pto_hours: number;
  pto_pay_cents: number;
  training_hours: number;
  training_pay_cents: number;
  holiday_hours: number;
  holiday_pay_cents: number;
  bereavement_hours: number;
  bereavement_pay_cents: number;
  total_pay_cents: number;
  /** Σ total pay ÷ Σ worked clock hours (reg + OT) over the window, in cents/hour;
   *  null when the window has no runs or zero clock hours. */
  avg_hourly_pay_cents: number | null;
}

/** Average hourly pay for any row set: Σ total pay ÷ Σ (reg + OT) clock hours
 *  (decision #9). null-safe: returns null on an empty set or zero hours. The
 *  dashboard's per-employee figure is this over the employee's last-12-runs rows. */
export function avgHourlyPayCents(rows: SummaryRow[]): number | null {
  let pay = 0;
  let hours = 0;
  for (const r of rows) {
    pay += r.total_pay_cents;
    hours += r.reg_hours + r.ot_hours;
  }
  return hours > 0 ? roundCents(pay / hours) : null;
}

/** Families whose employees receive a bonus — the only ones with a with-bonus
 *  average (round-3 decision #25); everyone else renders "n/a" (null). */
export const WITH_BONUS_FAMILIES: readonly Family[] = ["service_advisor", "office_manager", "shop_foreman"];

/**
 * Average hourly pay WITHOUT bonuses (round-3 decisions #24/#25): strips the SA tier
 * bonus + spiff, the foreman shop bonus, the office-manager sales bonus, and the
 * support manual incentive; KEEPS base + OT + billed + efficiency + leave pay.
 * Σ stripped pay ÷ Σ (reg + OT) clock hours; null-safe (null on an empty set or
 * zero hours). Window the rows with {@link lastCompletedRuns} first.
 */
export function avgHourlyWithoutBonusCents(rows: SummaryRow[]): number | null {
  let pay = 0;
  let hours = 0;
  for (const r of rows) {
    const manualIncentive = r.family === "support" ? (r.incentive_cents ?? 0) : 0;
    pay += r.total_pay_cents - (r.bonus_cents ?? 0) - (r.spiff_cents ?? 0) - manualIncentive;
    hours += r.reg_hours + r.ot_hours;
  }
  return hours > 0 ? roundCents(pay / hours) : null;
}

export interface EmployeeHourlyAverages {
  /** Every employee (null only when NO run in the window has clock hours). */
  avg_hourly_without_bonus_cents: number | null;
  /** Non-null ONLY for the bonus families (SA / office_manager / shop_foreman). */
  avg_hourly_with_bonus_cents: number | null;
}

/**
 * The MEAN of one rate per run (round-12): apply `rateFn` to each run's row group,
 * drop the runs that yield null (zero clock hours in that run — e.g. a run the
 * employee was on leave for), and arithmetic-mean the surviving per-run rates,
 * rounding once at the end (half-away-from-zero). null when NO run contributed a
 * rate. Each `rateFn` already rounds its per-run rate to integer cents, so this is
 * a mean-of-rounded-rates — the same rolling method the leave rate uses.
 */
export function meanOfPerRunRates(
  runsRows: SummaryRow[][],
  rateFn: (rows: SummaryRow[]) => number | null,
): number | null {
  let sum = 0;
  let count = 0;
  for (const runRows of runsRows) {
    const rate = rateFn(runRows);
    if (rate === null) continue;
    sum += rate;
    count += 1;
  }
  return count > 0 ? roundCents(sum / count) : null;
}

/**
 * The dashboard's two per-employee hourly averages (round-3 decision #25, round-12
 * rolling-26 method): the MEAN of per-RUN rates over the employee's last-26-COMPLETED
 * -runs groups (callers group per run via {@link lastCompletedRuns} → per-employee-
 * per-run; the window is {@link DASHBOARD_WINDOW}). Each element of `runsRows` is the
 * employee's rows within ONE run (normally a single row). `family` is the employee's
 * CURRENT family — it gates the with-bonus column, not the row math.
 *   - without bonus: mean of per-run {@link avgHourlyWithoutBonusCents};
 *   - with bonus: mean of per-run {@link avgHourlyPayCents}, bonus-families only.
 * The per-run numerator is UNCHANGED (leave-inclusive) — only the aggregation
 * (mean of per-run rates) + the window (26) differ from the old weighted-12 figure.
 */
export function employeeHourlyAverages(
  family: Family,
  runsRows: SummaryRow[][],
): EmployeeHourlyAverages {
  return {
    avg_hourly_without_bonus_cents: meanOfPerRunRates(runsRows, avgHourlyWithoutBonusCents),
    avg_hourly_with_bonus_cents: WITH_BONUS_FAMILIES.includes(family)
      ? meanOfPerRunRates(runsRows, avgHourlyPayCents)
      : null,
  };
}

/** The most recent `limit` COMPLETED runs (period_start descending). Voided and open
 *  runs never count. Exported so the dashboard can window per-employee rows too.
 *  Default = the per-employee {@link DASHBOARD_WINDOW} (26); the shop-wide card passes
 *  its own explicit 12. */
export function lastCompletedRuns(runs: RunForAggregation[], limit = DASHBOARD_WINDOW): RunForAggregation[] {
  return runs
    .filter((r) => r.status === "completed")
    .sort((a, b) => b.period_start.localeCompare(a.period_start))
    .slice(0, limit);
}

/** Aggregate the last-12-completed-runs card (requirement #7). */
export function aggregateLastCompletedRuns(runs: RunForAggregation[], limit = 12): LastRunsAggregate {
  const window = lastCompletedRuns(runs, limit);
  const agg: LastRunsAggregate = {
    run_count: window.length,
    reg_hours: 0,
    reg_pay_cents: 0,
    ot_hours: 0,
    ot_pay_cents: 0,
    billed_hours: 0,
    billed_pay_cents: 0,
    incentive_cents: 0,
    bonus_pay_cents: null,
    pto_hours: 0,
    pto_pay_cents: 0,
    training_hours: 0,
    training_pay_cents: 0,
    holiday_hours: 0,
    holiday_pay_cents: 0,
    bereavement_hours: 0,
    bereavement_pay_cents: 0,
    total_pay_cents: 0,
    avg_hourly_pay_cents: null,
  };
  const allRows: SummaryRow[] = [];
  for (const run of window) {
    for (const r of run.rows) {
      allRows.push(r);
      agg.reg_hours += r.reg_hours;
      agg.reg_pay_cents += r.reg_pay_cents;
      agg.ot_hours += r.ot_hours;
      agg.ot_pay_cents += r.ot_pay_cents;
      agg.billed_hours += r.billed_hours ?? 0;
      agg.billed_pay_cents += r.billed_pay_cents ?? 0;
      agg.incentive_cents += r.incentive_cents ?? 0;
      if (r.bonus_cents !== null || r.spiff_cents !== null) {
        agg.bonus_pay_cents = (agg.bonus_pay_cents ?? 0) + (r.bonus_cents ?? 0) + (r.spiff_cents ?? 0);
      }
      agg.pto_hours += r.pto_hours;
      agg.pto_pay_cents += r.pto_pay_cents ?? 0;
      agg.training_hours += r.training_hours;
      agg.training_pay_cents += r.training_pay_cents ?? 0;
      agg.holiday_hours += r.holiday_hours;
      agg.holiday_pay_cents += r.holiday_pay_cents ?? 0;
      agg.bereavement_hours += r.bereavement_hours;
      agg.bereavement_pay_cents += r.bereavement_pay_cents ?? 0;
      agg.total_pay_cents += r.total_pay_cents;
    }
  }
  // Hours accumulate float noise (2dp inputs) — settle them back to 2dp.
  agg.reg_hours = round2(agg.reg_hours);
  agg.ot_hours = round2(agg.ot_hours);
  agg.billed_hours = round2(agg.billed_hours);
  agg.pto_hours = round2(agg.pto_hours);
  agg.training_hours = round2(agg.training_hours);
  agg.holiday_hours = round2(agg.holiday_hours);
  agg.bereavement_hours = round2(agg.bereavement_hours);
  agg.avg_hourly_pay_cents = avgHourlyPayCents(allRows);
  return agg;
}
