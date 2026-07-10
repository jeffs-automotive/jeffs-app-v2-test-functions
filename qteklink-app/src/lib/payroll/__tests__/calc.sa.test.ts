/**
 * Synthetic service-advisor bonus-tier tests — the ROUND-3 tier semantics
 * (extraction doc decision #22, superseding the workbook's strict-> IF-nesting):
 *   beat = monthSales > salesGoal (STRICTLY >, "beat last year")
 *   beat AND gpWith ≥ gpGoal2      → gpWithout × tier3
 *   beat AND gpWith ≥ gpGoal1      → gpWithout × tier2
 *   NOT beat AND gpWith ≥ gpGoal1  → gpWithout × tier1  (clearing goal2 without the
 *                                     beat is STILL tier1)
 *   else 0                          (beat with gpWith < gpGoal1 pays NOTHING)
 * GP comparisons are ≥ (Chris's worked example: GPwith exactly at goal2 ⇒ tier3);
 * the payout % applies to GP-WITHOUT-fees. The sales goal auto-derives from the
 * prior-year same-month subtotal and arrives via derived.sales_goal_cents (round-3
 * #23); pay_config.sales_goal_cents is the legacy manual fallback. Every case keeps
 * gpWith ≠ gpWithout and distinct tier pcts so a swapped pct or a payout computed
 * off gpWith fails on exact cents.
 */
import { describe, expect, it } from "vitest";

import { computeSheet } from "../calc";
import type { DerivedInputs, ServiceAdvisorPayConfig } from "../types";

const saConfig: ServiceAdvisorPayConfig = {
  config_version: 1,
  pto_balance_hours: 0,
  pto_accrual_hours_per_period: 0,
  weekly_salary_cents: 100_000, // $1,000/week
  gp_goal_1_cents: 11_500_000, // $115,000
  gp_goal_2_cents: 12_500_000, // $125,000
  sales_goal_cents: 25_000_000, // $250,000 (legacy fallback when nothing derived)
  tier1_pct: 0.005,
  tier2_pct: 0.008,
  tier3_pct: 0.012,
  spiff_amount_cents: 500, // $5/spiff
};

function sa(derived: DerivedInputs) {
  return computeSheet("service_advisor", saConfig, {}, derived);
}

