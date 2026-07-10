/**
 * Payroll summary layer — per-run summary rows (extraction requirement #6) and the
 * dashboard aggregates (requirement #7): the last-12-completed-runs card and the
 * null-safe average hourly pay (decision #9: clock-hours denominator, last-12 window),
 * plus the two per-employee variants (round-3 decision #25): WITHOUT-bonus for
 * everyone and WITH-bonus for the bonus families only (SA/office_manager/shop_foreman).
 * Contract: docs/qteklink/payroll-contract.md §summary.ts.
 *
 * PURE — rows in, rows/aggregates out. Voided runs are EXCLUDED from every aggregate
 * (round-2 decision #18); open runs are excluded from the "completed" window too (the
 * in-flight run is provisional by definition). "n/a" renders as null throughout:
 * a support-family row with no manual incentive entered has incentive_cents = null,
 * salaried leave-pay fields are null, and an aggregate window with zero clock hours
 * (or zero runs) has avg_hourly_pay_cents = null — never Infinity/NaN.
 */
import { round2, roundCents } from "./calc";
import type { Family, Role, RunStatus, SheetComputation, SummaryRow } from "./types";

/** One employee's computed sheet plus identity — the DAL assembles these per run. */
export interface EmployeeSheet {
  employee_id: string;
  display_name: string;
  role: Role;
  family: Family;
  sheet: SheetComputation;
}

const TECH_FAMILIES: readonly Family[] = ["technician", "shop_foreman"];

/**
 * Build the per-run summary rows (one per employee, sorted by display name).
 * Column applicability per family:
 *   - billed hours/pay: technician + shop_foreman only (null elsewhere);
 *   - incentive: null ("n/a") ONLY for a support row with no manual incentive entered —
 *     every other family always has a numeric incentive (0 when nothing was earned);
 *   - leave pay: null for the salaried family (hours still tracked).
 */
export function buildRunSummary(sheets: EmployeeSheet[]): SummaryRow[] {
  return sheets
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
}

// ── Dashboard aggregates (last-12-completed-runs card) ─────────────────────────

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
  /** Every employee (null only when the window has no rows / zero clock hours). */
  avg_hourly_without_bonus_cents: number | null;
  /** Non-null ONLY for the bonus families (SA / office_manager / shop_foreman). */
  avg_hourly_with_bonus_cents: number | null;
}

/**
 * The dashboard's two per-employee hourly averages (round-3 decision #25), over the
 * employee's rows from the last-12-COMPLETED-runs window (callers window via
 * {@link lastCompletedRuns}). `family` is the employee's CURRENT family — it gates
 * the with-bonus column, not the row math.
 */
export function employeeHourlyAverages(family: Family, rows: SummaryRow[]): EmployeeHourlyAverages {
  return {
    avg_hourly_without_bonus_cents: avgHourlyWithoutBonusCents(rows),
    avg_hourly_with_bonus_cents: WITH_BONUS_FAMILIES.includes(family) ? avgHourlyPayCents(rows) : null,
  };
}

/** The most recent `limit` COMPLETED runs (period_start descending). Voided and open
 *  runs never count. Exported so the dashboard can window per-employee rows too. */
export function lastCompletedRuns(runs: RunForAggregation[], limit = 12): RunForAggregation[] {
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
