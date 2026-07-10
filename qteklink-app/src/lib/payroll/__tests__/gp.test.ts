/**
 * Month-GP + labor-pay-proration tests (pure, no DB). Locks decision #17's straddle
 * approximation (daily = weekHours ÷ 5; month share = daily × min(5, month-days in the
 * straddling week) — pay prorates linearly by min(5, days)/5), decision #1's GP role
 * set (technician + shop_foreman + shop_support ONLY), voided-run skipping, and the
 * GP-with/without-fees arithmetic.
 */
import { describe, it, expect } from "vitest";

import {
  GP_LABOR_ROLES,
  monthDaysInWeek,
  weekMonthShareFactor,
  laborPayProratedCents,
  monthGpCents,
  monthGpFromRuns,
  type GpRunInput,
} from "../gp";

const emp = (role: string, w1: number, w2: number) => ({
  role,
  totalPayW1Cents: w1,
  totalPayW2Cents: w2,
});

describe("monthDaysInWeek / weekMonthShareFactor", () => {
  it("week fully inside the month → 7 days, factor capped at 1", () => {
    // 2026-06-07 is a Sunday; Jun 7–13 all in June.
    expect(monthDaysInWeek("2026-06-07", "2026-06")).toBe(7);
    expect(weekMonthShareFactor("2026-06-07", "2026-06")).toBe(1);
  });

  it("the 3-June-days straddle: week of 2026-06-28 has Jun 28/29/30 → factor 3/5", () => {
    expect(monthDaysInWeek("2026-06-28", "2026-06")).toBe(3);
    expect(weekMonthShareFactor("2026-06-28", "2026-06")).toBe(0.6);
    // …and the July side of the same week is 4 days → 4/5.
    expect(monthDaysInWeek("2026-06-28", "2026-07")).toBe(4);
    expect(weekMonthShareFactor("2026-06-28", "2026-07")).toBe(0.8);
  });

  it("6 month-days still caps at 5 → factor 1", () => {
    // 2026-06-25 (Thu): Jun 25–30 = 6 June days + Jul 1.
    expect(monthDaysInWeek("2026-06-25", "2026-06")).toBe(6);
    expect(weekMonthShareFactor("2026-06-25", "2026-06")).toBe(1);
  });

  it("week fully outside the month → 0", () => {
    expect(monthDaysInWeek("2026-07-05", "2026-06")).toBe(0);
    expect(weekMonthShareFactor("2026-07-05", "2026-06")).toBe(0);
  });

  it("rejects junk inputs", () => {
    expect(() => monthDaysInWeek("junk", "2026-06")).toThrow(/ISO date/);
    expect(() => monthDaysInWeek("2026-06-07", "2026-13")).toThrow(/YYYY-MM/);
  });
});

