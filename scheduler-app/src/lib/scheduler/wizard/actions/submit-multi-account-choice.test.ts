/**
 * Unit tests for submitMultiAccountChoiceV2 — narrowed to the Plan 04
 * Phase 3B IDOR-defense surface (closes I-COR-5) + the combined-read
 * refactor (phone_e164 + pending_candidates in one query).
 *
 * Surface under test:
 *   - 'none_of_these' → no IDOR check, advances to no_match_choose_path
 *   - 'select' branch:
 *       - selected_customer_id in pending_candidates → proceeds through
 *         write + OTP, advances to otp_pending
 *       - selected_customer_id NOT in pending_candidates → IDOR reject
 *         (customer_id_invalid) + Sentry warning, NO write or OTP send
 *       - pending_candidates is null → reject same as above
 *       - bot gate fires → returns bot_detected, NO read/write
 *       - IP rate-limit fires → returns rate-limit reason, NO write
 *       - phone rate-limit fires → returns rate-limit reason, NO write
 *
 * Spec correction: PLAN-04 spec used `Array<{ id: number }>` for
 * pending_candidates membership, but the actual stored shape per the
 * writer at supabase/functions/scheduler-step2-direct/index.ts:262-269
 * is `Array<{ customer_id: number; recent_vehicle: string }>`. Tests
 * use the corrected shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// ─── Module mocks ──────────────────────────────────────────────────────────

const sentryCaptureExceptionMock: Mock = vi.fn();
const sentryCaptureMessageMock: Mock = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => sentryCaptureExceptionMock(...args),
  captureMessage: (...args: unknown[]) => sentryCaptureMessageMock(...args),
  setTag: vi.fn(),
  withServerActionInstrumentation: (
    _name: string,
    _options: unknown,
    callback: () => Promise<unknown>,
  ) => callback(),
}));

interface AwtCall {
  chatId: string;
  nextStep: string;
  jeffBubble?: string;
  updates?: Record<string, unknown>;
}
const awtCalls: AwtCall[] = [];
vi.mock("@/lib/scheduler/wizard/transition", () => ({
  applyWizardTransition: vi.fn(async (args: AwtCall) => {
    awtCalls.push(args);
    return { ok: true, next_step: args.nextStep };
  }),
}));

// callOtpResend — the OTP send that fires after a successful 'select'
// IDOR-check pass + DB write.
interface OtpResendCall {
  session_id: string;
}
const otpResendCalls: OtpResendCall[] = [];
let otpResendResult: { ok: true } | { ok: false; error: string } | (() => Promise<{ ok: true } | { ok: false; error: string }>) = {
  ok: true,
};
vi.mock("@/lib/scheduler/otp-direct-client", () => ({
  callOtpResend: vi.fn(async (args: OtpResendCall) => {
    otpResendCalls.push(args);
    if (typeof otpResendResult === "function") return otpResendResult();
    return otpResendResult;
  }),
  OtpDirectError: class OtpDirectError extends Error {
    status?: number;
  },
}));

// Security gates — each individually configurable per test.
let botCheckResult: { ok: boolean } = { ok: true };
vi.mock("@/lib/security/check-bot", () => ({
  checkBotForSensitiveAction: vi.fn(async () => botCheckResult),
}));

let ipCheckResult: { allowed: boolean; reason: string } = {
  allowed: true,
  reason: "",
};
let phoneCheckResult: { allowed: boolean; reason: string } = {
  allowed: true,
  reason: "",
};
vi.mock("@/lib/security/rate-limit", () => ({
  checkIpRateLimit: vi.fn(async () => ipCheckResult),
  checkPhoneRateLimit: vi.fn(async () => phoneCheckResult),
}));

vi.mock("@/lib/security/get-request-ip", () => ({
  getRequestIp: vi.fn(async () => "1.2.3.4"),
}));

// Supabase mock — supports BOTH the combined SELECT (phone_e164 +
// pending_candidates) AND the UPDATE that writes customer_id.
interface ChainCall {
  table: string;
  op: "select" | "update";
  payload?: Record<string, unknown>;
  cols?: string;
  match: Array<{ col: string; val: unknown }>;
}
const chainCalls: ChainCall[] = [];

let combinedReadResult: {
  data:
    | {
        phone_e164: string | null;
        pending_candidates: unknown;
      }
    | null;
  error: unknown;
} = {
  data: {
    phone_e164: "+15551234567",
    pending_candidates: [
      { customer_id: 9001, recent_vehicle: "2019 Toyota Camry" },
      { customer_id: 9002, recent_vehicle: "2021 Honda CR-V" },
    ],
  },
  error: null,
};

let updateResult: { error: unknown } = { error: null };

function makeMockClient() {
  return {
    from(table: string) {
      let currentCall: ChainCall | null = null;
      const builder = {
        select(cols: string) {
          currentCall = { table, op: "select", cols, match: [] };
          chainCalls.push(currentCall);
          return builder;
        },
        update(payload: Record<string, unknown>) {
          currentCall = { table, op: "update", payload, match: [] };
          chainCalls.push(currentCall);
          return builder;
        },
        eq(col: string, val: unknown) {
          currentCall?.match.push({ col, val });
          return builder;
        },
        async maybeSingle() {
          return combinedReadResult;
        },
        async then(resolve: (v: { error: unknown }) => unknown) {
          // update().eq() resolves as thenable
          return resolve(updateResult);
        },
      };
      return builder;
    },
  };
}
const createSupabaseAdminClientMock: Mock = vi.fn(() => makeMockClient());
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => createSupabaseAdminClientMock(),
}));

// Import the SUT after mocks are wired.
import { submitMultiAccountChoiceV2 } from "./submit-multi-account-choice";

// ─── Helpers ───────────────────────────────────────────────────────────────

const CHAT_ID = "00000000-0000-0000-0000-000000000001";
const CANDIDATE_A_ID = 9001;
const CANDIDATE_B_ID = 9002;
const ATTACKER_CUSTOMER_ID = 6666;

// ─── Suite ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  awtCalls.length = 0;
  otpResendCalls.length = 0;
  chainCalls.length = 0;
  botCheckResult = { ok: true };
  ipCheckResult = { allowed: true, reason: "" };
  phoneCheckResult = { allowed: true, reason: "" };
  otpResendResult = { ok: true };
  combinedReadResult = {
    data: {
      phone_e164: "+15551234567",
      pending_candidates: [
        { customer_id: CANDIDATE_A_ID, recent_vehicle: "2019 Toyota Camry" },
        { customer_id: CANDIDATE_B_ID, recent_vehicle: "2021 Honda CR-V" },
      ],
    },
    error: null,
  };
  updateResult = { error: null };
  sentryCaptureExceptionMock.mockClear();
  sentryCaptureMessageMock.mockClear();
  createSupabaseAdminClientMock.mockClear();
});

describe("submitMultiAccountChoiceV2 — 'none_of_these' branch (no IDOR surface)", () => {
  it("advances to no_match_choose_path, no security gates, no DB read", async () => {
    await submitMultiAccountChoiceV2({
      action: "none_of_these",
      chatId: CHAT_ID,
    });

    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("no_match_choose_path");
    // No DB call — applyWizardTransition is the only effect.
    expect(chainCalls).toHaveLength(0);
    expect(otpResendCalls).toHaveLength(0);
  });
});

describe("submitMultiAccountChoiceV2 — 'select' happy path (IDOR check passes)", () => {
  it("selected_customer_id in pending_candidates → write + OTP + otp_pending", async () => {
    await submitMultiAccountChoiceV2({
      action: "select",
      chatId: CHAT_ID,
      selected_customer_id: CANDIDATE_A_ID,
    });

    // Combined read fired.
    const readCall = chainCalls.find(
      (c) => c.table === "customer_chat_sessions" && c.op === "select",
    );
    expect(readCall).toBeDefined();
    expect(readCall!.cols).toBe("phone_e164, pending_candidates");

    // Update fired with the selected customer_id.
    const writeCall = chainCalls.find(
      (c) => c.table === "customer_chat_sessions" && c.op === "update",
    );
    expect(writeCall).toBeDefined();
    expect(writeCall!.payload).toMatchObject({
      customer_id: CANDIDATE_A_ID,
      pending_candidates: null,
    });

    // OTP fired.
    expect(otpResendCalls).toHaveLength(1);
    expect(otpResendCalls[0]!.session_id).toBe(CHAT_ID);

    // Final advance to otp_pending.
    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("otp_pending");
  });
});

describe("submitMultiAccountChoiceV2 — IDOR defense", () => {
  it("selected_customer_id NOT in pending_candidates → customer_id_invalid + warning, no write", async () => {
    const result = await submitMultiAccountChoiceV2({
      action: "select",
      chatId: CHAT_ID,
      selected_customer_id: ATTACKER_CUSTOMER_ID,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("customer_id_invalid");
    }

    // No UPDATE happened.
    expect(
      chainCalls.find(
        (c) => c.table === "customer_chat_sessions" && c.op === "update",
      ),
    ).toBeUndefined();
    // No OTP sent.
    expect(otpResendCalls).toHaveLength(0);
    // No advance.
    expect(awtCalls).toHaveLength(0);

    // Sentry warning with the right shape.
    expect(sentryCaptureMessageMock).toHaveBeenCalledWith(
      "customer_id_not_in_pending_candidates",
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({
          surface: "submit_multi_account_choice_v2_idor",
          chat_id: CHAT_ID,
        }),
        extra: expect.objectContaining({
          attempted_customer_id: ATTACKER_CUSTOMER_ID,
          candidate_count: 2,
        }),
      }),
    );
  });

  it("pending_candidates is null → customer_id_invalid + warning", async () => {
    combinedReadResult = {
      data: {
        phone_e164: "+15551234567",
        pending_candidates: null,
      },
      error: null,
    };

    const result = await submitMultiAccountChoiceV2({
      action: "select",
      chatId: CHAT_ID,
      selected_customer_id: CANDIDATE_A_ID,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("customer_id_invalid");
    }
    expect(sentryCaptureMessageMock).toHaveBeenCalledWith(
      "customer_id_not_in_pending_candidates",
      expect.objectContaining({
        extra: expect.objectContaining({ candidate_count: 0 }),
      }),
    );
  });

  it("uses correct shape (customer_id field, not id) per actual stored payload", async () => {
    // Sanity check: the spec's `Array<{ id: number }>` would have rejected
    // CANDIDATE_A_ID. The corrected `customer_id` field shape accepts it.
    const result = await submitMultiAccountChoiceV2({
      action: "select",
      chatId: CHAT_ID,
      selected_customer_id: CANDIDATE_A_ID,
    });

    expect(result.ok).toBe(true);
  });
});

describe("submitMultiAccountChoiceV2 — security gates short-circuit before IDOR check", () => {
  it("bot gate fires → returns bot_detected, no DB read or write", async () => {
    botCheckResult = { ok: false };

    const result = await submitMultiAccountChoiceV2({
      action: "select",
      chatId: CHAT_ID,
      selected_customer_id: CANDIDATE_A_ID,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("bot_detected");
    }
    // Bot gate runs first — no DB read happened.
    expect(chainCalls).toHaveLength(0);
  });

  it("IP rate-limit fires → returns IP reason, no DB read", async () => {
    ipCheckResult = { allowed: false, reason: "rate_limited_ip" };

    const result = await submitMultiAccountChoiceV2({
      action: "select",
      chatId: CHAT_ID,
      selected_customer_id: CANDIDATE_A_ID,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("rate_limited_ip");
    }
    expect(chainCalls).toHaveLength(0);
  });

  it("phone rate-limit fires (after IDOR check passes) → returns phone reason, no write", async () => {
    phoneCheckResult = { allowed: false, reason: "rate_limited_phone" };

    const result = await submitMultiAccountChoiceV2({
      action: "select",
      chatId: CHAT_ID,
      selected_customer_id: CANDIDATE_A_ID,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("rate_limited_phone");
    }
    // IDOR check passed (read happened) but write did not.
    expect(
      chainCalls.find(
        (c) => c.table === "customer_chat_sessions" && c.op === "select",
      ),
    ).toBeDefined();
    expect(
      chainCalls.find(
        (c) => c.table === "customer_chat_sessions" && c.op === "update",
      ),
    ).toBeUndefined();
  });
});
