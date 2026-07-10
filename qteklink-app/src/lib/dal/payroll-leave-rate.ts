/**
 * Payroll DAL — the technician/shop-foreman LEAVE-RATE basis (round-3 decision #24
 * + round-4 seed history; docs/qteklink/payroll-contract.md §Round-3/Round-4
 * amendments). Internal support module for src/lib/dal/payroll-compute.ts, split
 * out to honor the ~500-line file policy. Import the public surface from
 * "@/lib/dal/payroll".
 *
 * PTO/Holiday/Bereavement hours for billed-hours employees pay at the employee's
 * AVERAGE HOURLY RATE WITHOUT BONUS (Training stays at base hourly). The basis:
 *   rate = Σ(base + OT + billed + efficiency pay) ÷ Σ(worked clock hours)
 * over the employee's last 12 periods. Round-4: the window is a per-period MERGE of
 * completed-run entries (frozen snapshots, READ ONLY — completed runs are never
 * recomputed) with pre-qteklink SEED entries from pay_config.leave_rate_seed_history
 * (a completed run WINS over a seed with the same period_start, so seeds age out as
 * real runs accumulate). Precedence: overrides.leave_rate_cents_per_hour ('override')
 * → merged window with hours ('history') → pay_config.leave_rate_seed_cents_per_hour
 * ('seed') → the CURRENT run's ex-bonus ex-leave ratio ('current_run') → the base
 * hourly rate ('base_rate'). Rounded half-away-from-zero to integer cents.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { roundCents } from "@/lib/payroll/derive";
import type {
  LeaveRateSeedEntry,
  LeaveRateSource,
  Overrides,
  SheetComputation,
} from "@/lib/payroll/types";

/** Per-employee merge window: the basis averages over at most this many periods. */
const LEAVE_RATE_WINDOW = 12;
/** Completed runs fetched (shop-wide) — more than the window so an employee who
 *  missed shop runs still fills their own 12 (26 = a year of bi-weekly periods). */
const LEAVE_RATE_FETCH_RUNS = 26;

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

/** One period's leave-rate basis figures — from a completed run's frozen snapshot
 *  OR (converted) from a pay_config seed entry. */
export interface LeaveRateEntry {
  /** The period's start date (ISO YYYY-MM-DD) — the merge key. */
  periodStart: string;
  /** Σ base + OT + billed + efficiency pay (bonuses/spiffs/leave excluded). */
  payCents: number;
  /** Σ worked clock hours (reg + OT). */
  hours: number;
}

/** The merged per-employee basis window (mergeLeaveRateWindow output). */
export interface LeaveRateHistory {
  /** Σ payCents across the window entries. */
  payCents: number;
  /** Σ hours across the window entries. */
  hours: number;
  /** Real completed-run entries used in the window. */
  runs: number;
  /** Seed entries used in the window (round-4). */
  seededEntries: number;
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
 * Per-employee leave-rate basis ENTRIES over the shop's most recent completed runs'
 * frozen snapshots (READ ONLY — completed runs are never recomputed): one
 * {periodStart, payCents, hours} per run the employee appeared in. Fetches up to
 * 26 completed runs so the per-employee 12-period merge window isn't starved when
 * an employee missed shop runs — windowing happens per employee in
 * mergeLeaveRateWindow, not here.
 */
export async function fetchLeaveRateHistory(shopId: number): Promise<Map<string, LeaveRateEntry[]>> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_payroll_runs")
    .select("id, period_start, snapshot")
    .eq("shop_id", shopId)
    .eq("status", "completed")
    .order("period_start", { ascending: false })
    .limit(LEAVE_RATE_FETCH_RUNS);
  if (error) throw new Error(`payroll DAL: leave-rate history fetch failed: ${error.message}`);
  const byEmployee = new Map<string, LeaveRateEntry[]>();
  for (const run of (data ?? []) as { id: string; period_start: string; snapshot: unknown }[]) {
    const snap = run.snapshot as { employees?: unknown[] } | null;
    if (!Array.isArray(snap?.employees)) continue;
    for (const raw of snap.employees) {
      const emp = LeaveBasisEmployeeSchema.parse(raw);
      const list = byEmployee.get(emp.employee_id) ?? [];
      list.push({
        periodStart: run.period_start,
        payCents: leaveBasisPayCents(emp.sheet.week1, emp.sheet.week2),
        hours: emp.sheet.reg_hours + emp.sheet.ot_hours,
      });
      byEmployee.set(emp.employee_id, list);
    }
  }
  return byEmployee;
}

