/**
 * summary.ts tests — per-run summary rows (requirement #6: Reg/OT/Incentive/PTO/Trn/
 * Hol/Ber with "n/a" (null) where inapplicable) and the dashboard aggregates
 * (requirement #7: last-12-COMPLETED-runs window, voided + open runs excluded,
 * null-safe average hourly pay per decision #9).
 *
 * Rows are built from REAL computeSheet output (no hand-rolled SheetComputations) so
 * the row mapping is proven against the engine's actual shape.
 */
import { describe, expect, it } from "vitest";

import { computeSheet } from "../calc";
import {
  aggregateLastCompletedRuns,
  avgHourlyPayCents,
  buildRunSummary,
  lastCompletedRuns,
  type EmployeeSheet,
  type RunForAggregation,
} from "../summary";
import type { SummaryRow } from "../types";

// ── Fixture sheets (via the real engine) ───────────────────────────────────────

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const techSheet = computeSheet(
  "technician",
  {
    config_version: 1,
    pto_balance_hours: 0,
    pto_accrual_hours_per_period: 0,
    hourly_rate_cents: 2500, // $25
    billed_rate_cents: 1200, // $12
  },
  { clock_hours_w1: 45, clock_hours_w2: 40, pto_w1: 4 }, // 45 → 40 reg + 5 OT
  { billed_hours_w1: 50, billed_hours_w2: 42 },
);

const supportNoIncentive = computeSheet(
  "support",
  { config_version: 1, pto_balance_hours: 0, pto_accrual_hours_per_period: 0, hourly_rate_cents: 1600 },
  { clock_hours_w1: 20, clock_hours_w2: 20 },
  {},
);

const supportWithIncentive = computeSheet(
  "support",
  { config_version: 1, pto_balance_hours: 0, pto_accrual_hours_per_period: 0, hourly_rate_cents: 1600 },
  { clock_hours_w1: 20, clock_hours_w2: 20, manual_incentive_cents: 4200 },
  {},
);

const saSheet = computeSheet(
  "service_advisor",
  {
    config_version: 1,
    pto_balance_hours: 0,
    pto_accrual_hours_per_period: 0,
    weekly_salary_cents: 115_384,
    gp_goal_1_cents: 11_500_000,
    gp_goal_2_cents: 12_500_000,
    sales_goal_cents: 25_769_874,
    tier1_pct: 0.005,
    tier2_pct: 0.01,
    tier3_pct: 0.02,
    spiff_amount_cents: 500,
  },
  { clock_hours_w1: 40, clock_hours_w2: 40, holiday_w2: 8 },
  {
    month_sales_cents: 26_149_112, // > goal
    month_gp_with_fees_cents: 16_683_522, // > gp2 → tier 3
    month_gp_without_fees_cents: 15_462_854,
    spiff_count: 39,
  },
);

const SHEETS: EmployeeSheet[] = [
  { employee_id: uuid(1), display_name: "Zeta Tech", role: "technician", family: "technician", sheet: techSheet },
  { employee_id: uuid(2), display_name: "Alma Support", role: "shop_support", family: "support", sheet: supportNoIncentive },
  { employee_id: uuid(3), display_name: "Bram Support", role: "shop_support", family: "support", sheet: supportWithIncentive },
  { employee_id: uuid(4), display_name: "Mia Advisor", role: "service_manager", family: "service_advisor", sheet: saSheet },
];

describe("buildRunSummary", () => {
  const rows = buildRunSummary(SHEETS);
  const byName = new Map(rows.map((r) => [r.display_name, r]));

  it("emits one row per employee, sorted by display name", () => {
    expect(rows.map((r) => r.display_name)).toEqual(["Alma Support", "Bram Support", "Mia Advisor", "Zeta Tech"]);
  });

  it("technician row: reg/OT hours+pay split, billed fields populated, incentive = billed+efficiency pay", () => {
    const r = byName.get("Zeta Tech")!;
    expect(r.reg_hours).toBe(80); // 40 + 40
    expect(r.ot_hours).toBe(5);
    expect(r.reg_pay_cents).toBe(200_000); // 80 × $25
    expect(r.ot_pay_cents).toBe(18_750); // 5 × $25 × 1.5
    expect(r.billed_hours).toBe(92); // 50 + 42
    expect(r.billed_pay_cents).toBe(110_400); // 92 × $12
    // efficiency: w1 = 50 − 45 = 5, w2 = 42 − 40 = 2 → 7 × $25 = 17,500 on top of billed pay
    expect(r.incentive_cents).toBe(110_400 + 17_500);
    expect(r.bonus_cents).toBeNull(); // technicians have no bonus concept
    expect(r.pto_hours).toBe(4);
    expect(r.pto_pay_cents).toBe(10_000); // 4 × $25
    expect(r.total_pay_cents).toBe(techSheet.total_pay_cents);
  });

  it('support row with NO manual incentive entered → incentive is null ("n/a"), not 0', () => {
    const r = byName.get("Alma Support")!;
    expect(r.incentive_cents).toBeNull();
    expect(r.billed_hours).toBeNull(); // no billed concept outside the technician family
    expect(r.billed_pay_cents).toBeNull();
  });

  it("support row WITH a manual incentive → the entered amount", () => {
    expect(byName.get("Bram Support")!.incentive_cents).toBe(4200);
  });

  it("service-advisor row: salary as reg pay, leave pay n/a but hours tracked, bonus+spiff surfaced", () => {
    const r = byName.get("Mia Advisor")!;
    expect(r.reg_pay_cents).toBe(230_768); // salary × 2
    expect(r.ot_pay_cents).toBe(0); // OT tracked, never paid
    expect(r.holiday_hours).toBe(8);
    expect(r.holiday_pay_cents).toBeNull(); // salaried: hours-only
    expect(r.spiff_cents).toBe(19_500); // 39 × $5
    expect(r.bonus_cents).toBe(309_257); // tier3: 2% × $154,628.54 → round half away from zero
    expect(r.incentive_cents).toBe(19_500 + 309_257);
  });
});

