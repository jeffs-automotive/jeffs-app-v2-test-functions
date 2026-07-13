/**
 * parsePayConfig regression locks (round-11 plan §2a/§8.6): the legacy manual PTO
 * keys `pto_balance_hours` / `pto_accrual_hours_per_period` were DEMOTED from
 * required to optional so the new employee form (which no longer emits them) can
 * create employees. The verify gauntlet caught that the Zod `payConfigCommon`
 * demotion was initially missed while the SQL validator's was applied — every
 * new-employee CREATE threw a ZodError. These tests pin the exact key-less
 * payloads EmployeeForm.buildPayConfig now emits on create, per family, AND that
 * a stored config that STILL carries the keys keeps parsing (allowed-forever).
 */
import { describe, it, expect } from "vitest";
import { parsePayConfig, type Family } from "../types";

/** The minimal pay_config the create form emits per family — NO PTO keys. */
const KEYLESS_CREATE: Record<Family, Record<string, unknown>> = {
  technician: { config_version: 1, hourly_rate_cents: 3000, billed_rate_cents: 9000 },
  shop_foreman: {
    config_version: 1,
    hourly_rate_cents: 3200,
    billed_rate_cents: 9500,
    shop_hour_goal: 1100,
    shop_hour_bonus_cents_per_hour: 150,
  },
  service_advisor: {
    config_version: 1,
    weekly_salary_cents: 115_384,
    gp_goal_1_cents: 11_500_000,
    gp_goal_2_cents: 12_500_000,
    sales_goal_cents: 25_000_000,
    tier1_pct: 0.005,
    tier2_pct: 0.01,
    tier3_pct: 0.02,
    spiff_amount_cents: 500,
  },
  office_manager: { config_version: 1, hourly_rate_cents: 2600, sales_goal_cents: 25_000_000, bonus_pct: 0.01 },
  support: { config_version: 1, hourly_rate_cents: 2000 },
};

const FAMILIES = Object.keys(KEYLESS_CREATE) as Family[];

describe("parsePayConfig — the key-less CREATE payload (plan §2a demotion)", () => {
  it.each(FAMILIES)("accepts a %s config with NO legacy PTO keys", (family) => {
    const parsed = parsePayConfig(family, KEYLESS_CREATE[family]);
    expect(parsed.config_version).toBe(1);
    // The keys are absent, not zeroed — optional means "may be omitted".
    expect((parsed as Record<string, unknown>).pto_balance_hours).toBeUndefined();
    expect((parsed as Record<string, unknown>).pto_accrual_hours_per_period).toBeUndefined();
  });

  it.each(FAMILIES)("STILL accepts a %s config that carries the legacy PTO keys (allowed-forever)", (family) => {
    const withKeys = { ...KEYLESS_CREATE[family], pto_balance_hours: 40, pto_accrual_hours_per_period: 4 };
    const parsed = parsePayConfig(family, withKeys) as Record<string, unknown>;
    expect(parsed.pto_balance_hours).toBe(40);
    expect(parsed.pto_accrual_hours_per_period).toBe(4);
  });

  it("still REJECTS an unknown key (strictObject preserved)", () => {
    expect(() => parsePayConfig("support", { config_version: 1, hourly_rate_cents: 2000, bogus: 1 })).toThrow();
  });
});
