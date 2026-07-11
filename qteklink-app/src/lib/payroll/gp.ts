/**
 * Month gross profit for the payroll bonus engine (contract:
 * docs/qteklink/payroll-contract.md §gp.ts; decisions #2/#3/#14/#17/#38 in
 * docs/qteklink/payroll-workbook-extraction-2026-07-10.md).
 *
 * PRIMARY composition (round-5 decision #38 — {@link monthGpFromTechCost}):
 *   GP with fees    = monthSales(incl fees, internal) − partsCost(#37) − QBO 6010 tech cost
 *   GP without fees = GP with fees − monthFees
 *
 * COMPUTED FALLBACK (the pre-#38 path, kept ONLY for when the QBO P&L fetch
 * throws — the DAL labels it source 'computed'):
 *   GP with fees    = monthSales(incl fees) − monthPartsCost − laborPayProrated
 *   GP without fees = GP with fees − monthFees
 * (SA tier QUALIFIES on GP-with-fees; the payout % applies to GP-WITHOUT-fees.
 * The sales figure feeding GP keeps fee revenue IN — it is NOT the #36
 * after-fees display value.)
 *
 * laborPayProrated — "technician pay" in GP (decision #2) = total pay of the
 * technician + shop_foreman + shop_support roles ONLY (decision #1 — office_support
 * is NOT counted), over every payroll run overlapping the month:
 *   - completed runs → totals from the frozen snapshot (caller extracts),
 *   - open runs      → caller-supplied LIVE computed totals (provisional),
 *   - voided runs    → SKIPPED entirely.
 * This module is PURE: the CALLER (DAL) sources each run's per-employee week totals
 * from the snapshot or the live compute; here we only role-filter, prorate, and sum.
 *
 * Straddle proration (decision #17, an approved approximation): per week of a run
 * (w1 = periodStart..+6, w2 = periodStart+7..+13), daily = weekHours ÷ 5 and the
 * month's share = daily × min(5, month-days in that week). OT hours prorate the SAME
 * way (not re-derived), so pay is linear in the factor — we prorate each week's PAY
 * by min(5, monthDays)/5 directly. A week with 6–7 month-days caps at 5/5 = the full
 * week; a Sun–Tue straddle (3 month-days) contributes 3/5 of that week's pay.
 *
 * Money: integer cents; each prorated week rounds half-away-from-zero to cents.
 */
import { addDaysIso, isIsoDate } from "@/lib/format";
import { roundCents } from "./derive";

/** Roles whose total pay counts as "technician pay" in GP (decision #1). */
export const GP_LABOR_ROLES = ["technician", "shop_foreman", "shop_support"] as const;

export type GpRunStatus = "open" | "completed" | "voided";

export interface GpRunEmployeePay {
  /** Role snapshot for the run (contract role values). Non-GP roles are ignored. */
  role: string;
  /** Total pay attributable to week 1 / week 2 of the run, in cents
   *  (incl. OT/PTO/etc. — "total pay incl. PTO" per decision #2). */
  totalPayW1Cents: number;
  totalPayW2Cents: number;
}

export interface GpRunInput {
  /** voided runs are skipped; completed/open both count (source of totals differs — see module doc). */
  status: GpRunStatus;
  /** ISO date of the run's first day (a Sunday); the run spans 14 days. */
  periodStart: string;
  employees: GpRunEmployeePay[];
}

export interface MonthGpInputs {
  monthSalesCents: number;
  monthPartsCostCents: number;
  laborPayProratedCents: number;
  monthFeesCents: number;
}

export interface MonthGp {
  gpWithFeesCents: number;
  gpWithoutFeesCents: number;
}

function assertMonth(month: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error(`payroll gp: month must be "YYYY-MM", got "${month}"`);
  }
}

/** Calendar days of the week [weekStart .. weekStart+6] that fall inside `month` ("YYYY-MM"). */
export function monthDaysInWeek(weekStart: string, month: string): number {
  if (!isIsoDate(weekStart)) throw new Error(`payroll gp: weekStart must be an ISO date, got "${weekStart}"`);
  assertMonth(month);
  let days = 0;
  for (let d = 0; d < 7; d++) {
    if (addDaysIso(weekStart, d).slice(0, 7) === month) days++;
  }
  return days;
}

