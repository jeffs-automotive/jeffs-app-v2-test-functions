/**
 * Leave-pay basis tests (round-3 decision #24): technician + shop_foreman families
 * pay PTO/Holiday/Bereavement at the SUPPLIED derived.leave_rate_cents_per_hour
 * (one rate, both weeks) while Training stays at the base hourly rate; the sheet
 * echoes the rate + its source. Every other family ignores the leave-rate inputs:
 * office_manager/support keep base-hourly leave, service_advisor stays hours-only.
 * The legacy no-rate-supplied path (golden fixtures) keeps each week's hourly rate.
 * Downstream stake: the WEEK totals must include leave at the new rate — gp.ts labor
 * proration consumes week totals.
 */
import { describe, expect, it } from "vitest";

import { computeSheet } from "../calc";
import type {
  OfficeManagerPayConfig,
  ShopForemanPayConfig,
  SupportPayConfig,
  TechnicianPayConfig,
} from "../types";

const techConfig: TechnicianPayConfig = {
  config_version: 1,
  pto_balance_hours: 0,
  pto_accrual_hours_per_period: 0,
  hourly_rate_cents: 2000, // $20 base hourly
  billed_rate_cents: 1000,
};

describe("technician leave-rate basis (round-3 #24)", () => {
  const sheet = computeSheet(
    "technician",
    techConfig,
    { clock_hours_w1: 40, pto_w1: 8, training_w1: 4, holiday_w2: 8 },
    { leave_rate_cents_per_hour: 3000, leave_rate_source: "history" },
  );

  it("pays PTO/Holiday/Bereavement at the supplied rate, Training at the base hourly rate", () => {
    expect(sheet.pto_pay_cents).toBe(24_000); // 8h × $30 — NOT 8 × $20 (16,000)
    expect(sheet.holiday_pay_cents).toBe(24_000); // 8h × $30
    expect(sheet.training_pay_cents).toBe(8_000); // 4h × $20 base hourly, NEVER the leave rate
    expect(sheet.bereavement_pay_cents).toBe(0);
  });

  it("echoes the rate + source on the sheet", () => {
    expect(sheet.leave_rate_cents_per_hour).toBe(3000);
    expect(sheet.leave_rate_source).toBe("history");
  });

  it("WEEK totals include leave at the new rate (gp.ts labor pay consumes week totals)", () => {
    // w1: base 40×$20 = 80,000 + pto 24,000 + training 8,000 = 112,000
    expect(sheet.week1.leave_pay_cents).toBe(32_000);
    expect(sheet.week1.total_pay_cents).toBe(112_000);
    // w2: no clock; holiday 8×$30 = 24,000
    expect(sheet.week2.leave_pay_cents).toBe(24_000);
    expect(sheet.week2.total_pay_cents).toBe(24_000);
    expect(sheet.total_pay_cents).toBe(136_000);
  });

  it("a supplied rate without a source reports 'base_rate' (the DAL's final fallback label)", () => {
    const s = computeSheet(
      "technician",
      techConfig,
      { pto_w1: 1 },
      { leave_rate_cents_per_hour: 2000 },
    );
    expect(s.leave_rate_source).toBe("base_rate");
    expect(s.pto_pay_cents).toBe(2000);
  });

  it("legacy path (no rate supplied): each week's hourly rate incl. rates_w2, null rate fields", () => {
    const s = computeSheet(
      "technician",
      { ...techConfig, rates_w2: { hourly_rate_cents: 2400 } },
      { pto_w1: 8, pto_w2: 5 },
      {},
    );
    expect(s.pto_pay_cents).toBe(8 * 2000 + 5 * 2400); // per-week base hourly
    expect(s.leave_rate_cents_per_hour).toBeNull();
    expect(s.leave_rate_source).toBeNull();
  });
});

describe("shop_foreman leave-rate basis", () => {
  const foremanConfig: ShopForemanPayConfig = {
    ...techConfig,
    hourly_rate_cents: 3167, // Trilli $31.67
    shop_hour_goal: 1000,
    shop_hour_bonus_cents_per_hour: 50,
  };

  it("PTO/Holiday at the supplied rate, Training at base hourly — the bonus is untouched", () => {
    const s = computeSheet(
      "shop_foreman",
      foremanConfig,
      { clock_hours_w1: 40, pto_w1: 8, training_w2: 2 },
      { leave_rate_cents_per_hour: 5306, leave_rate_source: "override", shop_hours: 1100 },
    );
    expect(s.pto_pay_cents).toBe(8 * 5306); // 42,448 — the Trilli-style avg rate
    expect(s.training_pay_cents).toBe(2 * 3167); // base hourly
    expect(s.bonus_cents).toBe(1100 * 50); // cliff bonus unaffected by the leave rate
    expect(s.leave_rate_cents_per_hour).toBe(5306);
    expect(s.leave_rate_source).toBe("override");
  });
});

describe("other families ignore the leave-rate inputs", () => {
  it("office_manager: leave stays at the week's hourly rate; rate fields null", () => {
    const omConfig: OfficeManagerPayConfig = {
      config_version: 1,
      pto_balance_hours: 0,
      pto_accrual_hours_per_period: 0,
      hourly_rate_cents: 2613,
      sales_goal_cents: 16_000_000,
      bonus_pct: 0.01,
    };
    const s = computeSheet(
      "office_manager",
      omConfig,
      { pto_w1: 8 },
      { leave_rate_cents_per_hour: 9999, leave_rate_source: "history" },
    );
    expect(s.pto_pay_cents).toBe(8 * 2613); // base hourly, NOT the supplied rate
    expect(s.leave_rate_cents_per_hour).toBeNull();
    expect(s.leave_rate_source).toBeNull();
  });

  it("support: leave stays at the week's hourly rate; rate fields null", () => {
    const supportConfig: SupportPayConfig = {
      config_version: 1,
      pto_balance_hours: 0,
      pto_accrual_hours_per_period: 0,
      hourly_rate_cents: 1600,
    };
    const s = computeSheet(
      "support",
      supportConfig,
      { holiday_w2: 8 },
      { leave_rate_cents_per_hour: 9999, leave_rate_source: "history" },
    );
    expect(s.holiday_pay_cents).toBe(8 * 1600);
    expect(s.leave_rate_cents_per_hour).toBeNull();
    expect(s.leave_rate_source).toBeNull();
  });

  it("service_advisor: hours-only leave, rate fields null", () => {
    const s = computeSheet(
      "service_advisor",
      {
        config_version: 1,
        pto_balance_hours: 0,
        pto_accrual_hours_per_period: 0,
        weekly_salary_cents: 100_000,
        gp_goal_1_cents: 11_500_000,
        gp_goal_2_cents: 12_500_000,
        sales_goal_cents: 25_000_000,
        tier1_pct: 0.005,
        tier2_pct: 0.008,
        tier3_pct: 0.012,
        spiff_amount_cents: 500,
      },
      { pto_w1: 8 },
      { leave_rate_cents_per_hour: 9999, leave_rate_source: "history" },
    );
    expect(s.pto_hours).toBe(8);
    expect(s.pto_pay_cents).toBeNull();
    expect(s.leave_rate_cents_per_hour).toBeNull();
    expect(s.leave_rate_source).toBeNull();
  });
});