// ── Aggregates ─────────────────────────────────────────────────────────────────

/** A hand-built row with known constants (aggregation math is row-shape-agnostic). */
function row(over: Partial<SummaryRow>): SummaryRow {
  return {
    employee_id: uuid(9),
    display_name: "Agg Row",
    role: "technician",
    family: "technician",
    reg_hours: 80,
    ot_hours: 0,
    reg_pay_cents: 100_000,
    ot_pay_cents: 0,
    billed_hours: null,
    billed_pay_cents: null,
    incentive_cents: null,
    bonus_cents: null,
    spiff_cents: null,
    pto_hours: 0,
    pto_pay_cents: null,
    training_hours: 0,
    training_pay_cents: null,
    holiday_hours: 0,
    holiday_pay_cents: null,
    bereavement_hours: 0,
    bereavement_pay_cents: null,
    total_pay_cents: 100_000,
    ...over,
  };
}

/** period_start for the Nth run on the Sun–Sat cadence anchored 2026-06-28 − N×14d. */
function periodStart(n: number): string {
  const ms = Date.parse("2026-06-28T00:00:00Z") - n * 14 * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

describe("lastCompletedRuns / aggregateLastCompletedRuns", () => {
  // 14 completed runs (indexes 0..13, 0 = most recent) + 1 open + 1 voided.
  const completed: RunForAggregation[] = Array.from({ length: 14 }, (_, n) => ({
    status: "completed",
    period_start: periodStart(n + 1),
    rows: [row({ total_pay_cents: 100_000 + n, reg_hours: 80 })],
  }));
  const open: RunForAggregation = {
    status: "open",
    period_start: periodStart(0), // the newest period — still must NOT count
    rows: [row({ total_pay_cents: 999_999 })],
  };
  const voided: RunForAggregation = {
    status: "voided",
    period_start: periodStart(2),
    rows: [row({ total_pay_cents: 888_888 })],
  };
  const runs = [voided, open, ...completed].sort(() => 0.5); // order-independence: unsorted input

  it("windows to the 12 most recent COMPLETED runs — open and voided never count", () => {
    const window = lastCompletedRuns(runs);
    expect(window).toHaveLength(12);
    expect(window.every((r) => r.status === "completed")).toBe(true);
    // Most recent completed first; the 2 oldest completed (n=12,13) fall out.
    expect(window[0]!.period_start).toBe(periodStart(1));
    expect(window[11]!.period_start).toBe(periodStart(12));
  });

  it("sums the window and averages hourly pay over clock hours", () => {
    const agg = aggregateLastCompletedRuns(runs);
    expect(agg.run_count).toBe(12);
    // Σ total pay = Σ (100000+n) for n=0..11 = 1,200,000 + 66
    expect(agg.total_pay_cents).toBe(1_200_066);
    expect(agg.reg_hours).toBe(960); // 12 × 80
    expect(agg.avg_hourly_pay_cents).toBe(Math.round(1_200_066 / 960));
    expect(agg.bonus_pay_cents).toBeNull(); // no bonuses/spiffs anywhere in the window → n/a
  });

  it("nullable row fields aggregate as zero, and bonus/spiff rows flip bonus_pay_cents from n/a to a sum", () => {
    const agg = aggregateLastCompletedRuns([
      {
        status: "completed",
        period_start: periodStart(1),
        rows: [
          row({ incentive_cents: 5_000, billed_hours: 10, billed_pay_cents: 12_000 }),
          row({ bonus_cents: 30_000, spiff_cents: 2_000, incentive_cents: 32_000 }),
        ],
      },
    ]);
    expect(agg.incentive_cents).toBe(37_000);
    expect(agg.billed_hours).toBe(10);
    expect(agg.billed_pay_cents).toBe(12_000);
    expect(agg.bonus_pay_cents).toBe(32_000);
  });

  it("is null-safe: zero clock hours (or zero runs) → avg hourly pay null, never Infinity", () => {
    expect(aggregateLastCompletedRuns([]).avg_hourly_pay_cents).toBeNull();
    const zeroHours = aggregateLastCompletedRuns([
      { status: "completed", period_start: periodStart(1), rows: [row({ reg_hours: 0, ot_hours: 0 })] },
    ]);
    expect(zeroHours.avg_hourly_pay_cents).toBeNull();
    expect(zeroHours.total_pay_cents).toBe(100_000); // the pay still sums
  });
});

describe("avgHourlyPayCents (per-employee dashboard figure)", () => {
  it("divides total pay by reg+OT clock hours", () => {
    expect(avgHourlyPayCents([row({ total_pay_cents: 200_000, reg_hours: 40, ot_hours: 10 })])).toBe(4000);
  });

  it("returns null on an empty set and on zero hours", () => {
    expect(avgHourlyPayCents([])).toBeNull();
    expect(avgHourlyPayCents([row({ reg_hours: 0, ot_hours: 0, total_pay_cents: 50_000 })])).toBeNull();
  });
});
