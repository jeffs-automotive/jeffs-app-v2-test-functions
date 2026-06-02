import { describe, it, expect } from "vitest";
import {
  resolveQboEnvironment,
  qboBaseUrl,
  QBO_MINORVERSION,
} from "@/lib/qbo/config";

const env = (o: Record<string, string>): NodeJS.ProcessEnv =>
  o as unknown as NodeJS.ProcessEnv;

describe("qbo config", () => {
  it("defaults to production (plan decision #5) — only sandbox is explicit", () => {
    expect(resolveQboEnvironment(env({}))).toBe("production");
    expect(resolveQboEnvironment(env({ QBO_ENVIRONMENT: "production" }))).toBe(
      "production",
    );
    // Any non-"sandbox" value is treated as production (fail-safe to the real
    // books only via explicit opt-out, never silently to sandbox).
    expect(resolveQboEnvironment(env({ QBO_ENVIRONMENT: "weird" }))).toBe(
      "production",
    );
  });

  it("honors QBO_ENVIRONMENT=sandbox", () => {
    expect(resolveQboEnvironment(env({ QBO_ENVIRONMENT: "sandbox" }))).toBe(
      "sandbox",
    );
  });

  it("maps environment → the correct Accounting API base URL", () => {
    expect(qboBaseUrl("production")).toBe("https://quickbooks.api.intuit.com");
    expect(qboBaseUrl("sandbox")).toBe(
      "https://sandbox-quickbooks.api.intuit.com",
    );
  });

  it("pins minorversion 75 (current + only supported per Intuit 2025-08-01)", () => {
    expect(QBO_MINORVERSION).toBe("75");
  });
});
