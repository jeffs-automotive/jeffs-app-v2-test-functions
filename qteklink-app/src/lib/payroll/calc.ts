/**
 * Payroll calc engine — PURE functions, no I/O (contract:
 * docs/qteklink/payroll-contract.md §calc.ts). Formula source of truth:
 * docs/qteklink/payroll-workbook-extraction-2026-07-10.md §Pay math
 * (+ DECISIONS #2/#3/#5/#6/#16/#17), replicated formula-for-formula and locked by
 * the golden workbook fixtures in __tests__/calc.golden.test.ts.
 *
 * Clock-hours semantics (decision #6 — Chris's deliberate change from the workbook's
 * separate manual-OT entry): the office manager enters TOTAL worked clock hours per
 * week; `splitClock` derives reg = min(40, total), OT = max(0, total − 40) at 1.5×.
 * A consequence: OT cannot be granted on a <40-hour week. PTO/Holiday/Bereavement/
 * Training hours NEVER trigger OT (decision #16) — only worked clock feeds the split.
 *
 * Money: integer cents. Each OUTPUT component is rounded half-away-from-zero to cents
 * from EXACT float math (matching Excel, which sums unrounded floats) — components are
 * never summed post-rounding. Hours: 2dp. Ratio metrics return null (never Infinity/
 * NaN) on zero denominators.
 *
 * Leave pay (round-3 decision #24): technician + shop_foreman pay PTO/Holiday/
 * Bereavement at `derived.leave_rate_cents_per_hour` (the avg-hourly-WITHOUT-bonus
 * basis, resolved by the DAL — history → current run → override → base rate) and
 * Training at the base hourly rate; when no leave rate is supplied (legacy path,
 * golden fixtures) all leave falls back to each week's hourly rate. office_manager +
 * support pay ALL leave at the week's hourly rate; the salaried family
 * (service_advisor) tracks hours only — leave-pay fields are null there.
 *
 * `rates_w2` (run-level pay_config) applies a mid-period rate change: week 1 always
 * uses the base fields, week 2 uses the override when present.
 */
import type {
  DerivedInputs,
  Family,
  LeaveRateSource,
  OfficeManagerPayConfig,
  PayConfigFor,
  ServiceAdvisorPayConfig,
  SheetComputation,
  SheetEntries,
  ShopForemanPayConfig,
  ShopHourGoalSource,
  SupportPayConfig,
  TechnicianPayConfig,
  WeekComputation,
  WeekSplit,
} from "./types";

/** Bumped whenever a formula changes; pinned into every run snapshot.
 *  v2 (2026-07-10 round-3 amendments): SA tier ladder reordered to the beat-last-year
 *  semantics with ≥ GP comparisons (#22), and technician/shop_foreman PTO/Holiday/
 *  Bereavement pay moved to the avg-hourly leave-rate basis (#24).
 *  v3 (2026-07-11 round-5 #32): the shop-foreman hour goal consumes the DAL-derived
 *  prior-year same-month shop hours (override → prior-year → pay_config fallback);
 *  the sheet echoes the effective goal + its source.
 *  v4 (2026-07-11 round-5 #36/#37/#38 — formula-INPUT changes, pinned like v3):
 *  month sales (current + the prior-year auto goal) display AFTER fees; parts
 *  cost = per-line round(cost × qty) over authorized jobs + sublet items; GP =
 *  sales(incl fees, internal) − parts − QBO 6010 technician cost, with the
 *  computed prorated-labor path only as the labeled fallback when QBO fails.
 *  v5 (2026-07-11 round-9 #44/#45): per-week efficiency guard — a week pays NO
 *  efficiency hours/pay unless its worked clock hours are STRICTLY > 1 (#44,
 *  technician + shop_foreman); and month sales (display + SA tier check + the
 *  prior-year auto goal) revert to the fee-INCLUSIVE Σ(totalSales − taxes)
 *  (#45 — supersedes #36, restores the #28 sales number; the with/without-fees
 *  split stays GP-only per #38). The v5 recompute also backfills the round-9
 *  #46 summary-totals block into open runs' live snapshots.
 *  v6: totals gain cost_per_billed_hour_cents (round-9 addendum — the bump
 *  forces the live-snapshot recompute that backfills the new metric).
 *  v7 (2026-07-12 round-10 #49 — a formula-INPUT change like v4): the
 *  office-manager bonus base = month sales BEFORE fees (the DAL feeds
 *  sales − fees as her effective month_sales_cents); SA tier check, display,
 *  and the prior-year auto goal stay fee-inclusive per #45. The engine below
 *  is unchanged — the bump rolls the corrected input into live snapshots. */
