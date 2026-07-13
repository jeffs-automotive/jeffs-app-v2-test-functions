/**
 * summary.ts tests — per-run summary rows (requirement #6: Reg/OT/Incentive/PTO/Trn/
 * Hol/Ber with "n/a" (null) where inapplicable), the round-9 #46 run-level TOTALS
 * block (n/a-safe category sums + the zero-denominator-null cost per clock hour),
 * and the dashboard aggregates (requirement #7: last-COMPLETED-runs window, voided +
 * open runs excluded, null-safe average hourly pay per decision #9).
 *
 * Round-12 (2026-07-12): the per-EMPLOYEE dashboard averages switched from weighted
 * (Σpay ÷ Σhours over a flattened rowset, last 12) to the MEAN OF PER-RUN RATES over
 * the last DASHBOARD_WINDOW = 26 completed runs (each run one rate, meaned). The
 * SHOP-WIDE card (aggregateLastCompletedRuns) stays WEIGHTED over its own explicit
 * 12-run window — asserted below to lock that it did NOT change.
 *
 * Rows are built from REAL computeSheet output (no hand-rolled SheetComputations) so
 * the row mapping is proven against the engine's actual shape.
 */
import { describe, expect, it } from "vitest";

import { computeSheet } from "../calc";
import {
  aggregateLastCompletedRuns,
  avgHourlyPayCents,
  avgHourlyWithoutBonusCents,
  buildRunSummary,
  buildRunTotals,
  DASHBOARD_WINDOW,
  employeeHourlyAverages,
  lastCompletedRuns,
  meanOfPerRunRates,
  WITH_BONUS_FAMILIES,
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
  const { rows, totals } = buildRunSummary(SHEETS);
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

  it("the round-9 #46 totals block rides along and matches the rows' sums", () => {
    expect(totals).toEqual(buildRunTotals(rows));
    expect(totals.total_pay_cents).toBe(rows.reduce((s, r) => s + r.total_pay_cents, 0));
  });
});

// ── Round-9 #46: the run-level totals block ────────────────────────────────────

