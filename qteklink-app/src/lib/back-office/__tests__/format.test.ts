import { describe, it, expect } from "vitest";
import { centsToUsd, daysSince, isStale } from "../format";

describe("centsToUsd", () => {
  it("formats cents as USD", () => {
    expect(centsToUsd(34219)).toBe("$342.19");
    expect(centsToUsd(0)).toBe("$0.00");
  });
  it("renders a dash for null/undefined", () => {
    expect(centsToUsd(null)).toBe("—");
    expect(centsToUsd(undefined)).toBe("—");
  });
});

describe("daysSince", () => {
  const now = Date.parse("2026-07-17T12:00:00Z");
  it("computes whole days", () => {
    expect(daysSince("2026-07-14T12:00:00Z", now)).toBe(3);
    expect(daysSince("2026-07-17T11:00:00Z", now)).toBe(0);
  });
  it("returns 0 for missing/invalid", () => {
    expect(daysSince(null, now)).toBe(0);
    expect(daysSince("nope", now)).toBe(0);
  });
});

describe("isStale", () => {
  const now = Date.parse("2026-07-17T12:00:00Z");
  it("is stale past the threshold", () => {
    expect(isStale("2026-07-15T00:00:00Z", 48, now)).toBe(true); // > 48h
    expect(isStale("2026-07-16T00:00:00Z", 48, now)).toBe(false); // < 48h
  });
});