export const CALC_VERSION = 7;

// ── Rounding (same semantics as derive.ts's roundCents — kept local so calc.ts
//    stays free of the fetcher module's import graph) ──────────────────────────

/** Round half AWAY FROM ZERO to an integer (cents). */
export function roundCents(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/** Hours → 2dp (half away from zero; also absorbs float noise like 12.530000000001). */
export function round2(x: number): number {
  return roundCents(x * 100) / 100;
}

function round4(x: number): number {
  return roundCents(x * 10_000) / 10_000;
}

const num = (x: number | null | undefined): number => x ?? 0;

// ── The splitter (decision #6) ─────────────────────────────────────────────────

/**
 * Split one week's TOTAL worked clock hours into regular + overtime:
 * reg = min(40, total), ot = max(0, total − 40). Pure per-week math — PTO/Holiday/
 * etc. never enter (decision #16). Both parts are 2dp-rounded so float noise at the
 * 40-hour boundary can't fabricate phantom OT.
 */
export function splitClock(totalClockHours: number): WeekSplit {
  return {
    reg: round2(Math.min(40, totalClockHours)),
    ot: round2(Math.max(0, totalClockHours - 40)),
  };
}

export interface ComputeSheetOptions {
  /**
   * Explicit per-week reg/OT split, bypassing `splitClock`. This is the seam the
   * golden tests use: the workbook fixtures carry the OLD manual-OT model (clock =
   * reg-only + a separate OT entry), so they feed the recorded (clock, ot) pair
   * straight into the pay formulas. Production callers omit it.
   */
  presplit?: { w1: WeekSplit; w2: WeekSplit };
}

// ── Internal helpers ───────────────────────────────────────────────────────────

interface LeaveHours {
  pto: number;
  holiday: number;
  bereavement: number;
  training: number;
}

const LEAVE_KEYS = ["pto", "holiday", "bereavement", "training"] as const;

function leaveHoursForWeek(entries: SheetEntries, week: 1 | 2): LeaveHours {
  return week === 1
    ? {
        pto: num(entries.pto_w1),
        holiday: num(entries.holiday_w1),
        bereavement: num(entries.bereavement_w1),
        training: num(entries.training_w1),
      }
    : {
        pto: num(entries.pto_w2),
        holiday: num(entries.holiday_w2),
        bereavement: num(entries.bereavement_w2),
        training: num(entries.training_w2),
      };
}

function resolveSplits(entries: SheetEntries, options?: ComputeSheetOptions): [WeekSplit, WeekSplit] {
  if (options?.presplit) return [options.presplit.w1, options.presplit.w2];
  return [splitClock(num(entries.clock_hours_w1)), splitClock(num(entries.clock_hours_w2))];
}

/** Everything computed for one week of an HOURLY-family sheet, in EXACT (unrounded) cents. */
interface HourlyWeekExact {
  reg: number;
  ot: number;
  basePay: number;
  otPay: number;
  billedHours: number | null;
  effHours: number | null;
  billedPay: number | null;
  effPay: number | null;
  leavePay: LeaveHours; // pay per category, exact cents
}

function hourlyWeekExact(
  hourlyRateCents: number,
  split: WeekSplit,
  leave: LeaveHours,
  billed: { billedRateCents: number; billedHours: number } | null,
  /** Rate for PTO/Holiday/Bereavement (round-3 #24); Training ALWAYS pays the hourly
   *  rate. Defaults to the hourly rate (office_manager/support + the legacy path). */
  ptoHolBerRateCents: number = hourlyRateCents,
): HourlyWeekExact {
  const basePay = hourlyRateCents * split.reg;
  const otPay = hourlyRateCents * 1.5 * split.ot;
  let billedHours: number | null = null;
  let effHours: number | null = null;
  let billedPay: number | null = null;
  let effPay: number | null = null;
  if (billed) {
    billedHours = billed.billedHours;
    // Workbook: Efficiency = max(0, billed − (clock + OT)) — reg+ot IS total worked clock.
    // Round-9 #44 EFFICIENCY GUARD (per WEEK, matching the formula's grain): a week
    // pays NO efficiency unless its worked clock hours are STRICTLY > 1 — near-zero
    // clock + real billed hours would otherwise fabricate huge phantom efficiency
    // (billed − ~0). Exactly 1.00 clock hour still pays none; billed pay is untouched.
    const workedClock = split.reg + split.ot;
    effHours = workedClock > 1 ? Math.max(0, billed.billedHours - workedClock) : 0;
    billedPay = billed.billedRateCents * billed.billedHours;
    effPay = hourlyRateCents * effHours;
  }
  return {
    reg: split.reg,
    ot: split.ot,
    basePay,
    otPay,
    billedHours,
    effHours,
    billedPay,
    effPay,
    leavePay: {
      pto: leave.pto * ptoHolBerRateCents,
      holiday: leave.holiday * ptoHolBerRateCents,
      bereavement: leave.bereavement * ptoHolBerRateCents,
      training: leave.training * hourlyRateCents,
    },
  };
}

function weekComputation(w: HourlyWeekExact): WeekComputation {
  const leave = w.leavePay.pto + w.leavePay.holiday + w.leavePay.bereavement + w.leavePay.training;
  return {
    reg_hours: round2(w.reg),
    ot_hours: round2(w.ot),
    base_pay_cents: roundCents(w.basePay),
    ot_pay_cents: roundCents(w.otPay),
    billed_hours: w.billedHours === null ? null : round2(w.billedHours),
    efficiency_hours: w.effHours === null ? null : round2(w.effHours),
    billed_pay_cents: w.billedPay === null ? null : roundCents(w.billedPay),
    efficiency_pay_cents: w.effPay === null ? null : roundCents(w.effPay),
    leave_pay_cents: roundCents(leave),
    total_pay_cents: roundCents(w.basePay + w.otPay + (w.billedPay ?? 0) + (w.effPay ?? 0) + leave),
  };
}

/** Shared skeleton for the four hourly families (all but service_advisor). */
function hourlySheet(
  family: Family,
  weeks: [HourlyWeekExact, HourlyWeekExact],
  extra: {
    bonusCents: number | null; // exact (unrounded); shop_foreman / office_manager
    spiffCents: number | null;
    manualIncentiveCents: number | null; // support echo (null = none entered)
    incentiveExact: number; // family rollup, exact cents
    withMetrics: boolean; // technician-family layouts show metrics
    leaveRateCents: number | null; // round-3 #24 — technician/shop_foreman only
    leaveRateSource: LeaveRateSource | null;
    shopHourGoal: number | null; // round-5 #32 — shop_foreman only
    shopHourGoalSource: ShopHourGoalSource | null;
  },
  leaveHoursTotals: LeaveHours,
): SheetComputation {
  const [w1, w2] = weeks;
  const regHours = w1.reg + w2.reg;
  const otHours = w1.ot + w2.ot;
  const totalHours = regHours + otHours;
  const regTotal = w1.basePay + w1.otPay + w2.basePay + w2.otPay;
  const leaveTotals = {
    pto: w1.leavePay.pto + w2.leavePay.pto,
    holiday: w1.leavePay.holiday + w2.leavePay.holiday,
    bereavement: w1.leavePay.bereavement + w2.leavePay.bereavement,
    training: w1.leavePay.training + w2.leavePay.training,
  };
  const leaveTotal = LEAVE_KEYS.reduce((s, k) => s + leaveTotals[k], 0);
  const totalPay = regTotal + extra.incentiveExact + leaveTotal;
  const billedTotal = w1.billedHours === null && w2.billedHours === null ? null : num(w1.billedHours) + num(w2.billedHours);
  return {
    family,
    week1: weekComputation(w1),
    week2: weekComputation(w2),
    reg_hours: round2(regHours),
    ot_hours: round2(otHours),
    total_hours: round2(totalHours),
    pto_hours: round2(leaveHoursTotals.pto),
    holiday_hours: round2(leaveHoursTotals.holiday),
    bereavement_hours: round2(leaveHoursTotals.bereavement),
    training_hours: round2(leaveHoursTotals.training),
    reg_total_cents: roundCents(regTotal),
    billed_hours_total: billedTotal === null ? null : round2(billedTotal),
    bonus_cents: extra.bonusCents === null ? null : roundCents(extra.bonusCents),
    shop_hour_goal: extra.shopHourGoal,
    shop_hour_goal_source: extra.shopHourGoalSource,
    spiff_cents: extra.spiffCents === null ? null : roundCents(extra.spiffCents),
    manual_incentive_cents: extra.manualIncentiveCents,
    incentive_cents: roundCents(extra.incentiveExact),
    pto_pay_cents: roundCents(leaveTotals.pto),
    training_pay_cents: roundCents(leaveTotals.training),
    holiday_pay_cents: roundCents(leaveTotals.holiday),
    bereavement_pay_cents: roundCents(leaveTotals.bereavement),
    leave_rate_cents_per_hour: extra.leaveRateCents,
    leave_rate_source: extra.leaveRateSource,
    total_pay_cents: roundCents(totalPay),
    metrics: extra.withMetrics
      ? {
          pay_per_clock_hour_cents: totalHours > 0 ? roundCents(totalPay / totalHours) : null,
          cost_per_billed_hour_cents:
            billedTotal !== null && billedTotal > 0 ? roundCents(totalPay / billedTotal) : null,
          productivity: billedTotal !== null && totalHours > 0 ? round4(billedTotal / totalHours) : null,
        }
      : { pay_per_clock_hour_cents: null, cost_per_billed_hour_cents: null, productivity: null },
  };
}

function leaveTotalsFromEntries(entries: SheetEntries): LeaveHours {
  const l1 = leaveHoursForWeek(entries, 1);
  const l2 = leaveHoursForWeek(entries, 2);
  return {
    pto: l1.pto + l2.pto,
    holiday: l1.holiday + l2.holiday,
    bereavement: l1.bereavement + l2.bereavement,
    training: l1.training + l2.training,
  };
}

// ── Family implementations ─────────────────────────────────────────────────────

function computeTechnicianFamily(
  family: "technician" | "shop_foreman",
  config: TechnicianPayConfig | ShopForemanPayConfig,
  entries: SheetEntries,
  derived: DerivedInputs,
  options?: ComputeSheetOptions,
): SheetComputation {
  const [s1, s2] = resolveSplits(entries, options);
  const hourlyW1 = config.hourly_rate_cents;
  const hourlyW2 = config.rates_w2?.hourly_rate_cents ?? config.hourly_rate_cents;
  const billedRateW1 = config.billed_rate_cents;
  const billedRateW2 = config.rates_w2?.billed_rate_cents ?? config.billed_rate_cents;
  // Leave-rate basis (round-3 #24): PTO/Hol/Ber pay at the supplied avg-hourly rate
  // (one rate, both weeks); Training pays the week's base hourly rate. No rate
  // supplied (legacy path / golden fixtures) → each week's hourly rate.
  const leaveRate = derived.leave_rate_cents_per_hour ?? null;
  const leaveSource: LeaveRateSource | null =
    leaveRate === null ? null : (derived.leave_rate_source ?? "base_rate");
  const w1 = hourlyWeekExact(
    hourlyW1,
    s1,
    leaveHoursForWeek(entries, 1),
    { billedRateCents: billedRateW1, billedHours: num(derived.billed_hours_w1) },
    leaveRate ?? hourlyW1,
  );
  const w2 = hourlyWeekExact(
    hourlyW2,
    s2,
    leaveHoursForWeek(entries, 2),
    { billedRateCents: billedRateW2, billedHours: num(derived.billed_hours_w2) },
    leaveRate ?? hourlyW2,
  );
  // Foreman cliff bonus (extraction §Shop Foreman): pays on ALL shop hours once the
  // goal is exceeded (shopHours × rate), NOT on the excess. Strictly-greater-than —
  // round-5 #32 keeps it (beating last year by ≥ 0.01h at 2dp ≡ strict >). The goal
  // itself is the DAL-derived prior-year same-month shop hours (override already
  // applied upstream); pay_config.shop_hour_goal is the legacy fallback when the
  // derivation had no data (or on non-bonus runs, where the bonus is 0 anyway).
  let bonusExact: number | null = null;
  let shopHourGoal: number | null = null;
  let shopHourGoalSource: ShopHourGoalSource | null = null;
  if (family === "shop_foreman") {
    const fc = config as ShopForemanPayConfig;
    shopHourGoal = derived.shop_hour_goal ?? fc.shop_hour_goal;
    shopHourGoalSource =
      derived.shop_hour_goal != null ? (derived.shop_hour_goal_source ?? "prior_year") : "config";
    const shopHours = num(derived.shop_hours);
    bonusExact = shopHours > shopHourGoal ? shopHours * fc.shop_hour_bonus_cents_per_hour : 0;
  }
  const incentiveExact =
    num(w1.billedPay) + num(w2.billedPay) + num(w1.effPay) + num(w2.effPay) + num(bonusExact);
  return hourlySheet(
    family,
    [w1, w2],
    {
      bonusCents: bonusExact,
      spiffCents: null,
      manualIncentiveCents: null,
      incentiveExact,
      withMetrics: true,
      leaveRateCents: leaveRate,
      leaveRateSource: leaveSource,
      shopHourGoal,
      shopHourGoalSource,
    },
    leaveTotalsFromEntries(entries),
  );
}

function computeServiceAdvisor(
  config: ServiceAdvisorPayConfig,
  entries: SheetEntries,
  derived: DerivedInputs,
  options?: ComputeSheetOptions,
): SheetComputation {
  const [s1, s2] = resolveSplits(entries, options);
  const salaryW1 = config.weekly_salary_cents;
  const salaryW2 = config.rates_w2?.weekly_salary_cents ?? config.weekly_salary_cents;
  // Spiff (decision #15 rollup happens upstream): spiff_count × spiff_amount_cents.
  const spiffExact = num(derived.spiff_count) * config.spiff_amount_cents;
  // Tier bonus (round-3 decision #22 — supersedes the workbook's strict-> nesting):
  // the TIER qualifies on "beat last year" (sales vs the auto-derived prior-year
  // sales goal, STRICTLY >) + GP-WITH-fees vs the GP goals (≥); the payout % applies
  // to GP-WITHOUT-fees.
  //   beat AND gpWith ≥ gp2      → tier3
  //   beat AND gpWith ≥ gp1      → tier2
  //   NOT beat AND gpWith ≥ gp1  → tier1  (clearing gp2 without the beat is STILL tier1)
  //   else 0                     (beat with gpWith < gp1 pays NOTHING — gp1 is a hard floor)
  // Chris's worked example: gpWith exactly at goal2 ⇒ tier3; payout = gpWithout × pct.
  // The sales goal arrives via derived.sales_goal_cents (prior-year same-month
  // subtotal, override already applied by the DAL — round-3 #23);
  // pay_config.sales_goal_cents is the legacy manual fallback (derivation had no data).
  const sales = num(derived.month_sales_cents);
  const gpWith = num(derived.month_gp_with_fees_cents);
  const gpWithout = num(derived.month_gp_without_fees_cents);
  const salesGoal = derived.sales_goal_cents ?? config.sales_goal_cents;
  const beat = sales > salesGoal;
  let bonusExact = 0;
  if (beat && gpWith >= config.gp_goal_2_cents) {
    bonusExact = gpWithout * config.tier3_pct;
  } else if (beat && gpWith >= config.gp_goal_1_cents) {
    bonusExact = gpWithout * config.tier2_pct;
  } else if (!beat && gpWith >= config.gp_goal_1_cents) {
    bonusExact = gpWithout * config.tier1_pct;
  }
  const incentiveExact = spiffExact + bonusExact;
  const regTotal = salaryW1 + salaryW2;
  const totalPay = regTotal + incentiveExact;
  const leaveHours = leaveTotalsFromEntries(entries);
  const week = (sal: number, split: WeekSplit): WeekComputation => ({
    reg_hours: round2(split.reg),
    ot_hours: round2(split.ot),
    base_pay_cents: roundCents(sal),
    ot_pay_cents: 0, // salaried — OT hours are tracked, never paid (workbook parity)
    billed_hours: null,
    efficiency_hours: null,
    billed_pay_cents: null,
    efficiency_pay_cents: null,
    leave_pay_cents: null, // hours-only for salaried
    total_pay_cents: roundCents(sal),
  });
  const regHours = s1.reg + s2.reg;
  const otHours = s1.ot + s2.ot;
  return {
    family: "service_advisor",
    week1: week(salaryW1, s1),
    week2: week(salaryW2, s2),
    reg_hours: round2(regHours),
    ot_hours: round2(otHours),
    total_hours: round2(regHours + otHours),
    pto_hours: round2(leaveHours.pto),
    holiday_hours: round2(leaveHours.holiday),
    bereavement_hours: round2(leaveHours.bereavement),
    training_hours: round2(leaveHours.training),
    reg_total_cents: roundCents(regTotal),
    billed_hours_total: null,
    bonus_cents: roundCents(bonusExact),
    shop_hour_goal: null,
    shop_hour_goal_source: null,
    spiff_cents: roundCents(spiffExact),
    manual_incentive_cents: null,
    incentive_cents: roundCents(incentiveExact),
    pto_pay_cents: null,
    training_pay_cents: null,
    holiday_pay_cents: null,
    bereavement_pay_cents: null,
    leave_rate_cents_per_hour: null,
    leave_rate_source: null,
    total_pay_cents: roundCents(totalPay),
    metrics: { pay_per_clock_hour_cents: null, cost_per_billed_hour_cents: null, productivity: null },
  };
}

function computeOfficeManager(
  config: OfficeManagerPayConfig,
  entries: SheetEntries,
  derived: DerivedInputs,
  options?: ComputeSheetOptions,
): SheetComputation {
  const [s1, s2] = resolveSplits(entries, options);
  const hourlyW1 = config.hourly_rate_cents;
  const hourlyW2 = config.rates_w2?.hourly_rate_cents ?? config.hourly_rate_cents;
  const w1 = hourlyWeekExact(hourlyW1, s1, leaveHoursForWeek(entries, 1), null);
  const w2 = hourlyWeekExact(hourlyW2, s2, leaveHoursForWeek(entries, 2), null);
  // Office-manager bonus (extraction §Office Manager): pays on the EXCESS over the
  // monthly sales goal (unlike the foreman cliff): (sales − goal)⁺ × pct.
  // Round-10 #49: the DAL feeds this family month sales BEFORE fees
  // (sales − fees) as the effective month_sales_cents — fees-out is HER base
  // only; the SA tier/display definition stays fee-inclusive (#45).
  const sales = num(derived.month_sales_cents);
  const bonusExact = sales > config.sales_goal_cents ? (sales - config.sales_goal_cents) * config.bonus_pct : 0;
  return hourlySheet(
    "office_manager",
    [w1, w2],
    {
      bonusCents: bonusExact,
      spiffCents: null,
      manualIncentiveCents: null,
      incentiveExact: bonusExact,
      withMetrics: false,
      leaveRateCents: null,
      leaveRateSource: null,
      shopHourGoal: null,
      shopHourGoalSource: null,
    },
    leaveTotalsFromEntries(entries),
  );
}

function computeSupport(
  config: SupportPayConfig,
  entries: SheetEntries,
  options?: ComputeSheetOptions,
): SheetComputation {
  const [s1, s2] = resolveSplits(entries, options);
  const hourlyW1 = config.hourly_rate_cents;
  const hourlyW2 = config.rates_w2?.hourly_rate_cents ?? config.hourly_rate_cents;
  const w1 = hourlyWeekExact(hourlyW1, s1, leaveHoursForWeek(entries, 1), null);
  const w2 = hourlyWeekExact(hourlyW2, s2, leaveHoursForWeek(entries, 2), null);
  const manual = entries.manual_incentive_cents ?? null;
  return hourlySheet(
    "support",
    [w1, w2],
    {
      bonusCents: null,
      spiffCents: null,
      manualIncentiveCents: manual,
      incentiveExact: num(manual),
      withMetrics: false,
      leaveRateCents: null,
      leaveRateSource: null,
      shopHourGoal: null,
      shopHourGoalSource: null,
    },
    leaveTotalsFromEntries(entries),
  );
}

// ── Entry point ────────────────────────────────────────────────────────────────

/**
 * Compute one employee's pay sheet. Pure: config + manual entries + EFFECTIVE derived
 * inputs in (override precedence is the DAL's job), SheetComputation out. null/missing
 * derived values and hour entries are treated as 0 — a non-bonus run simply passes no
 * month numbers and every bonus computes to 0.
 */
export function computeSheet<F extends Family>(
  family: F,
  payConfig: PayConfigFor<F>,
  entries: SheetEntries,
  derived: DerivedInputs,
  options?: ComputeSheetOptions,
): SheetComputation {
  switch (family) {
    case "technician":
    case "shop_foreman":
      return computeTechnicianFamily(
        family,
        payConfig as TechnicianPayConfig | ShopForemanPayConfig,
        entries,
        derived,
        options,
      );
    case "service_advisor":
      return computeServiceAdvisor(payConfig as ServiceAdvisorPayConfig, entries, derived, options);
    case "office_manager":
      return computeOfficeManager(payConfig as OfficeManagerPayConfig, entries, derived, options);
    case "support":
      return computeSupport(payConfig as SupportPayConfig, entries, options);
    default: {
      const exhaustive: never = family;
      throw new Error(`payroll calc: unknown family ${String(exhaustive)}`);
    }
  }
}
