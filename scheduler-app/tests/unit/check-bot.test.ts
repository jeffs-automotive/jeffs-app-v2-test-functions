/**
 * PLAN-03 Phase 1A — unit tests for checkBotForSensitiveAction().
 *
 * Covers the four decision branches:
 *   1. Bot detected (isBot=true, bypassed=false) → ok:false reason:bot_detected
 *   2. Bot bypassed (isBot=true, bypassed=true) → ok:true bypassed:true
 *      (this happens when an E2E test sends the x-vercel-protection-bypass
 *      header with the correct secret — BotID flips bypassed to true even
 *      though the heuristics say bot)
 *   3. Human (isBot=false) → ok:true bypassed:false
 *   4. BotID throws → fail OPEN (ok:true) + Sentry warning emitted
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

const checkBotIdMock: Mock = vi.fn();
const sentryCaptureExceptionMock: Mock = vi.fn();

vi.mock("botid/server", () => ({
  checkBotId: (...args: unknown[]) => checkBotIdMock(...args),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => sentryCaptureExceptionMock(...args),
  captureMessage: vi.fn(),
  setTag: vi.fn(),
}));

import { checkBotForSensitiveAction } from "@/lib/security/check-bot";

beforeEach(() => {
  checkBotIdMock.mockReset();
  sentryCaptureExceptionMock.mockReset();
});

describe("checkBotForSensitiveAction", () => {
  it("returns ok:false reason:bot_detected when isBot=true and bypassed=false", async () => {
    checkBotIdMock.mockResolvedValue({
      isHuman: false,
      isBot: true,
      isVerifiedBot: false,
      bypassed: false,
    });

    const result = await checkBotForSensitiveAction();

    expect(result).toEqual({ ok: false, reason: "bot_detected" });
    expect(sentryCaptureExceptionMock).not.toHaveBeenCalled();
  });

  it("returns ok:true bypassed:true when E2E bypass header was honored", async () => {
    // When VERCEL_AUTOMATION_BYPASS_SECRET is set + the client sends
    // x-vercel-protection-bypass: <secret>, BotID flips bypassed=true even
    // though the bot detection heuristics may also be true. The bypass
    // wins → we treat as human.
    checkBotIdMock.mockResolvedValue({
      isHuman: false,
      isBot: true,
      isVerifiedBot: false,
      bypassed: true,
    });

    const result = await checkBotForSensitiveAction();

    expect(result).toEqual({ ok: true, bypassed: true });
  });

  it("returns ok:true bypassed:false for a normal human user", async () => {
    checkBotIdMock.mockResolvedValue({
      isHuman: true,
      isBot: false,
      isVerifiedBot: false,
      bypassed: false,
    });

    const result = await checkBotForSensitiveAction();

    expect(result).toEqual({ ok: true, bypassed: false });
  });

  it("fails OPEN with a Sentry warning when checkBotId() throws (default mode)", async () => {
    // Simulates BotID infra unavailable — local dev, Vercel outage, or
    // misconfigured proxy. Failing closed would break OTPs for legitimate
    // customers; we let through with telemetry instead. Rate-limit
    // defense-in-depth (Phase 1B) is the backstop.
    delete process.env.SCHEDULER_REQUIRE_RATE_LIMIT;
    const boom = new Error("vercel bot-protection unavailable");
    checkBotIdMock.mockRejectedValue(boom);

    const result = await checkBotForSensitiveAction();

    expect(result).toEqual({ ok: true, bypassed: false });
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    const [capturedErr, captureOpts] = sentryCaptureExceptionMock.mock.calls[0]!;
    expect(capturedErr).toBe(boom);
    expect((captureOpts as { level: string }).level).toBe("warning");
    expect(
      (captureOpts as { tags: { surface: string } }).tags.surface,
    ).toBe("check_bot_for_sensitive_action");
  });

  describe("P1.4 post-validator — strict mode (SCHEDULER_REQUIRE_RATE_LIMIT=true)", () => {
    it("fails CLOSED with reason=bot_check_unavailable when checkBotId throws", async () => {
      process.env.SCHEDULER_REQUIRE_RATE_LIMIT = "true";
      const boom = new Error("vercel bot-protection unavailable");
      checkBotIdMock.mockRejectedValue(boom);

      const result = await checkBotForSensitiveAction();

      expect(result).toEqual({
        ok: false,
        reason: "bot_check_unavailable",
      });
      // Strict-mode bumps Sentry to error level (not warning) — operator
      // sees the issue more prominently.
      expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
      const [, captureOpts] = sentryCaptureExceptionMock.mock.calls[0]!;
      expect((captureOpts as { level: string }).level).toBe("error");
      expect(
        (captureOpts as { tags: { strict_mode: string } }).tags.strict_mode,
      ).toBe("true");

      delete process.env.SCHEDULER_REQUIRE_RATE_LIMIT;
    });

    it("any value other than literal 'true' keeps default fail-OPEN behavior", async () => {
      process.env.SCHEDULER_REQUIRE_RATE_LIMIT = "1"; // not "true"
      const boom = new Error("transient");
      checkBotIdMock.mockRejectedValue(boom);

      const result = await checkBotForSensitiveAction();

      expect(result).toEqual({ ok: true, bypassed: false });

      delete process.env.SCHEDULER_REQUIRE_RATE_LIMIT;
    });
  });
});
