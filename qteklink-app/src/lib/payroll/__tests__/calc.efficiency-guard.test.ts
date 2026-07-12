/**
 * Efficiency-guard tests (round-9 decision #44): per WEEK, efficiency hours/pay
 * are 0 unless that week's WORKED clock hours (reg + derived OT) are STRICTLY
 * greater than 1 — the guard against the inflated-efficiency case (near-zero
 * clock + real billed hours → huge phantom efficiency = billed − ~0). Applies to
 * the technician + shop_foreman families (the only ones with an efficiency
 * concept). Billed PAY is deliberately untouched — only efficiency is guarded.
 * The #44 ADDENDUM is asserted here too: PTO/holiday/bereavement/training hours
 * NEVER enter the efficiency calc — not toward the >1 threshold (leave cannot
 * rescue it) and not in the billed−clock formula (worked clock only).
 * The real-workbook instance (Clark 5-17 w2: clock 0, billed 2, $45.32 paid) is
 * the documented Quirk C skip in calc.golden.test.ts.
 */
import { describe, expect, it } from "vitest";

import { computeSheet } from "../calc";
import type { ShopForemanPayConfig, TechnicianPayConfig } from "../types";

const techConfig: TechnicianPayConfig = {
  config_version: 1,
  pto_balance_hours: 0,
  pto_accrual_hours_per_period: 0,
  hourly_rate_cents: 2000, // $20.00/hr
  billed_rate_cents: 1000, // $10.00/hr billed
};

/** One-week technician sheet: `clock` worked hours + `billed` billed hours. */
function techWeek(clock: number, billed: number) {
  return computeSheet("technician", techConfig, { clock_hours_w1: clock }, { billed_hours_w1: billed });
}

describe("the #44 efficiency guard (technician)", () => {
  it("clock 0 → NO efficiency, even with real billed hours (the phantom-efficiency case)", () => {
    const s = techWeek(0, 10);
    expect(s.week1.efficiency_hours).toBe(0);
    expect(s.week1.efficiency_pay_cents).toBe(0);
    // Billed pay is NOT guarded — the hours were genuinely billed.
    expect(s.week1.billed_pay_cents).toBe(10_000); // 10 × $10
    expect(s.incentive_cents).toBe(10_000); // billed pay only, no efficiency
  });

  it("clock 0.5 → NO efficiency (0.5 ≤ 1)", () => {
    const s = techWeek(0.5, 10);
    expect(s.week1.efficiency_hours).toBe(0);
    expect(s.week1.efficiency_pay_cents).toBe(0);
    expect(s.week1.billed_pay_cents).toBe(10_000);
  });

  it("clock EXACTLY 1.0 → NO efficiency (strictly greater than, not ≥)", () => {
    const s = techWeek(1, 10);
    expect(s.week1.efficiency_hours).toBe(0);
    expect(s.week1.efficiency_pay_cents).toBe(0);
  });

  it("clock 1.01 → the guard opens: efficiency = billed − worked clock", () => {
    const s = techWeek(1.01, 10);
    expect(s.week1.efficiency_hours).toBe(8.99); // 10 − 1.01
    expect(s.week1.efficiency_pay_cents).toBe(17_980); // 8.99 × $20
  });

  it("a normal week is unchanged: 44 worked (40 reg + 4 OT), 50 billed → efficiency 6", () => {
    const s = techWeek(44, 50);
    expect(s.week1.efficiency_hours).toBe(6);
    expect(s.week1.efficiency_pay_cents).toBe(12_000); // 6 × $20
    expect(s.week1.billed_pay_cents).toBe(50_000);
  });

  it("the guard is per WEEK: a guarded week 1 never affects week 2 (and vice versa)", () => {
    const s = computeSheet(
      "technician",
      techConfig,
      { clock_hours_w1: 0.75, clock_hours_w2: 40 },
      { billed_hours_w1: 5, billed_hours_w2: 46 },
    );
    expect(s.week1.efficiency_hours).toBe(0); // guarded (0.75 ≤ 1)
    expect(s.week1.efficiency_pay_cents).toBe(0);
    expect(s.week2.efficiency_hours).toBe(6); // 46 − 40, untouched
    expect(s.week2.efficiency_pay_cents).toBe(12_000);
    // Incentive = billed pay both weeks + week-2 efficiency only.
    expect(s.incentive_cents).toBe(5_000 + 46_000 + 12_000);
  });

  it("the guard judges TOTAL worked clock (reg + derived OT): 41 worked, 50 billed → efficiency 9", () => {
    const s = techWeek(41, 50);
    expect(s.week1.reg_hours).toBe(40);
    expect(s.week1.ot_hours).toBe(1);
    expect(s.week1.efficiency_hours).toBe(9); // 50 − 41, the guard sees 41 > 1
  });

  it("presplit path (the golden seam) is guarded too: reg 0 + ot 0 with billed hours → NO efficiency", () => {
    const s = computeSheet(
      "technician",
      techConfig,
      { clock_hours_w1: 0 },
      { billed_hours_w1: 2 },
      { presplit: { w1: { reg: 0, ot: 0 }, w2: { reg: 40, ot: 0 } } },
    );
    expect(s.week1.efficiency_hours).toBe(0);
    expect(s.week1.efficiency_pay_cents).toBe(0);
    expect(s.week1.billed_pay_cents).toBe(2_000); // billed pay still flows
  });
});