/** Proration factor for one week: min(5, month-days in the week) ÷ 5 (decision #17). */
export function weekMonthShareFactor(weekStart: string, month: string): number {
  return Math.min(5, monthDaysInWeek(weekStart, month)) / 5;
}

/**
 * Prorated GP labor pay for `month` over the supplied runs. Voided runs are skipped;
 * only GP_LABOR_ROLES employees count; each week's role-filtered pay is multiplied by
 * that week's month-share factor and rounded to cents. Runs that don't overlap the
 * month contribute 0 (safe to pass extra runs). Empty input → 0.
 */
export function laborPayProratedCents(runs: GpRunInput[], month: string): number {
  assertMonth(month);
  const gpRoles = new Set<string>(GP_LABOR_ROLES);
  let total = 0;
  for (const run of runs) {
    if (run.status === "voided") continue;
    const w1Factor = weekMonthShareFactor(run.periodStart, month);
    const w2Factor = weekMonthShareFactor(addDaysIso(run.periodStart, 7), month);
    if (w1Factor === 0 && w2Factor === 0) continue;
    let w1Pay = 0;
    let w2Pay = 0;
    for (const e of run.employees) {
      if (!gpRoles.has(e.role)) continue;
      w1Pay += e.totalPayW1Cents;
      w2Pay += e.totalPayW2Cents;
    }
    total += roundCents(w1Pay * w1Factor) + roundCents(w2Pay * w2Factor);
  }
  return total;
}

/** Month GP, with and without fees (decisions #2/#3/#14). Pure integer-cents math. */
export function monthGpCents(inputs: MonthGpInputs): MonthGp {
  const gpWithFeesCents = inputs.monthSalesCents - inputs.monthPartsCostCents - inputs.laborPayProratedCents;
  return { gpWithFeesCents, gpWithoutFeesCents: gpWithFeesCents - inputs.monthFeesCents };
}

// ── Decision #38: the QBO-technician-cost GP composition (the PRIMARY path) ────

/** Which composition produced the month GP figures (snapshot + UI provenance). */
export type MonthGpSource = "qbo_tech_cost" | "computed";

export interface MonthGpTechCostInputs {
  /** Σ(totalSales − taxes) — fees INCLUDED. The INTERNAL GP base (#38), NOT the
   *  #36 after-fees display value. */
  monthSalesInclFeesCents: number;
  /** Decision #37 parts cost (per-line round(cost × qty) + sublet items). */
  monthPartsCostCents: number;
  /** QBO P&L COGS row "6010 Technicians" for the bonus month. */
  qboTechCostCents: number;
  monthFeesCents: number;
}

/**
 * Decision #38 — THE GP composition (supersedes #35's direct-QBO-GP): QBO
 * supplies ONLY the technician cost; sales/parts stay Tekmetric (#36/#37).
 *   GP with fees    = monthSales(incl fees) − partsCost − QBO 6010 tech cost
 *   GP without fees = GP with fees − monthFees
 * June 2026 proof: 286,290.76 − 69,370.90 − 48,740.72 = $168,179.14 with fees;
 * − 13,229.63 = $154,949.51 without. Pure integer-cents math.
 */
export function monthGpFromTechCost(inputs: MonthGpTechCostInputs): MonthGp {
  const gpWithFeesCents =
    inputs.monthSalesInclFeesCents - inputs.monthPartsCostCents - inputs.qboTechCostCents;
  return { gpWithFeesCents, gpWithoutFeesCents: gpWithFeesCents - inputs.monthFeesCents };
}

/** Convenience: prorate labor pay from runs, then compute both GP figures. */
export function monthGpFromRuns(
  runs: GpRunInput[],
  month: string,
  inputs: { monthSalesCents: number; monthPartsCostCents: number; monthFeesCents: number },
): MonthGp & { laborPayProratedCents: number } {
  const labor = laborPayProratedCents(runs, month);
  return { laborPayProratedCents: labor, ...monthGpCents({ ...inputs, laborPayProratedCents: labor }) };
}
