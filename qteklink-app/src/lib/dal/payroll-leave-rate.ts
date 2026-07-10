/**
 * Payroll DAL — the technician/shop-foreman LEAVE-RATE basis (round-3 decision #24;
 * docs/qteklink/payroll-contract.md §Round-3 amendments). Internal support module
 * for src/lib/dal/payroll-compute.ts, split out to honor the ~500-line file policy.
 * Import the public surface from "@/lib/dal/payroll".
 *
 * PTO/Holiday/Bereavement hours for billed-hours employees pay at the employee's
 * AVERAGE HOURLY RATE WITHOUT BONUS (Training stays at base hourly). The basis:
 *   rate = Σ(base + OT + billed + efficiency pay) ÷ Σ(worked clock hours)
 * over the LAST 12 COMPLETED runs' frozen snapshots (READ ONLY — completed runs are
 * never recomputed); fallback with no history = the same ratio over the CURRENT run
 * (ex-bonus, ex-leave); overrides.leave_rate_cents_per_hour wins; a zero-hours
 * denominator falls through to the base hourly rate ('base_rate'). Rounded
 * half-away-from-zero to integer cents.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { roundCents } from "@/lib/payroll/derive";
import type { LeaveRateSource, Overrides, SheetComputation } from "@/lib/payroll/types";

const LEAVE_RATE_WINDOW = 12;

/** Tolerant snapshot read for the leave-rate basis: identity + the ex-bonus
 *  ex-leave pay components + worked hours (older snapshot versions may add fields). */
const LeaveBasisWeekSchema = z.object({
  base_pay_cents: z.number(),
  ot_pay_cents: z.number(),
  billed_pay_cents: z.number().nullable(),
  efficiency_pay_cents: z.number().nullable(),
});
const LeaveBasisEmployeeSchema = z.object({
  employee_id: z.string(),
  sheet: z.object({
    reg_hours: z.number(),
    ot_hours: z.number(),
    week1: LeaveBasisWeekSchema,
    week2: LeaveBasisWeekSchema,
  }),
});

export interface LeaveRateHistory {
  /** Σ base + OT + billed + efficiency pay (bonuses/spiffs/leave excluded). */
  payCents: number;
  /** Σ worked clock hours (reg + OT). */
  hours: number;
  /** Completed runs in the window that contained this employee. */
  runs: number;
}

type LeaveBasisWeek = z.infer<typeof LeaveBasisWeekSchema>;

function leaveBasisPayCents(w1: LeaveBasisWeek, w2: LeaveBasisWeek): number {
  return (
    w1.base_pay_cents +
    w1.ot_pay_cents +
    (w1.billed_pay_cents ?? 0) +
    (w1.efficiency_pay_cents ?? 0) +
    w2.base_pay_cents +
    w2.ot_pay_cents +
    (w2.billed_pay_cents ?? 0) +
    (w2.efficiency_pay_cents ?? 0)
  );
}

/**
 * Per-employee leave-rate basis sums over the shop's last 12 COMPLETED runs' frozen
 * snapshots (READ ONLY — completed runs are never recomputed): Σ(base+OT+billed+
 * efficiency pay) and Σ(worked clock hours) per employee_id, plus the count of
 * window runs the employee appeared in.
 */
export async function fetchLeaveRateHistory(shopId: number): Promise<Map<string, LeaveRateHistory>> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_payroll_runs")
    .select("id, period_start, snapshot")
    .eq("shop_id", shopId)
    .eq("status", "completed")
    .order("period_start", { ascending: false })
    .limit(LEAVE_RATE_WINDOW);
  if (error) throw new Error(`payroll DAL: leave-rate history fetch failed: ${error.message}`);
  const byEmployee = new Map<string, LeaveRateHistory>();
  for (const run of (data ?? []) as { id: string; snapshot: unknown }[]) {
    const snap = run.snapshot as { employees?: unknown[] } | null;
    if (!Array.isArray(snap?.employees)) continue;
    for (const raw of snap.employees) {
      const emp = LeaveBasisEmployeeSchema.parse(raw);
      const acc = byEmployee.get(emp.employee_id) ?? { payCents: 0, hours: 0, runs: 0 };
      acc.payCents += leaveBasisPayCents(emp.sheet.week1, emp.sheet.week2);
      acc.hours += emp.sheet.reg_hours + emp.sheet.ot_hours;
      acc.runs += 1;
      byEmployee.set(emp.employee_id, acc);
    }
  }
  return byEmployee;
}

export interface LeaveRateResolution {
  rateCents: number;
  source: LeaveRateSource;
  /** Completed runs in the 12-run window that contained the employee. */
  windowRuns: number;
}

/**
 * Resolve one technician/shop-foreman employee's PTO/Holiday/Bereavement rate
 * (round-3 #24). Precedence: overrides.leave_rate_cents_per_hour ('override') →
 * last-12-completed-runs basis ('history') → the CURRENT run's ex-bonus ex-leave
 * ratio ('current_run') → the base hourly rate ('base_rate'). Every rate is
 * Σ(base+OT+billed+efficiency pay) ÷ Σ(worked clock hours), rounded
 * half-away-from-zero to integer cents; a zero-hours denominator falls through.
 * `prelim` is the sheet computed WITHOUT a leave rate — its base/OT/billed/
 * efficiency components are leave-rate-independent, so it safely feeds the basis.
 */
export function resolveLeaveRate(
  overrides: Overrides,
  history: LeaveRateHistory | undefined,
  prelim: SheetComputation,
  baseHourlyRateCents: number,
): LeaveRateResolution {
  const windowRuns = history?.runs ?? 0;
  const overrideValue = overrides.leave_rate_cents_per_hour?.value;
  if (overrideValue !== undefined) {
    return { rateCents: roundCents(overrideValue), source: "override", windowRuns };
  }
  if (history && history.hours > 0) {
    return { rateCents: roundCents(history.payCents / history.hours), source: "history", windowRuns };
  }
  const currentHours = prelim.total_hours; // worked reg + OT only
  if (currentHours > 0) {
    const currentPay = leaveBasisPayCents(prelim.week1, prelim.week2);
    return { rateCents: roundCents(currentPay / currentHours), source: "current_run", windowRuns };
  }
  return { rateCents: baseHourlyRateCents, source: "base_rate", windowRuns };
}
