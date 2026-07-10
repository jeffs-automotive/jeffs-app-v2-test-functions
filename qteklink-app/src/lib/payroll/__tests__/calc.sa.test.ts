/**
 * Synthetic service-advisor bonus-tier tests. The golden workbook fixtures only ever
 * exercise tier3 (all 8 non-zero bonus cells) or the zero branch — tier1/tier2 and the
 * workbook's surprising "sales over goal but GP-with-fees under goal 1 pays NOTHING"
 * edge have no real-workbook coverage, so this file locks every branch of the tier
 * ladder (extraction §Service Advisor, decision #3) with exact cent assertions:
 *   sales > goal AND gpWith > gp2 → gpWithout × tier3
 *   sales > goal AND gpWith > gp1 → gpWithout × tier2
 *   sales ≤ goal AND gpWith > gp1 → gpWithout × tier1
 *   else 0
 * The TIER qualifies on GP-WITH-fees (+ sales vs goal); the payout % applies to
 * GP-WITHOUT-fees — every case here keeps gpWith ≠ gpWithout and distinct tier pcts
 * so a swapped pct or a payout computed off gpWith fails on exact cents.
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
  sales_goal_cents: 25_000_000, // $250,000
  tier1_pct: 0.005,
  tier2_pct: 0.008,
  tier3_pct: 0.012,
  spiff_amount_cents: 500, // $5/spiff
};

function sa(derived: DerivedInputs) {
  return computeSheet("service_advisor", saConfig, {}, derived);
}

describe("service-advisor bonus tier ladder", () => {
  it("tier1: sales ≤ goal AND gpWith > gp1 → gpWithout × tier1_pct", () => {
    const s = sa({
      month_sales_cents: 24_000_000, // under the $250k goal
      month_gp_with_fees_cents: 12_000_000, // over gp1 ($115k)
      month_gp_without_fees_cents: 10_700_000,
    });
    // 10,700,000 × 0.005 = 53,500 — NOT gpWith × 0.005 (60,000), NOT tier2 (85,600).
    expect(s.bonus_cents).toBe(53_500);
  });

  it("boundary: sales == goal stays on the tier1 path even when gpWith clears gp2", () => {
    const s = sa({
      month_sales_cents: 25_000_000, // exactly the goal — strict > gates tier2/tier3
      month_gp_with_fees_cents: 13_000_000, // over gp2, but sales didn't beat the goal
      month_gp_without_fees_cents: 12_000_000,
    });
    // tier1: 12,000,000 × 0.005 = 60,000 — NOT tier3 (144,000).
    expect(s.bonus_cents).toBe(60_000);
  });

  it("tier2: sales > goal AND gp1 < gpWith ≤ gp2 → gpWithout × tier2_pct", () => {
    const s = sa({
      month_sales_cents: 26_000_000,
      month_gp_with_fees_cents: 12_000_000, // between gp1 and gp2
      month_gp_without_fees_cents: 10_700_000,
    });
    // 10,700,000 × 0.008 = 85,600 — a payout off gpWith would be 96,000.
    expect(s.bonus_cents).toBe(85_600);
  });

  it("boundary: gpWith == gp2 stays tier2 (strict > for tier3)", () => {
    const s = sa({
      month_sales_cents: 26_000_000,
      month_gp_with_fees_cents: 12_500_000, // exactly gp2
      month_gp_without_fees_cents: 11_000_000,
    });
    // tier2: 11,000,000 × 0.008 = 88,000 — NOT tier3 (132,000).
    expect(s.bonus_cents).toBe(88_000);
  });

  it("boundary: one cent over gp2 flips to tier3", () => {
    const s = sa({
      month_sales_cents: 26_000_000,
      month_gp_with_fees_cents: 12_500_001,
      month_gp_without_fees_cents: 11_000_000,
    });
    // tier3: 11,000,000 × 0.012 = 132,000.
    expect(s.bonus_cents).toBe(132_000);
  });

  it("the workbook's zero edge: sales > goal but gpWith ≤ gp1 pays NOTHING (gp1 is a hard floor)", () => {
    const atGp1 = sa({
      month_sales_cents: 30_000_000, // far over the goal
      month_gp_with_fees_cents: 11_500_000, // exactly gp1 — strict > required
      month_gp_without_fees_cents: 11_000_000,
    });
    expect(atGp1.bonus_cents).toBe(0);
    const underGp1 = sa({
      month_sales_cents: 30_000_000,
      month_gp_with_fees_cents: 11_000_000, // under gp1
      month_gp_without_fees_cents: 10_500_000,
    });
    expect(underGp1.bonus_cents).toBe(0);
  });

  it("all-miss: sales ≤ goal AND gpWith ≤ gp1 → 0", () => {
    const s = sa({
      month_sales_cents: 20_000_000,
      month_gp_with_fees_cents: 11_000_000,
      month_gp_without_fees_cents: 10_000_000,
    });
    expect(s.bonus_cents).toBe(0);
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
