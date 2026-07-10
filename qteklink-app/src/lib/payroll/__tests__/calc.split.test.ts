/**
 * Synthetic tests for the >40 auto-splitter (decision #6: TOTAL worked clock in,
 * reg = min(40, total) + OT = max(0, total − 40) out; the workbook's separate manual
 * OT entry is gone) and for the split flowing through computeSheet without a presplit.
 * The golden suite covers the pay formulas; this file owns the splitter semantics.
 */
import { describe, expect, it } from "vitest";

import { computeSheet, splitClock } from "../calc";
import type { SheetEntries, SupportPayConfig, TechnicianPayConfig } from "../types";

describe("splitClock", () => {
  it("exactly 40 → all regular, zero OT", () => {
    expect(splitClock(40)).toEqual({ reg: 40, ot: 0 });
  });

  it("under 40 stays regular (38.25)", () => {
    expect(splitClock(38.25)).toEqual({ reg: 38.25, ot: 0 });
  });

  it("over 40 splits at the threshold (47.3 → 40 reg + 7.3 OT)", () => {
    expect(splitClock(47.3)).toEqual({ reg: 40, ot: 7.3 });
  });

  it("zero → zero/zero", () => {
    expect(splitClock(0)).toEqual({ reg: 0, ot: 0 });
  });

  it("a single hundredth over the line is OT (40.01 → 0.01 OT)", () => {
    expect(splitClock(40.01)).toEqual({ reg: 40, ot: 0.01 });
  });

  it("float noise at the boundary cannot fabricate phantom OT (2dp rounding)", () => {
    // 0.1+0.2-style representation noise: 40 + 1e-9 must NOT yield ot > 0.
    expect(splitClock(40.000000001)).toEqual({ reg: 40, ot: 0 });
  });

  it("decision #6 by design: the old 'pre-approved OT on a short week' cannot happen — 35 worked + 2 'OT' is keyed as 37 total → NO OT", () => {
    // Under the workbook's manual-OT model this would have been reg 35 + OT 2.
    expect(splitClock(35 + 2)).toEqual({ reg: 37, ot: 0 });
  });
});

// ── The split through computeSheet (no presplit → splitClock drives the pay) ────

const supportConfig: SupportPayConfig = {
  config_version: 1,
  pto_balance_hours: 0,
  pto_accrual_hours_per_period: 0,
  hourly_rate_cents: 2000, // $20.00/hr
};

const emptyEntries: SheetEntries = {};

describe("computeSheet derives reg/OT from total worked clock", () => {
  it("45.5 total → 40 reg @ $20 + 5.5 OT @ 1.5×", () => {
    const s = computeSheet("support", supportConfig, { ...emptyEntries, clock_hours_w1: 45.5 }, {});
    expect(s.week1.reg_hours).toBe(40);
    expect(s.week1.ot_hours).toBe(5.5);
    expect(s.week1.base_pay_cents).toBe(80_000); // 40 × 2000
    expect(s.week1.ot_pay_cents).toBe(16_500); // 5.5 × 2000 × 1.5
    expect(s.reg_hours).toBe(40);
    expect(s.ot_hours).toBe(5.5);
    expect(s.total_pay_cents).toBe(96_500);
  });

  it("a 37-hour week yields NO OT pay (the pre-approved-OT case is gone by design)", () => {
    const s = computeSheet("support", supportConfig, { ...emptyEntries, clock_hours_w1: 37 }, {});
    expect(s.ot_hours).toBe(0);
    expect(s.week1.ot_pay_cents).toBe(0);
    expect(s.total_pay_cents).toBe(74_000); // 37 × 2000, nothing else
  });

  it("decision #16: PTO/Holiday hours NEVER trigger OT — 38 worked + 8 PTO stays regular", () => {
    const s = computeSheet("support", supportConfig, { ...emptyEntries, clock_hours_w1: 38, pto_w1: 8 }, {});
    expect(s.ot_hours).toBe(0);
    expect(s.week1.ot_pay_cents).toBe(0);
    expect(s.pto_pay_cents).toBe(16_000); // PTO paid at the hourly rate…
    expect(s.total_pay_cents).toBe(76_000 + 16_000); // …on top of 38 worked hours
  });

  it("the two weeks split independently (41 + 39 ≠ 80 flat)", () => {
    const s = computeSheet(
      "support",
      supportConfig,
      { ...emptyEntries, clock_hours_w1: 41, clock_hours_w2: 39 },
      {},
    );
    expect(s.week1.ot_hours).toBe(1);
    expect(s.week2.ot_hours).toBe(0);
    expect(s.reg_hours).toBe(79);
    expect(s.ot_hours).toBe(1);
  });

  it("technician efficiency uses TOTAL worked clock (reg + derived OT), matching the workbook's billed − (clock + OT)", () => {
    const config: TechnicianPayConfig = {
      config_version: 1,
      pto_balance_hours: 0,
      pto_accrual_hours_per_period: 0,
      hourly_rate_cents: 2000,
      billed_rate_cents: 1000,
    };
    // 44 worked (40 reg + 4 OT), 50 billed → efficiency = 50 − 44 = 6, not 50 − 40.
    const s = computeSheet("technician", config, { ...emptyEntries, clock_hours_w1: 44 }, { billed_hours_w1: 50 });
    expect(s.week1.efficiency_hours).toBe(6);
    expect(s.week1.efficiency_pay_cents).toBe(12_000); // 6 × $20 (hourly, not billed, rate)
    expect(s.week1.billed_pay_cents).toBe(50_000); // 50 × $10
  });

  it("rates_w2 mid-period change: week 2 pays at the override rate", () => {
    const s = computeSheet(
      "support",
      { ...supportConfig, rates_w2: { hourly_rate_cents: 2200 } },
      { ...emptyEntries, clock_hours_w1: 40, clock_hours_w2: 40 },
      {},
    );
    expect(s.week1.base_pay_cents).toBe(80_000); // 40 × $20 (week 1 = base fields, always)
    expect(s.week2.base_pay_cents).toBe(88_000); // 40 × $22
  });
});
