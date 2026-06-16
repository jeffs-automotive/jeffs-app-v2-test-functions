/**
 * Unit tests for the tiny money/date formatters. fmtUsdSigned is the negative-aware
 * variant added for the refund-sign fix: a refund nets the displayed totals negative,
 * and fmtUsd alone renders that as the ugly "$-10.62" — fmtUsdSigned renders "−$10.62"
 * (leading unicode minus, matching the SalesTile / discount idiom).
 */
import { describe, it, expect } from "vitest";
import { fmtUsd, fmtUsdSigned } from "../format";

describe("fmtUsd", () => {
  it("formats positive + zero cents", () => {
    expect(fmtUsd(0)).toBe("$0.00");
    expect(fmtUsd(1062)).toBe("$10.62");
    expect(fmtUsd(1066765)).toBe("$10,667.65");
  });
});

describe("fmtUsdSigned", () => {
  it("formats a non-negative value exactly like fmtUsd", () => {
    expect(fmtUsdSigned(0)).toBe("$0.00");
    expect(fmtUsdSigned(1062)).toBe("$10.62");
    expect(fmtUsdSigned(1066765)).toBe("$10,667.65");
  });

  it("renders a negative as a leading unicode minus then the dollar amount (not '$-10.62')", () => {
    expect(fmtUsdSigned(-1062)).toBe("−$10.62");
    expect(fmtUsdSigned(-2124)).toBe("−$21.24");
    expect(fmtUsdSigned(-1066765)).toBe("−$10,667.65");
    // The minus is U+2212 (matches the SalesTile discount idiom), not an ASCII hyphen.
    expect(fmtUsdSigned(-1062).charCodeAt(0)).toBe(0x2212);
  });
});
