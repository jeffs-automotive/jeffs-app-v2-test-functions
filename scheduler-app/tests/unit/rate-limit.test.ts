/**
 * SEC-7 — unit tests for the Postgres-backed per-phone rate limiter.
 *
 * Covers:
 *   - hashPhone() — deterministic SHA-256-prefix (PII-minimizing key)
 *   - checkPhoneRateLimit() calls the check_and_increment_rate_limit RPC
 *     via the service-role admin client, keyed on the HASHED phone
 *   - allowed + denied (rate_limited_phone) paths
 *   - RPC error → fail-OPEN by default (+ Sentry warning); fail-CLOSED
 *     (rate_limit_unavailable) under SCHEDULER_REQUIRE_RATE_LIMIT
 *
 * The admin client + strict-mode flag are mocked at the module boundary,
 * so these tests never touch a real database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// ─── Mocks (factories are closures; the consts are initialized before the
//     SUT import runs them — same pattern as the prior Upstash test) ───────
const rpcMock: Mock = vi.fn();
const captureExceptionMock: Mock = vi.fn();
let strictMode = false;

vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  captureMessage: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock }),
}));

vi.mock("@/lib/security/check-bot", () => ({
  isRateLimitStrictMode: () => strictMode,
}));

import {
  checkPhoneRateLimit,
  hashPhone,
} from "@/lib/security/rate-limit";

const PHONE = "+15551234567";

beforeEach(() => {
  rpcMock.mockReset();
  captureExceptionMock.mockReset();
  strictMode = false;
});

// ─── hashPhone ─────────────────────────────────────────────────────────────

describe("hashPhone", () => {
  it("is deterministic — same input maps to the same 16-char hex", () => {
    expect(hashPhone(PHONE)).toBe(hashPhone(PHONE));
    expect(hashPhone(PHONE)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("returns different hashes for different inputs", () => {
    expect(hashPhone(PHONE)).not.toBe(hashPhone("+15557654321"));
  });
});

// ─── checkPhoneRateLimit ─────────────────────────────────────────────────────

describe("checkPhoneRateLimit", () => {
  it("calls the RPC with the HASHED phone key + 15/hour budget; allows when under", async () => {
    rpcMock.mockResolvedValue({
      data: [{ allowed: true, retry_after_seconds: 0 }],
      error: null,
    });

    const result = await checkPhoneRateLimit(PHONE);

    expect(result).toEqual({ allowed: true });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [fn, args] = rpcMock.mock.calls[0]!;
    expect(fn).toBe("check_and_increment_rate_limit");
    expect(args).toEqual({
      p_key: `otp_phone:${hashPhone(PHONE)}`,
      p_window_seconds: 3600,
      p_max: 15,
    });
    // PII minimization — the raw phone never reaches the RPC key.
    expect((args as { p_key: string }).p_key).not.toContain(PHONE);
  });

  it("returns rate_limited_phone when the RPC denies", async () => {
    rpcMock.mockResolvedValue({
      data: [{ allowed: false, retry_after_seconds: 1200 }],
      error: null,
    });

    const result = await checkPhoneRateLimit(PHONE);
    expect(result).toEqual({ allowed: false, reason: "rate_limited_phone" });
  });

  it("fails OPEN (allowed) + emits a Sentry warning when the RPC errors", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "db boom" } });

    const result = await checkPhoneRateLimit(PHONE);

    expect(result).toEqual({ allowed: true });
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [, opts] = captureExceptionMock.mock.calls[0]!;
    expect((opts as { level: string }).level).toBe("warning");
    expect((opts as { tags: { surface: string } }).tags.surface).toBe(
      "check_phone_rate_limit",
    );
  });

  it("fails CLOSED (rate_limit_unavailable) on RPC error under strict mode", async () => {
    strictMode = true;
    rpcMock.mockResolvedValue({ data: null, error: { message: "db boom" } });

    const result = await checkPhoneRateLimit(PHONE);

    expect(result).toEqual({ allowed: false, reason: "rate_limit_unavailable" });
    const [, opts] = captureExceptionMock.mock.calls[0]!;
    expect((opts as { level: string }).level).toBe("error");
  });

  it("fails OPEN if the admin client / RPC throws (transient)", async () => {
    rpcMock.mockRejectedValue(new Error("connection reset"));

    const result = await checkPhoneRateLimit(PHONE);
    expect(result).toEqual({ allowed: true });
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });
});
