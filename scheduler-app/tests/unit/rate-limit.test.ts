/**
 * PLAN-03 Phase 1B — unit tests for the Upstash rate-limit helpers.
 *
 * Covers:
 *   - hashPhone() — deterministic SHA-256-prefix
 *   - getRateLimiters() (via the public checkIpRateLimit / checkPhoneRateLimit
 *     functions) — disabled-when-env-vars-missing path emits a one-time
 *     Sentry warning + fails OPEN
 *   - checkIpRateLimit / checkPhoneRateLimit happy paths (success + rejection)
 *   - Upstash transient failure → fail OPEN with Sentry warning
 *
 * The Ratelimit + Redis classes are mocked at the module boundary so we
 * never hit the real Upstash service from tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const sentryCaptureMessageMock: Mock = vi.fn();
const sentryCaptureExceptionMock: Mock = vi.fn();

// Both limiter instances share a single mock `limit()` so we can program
// per-test responses. The Ratelimit constructor records which prefix it
// was instantiated with so we could differentiate IP vs phone limiter, but
// for these tests we just program the response sequence.
const ratelimitInstanceLimitMock: Mock = vi.fn();
const ratelimitConstructorMock: Mock = vi.fn(() => ({
  limit: ratelimitInstanceLimitMock,
}));
const redisConstructorMock: Mock = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => sentryCaptureMessageMock(...args),
  captureException: (...args: unknown[]) => sentryCaptureExceptionMock(...args),
}));

vi.mock("@upstash/ratelimit", () => {
  // Need a class-shaped mock with a static slidingWindow that returns
  // *something* (the constructor receives it but never inspects it in our
  // tests).
  const RatelimitMock = function (...args: unknown[]) {
    return ratelimitConstructorMock(...args);
  } as unknown as { new (...a: unknown[]): unknown };
  // Static method.
  (RatelimitMock as unknown as Record<string, unknown>).slidingWindow = (
    ...args: unknown[]
  ) => ({ __sliding: args });
  return { Ratelimit: RatelimitMock };
});

vi.mock("@upstash/redis", () => {
  const RedisMock = function (...args: unknown[]) {
    return redisConstructorMock(...args);
  } as unknown as { new (...a: unknown[]): unknown };
  return { Redis: RedisMock };
});

// Pull in the module fresh on each test so the lazy-init cache resets
// cleanly with the env-var state.
async function freshLoadRateLimit() {
  vi.resetModules();
  return await import("@/lib/security/rate-limit");
}

beforeEach(() => {
  sentryCaptureMessageMock.mockReset();
  sentryCaptureExceptionMock.mockReset();
  ratelimitInstanceLimitMock.mockReset();
  ratelimitConstructorMock.mockClear();
  redisConstructorMock.mockClear();
  // Clean env to known baseline.
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

// ─── hashPhone ─────────────────────────────────────────────────────────────

describe("hashPhone", () => {
  it("is deterministic — same input maps to the same 16-char hex", async () => {
    const { hashPhone } = await freshLoadRateLimit();
    const a = hashPhone("+15551234567");
    const b = hashPhone("+15551234567");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("returns different hashes for different inputs", async () => {
    const { hashPhone } = await freshLoadRateLimit();
    expect(hashPhone("+15551234567")).not.toBe(hashPhone("+15557654321"));
  });

  it("output length is exactly 16 hex chars (64-bit prefix)", async () => {
    const { hashPhone } = await freshLoadRateLimit();
    expect(hashPhone("+15551234567")).toHaveLength(16);
  });
});

// ─── disabled (env vars missing) path ──────────────────────────────────────

describe("rate-limit (env vars missing — disabled / fail-open)", () => {
  it("checkIpRateLimit allows + emits a one-time Sentry warning", async () => {
    const { checkIpRateLimit } = await freshLoadRateLimit();
    const result = await checkIpRateLimit("1.2.3.4");

    expect(result).toEqual({ allowed: true, disabled: true });
    expect(sentryCaptureMessageMock).toHaveBeenCalledTimes(1);
    const [msg, opts] = sentryCaptureMessageMock.mock.calls[0]!;
    expect(String(msg)).toContain("Upstash rate-limit env vars missing");
    expect((opts as { level: string }).level).toBe("warning");
    expect(
      (opts as { tags: { misconfiguration: string } }).tags.misconfiguration,
    ).toBe("upstash_missing");
  });

  it("emits the warning ONCE per process even across many calls", async () => {
    const { checkIpRateLimit, checkPhoneRateLimit } = await freshLoadRateLimit();
    await checkIpRateLimit("1.2.3.4");
    await checkPhoneRateLimit("+15551234567");
    await checkIpRateLimit("5.6.7.8");
    expect(sentryCaptureMessageMock).toHaveBeenCalledTimes(1);
  });

  it("never instantiates Redis or Ratelimit when env vars are missing", async () => {
    const { checkIpRateLimit } = await freshLoadRateLimit();
    await checkIpRateLimit("1.2.3.4");
    expect(redisConstructorMock).not.toHaveBeenCalled();
    expect(ratelimitConstructorMock).not.toHaveBeenCalled();
  });
});

// ─── enabled (env vars set) path ───────────────────────────────────────────

describe("rate-limit (env vars set — enabled)", () => {
  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  });

  it("checkIpRateLimit returns allowed:true when limiter says success", async () => {
    ratelimitInstanceLimitMock.mockResolvedValue({
      success: true,
      limit: 5,
      remaining: 4,
      reset: Date.now() + 60_000,
      pending: Promise.resolve(),
    });

    const { checkIpRateLimit } = await freshLoadRateLimit();
    const result = await checkIpRateLimit("1.2.3.4");

    expect(result).toEqual({ allowed: true, disabled: false });
    // Both limiters constructed at first call.
    expect(redisConstructorMock).toHaveBeenCalledTimes(1);
    expect(ratelimitConstructorMock).toHaveBeenCalledTimes(2);
  });

  it("checkIpRateLimit returns allowed:false rate_limited_ip when over limit", async () => {
    ratelimitInstanceLimitMock.mockResolvedValue({
      success: false,
      limit: 5,
      remaining: 0,
      reset: Date.now() + 60_000,
      pending: Promise.resolve(),
    });

    const { checkIpRateLimit } = await freshLoadRateLimit();
    const result = await checkIpRateLimit("1.2.3.4");

    expect(result).toEqual({ allowed: false, reason: "rate_limited_ip" });
  });

  it("checkPhoneRateLimit hashes the phone before keying the limiter", async () => {
    ratelimitInstanceLimitMock.mockResolvedValue({
      success: true,
      limit: 3,
      remaining: 2,
      reset: Date.now() + 3_600_000,
      pending: Promise.resolve(),
    });

    const { checkPhoneRateLimit, hashPhone } = await freshLoadRateLimit();
    await checkPhoneRateLimit("+15551234567");

    // The limit() mock is shared across both limiters in this test setup,
    // and the .limit() call should have been invoked with the hashed value
    // (NOT the raw phone — PII minimization).
    expect(ratelimitInstanceLimitMock).toHaveBeenCalledTimes(1);
    const calledWith = ratelimitInstanceLimitMock.mock.calls[0]![0];
    expect(calledWith).toBe(hashPhone("+15551234567"));
    expect(calledWith).not.toBe("+15551234567");
  });

  it("checkPhoneRateLimit returns rate_limited_phone when over limit", async () => {
    ratelimitInstanceLimitMock.mockResolvedValue({
      success: false,
      limit: 3,
      remaining: 0,
      reset: Date.now() + 3_600_000,
      pending: Promise.resolve(),
    });

    const { checkPhoneRateLimit } = await freshLoadRateLimit();
    const result = await checkPhoneRateLimit("+15551234567");
    expect(result).toEqual({ allowed: false, reason: "rate_limited_phone" });
  });

  it("fails OPEN with a Sentry warning when Upstash .limit() throws", async () => {
    // Simulates Upstash transient failure (network timeout, 503, etc.).
    // We don't want a missing Redis to break OTP — bot check + DB-level
    // phone limit are the backstops.
    const boom = new Error("upstash timeout");
    ratelimitInstanceLimitMock.mockRejectedValue(boom);

    const { checkIpRateLimit } = await freshLoadRateLimit();
    const result = await checkIpRateLimit("1.2.3.4");

    expect(result).toEqual({ allowed: true, disabled: false });
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    const [capturedErr, opts] = sentryCaptureExceptionMock.mock.calls[0]!;
    expect(capturedErr).toBe(boom);
    expect((opts as { level: string }).level).toBe("warning");
    expect((opts as { tags: { surface: string } }).tags.surface).toBe(
      "check_ip_rate_limit",
    );
  });
});