describe("laborPayProratedCents", () => {
  it("run fully inside the month counts both weeks at 100%", () => {
    const runs: GpRunInput[] = [
      {
        status: "completed",
        periodStart: "2026-06-07", // w1 Jun 7–13, w2 Jun 14–20
        employees: [emp("technician", 100_000, 110_000), emp("shop_foreman", 90_000, 90_000)],
      },
    ];
    expect(laborPayProratedCents(runs, "2026-06")).toBe(390_000);
  });

  it("straddling run: w1 (3 June days) at 3/5, w2 (all July) at 0 — the June example", () => {
    const runs: GpRunInput[] = [
      {
        status: "open",
        periodStart: "2026-06-28", // w1 Jun 28–Jul 4 → 3/5 for June; w2 Jul 5–11 → 0
        employees: [emp("technician", 100_000, 100_000)],
      },
    ];
    expect(laborPayProratedCents(runs, "2026-06")).toBe(60_000);
    // The July side of the same run: w1 at 4/5 + w2 at full.
    expect(laborPayProratedCents(runs, "2026-07")).toBe(80_000 + 100_000);
  });

  it("only technician + shop_foreman + shop_support count (decision #1)", () => {
    expect([...GP_LABOR_ROLES]).toEqual(["technician", "shop_foreman", "shop_support"]);
    const runs: GpRunInput[] = [
      {
        status: "completed",
        periodStart: "2026-06-07",
        employees: [
          emp("technician", 10_000, 0),
          emp("shop_foreman", 20_000, 0),
          emp("shop_support", 30_000, 0),
          // ALL excluded:
          emp("office_support", 500_000, 500_000),
          emp("general_manager", 500_000, 500_000),
          emp("service_manager", 500_000, 500_000),
          emp("asst_manager", 500_000, 500_000),
          emp("office_manager", 500_000, 500_000),
        ],
      },
    ];
    expect(laborPayProratedCents(runs, "2026-06")).toBe(60_000);
  });

  it("voided runs are skipped; completed and open both count", () => {
    const base = { periodStart: "2026-06-07", employees: [emp("technician", 10_000, 10_000)] };
    const runs: GpRunInput[] = [
      { status: "voided", ...base },
      { status: "completed", ...base },
      { status: "open", ...base },
    ];
    expect(laborPayProratedCents(runs, "2026-06")).toBe(40_000);
  });

  it("runs not overlapping the month contribute 0", () => {
    const runs: GpRunInput[] = [
      { status: "completed", periodStart: "2026-08-02", employees: [emp("technician", 999_999, 999_999)] },
    ];
    expect(laborPayProratedCents(runs, "2026-06")).toBe(0);
  });

  it("rounds each prorated week half away from zero", () => {
    const runs: GpRunInput[] = [
      { status: "open", periodStart: "2026-06-28", employees: [emp("technician", 333, 0)] },
    ];
    // 333 × 0.6 = 199.8 → 200
    expect(laborPayProratedCents(runs, "2026-06")).toBe(200);
  });

  it("zero data → 0 (null-safety)", () => {
    expect(laborPayProratedCents([], "2026-06")).toBe(0);
    expect(
      laborPayProratedCents([{ status: "open", periodStart: "2026-06-07", employees: [] }], "2026-06"),
    ).toBe(0);
  });

  it("rejects a junk month", () => {
    expect(() => laborPayProratedCents([], "06-2026")).toThrow(/YYYY-MM/);
  });
});

describe("monthGpCents", () => {
  it("GP with fees = sales − parts − labor; without fees subtracts fees too", () => {
    const gp = monthGpCents({
      monthSalesCents: 30_000_000, // $300,000.00
      monthPartsCostCents: 9_000_000, // $90,000.00
      laborPayProratedCents: 8_500_000, // $85,000.00
      monthFeesCents: 1_323_145, // $13,231.45 (June 2026 real figure)
    });
    expect(gp.gpWithFeesCents).toBe(12_500_000);
    expect(gp.gpWithoutFeesCents).toBe(12_500_000 - 1_323_145);
  });

  it("zero inputs → zeros (null-safety)", () => {
    const gp = monthGpCents({
      monthSalesCents: 0,
      monthPartsCostCents: 0,
      laborPayProratedCents: 0,
      monthFeesCents: 0,
    });
    expect(gp.gpWithFeesCents).toBe(0);
    expect(gp.gpWithoutFeesCents).toBe(0);
  });
});

describe("monthGpFromRuns (integration convenience)", () => {
  it("prorates labor from the runs, then feeds the GP arithmetic", () => {
    const runs: GpRunInput[] = [
      { status: "completed", periodStart: "2026-06-28", employees: [emp("technician", 100_000, 100_000)] },
    ];
    const gp = monthGpFromRuns(runs, "2026-06", {
      monthSalesCents: 1_000_000,
      monthPartsCostCents: 200_000,
      monthFeesCents: 50_000,
    });
    expect(gp.laborPayProratedCents).toBe(60_000);
    expect(gp.gpWithFeesCents).toBe(1_000_000 - 200_000 - 60_000);
    expect(gp.gpWithoutFeesCents).toBe(gp.gpWithFeesCents - 50_000);
  });
});
