/**
 * Unit tests for checkPhoneRateLimit (SEC-7 per-phone OTP limiter).
 *
 * Pins the per-phone budget passed to the `check_and_increment_rate_limit`
 * RPC: 15 sends / phone-hash / 3600s (raised from 3 → 15 on 2026-07-17). A
 * regression that silently reverts the cap fails here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// ─── Module mocks ──────────────────────────────────────────────────────────

const rpcMock: Mock = vi.fn(async () => ({
  data: [{ allowed: true, retry_after_seconds: null }],
  error: null,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: (...args: unknown[]) => rpcMock(...args),
  }),
}));

vi.mock("@/lib/security/check-bot", () => ({
  isRateLimitStrictMode: () => false,
}));

const sentryCaptureExceptionMock: Mock = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => sentryCaptureExceptionMock(...args),
  captureMessage: vi.fn(),
}));

import { checkPhoneRateLimit, hashPhone } from "@/lib/security/rate-limit";

beforeEach(() => {
  rpcMock.mockClear();
  sentryCaptureExceptionMock.mockClear();
});

describe("checkPhoneRateLimit — per-phone OTP budget", () => {
  it("calls the RPC with the 15-sends-per-hour budget (window 3600s)", async () => {
    const phone = "+16105551234";
    const outcome = await checkPhoneRateLimit(phone);

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const call = rpcMock.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("RPC was not called");
    const [fnName, args] = call;
    expect(fnName).toBe("check_and_increment_rate_limit");
    expect(args).toEqual({
      p_key: `otp_phone:${hashPhone(phone)}`,
      p_window_seconds: 3600,
      p_max: 15,
    });
    expect(outcome).toEqual({ allowed: true });
  });

  it("returns rate_limited_phone when the RPC reports the bucket is full", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ allowed: false, retry_after_seconds: 900 }],
      error: null,
    });
    const outcome = await checkPhoneRateLimit("+16105551234");
    expect(outcome.allowed).toBe(false);
    if (!outcome.allowed) {
      expect(outcome.reason).toBe("rate_limited_phone");
    }
  });
});
