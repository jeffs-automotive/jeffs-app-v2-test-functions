/**
 * Unit tests for beacon-hmac.ts (P1.5 post-validator 2026-05-25).
 *
 * Covers the four verifyBeaconSig outcomes:
 *   - "skipped"     — SCHEDULER_BEACON_HMAC_SECRET unset (dev posture)
 *   - "verified"    — sig is valid
 *   - "mismatch"    — sig present but wrong
 *   - "missing_sig" — secret configured but request had no sig
 *
 * Plus:
 *   - signBeaconChatId is deterministic + base64url (43 chars for SHA-256)
 *   - signBeaconChatId returns "" when secret unset + emits Sentry warning once
 *   - signBeaconChatId rejects short secrets (< 32 chars)
 *   - verifyBeaconSig uses timing-safe comparison
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

const sentryCaptureMessageMock: Mock = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => sentryCaptureMessageMock(...args),
  captureException: vi.fn(),
  setTag: vi.fn(),
}));

import {
  signBeaconChatId,
  signBeaconPayload,
  verifyBeaconSig,
  verifyBeaconPayloadSig,
  isBeaconHmacConfigured,
  __resetBeaconHmacWarningForTests,
} from "@/lib/security/beacon-hmac";

const CHAT_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_CHAT_ID = "00000000-0000-0000-0000-000000000002";
// 64 random hex chars = 32 bytes (above the 32-char floor enforced by
// isBeaconHmacConfigured).
const VALID_SECRET =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

beforeEach(() => {
  delete process.env.SCHEDULER_BEACON_HMAC_SECRET;
  delete process.env.SCHEDULER_REQUIRE_RATE_LIMIT;
  sentryCaptureMessageMock.mockReset();
  __resetBeaconHmacWarningForTests();
});

describe("isBeaconHmacConfigured", () => {
  it("returns false when env var is unset", () => {
    expect(isBeaconHmacConfigured()).toBe(false);
  });

  it("returns false when env var is too short (< 32 chars)", () => {
    process.env.SCHEDULER_BEACON_HMAC_SECRET = "shortsecret";
    expect(isBeaconHmacConfigured()).toBe(false);
  });

  it("returns true when env var is configured with ≥ 32 chars", () => {
    process.env.SCHEDULER_BEACON_HMAC_SECRET = VALID_SECRET;
    expect(isBeaconHmacConfigured()).toBe(true);
  });
});

describe("signBeaconChatId", () => {
  it("returns empty string + emits Sentry warning when secret unset (default strict mode off)", () => {
    const sig = signBeaconChatId(CHAT_ID);

    expect(sig).toBe("");
    expect(sentryCaptureMessageMock).toHaveBeenCalledTimes(1);
    const [msg, opts] = sentryCaptureMessageMock.mock.calls[0]!;
    expect(msg).toContain("SCHEDULER_BEACON_HMAC_SECRET not configured");
    expect((opts as { level: string }).level).toBe("warning");
    expect(
      (opts as { tags: { misconfiguration: string } }).tags.misconfiguration,
    ).toBe("secret_missing");
  });

  it("emits Sentry at ERROR level under strict mode (SCHEDULER_REQUIRE_RATE_LIMIT=true)", () => {
    process.env.SCHEDULER_REQUIRE_RATE_LIMIT = "true";

    signBeaconChatId(CHAT_ID);

    expect(sentryCaptureMessageMock).toHaveBeenCalledTimes(1);
    const [, opts] = sentryCaptureMessageMock.mock.calls[0]!;
    expect((opts as { level: string }).level).toBe("error");
    expect(
      (opts as { tags: { strict_mode: string } }).tags.strict_mode,
    ).toBe("true");
  });

  it("emits the missing-secret warning at most once per process", () => {
    signBeaconChatId(CHAT_ID);
    signBeaconChatId(CHAT_ID);
    signBeaconChatId(OTHER_CHAT_ID);

    expect(sentryCaptureMessageMock).toHaveBeenCalledTimes(1);
  });

  it("returns a 43-char base64url string when secret is configured", () => {
    process.env.SCHEDULER_BEACON_HMAC_SECRET = VALID_SECRET;

    const sig = signBeaconChatId(CHAT_ID);

    expect(sig).toHaveLength(43);
    // base64url charset (no `+` / `/`, optional `-` `_`).
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
    // No padding (base64url omits trailing `=`).
    expect(sig).not.toContain("=");
  });

  it("is deterministic — same input + same secret produces same sig", () => {
    process.env.SCHEDULER_BEACON_HMAC_SECRET = VALID_SECRET;

    const a = signBeaconChatId(CHAT_ID);
    const b = signBeaconChatId(CHAT_ID);

    expect(a).toBe(b);
  });

  it("different chatIds produce different sigs (collision resistance smoke test)", () => {
    process.env.SCHEDULER_BEACON_HMAC_SECRET = VALID_SECRET;

    const a = signBeaconChatId(CHAT_ID);
    const b = signBeaconChatId(OTHER_CHAT_ID);

    expect(a).not.toBe(b);
  });

  it("rotating the secret invalidates prior sigs (rotation-safety smoke test)", () => {
    process.env.SCHEDULER_BEACON_HMAC_SECRET = VALID_SECRET;
    const oldSig = signBeaconChatId(CHAT_ID);

    process.env.SCHEDULER_BEACON_HMAC_SECRET = VALID_SECRET.replace(
      "0",
      "f",
    );
    const newSig = signBeaconChatId(CHAT_ID);

    expect(oldSig).not.toBe(newSig);
  });
});

describe("verifyBeaconSig", () => {
  it("returns 'skipped' when secret unset (fail-OPEN posture)", () => {
    const result = verifyBeaconSig(CHAT_ID, "anything");
    expect(result).toBe("skipped");
  });

  it("returns 'verified' when sig matches the secret + chatId", () => {
    process.env.SCHEDULER_BEACON_HMAC_SECRET = VALID_SECRET;
    const sig = signBeaconChatId(CHAT_ID);

    const result = verifyBeaconSig(CHAT_ID, sig);

    expect(result).toBe("verified");
  });

  it("returns 'mismatch' when sig is wrong (correct length but wrong content)", () => {
    process.env.SCHEDULER_BEACON_HMAC_SECRET = VALID_SECRET;
    // Sig for a DIFFERENT chatId under the same secret — same length,
    // wrong bytes.
    const wrongSig = signBeaconChatId(OTHER_CHAT_ID);

    const result = verifyBeaconSig(CHAT_ID, wrongSig);

    expect(result).toBe("mismatch");
  });

  it("returns 'mismatch' when sig has wrong length (short)", () => {
    process.env.SCHEDULER_BEACON_HMAC_SECRET = VALID_SECRET;

    const result = verifyBeaconSig(CHAT_ID, "tooshort");

    // Length mismatch is detected before timingSafeEqual (which would
    // throw on length mismatch). Reports as mismatch — not a separate
    // outcome — so callers don't need to branch on attacker probe
    // patterns.
    expect(result).toBe("mismatch");
  });

  it("returns 'mismatch' when sig has wrong length (long)", () => {
    process.env.SCHEDULER_BEACON_HMAC_SECRET = VALID_SECRET;
    const tooLong = "a".repeat(100);

    const result = verifyBeaconSig(CHAT_ID, tooLong);

    expect(result).toBe("mismatch");
  });

  it("returns 'missing_sig' when sig is null", () => {
    process.env.SCHEDULER_BEACON_HMAC_SECRET = VALID_SECRET;

    const result = verifyBeaconSig(CHAT_ID, null);

    expect(result).toBe("missing_sig");
  });

  it("returns 'missing_sig' when sig is undefined", () => {
    process.env.SCHEDULER_BEACON_HMAC_SECRET = VALID_SECRET;

    const result = verifyBeaconSig(CHAT_ID, undefined);

    expect(result).toBe("missing_sig");
  });

  it("returns 'missing_sig' when sig is empty string", () => {
    process.env.SCHEDULER_BEACON_HMAC_SECRET = VALID_SECRET;

    const result = verifyBeaconSig(CHAT_ID, "");

    // Empty string is falsy → missing_sig (NOT mismatch on length).
    // Matches the IdleTimer's behavior of OMITTING `sig=` from the
    // URL when beaconSig is "" — the route never sees `sig=` in
    // the query string in that posture.
    expect(result).toBe("missing_sig");
  });

  it("rotation: sig generated under old secret fails under new secret", () => {
    process.env.SCHEDULER_BEACON_HMAC_SECRET = VALID_SECRET;
    const oldSig = signBeaconChatId(CHAT_ID);

    // Operator rotates the secret.
    process.env.SCHEDULER_BEACON_HMAC_SECRET = VALID_SECRET.replace(
      "0",
      "f",
    );

    const result = verifyBeaconSig(CHAT_ID, oldSig);
    expect(result).toBe("mismatch");
  });
});

describe("signBeaconPayload + verifyBeaconPayloadSig (validator-2-followup)", () => {
  it("payload-bound sig (chatId+step+source) round-trips correctly", () => {
    process.env.SCHEDULER_BEACON_HMAC_SECRET = VALID_SECRET;
    const sig = signBeaconPayload(CHAT_ID, "summary", "idle_timer");
    expect(verifyBeaconPayloadSig(CHAT_ID, "summary", "idle_timer", sig)).toBe(
      "verified",
    );
  });

  it("replay defense: captured sig with WRONG step → mismatch", () => {
    process.env.SCHEDULER_BEACON_HMAC_SECRET = VALID_SECRET;
    const capturedSig = signBeaconPayload(CHAT_ID, "summary", "idle_timer");
    expect(
      verifyBeaconPayloadSig(CHAT_ID, "date_pick", "idle_timer", capturedSig),
    ).toBe("mismatch");
  });

  it("replay defense: captured sig with WRONG source → mismatch", () => {
    process.env.SCHEDULER_BEACON_HMAC_SECRET = VALID_SECRET;
    const capturedSig = signBeaconPayload(CHAT_ID, "summary", "idle_timer");
    expect(
      verifyBeaconPayloadSig(CHAT_ID, "summary", "tab_close", capturedSig),
    ).toBe("mismatch");
  });

  it("legacy chatId-only sig still verifies under verifyBeaconPayloadSig (backwards compat)", () => {
    process.env.SCHEDULER_BEACON_HMAC_SECRET = VALID_SECRET;
    const legacySig = signBeaconChatId(CHAT_ID);
    expect(
      verifyBeaconPayloadSig(CHAT_ID, "anything", "tab_close", legacySig),
    ).toBe("verified");
  });

  it("different sources produce different sigs", () => {
    process.env.SCHEDULER_BEACON_HMAC_SECRET = VALID_SECRET;
    const a = signBeaconPayload(CHAT_ID, "summary", "idle_timer");
    const b = signBeaconPayload(CHAT_ID, "summary", "tab_close");
    expect(a).not.toBe(b);
  });

  it("different steps produce different sigs", () => {
    process.env.SCHEDULER_BEACON_HMAC_SECRET = VALID_SECRET;
    const a = signBeaconPayload(CHAT_ID, "summary", "idle_timer");
    const b = signBeaconPayload(CHAT_ID, "date_pick", "idle_timer");
    expect(a).not.toBe(b);
  });

  it("signBeaconPayload returns empty string when secret missing", () => {
    const sig = signBeaconPayload(CHAT_ID, "summary", "idle_timer");
    expect(sig).toBe("");
  });

  it("missing sig → missing_sig under verifyBeaconPayloadSig", () => {
    process.env.SCHEDULER_BEACON_HMAC_SECRET = VALID_SECRET;
    expect(
      verifyBeaconPayloadSig(CHAT_ID, "summary", "idle_timer", null),
    ).toBe("missing_sig");
  });

  it("no secret → skipped under verifyBeaconPayloadSig", () => {
    expect(
      verifyBeaconPayloadSig(CHAT_ID, "summary", "idle_timer", "anything"),
    ).toBe("skipped");
  });

});
