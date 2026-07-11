/**
 * period.ts — the dashboard's next-on-cadence math (the "Start new payroll run"
 * affordance) + the period-range label. Pure functions; the create-run RPC
 * re-validates cadence server-side, so these tests pin the OFFERED period.
 */
import { describe, expect, it } from "vitest";
import { fmtMonthDay, fmtPeriodRange, nextOnCadencePeriodStart } from "../period";

describe("fmtMonthDay / fmtPeriodRange", () => {
  it("drops leading zeros", () => {
    expect(fmtMonthDay("2026-06-08")).toBe("6/8");
    expect(fmtMonthDay("2026-12-27")).toBe("12/27");
  });

  it("renders the run-period label", () => {
    expect(fmtPeriodRange("2026-06-28", "2026-07-11")).toBe("6/28 – 7/11");
  });
});

describe("nextOnCadencePeriodStart", () => {
  const anchor = "2026-06-28"; // Jeff's real anchor (contract §settings)

  it("null when the anchor is unset (affordance must disable)", () => {
    expect(nextOnCadencePeriodStart(null, null, "2026-07-10")).toBeNull();
    expect(nextOnCadencePeriodStart(null, "2026-06-28", "2026-07-10")).toBeNull();
  });

  it("null when the anchor is not a valid ISO date", () => {
    expect(nextOnCadencePeriodStart("06/28/2026", null, "2026-07-10")).toBeNull();
    expect(nextOnCadencePeriodStart("2026-02-30", null, "2026-07-10")).toBeNull();
  });

  it("with prior runs: latest non-voided period + 14 (payroll is sequential)", () => {
    expect(nextOnCadencePeriodStart(anchor, "2026-06-28", "2026-07-10")).toBe("2026-07-12");
    // Even when the last run is old — periods are never skipped silently.
    expect(nextOnCadencePeriodStart(anchor, "2026-05-17", "2026-07-10")).toBe("2026-05-31");
  });

  it("fresh install: the on-cadence period containing today", () => {
    // 2026-07-10 is 12 days past the anchor → still inside the anchor period.
    expect(nextOnCadencePeriodStart(anchor, null, "2026-07-10")).toBe("2026-06-28");
    // Day 14 rolls into the next period.
    expect(nextOnCadencePeriodStart(anchor, null, "2026-07-12")).toBe("2026-07-12");
    // Deep into the future: floors to the containing period, stays on cadence.
    expect(nextOnCadencePeriodStart(anchor, null, "2026-08-01")).toBe("2026-07-26");
  });

  it("fresh install with a future anchor: offers the anchor itself", () => {
    expect(nextOnCadencePeriodStart("2026-08-09", null, "2026-07-10")).toBe("2026-08-09");
  });

  it("anchor day itself is the anchor period", () => {
    expect(nextOnCadencePeriodStart(anchor, null, anchor)).toBe(anchor);
  });
});
