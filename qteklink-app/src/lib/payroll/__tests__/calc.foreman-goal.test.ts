/**
 * Shop-foreman hour-goal resolution tests (round-5 decision #32): the goal the
 * cliff bonus is judged against comes from the DAL-derived inputs with three
 * tiers of precedence — override (source 'override') → prior-year same-month
 * shop hours (source 'prior_year') → the legacy pay_config.shop_hour_goal
 * (source 'config', used only when derivation had no data). The bonus condition
 * itself stays STRICTLY greater-than (beating last year by ≥ 0.01h at 2dp ≡
 * strict >), and the sheet echoes the effective goal + its source for
 * provenance. Every other family reports null goal fields.
 */
import { describe, expect, it } from "vitest";

import { computeSheet } from "../calc";
import type { ShopForemanPayConfig, TechnicianPayConfig } from "../types";

const config: ShopForemanPayConfig = {
  config_version: 1,
  pto_balance_hours: 0,
  pto_accrual_hours_per_period: 0,
  hourly_rate_cents: 3167,
  billed_rate_cents: 1500,
  shop_hour_goal: 1000, // the LEGACY fallback
  shop_hour_bonus_cents_per_hour: 50,
};

describe("shop_foreman goal precedence (round-5 #32)", () => {
  it("a derived prior-year goal beats the pay_config legacy value", () => {
    // Legacy goal 1000 would pay; the derived prior-year goal 1200 must win → no bonus.
    const s = computeSheet(
      "shop_foreman",
      config,
      {},
      { shop_hours: 1150, shop_hour_goal: 1200, shop_hour_goal_source: "prior_year" },
    );
    expect(s.bonus_cents).toBe(0);
    expect(s.shop_hour_goal).toBe(1200);
    expect(s.shop_hour_goal_source).toBe("prior_year");
  });

  it("pays on ALL shop hours (not the excess) once the derived goal is beaten", () => {
    const s = computeSheet(
      "shop_foreman",
      config,
      {},
      { shop_hours: 1250, shop_hour_goal: 1200, shop_hour_goal_source: "prior_year" },
    );
    expect(s.bonus_cents).toBe(1250 * 50); // cliff: all hours × rate
  });

  it("an override-sourced goal passes through to the sheet", () => {
    const s = computeSheet(
      "shop_foreman",
      config,
      {},
      { shop_hours: 1150, shop_hour_goal: 1100, shop_hour_goal_source: "override" },
    );
    expect(s.bonus_cents).toBe(1150 * 50);
    expect(s.shop_hour_goal).toBe(1100);
    expect(s.shop_hour_goal_source).toBe("override");
  });

  it("no derived goal → the legacy pay_config.shop_hour_goal, source 'config'", () => {
    const s = computeSheet("shop_foreman", config, {}, { shop_hours: 1000.5 });
    expect(s.bonus_cents).toBe(50_025); // 1000.5 × 50 against the legacy 1000 goal
    expect(s.shop_hour_goal).toBe(1000);
    expect(s.shop_hour_goal_source).toBe("config");
  });

  it("strict >: exactly AT the goal pays nothing; 0.01h over pays (2dp semantics)", () => {
    const at = computeSheet(
      "shop_foreman",
      config,
      {},
      { shop_hours: 1100, shop_hour_goal: 1100, shop_hour_goal_source: "prior_year" },
    );
    expect(at.bonus_cents).toBe(0);
    const over = computeSheet(
      "shop_foreman",
      config,
      { clock_hours_w1: 0 },
      { shop_hours: 1100.01, shop_hour_goal: 1100, shop_hour_goal_source: "prior_year" },
    );
    expect(over.bonus_cents).toBeGreaterThan(0); // beat by 0.01 at 2dp ≡ strict >
  });

  it("a derived goal without a source labels itself 'prior_year' (the DAL default path)", () => {
    const s = computeSheet("shop_foreman", config, {}, { shop_hours: 900, shop_hour_goal: 950 });
    expect(s.shop_hour_goal_source).toBe("prior_year");
    expect(s.bonus_cents).toBe(0);
  });

  it("every other family reports null goal fields even when the inputs carry them", () => {
    const techConfig: TechnicianPayConfig = {
      config_version: 1,
      pto_balance_hours: 0,
      pto_accrual_hours_per_period: 0,
      hourly_rate_cents: 2300,
      billed_rate_cents: 1000,
    };
    const s = computeSheet(
      "technician",
      techConfig,
      {},
      { shop_hours: 1200, shop_hour_goal: 999, shop_hour_goal_source: "prior_year" },
    );
    expect(s.shop_hour_goal).toBeNull();
    expect(s.shop_hour_goal_source).toBeNull();
    expect(s.bonus_cents).toBeNull(); // technicians have no bonus concept
  });
});