describe("buildRunTotals (round-9 #46)", () => {
  it("sums pay + hours across synthetic rows and derives cost per clock hour", () => {
    const t = buildRunTotals([
      row({
        reg_hours: 40,
        ot_hours: 2,
        reg_pay_cents: 100_000,
        ot_pay_cents: 7_500,
        billed_hours: 45,
        billed_pay_cents: 45_000,
        incentive_cents: 45_000,
        pto_hours: 8,
        pto_pay_cents: 20_000,
        total_pay_cents: 172_500,
      }),
      row({
        reg_hours: 38,
        ot_hours: 0,
        reg_pay_cents: 60_800,
        ot_pay_cents: 0,
        holiday_hours: 8,
        holiday_pay_cents: 12_800,
        total_pay_cents: 73_600,
      }),
    ]);
    expect(t.total_pay_cents).toBe(246_100);
    expect(t.reg_pay_cents).toBe(160_800);
    expect(t.ot_pay_cents).toBe(7_500);
    expect(t.incentive_pay_cents).toBe(45_000); // null row counts 0, mixed column sums
    expect(t.pto_pay_cents).toBe(20_000);
    expect(t.holiday_pay_cents).toBe(12_800);
    expect(t.reg_hours).toBe(78);
    expect(t.ot_hours).toBe(2);
    expect(t.pto_hours).toBe(8);
    expect(t.holiday_hours).toBe(8);
    expect(t.billed_hours).toBe(45); // null row counts 0 in a mixed column
    // 246,100 ÷ 80 clock hours = 3,076.25 → round half away from zero.
    expect(t.cost_per_clock_hour_cents).toBe(3_076);
    // Round-9 addendum: ALL pay ÷ total billed hours — 246,100 ÷ 45 = 5,468.89 → 5,469.
    expect(t.cost_per_billed_hour_cents).toBe(5_469);
  });

  it("an ALL-null category stays null (renders n/a, never $0.00); mixed columns count nulls as 0", () => {
    const t = buildRunTotals([row({}), row({})]); // every nullable field null
    expect(t.incentive_pay_cents).toBeNull();
    expect(t.pto_pay_cents).toBeNull();
    expect(t.holiday_pay_cents).toBeNull();
    expect(t.bereavement_pay_cents).toBeNull();
    expect(t.training_pay_cents).toBeNull();
    expect(t.billed_hours).toBeNull();
    // No billed hours anywhere → cost per billed hour n/a, never Infinity.
    expect(t.cost_per_billed_hour_cents).toBeNull();
    // The never-null columns still sum.
    expect(t.reg_pay_cents).toBe(200_000);
    expect(t.total_pay_cents).toBe(200_000);
  });

  it("zero clock hours → cost per clock hour null, never Infinity/NaN (the pay still sums)", () => {
    const t = buildRunTotals([row({ reg_hours: 0, ot_hours: 0, total_pay_cents: 50_000 })]);
    expect(t.cost_per_clock_hour_cents).toBeNull();
    expect(t.total_pay_cents).toBe(50_000);
  });

  it("empty run → zeros, null categories, null cost per clock hour", () => {
    const t = buildRunTotals([]);
    expect(t.total_pay_cents).toBe(0);
    expect(t.reg_hours).toBe(0);
    expect(t.incentive_pay_cents).toBeNull();
    expect(t.billed_hours).toBeNull();
    expect(t.cost_per_clock_hour_cents).toBeNull();
    expect(t.cost_per_billed_hour_cents).toBeNull();
  });

  it("hours settle back to 2dp (float-noise accumulation)", () => {
    const t = buildRunTotals([
      row({ reg_hours: 0.1, ot_hours: 0 }),
      row({ reg_hours: 0.2, ot_hours: 0 }),
    ]);
    expect(t.reg_hours).toBe(0.3); // NOT 0.30000000000000004
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

  it("filters to COMPLETED runs only — open and voided never count — newest first", () => {
    // Round-12: lastCompletedRuns DEFAULTS to DASHBOARD_WINDOW (26); with only 14
    // completed runs it returns all 14 (26 ≥ 14), never the open/voided rows.
    const window = lastCompletedRuns(runs);
    expect(window).toHaveLength(14);
    expect(window.every((r) => r.status === "completed")).toBe(true);
    expect(window[0]!.period_start).toBe(periodStart(1)); // most recent completed first
  });

  it("an explicit limit still windows (the shop-wide card passes 12)", () => {
    const window = lastCompletedRuns(runs, 12);
    expect(window).toHaveLength(12);
    // Most recent completed first; the 2 oldest completed (n=12,13) fall out.
    expect(window[0]!.period_start).toBe(periodStart(1));
    expect(window[11]!.period_start).toBe(periodStart(12));
  });

  it("the SHOP-WIDE card stays weighted over its own explicit 12-run window (unchanged)", () => {
    const agg = aggregateLastCompletedRuns(runs);
    expect(agg.run_count).toBe(12); // aggregateLastCompletedRuns default is still 12
    // Σ total pay = Σ (100000+n) for n=0..11 = 1,200,000 + 66
    expect(agg.total_pay_cents).toBe(1_200_066);
    expect(agg.reg_hours).toBe(960); // 12 × 80
    // Weighted: Σ pay ÷ Σ hours (NOT a mean of per-run rates).
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

describe("avg-hourly variants (round-3 decisions #24/#25)", () => {
  it("without-bonus strips the foreman shop bonus but keeps billed/efficiency/leave pay", () => {
    // total 150,000 incl. 20,000 shop bonus + 30,000 billed pay; 80 clock hours.
    const rows = [
      row({
        family: "shop_foreman",
        role: "shop_foreman",
        total_pay_cents: 150_000,
        bonus_cents: 20_000,
        incentive_cents: 50_000, // billed+efficiency+bonus — NOT stripped (not support)
        billed_pay_cents: 30_000,
        reg_hours: 80,
      }),
    ];
    expect(avgHourlyWithoutBonusCents(rows)).toBe(Math.round(130_000 / 80)); // 1,625
    expect(avgHourlyPayCents(rows)).toBe(Math.round(150_000 / 80)); // with-bonus keeps it
  });

  it("without-bonus strips the SA tier bonus + spiff (leaves 2×salary)", () => {
    const rows = [
      row({
        family: "service_advisor",
        role: "service_manager",
        total_pay_cents: 291_600,
        bonus_cents: 85_600,
        spiff_cents: 6_000,
        incentive_cents: 91_600,
        reg_hours: 80,
        ot_hours: 0,
      }),
    ];
    expect(avgHourlyWithoutBonusCents(rows)).toBe(Math.round(200_000 / 80)); // 2,500
  });

  it("without-bonus strips the support manual incentive (incentive_cents on a support row)", () => {
    const rows = [
      row({
        family: "support",
        role: "shop_support",
        total_pay_cents: 104_200,
        incentive_cents: 4_200, // the manual incentive
        reg_hours: 40,
      }),
    ];
    expect(avgHourlyWithoutBonusCents(rows)).toBe(Math.round(100_000 / 40)); // 2,500
    // a support row with NO incentive entered (null) strips nothing:
    expect(
      avgHourlyWithoutBonusCents([
        row({ family: "support", role: "shop_support", incentive_cents: null, total_pay_cents: 100_000, reg_hours: 40 }),
      ]),
    ).toBe(2_500);
  });

  it("is null-safe (empty set / zero hours)", () => {
    expect(avgHourlyWithoutBonusCents([])).toBeNull();
    expect(avgHourlyWithoutBonusCents([row({ reg_hours: 0, ot_hours: 0 })])).toBeNull();
  });

  it("employeeHourlyAverages: with-bonus is non-null ONLY for the bonus families", () => {
    // Round-12: the input is per-RUN groups (SummaryRow[][]); a single run → the mean
    // of one rate is that rate, so the single-run expectations match the old figures.
    const runsRows = [[row({ total_pay_cents: 160_000, bonus_cents: 20_000, reg_hours: 80 })]];
    expect(WITH_BONUS_FAMILIES).toEqual(["service_advisor", "office_manager", "shop_foreman"]);
    for (const family of WITH_BONUS_FAMILIES) {
      expect(employeeHourlyAverages(family, runsRows)).toEqual({
        avg_hourly_without_bonus_cents: Math.round(140_000 / 80),
        avg_hourly_with_bonus_cents: Math.round(160_000 / 80),
      });
    }
    for (const family of ["technician", "support"] as const) {
      expect(employeeHourlyAverages(family, runsRows)).toEqual({
        avg_hourly_without_bonus_cents: Math.round(140_000 / 80),
        avg_hourly_with_bonus_cents: null, // "n/a" for non-bonus families
      });
    }
  });

  it("employeeHourlyAverages is null-safe on an empty window (no completed runs)", () => {
    expect(employeeHourlyAverages("shop_foreman", [])).toEqual({
      avg_hourly_without_bonus_cents: null,
      avg_hourly_with_bonus_cents: null,
    });
  });

  it("employeeHourlyAverages MEANS the per-run rates (round-12) — NOT a weighted Σ÷Σ", () => {
    // Two runs, deliberately different hour weights so the mean-of-rates ≠ the
    // weighted average. Run A: 100,000 pay ÷ 40 hrs = 2,500/hr. Run B: 100,000 pay ÷
    // 80 hrs = 1,250/hr. Mean of per-run rates = (2,500 + 1,250)/2 = 1,875. The
    // OLD weighted figure would have been 200,000 ÷ 120 = 1,667 — proving the change.
    const runsRows = [
      [row({ family: "technician", role: "technician", total_pay_cents: 100_000, reg_hours: 40, ot_hours: 0 })],
      [row({ family: "technician", role: "technician", total_pay_cents: 100_000, reg_hours: 80, ot_hours: 0 })],
    ];
    expect(employeeHourlyAverages("technician", runsRows).avg_hourly_without_bonus_cents).toBe(1_875);
    // Sanity: the weighted number (what we moved away from) is different.
    expect(Math.round(200_000 / 120)).toBe(1_667);
  });

  it("employeeHourlyAverages: with-bonus means the per-run WITH-bonus rates (bonus families)", () => {
    // Two SA runs: rate A = 160,000 ÷ 80 = 2,000; rate B = 240,000 ÷ 80 = 3,000.
    // With-bonus mean = 2,500. Without-bonus strips the bonus each run first:
    // (160,000−20,000)/80 = 1,750 and (240,000−40,000)/80 = 2,500 → mean 2,125.
    const runsRows = [
      [row({ family: "service_advisor", role: "service_manager", total_pay_cents: 160_000, bonus_cents: 20_000, reg_hours: 80 })],
      [row({ family: "service_advisor", role: "service_manager", total_pay_cents: 240_000, bonus_cents: 40_000, reg_hours: 80 })],
    ];
    expect(employeeHourlyAverages("service_advisor", runsRows)).toEqual({
      avg_hourly_without_bonus_cents: 2_125,
      avg_hourly_with_bonus_cents: 2_500,
    });
  });

  it("employeeHourlyAverages skips a zero-hours run (leave-only period) from the mean", () => {
    // Run A: 100,000 ÷ 50 = 2,000. Run B: reg=ot=0 → null rate, dropped. Mean = 2,000.
    const runsRows = [
      [row({ family: "technician", role: "technician", total_pay_cents: 100_000, reg_hours: 50, ot_hours: 0 })],
      [row({ family: "technician", role: "technician", total_pay_cents: 30_000, reg_hours: 0, ot_hours: 0 })],
    ];
    expect(employeeHourlyAverages("technician", runsRows).avg_hourly_without_bonus_cents).toBe(2_000);
  });

  it("respects DASHBOARD_WINDOW = 26 (the rolling window is a year of bi-weekly runs)", () => {
    expect(DASHBOARD_WINDOW).toBe(26);
  });
});

describe("meanOfPerRunRates (round-12 rolling-26 aggregation)", () => {
  it("means one rate per run, rounding once at the end (half away from zero)", () => {
    // Rates 100, 100, 101 → mean 100.33… → 100. Each rate is already integer cents.
    const runsRows = [
      [row({ total_pay_cents: 10_000, reg_hours: 100, ot_hours: 0 })], // 100/hr
      [row({ total_pay_cents: 10_000, reg_hours: 100, ot_hours: 0 })], // 100/hr
      [row({ total_pay_cents: 10_100, reg_hours: 100, ot_hours: 0 })], // 101/hr
    ];
    expect(meanOfPerRunRates(runsRows, avgHourlyPayCents)).toBe(100);
  });

  it("sums MULTIPLE rows within one run before rating that run (a run is one rate)", () => {
    // One run, two rows: 100,000 pay over 40 hrs + 100,000 over 60 hrs = 200,000 ÷ 100
    // = 2,000/hr for THAT run. A single run → the mean is that one rate.
    const runsRows = [
      [
        row({ total_pay_cents: 100_000, reg_hours: 40, ot_hours: 0 }),
        row({ total_pay_cents: 100_000, reg_hours: 60, ot_hours: 0 }),
      ],
    ];
    expect(meanOfPerRunRates(runsRows, avgHourlyPayCents)).toBe(2_000);
  });

  it("drops null-rate runs (zero clock hours) and is null when NO run contributes", () => {
    expect(meanOfPerRunRates([], avgHourlyPayCents)).toBeNull();
    expect(
      meanOfPerRunRates([[row({ reg_hours: 0, ot_hours: 0, total_pay_cents: 50_000 })]], avgHourlyPayCents),
    ).toBeNull();
    // One good run + one zero-hours run → the good run's rate (the null is skipped).
    expect(
      meanOfPerRunRates(
        [
          [row({ total_pay_cents: 200_000, reg_hours: 40, ot_hours: 10 })], // 4,000/hr
          [row({ reg_hours: 0, ot_hours: 0, total_pay_cents: 10_000 })], // null
        ],
        avgHourlyPayCents,
      ),
    ).toBe(4_000);
  });
});