/**
 * PURE merge of one employee's completed-run entries with their pay_config seed
 * entries (round-4): union keyed on period start, where a completed-run entry WINS
 * over a seed entry with the same period_start (real runs supersede the seeded
 * pre-qteklink figure for that period); newest periods first; capped at `window`
 * (default 12). Returns the window's summed basis + how many of each kind were used.
 */
export function mergeLeaveRateWindow(
  runEntries: LeaveRateEntry[],
  seedEntries: LeaveRateSeedEntry[],
  window: number = LEAVE_RATE_WINDOW,
): LeaveRateHistory {
  const byPeriod = new Map<string, { entry: LeaveRateEntry; seeded: boolean }>();
  for (const s of seedEntries) {
    byPeriod.set(s.period_start, {
      entry: { periodStart: s.period_start, payCents: s.work_pay_cents, hours: s.clock_hours },
      seeded: true,
    });
  }
  for (const r of runEntries) {
    byPeriod.set(r.periodStart, { entry: r, seeded: false }); // run beats same-period seed
  }
  const windowed = [...byPeriod.values()]
    .sort((a, b) => b.entry.periodStart.localeCompare(a.entry.periodStart))
    .slice(0, window);
  const merged: LeaveRateHistory = { payCents: 0, hours: 0, runs: 0, seededEntries: 0 };
  for (const { entry, seeded } of windowed) {
    merged.payCents += entry.payCents;
    merged.hours += entry.hours;
    if (seeded) merged.seededEntries += 1;
    else merged.runs += 1;
  }
  return merged;
}

export interface LeaveRateResolution {
  rateCents: number;
  source: LeaveRateSource;
  /** Completed-run entries in the employee's merged 12-period window. */
  windowRuns: number;
  /** Seed entries in the employee's merged 12-period window (round-4). */
  seededEntries: number;
}

/**
 * Resolve one technician/shop-foreman employee's PTO/Holiday/Bereavement rate
 * (round-3 #24 + round-4 seeds). Precedence: overrides.leave_rate_cents_per_hour
 * ('override') → the merged run+seed window basis when it has hours ('history') →
 * pay_config.leave_rate_seed_cents_per_hour ('seed') → the CURRENT run's ex-bonus
 * ex-leave ratio ('current_run') → the base hourly rate ('base_rate'). Every
 * computed rate is Σ(base+OT+billed+efficiency pay) ÷ Σ(worked clock hours),
 * rounded half-away-from-zero to integer cents; a zero-hours denominator falls
 * through. `prelim` is the sheet computed WITHOUT a leave rate — its base/OT/
 * billed/efficiency components are leave-rate-independent, so it safely feeds the
 * current-run basis.
 */
export function resolveLeaveRate(
  overrides: Overrides,
  merged: LeaveRateHistory | undefined,
  seedRateCents: number | null | undefined,
  prelim: SheetComputation,
  baseHourlyRateCents: number,
): LeaveRateResolution {
  const windowRuns = merged?.runs ?? 0;
  const seededEntries = merged?.seededEntries ?? 0;
  const overrideValue = overrides.leave_rate_cents_per_hour?.value;
  if (overrideValue !== undefined) {
    return { rateCents: roundCents(overrideValue), source: "override", windowRuns, seededEntries };
  }
  if (merged && merged.hours > 0) {
    return {
      rateCents: roundCents(merged.payCents / merged.hours),
      source: "history",
      windowRuns,
      seededEntries,
    };
  }
  if (seedRateCents !== null && seedRateCents !== undefined) {
    return { rateCents: roundCents(seedRateCents), source: "seed", windowRuns, seededEntries };
  }
  const currentHours = prelim.total_hours; // worked reg + OT only
  if (currentHours > 0) {
    const currentPay = leaveBasisPayCents(prelim.week1, prelim.week2);
    return {
      rateCents: roundCents(currentPay / currentHours),
      source: "current_run",
      windowRuns,
      seededEntries,
    };
  }
  return { rateCents: baseHourlyRateCents, source: "base_rate", windowRuns, seededEntries };
}
