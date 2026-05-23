/**
 * PLAN-03 Phase 1B — unit tests for getRequestIp().
 *
 * Covers the three relevant branches:
 *   - x-forwarded-for present, single value → return it trimmed
 *   - x-forwarded-for present, comma-separated → return the LEFT-MOST
 *     (the original client; intermediaries are proxies)
 *   - x-forwarded-for missing → return "unknown" (rate-limiter still
 *     gets a key to bucket on)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

const headersGetMock: Mock = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (key: string) => headersGetMock(key),
  }),
}));

import { getRequestIp } from "@/lib/security/get-request-ip";

beforeEach(() => {
  headersGetMock.mockReset();
});

describe("getRequestIp", () => {
  it("returns the trimmed first IP from a comma-separated x-forwarded-for", async () => {
    headersGetMock.mockImplementation((key: string) =>
      key === "x-forwarded-for" ? "203.0.113.42, 10.0.0.1, 10.0.0.2" : null,
    );
    expect(await getRequestIp()).toBe("203.0.113.42");
  });

  it("returns the single IP when x-forwarded-for has only one value", async () => {
    headersGetMock.mockImplementation((key: string) =>
      key === "x-forwarded-for" ? "203.0.113.42" : null,
    );
    expect(await getRequestIp()).toBe("203.0.113.42");
  });

  it("trims surrounding whitespace from the first value", async () => {
    headersGetMock.mockImplementation((key: string) =>
      key === "x-forwarded-for" ? "  203.0.113.42  , 10.0.0.1" : null,
    );
    expect(await getRequestIp()).toBe("203.0.113.42");
  });

  it("returns 'unknown' when x-forwarded-for is missing", async () => {
    headersGetMock.mockImplementation(() => null);
    expect(await getRequestIp()).toBe("unknown");
  });

  it("returns 'unknown' when x-forwarded-for is empty string", async () => {
    headersGetMock.mockImplementation((key: string) =>
      key === "x-forwarded-for" ? "" : null,
    );
    expect(await getRequestIp()).toBe("unknown");
  });
});