describe("service-advisor bonus tier ladder (round-3 #22)", () => {
  it("Chris's worked example EXACTLY: beat, gpWith == goal2 ⇒ tier3; 12,300,000 × 0.012 = 147,600¢", () => {
    const s = sa({
      month_sales_cents: 26_000_000, // > the $250k goal → beat
      month_gp_with_fees_cents: 12_500_000, // EXACTLY gpGoal2 — ≥ makes this tier3
      month_gp_without_fees_cents: 12_300_000,
    });
    // $123,000 × 1.2% = $1,476.00 — exactly 147,600 cents (never off gpWith: 150,000).
    expect(s.bonus_cents).toBe(147_600);
  });

  it("tier2: beat AND gpGoal1 ≤ gpWith < gpGoal2 → gpWithout × tier2_pct", () => {
    const s = sa({
      month_sales_cents: 26_000_000,
      month_gp_with_fees_cents: 12_000_000, // between the goals
      month_gp_without_fees_cents: 10_700_000,
    });
    // 10,700,000 × 0.008 = 85,600 — a payout off gpWith would be 96,000.
    expect(s.bonus_cents).toBe(85_600);
  });

  it("≥ boundary: beat AND gpWith == gpGoal1 exactly → tier2 (was 0 under the old strict >)", () => {
    const s = sa({
      month_sales_cents: 26_000_000,
      month_gp_with_fees_cents: 11_500_000, // exactly gpGoal1
      month_gp_without_fees_cents: 10_700_000,
    });
    expect(s.bonus_cents).toBe(85_600); // tier2, not 0
  });

  it("tier1: NOT beat AND gpWith ≥ gpGoal1 → gpWithout × tier1_pct", () => {
    const s = sa({
      month_sales_cents: 24_000_000, // under the goal
      month_gp_with_fees_cents: 12_000_000,
      month_gp_without_fees_cents: 10_700_000,
    });
    // 10,700,000 × 0.005 = 53,500 — NOT tier2 (85,600).
    expect(s.bonus_cents).toBe(53_500);
  });

  it("≥ boundary: NOT beat AND gpWith == gpGoal1 exactly → tier1", () => {
    const s = sa({
      month_sales_cents: 24_000_000,
      month_gp_with_fees_cents: 11_500_000, // exactly gpGoal1
      month_gp_without_fees_cents: 10_700_000,
    });
    expect(s.bonus_cents).toBe(53_500); // tier1, not 0
  });

  it("NOT beat but clears goal2: STILL tier1 (the beat gates tier2/tier3, not GP)", () => {
    const s = sa({
      month_sales_cents: 24_000_000, // did not beat last year
      month_gp_with_fees_cents: 13_000_000, // over gpGoal2
      month_gp_without_fees_cents: 12_000_000,
    });
    // tier1: 12,000,000 × 0.005 = 60,000 — NOT tier3 (144,000).
    expect(s.bonus_cents).toBe(60_000);
  });

  it('"beat" stays STRICTLY >: sales == goal is NOT a beat → tier1 path', () => {
    const s = sa({
      month_sales_cents: 25_000_000, // exactly the goal
      month_gp_with_fees_cents: 13_000_000, // over gpGoal2, but no beat
      month_gp_without_fees_cents: 12_000_000,
    });
    expect(s.bonus_cents).toBe(60_000); // tier1, not tier3
  });

  it("gpGoal1 is a hard floor: beat with gpWith < gpGoal1 pays NOTHING", () => {
    const s = sa({
      month_sales_cents: 30_000_000, // far over the goal
      month_gp_with_fees_cents: 11_499_999, // one cent under gpGoal1
      month_gp_without_fees_cents: 11_000_000,
    });
    expect(s.bonus_cents).toBe(0);
  });

  it("all-miss: NOT beat AND gpWith < gpGoal1 → 0", () => {
    const s = sa({
      month_sales_cents: 20_000_000,
      month_gp_with_fees_cents: 11_000_000,
      month_gp_without_fees_cents: 10_000_000,
    });
    expect(s.bonus_cents).toBe(0);
  });

  it("derived.sales_goal_cents (prior-year subtotal, round-3 #23) beats the legacy pay_config goal", () => {
    const s = sa({
      month_sales_cents: 26_000_000, // beats the pay_config goal ($250k)…
      sales_goal_cents: 30_000_000, // …but NOT the derived prior-year goal ($300k)
      month_gp_with_fees_cents: 13_000_000,
      month_gp_without_fees_cents: 12_000_000,
    });
    expect(s.bonus_cents).toBe(60_000); // tier1 — the derived goal governs
    const fallback = sa({
      month_sales_cents: 26_000_000, // no derived goal → legacy pay_config fallback
      month_gp_with_fees_cents: 13_000_000,
      month_gp_without_fees_cents: 12_000_000,
    });
    expect(fallback.bonus_cents).toBe(144_000); // beat + tier3 off the $250k config goal
  });

  it("incentive rollup + salaried assembly: incentive = spiff + bonus; total = 2×salary + incentive", () => {
    const s = sa({
      month_sales_cents: 26_000_000,
      month_gp_with_fees_cents: 12_000_000,
      month_gp_without_fees_cents: 10_700_000, // tier2 → 85,600
      spiff_count: 12, // 12 × 500 = 6,000
    });
    expect(s.spiff_cents).toBe(6_000);
    expect(s.bonus_cents).toBe(85_600);
    expect(s.incentive_cents).toBe(91_600);
    expect(s.reg_total_cents).toBe(200_000);
    expect(s.total_pay_cents).toBe(291_600);
  });
});