describe("the #44 addendum: PTO/holiday/bereavement/training hours NEVER enter the efficiency calc", () => {
  it("leave hours cannot rescue the >1 threshold: clock 0.5 + PTO 39.5 → zero efficiency", () => {
    const s = computeSheet(
      "technician",
      techConfig,
      { clock_hours_w1: 0.5, pto_w1: 39.5 },
      { billed_hours_w1: 10 },
    );
    expect(s.week1.efficiency_hours).toBe(0);
    expect(s.week1.efficiency_pay_cents).toBe(0);
    // Billed pay + PTO pay still flow — only efficiency is guarded.
    expect(s.week1.billed_pay_cents).toBe(10_000); // 10 × $10
    expect(s.pto_pay_cents).toBe(79_000); // 39.5 × $20 (legacy no-leave-rate path)
    expect(s.incentive_cents).toBe(10_000); // billed pay only — no efficiency, no leave
  });

  it("mixed leave categories cannot rescue it either: clock 1 + hol 8 + ber 8 + trn 24 → zero efficiency", () => {
    const s = computeSheet(
      "technician",
      techConfig,
      { clock_hours_w1: 1, holiday_w1: 8, bereavement_w1: 8, training_w1: 24 },
      { billed_hours_w1: 10 },
    );
    expect(s.week1.efficiency_hours).toBe(0);
    expect(s.week1.efficiency_pay_cents).toBe(0);
  });

  it("the symmetric case: leave hours never inflate the billed−clock denominator (40 clock + 8 PTO, 46 billed → efficiency 6, not 0)", () => {
    const s = computeSheet(
      "technician",
      techConfig,
      { clock_hours_w1: 40, pto_w1: 8 },
      { billed_hours_w1: 46 },
    );
    expect(s.week1.efficiency_hours).toBe(6); // 46 − 40 worked clock; the 8 PTO hours don't subtract
    expect(s.week1.efficiency_pay_cents).toBe(12_000); // 6 × $20
  });
});

describe("the #44 efficiency guard (shop_foreman — same technician-family math)", () => {
  const foremanConfig: ShopForemanPayConfig = {
    ...techConfig,
    hourly_rate_cents: 3167,
    shop_hour_goal: 1000,
    shop_hour_bonus_cents_per_hour: 50,
  };

  it("a zero-clock week pays no efficiency; the shop bonus is untouched", () => {
    const s = computeSheet(
      "shop_foreman",
      foremanConfig,
      { clock_hours_w1: 0 },
      { billed_hours_w1: 12, shop_hours: 1100 },
    );
    expect(s.week1.efficiency_hours).toBe(0);
    expect(s.week1.efficiency_pay_cents).toBe(0);
    expect(s.week1.billed_pay_cents).toBe(12_000); // 12 × $10 billed rate
    expect(s.bonus_cents).toBe(1100 * 50); // the cliff bonus has its own gate
  });

  it("a normal foreman week keeps its efficiency (40 clock, 55 billed → 15)", () => {
    const s = computeSheet(
      "shop_foreman",
      foremanConfig,
      { clock_hours_w1: 40 },
      { billed_hours_w1: 55 },
    );
    expect(s.week1.efficiency_hours).toBe(15);
    expect(s.week1.efficiency_pay_cents).toBe(15 * 3167);
  });
});
