/**
 * Payroll DAL — the technician/shop-foreman LEAVE-RATE basis (round-3 decision #24
 * + round-4 seed history + round-12 rolling-26 mean-of-per-period-rates;
 * docs/qteklink/payroll-contract.md §Round-3/Round-4 amendments +
 * payroll-rolling-avg-fulltime-plan-2026-07-12.md §A). Internal support module for
 * src/lib/dal/payroll-compute.ts, split out to honor the ~500-line file policy.
 * Import the public surface from "@/lib/dal/payroll".
 *
 * PTO/Holiday/Bereavement hours for billed-hours employees pay at the employee's
 * AVERAGE HOURLY RATE WITHOUT BONUS (Training stays at base hourly). Round-12: the
 * basis is the ARITHMETIC MEAN of the per-period rates over the rolling 26-period
 * window (NOT Σpay÷Σhours over 12). Each period contributes ONE rate:
 *   real run:  rate = (base + OT + billed + efficiency pay) ÷ (reg + OT hours)
 *              for that run's frozen snapshot (hours>0, else the period is SKIPPED);
 *   seed:      the stored per-period rate (pay_config.leave_rate_seed_history).
 * The window is a per-period MERGE of completed-run entries (frozen snapshots,
 * READ ONLY — completed runs are never recomputed) with pre-qteklink SEED entries
 * (a completed run WINS over a seed with the same period_start, so seeds age out as
 * real runs accumulate). Precedence: overrides.leave_rate_cents_per_hour
 * ('override') → the 26-window mean when at least one period contributed a finite
 * rate ('history') → pay_config.leave_rate_seed_cents_per_hour ('seed') → the
 * CURRENT run's ex-bonus ex-leave ratio ('current_run') → the base hourly rate
 * ('base_rate'). Each per-period rate AND the final mean round half-away-from-zero
 * to integer cents.
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

/** Per-employee merge window: the basis averages over at most this many periods
 *  (round-12: 26 = a year of bi-weekly periods). */
const LEAVE_RATE_WINDOW = 26;
/** Completed runs fetched (shop-wide) — MORE than the window so an employee who
 *  missed shop runs can still fill their own 26 (round-12: 52 = two years of
 *  bi-weekly periods, giving the 26-window real slack). */
const LEAVE_RATE_FETCH_RUNS = 52;

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

/** One period's contribution to the leave-rate basis — from a completed run's
 *  frozen snapshot OR (directly) from a pay_config seed entry. Round-12: each
 *  period contributes a single already-averaged RATE, not a pay+hours pair. */
export interface LeaveRateEntry {
  /** The period's start date (ISO YYYY-MM-DD) — the merge key. */
  periodStart: string;
  /** The period's average hourly pay in integer cents:
   *  (base + OT + billed + efficiency pay) ÷ (reg + OT hours), rounded
   *  half-away-from-zero. NULL when the period had zero worked hours (no finite
   *  rate) — such a period is skipped from the mean. */
  rateCents: number | null;
}

/** The merged per-employee basis window (mergeLeaveRateWindow output). Round-12:
 *  the arithmetic mean of the contributing per-period rates, plus provenance. */
export interface LeaveRateHistory {
  /** Mean of the contributing per-period rates over the window (integer cents,
   *  rounded once at the end). NULL when no period in the window contributed a
   *  finite rate — the 'history' branch then falls through. */
  meanRateCents: number | null;
  /** Real completed-run entries used in the window (round-4). */
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
 * {periodStart, rateCents} per run the employee appeared in, where rateCents is the
 * period's (base+OT+billed+efficiency pay) ÷ (reg+OT hours) rounded half-away-from-
 * zero, or NULL when the run had zero worked hours. Fetches up to 52 completed runs
 * so the per-employee 26-period merge window isn't starved when an employee missed
 * shop runs — windowing happens per employee in mergeLeaveRateWindow, not here.
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
      const hours = emp.sheet.reg_hours + emp.sheet.ot_hours;
      const list = byEmployee.get(emp.employee_id) ?? [];
      list.push({
        periodStart: run.period_start,
        rateCents:
          hours > 0 ? roundCents(leaveBasisPayCents(emp.sheet.week1, emp.sheet.week2) / hours) : null,
      });
      byEmployee.set(emp.employee_id, list);
    }
  }
  return byEmployee;
}

/**
 * PURE merge of one employee's completed-run entries with their pay_config seed
 * entries (round-4 + round-12): union keyed on period start, where a completed-run
 * entry WINS over a seed entry with the same period_start (real runs supersede the
 * seeded pre-qteklink figure for that period — INCLUDING a zero-hours run, whose
 * null rate then evicts the seed and contributes nothing); newest periods first;
 * capped at `window` (default 26). Returns the arithmetic MEAN of the contributing
 * per-period rates (rounded once) + how many of each kind of entry landed in the
 * window. meanRateCents is NULL when no windowed period contributed a finite rate.
 */
export function mergeLeaveRateWindow(
  runEntries: LeaveRateEntry[],
  seedEntries: LeaveRateSeedEntry[],
  window: number = LEAVE_RATE_WINDOW,
): LeaveRateHistory {
  const byPeriod = new Map<string, { entry: LeaveRateEntry; seeded: boolean }>();
  for (const s of seedEntries) {
    byPeriod.set(s.period_start, {
      entry: { periodStart: s.period_start, rateCents: s.avg_hourly_pay_cents },
      seeded: true,
    });
  }
  for (const r of runEntries) {
    byPeriod.set(r.periodStart, { entry: r, seeded: false }); // run beats same-period seed
  }
  const windowed = [...byPeriod.values()]
    .sort((a, b) => b.entry.periodStart.localeCompare(a.entry.periodStart))
    .slice(0, window);
  let runs = 0;
  let seededEntries = 0;
  let rateSum = 0;
  let rateCount = 0;
  for (const { entry, seeded } of windowed) {
    if (seeded) seededEntries += 1;
    else runs += 1;
    if (entry.rateCents !== null) {
      rateSum += entry.rateCents;
      rateCount += 1;
    }
  }
  return {
    meanRateCents: rateCount > 0 ? roundCents(rateSum / rateCount) : null,
    runs,
    seededEntries,
  };
}

export interface LeaveRateResolution {
  rateCents: number;
  source: LeaveRateSource;
  /** Completed-run entries in the employee's merged 26-period window. */
  windowRuns: number;
  /** Seed entries in the employee's merged 26-period window (round-4). */
  seededEntries: number;
}

/**
 * Resolve one technician/shop-foreman employee's PTO/Holiday/Bereavement rate
 * (round-3 #24 + round-4 seeds + round-12 rolling-26 mean). Precedence:
 * overrides.leave_rate_cents_per_hour ('override') → the merged run+seed window's
 * MEAN of per-period rates when at least one period contributed a finite rate
 * ('history') → pay_config.leave_rate_seed_cents_per_hour ('seed') → the CURRENT
 * run's ex-bonus ex-leave ratio ('current_run') → the base hourly rate
 * ('base_rate'). Every computed rate is rounded half-away-from-zero to integer
 * cents; a window with no finite per-period rate falls through. `prelim` is the
 * sheet computed WITHOUT a leave rate — its base/OT/billed/efficiency components
 * are leave-rate-independent, so it safely feeds the current-run basis.
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
  if (merged && merged.meanRateCents !== null) {
    return { rateCents: merged.meanRateCents, source: "history", windowRuns, seededEntries };
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
