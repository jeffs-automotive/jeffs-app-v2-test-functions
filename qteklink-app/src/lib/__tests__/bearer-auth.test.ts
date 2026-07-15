import { describe, it, expect } from "vitest";
import { bearerMatches } from "@/lib/bearer-auth";

describe("bearerMatches (constant-time bearer verification)", () => {
  const SECRET = "s3cr3t-payroll-mirror-apply-key";

  it("accepts the exact Bearer <secret> header", () => {
    expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects a wrong secret", () => {
    expect(bearerMatches(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(bearerMatches(`Bearer wrong`, SECRET)).toBe(false);
  });

  it("rejects a missing/blank scheme or header", () => {
    expect(bearerMatches(SECRET, SECRET)).toBe(false); // no "Bearer " prefix
    expect(bearerMatches("", SECRET)).toBe(false);
    expect(bearerMatches(null, SECRET)).toBe(false);
    expect(bearerMatches(undefined, SECRET)).toBe(false);
  });

  it("rejects when the configured secret is missing (never authorizes on empty)", () => {
    expect(bearerMatches("Bearer ", undefined)).toBe(false);
    expect(bearerMatches("Bearer ", "")).toBe(false);
    expect(bearerMatches("Bearer anything", null)).toBe(false);
  });

  it("is case-sensitive on the scheme and value", () => {
    expect(bearerMatches(`bearer ${SECRET}`, SECRET)).toBe(false);
    expect(bearerMatches(`Bearer ${SECRET.toUpperCase()}`, SECRET)).toBe(false);
  });
});
