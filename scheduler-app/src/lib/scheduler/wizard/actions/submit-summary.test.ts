/**
 * Unit tests for submitSummaryV2 — narrowed to the Plan 04 Phase 2
 * CAS-claim surface (closes I-COR-3). Other branches of the action
 * (edit path, escalation path, post-Tekmetric writes) are NOT covered
 * here; they remain Phase 1 / earlier integration coverage.
 *
 * Surface under test (handleConfirmPath, lines ~282-380):
 *   1. CAS-claim atomic UPDATE on appointment_holds:
 *      WHERE id = holdToken AND session_id = chatId
 *        AND released_at IS NULL AND expires_at > now
 *      .select("id").maybeSingle()
 *   2. On non-CAS DB error → escalate path via applyWizardTransition
 *      (escalation_reason: "cas_claim_db_error").
 *   3. On CAS miss (data: null, error: null) → diagnostic SELECT
 *      to determine WHICH condition tripped, then route via
 *      applyWizardTransition with one of 3 user-facing copies:
 *        - diag null              → "Hmm, that slot reservation timed out."
 *        - diag.released_at set   → "Looks like that slot reservation was released."
 *        - diag expired (else)    → "Your slot just expired — but don't worry…"
 *   4. On CAS success → confirmBooking() invoked with correct args.
 *
 * Mocking strategy: applyWizardTransition + confirmBooking + the heavy
 * helpers (build-summary-data, build-service-summary, staff-notification,
 * shop-tz, logError, wrapAction, Sentry, next/cache) are mocked at the
 * module boundary. The supabase admin client mock handles two narrowed
 * surfaces — the customer_chat_sessions row read at the top of
 * handleConfirmPath and the appointment_holds CAS-claim + diagnostic
 * read added by Phase 2.
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
  // wrapAction wraps in withServerActionInstrumentation; pass through.
  withServerActionInstrumentation: (
    _name: string,
    _options: unknown,
    callback: () => Promise<unknown>,
  ) => callback(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const logErrorMock: Mock = vi.fn(async () => {});
vi.mock("@/lib/scheduler/wizard/log-error", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

// applyWizardTransition is the primary write surface for both CAS-failure
// routing (date_pick) AND escalation. Mocked at boundary so we can inspect
// its inputs to verify the right copy + nextStep + updates land.
interface AwtCall {
  chatId: string;
  nextStep: string;
  jeffBubble?: string;
  updates?: Record<string, unknown>;
  userBubble?: string;
}
const awtCalls: AwtCall[] = [];
vi.mock("@/lib/scheduler/wizard/transition", () => ({
  applyWizardTransition: vi.fn(async (args: AwtCall) => {
    awtCalls.push(args);
    return { ok: true, next_step: args.nextStep };
  }),
}));

// confirmBooking — the Tekmetric POST gate. Tests assert whether/when
// this is called (NOT on CAS-failure paths; only on CAS-success).
interface ConfirmCall {
  op: string;
  session_id: string;
  hold_id: string;
  customer_id: number;
  vehicle_id: number;
  title: string;
  description: string;
  color: string;
}
const confirmCalls: ConfirmCall[] = [];
let confirmResult: {
  ok: boolean;
  appointment_id?: number;
  error?: string;
  verification?: { ok: boolean; diff?: string };
  start_time?: string;
} = {
  ok: true,
  appointment_id: 12345,
};
vi.mock("@/lib/scheduler/booking-direct-client", () => ({
  confirmBooking: vi.fn(async (args: ConfirmCall) => {
    confirmCalls.push(args);
    return confirmResult;
  }),
  BookingDirectError: class BookingDirectError extends Error {
    status?: number;
  },
}));

// Helpers that the post-CAS happy path invokes. Mocked to canned strings
// so we can exercise that path without dragging in the full build logic.
vi.mock("@/lib/scheduler/wizard/build-summary-data", () => ({
  buildAppointmentTitleV2: vi.fn(async () => "Test appointment title"),
}));
vi.mock("@/lib/scheduler/wizard/build-service-summary", () => ({
  buildServiceSummary: vi.fn(async () => "Test service summary"),
}));
vi.mock("@/lib/scheduler/wizard/staff-notification", () => ({
  notifyStaffOfNewAppointment: vi.fn(async () => undefined),
}));
vi.mock("@/lib/scheduler/wizard/shop-tz", () => ({
  isSameDayLocal: vi.fn(() => false),
  shopLocalDate: vi.fn(() => "2026-06-01"),
}));

// Supabase admin client — minimal mock that handles 3 chain shapes used
// by the CAS surface under test:
//   (1) .from("customer_chat_sessions").select("*").eq("id", chatId).maybeSingle()
//   (2) .from("appointment_holds").update({released_at}).eq(id).eq(session_id).is(released_at, null).gt(expires_at, now).select(id).maybeSingle()
//   (3) .from("appointment_holds").select("released_at, expires_at").eq(id).eq(session_id).maybeSingle()
//
// Per-test result slots configurable in each `it()` block.
interface ChainCall {
  table: string;
  op: "select" | "update";
  payload?: Record<string, unknown>;
  match: Array<{ kind: "eq" | "is" | "gt"; col: string; val: unknown }>;
  selectCols?: string;
}
const chainCalls: ChainCall[] = [];

let sessionRowResult: { data: Record<string, unknown> | null; error: unknown } = {
  data: null,
  error: null,
};
let casClaimResult: { data: { id: string } | null; error: unknown } = {
  data: { id: "hold-uuid" },
  error: null,
};
let diagResult: {
  data: { released_at: string | null; expires_at: string } | null;
  error: unknown;
} = { data: null, error: null };

// PLAN-04 Phase 4 — supabase.rpc("create_manual_review", ...) tracker
// for verify-mismatch tests. Per-test result slot lets us simulate
// success / DB error.
interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}
const rpcCalls: RpcCall[] = [];
let createManualReviewResult: { data: unknown; error: unknown } = {
  data: { id: 1, code: "AVM-ABCDEF" },
  error: null,
};

function makeMockClient() {
  return {
    from(table: string) {
      let currentCall: ChainCall | null = null;
      const builder = {
        select(cols: string) {
          if (!currentCall) {
            currentCall = { table, op: "select", match: [], selectCols: cols };
            chainCalls.push(currentCall);
          } else {
            currentCall.selectCols = cols;
          }
          return builder;
        },
        update(payload: Record<string, unknown>) {
          currentCall = { table, op: "update", match: [], payload };
          chainCalls.push(currentCall);
          return builder;
        },
        eq(col: string, val: unknown) {
          currentCall?.match.push({ kind: "eq", col, val });
          return builder;
        },
        is(col: string, val: unknown) {
          currentCall?.match.push({ kind: "is", col, val });
          return builder;
        },
        gt(col: string, val: unknown) {
          currentCall?.match.push({ kind: "gt", col, val });
          return builder;
        },
        async maybeSingle() {
          if (table === "customer_chat_sessions") {
            return sessionRowResult;
          }
          if (table === "appointment_holds") {
            return currentCall?.op === "update" ? casClaimResult : diagResult;
          }
          return { data: null, error: null };
        },
      };
      return builder;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      if (fn === "create_manual_review") return createManualReviewResult;
      return { data: null, error: null };
    },
  };
}

const createSupabaseAdminClientMock: Mock = vi.fn(() => makeMockClient());
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => createSupabaseAdminClientMock(),
}));

// Import the SUT after mocks are wired.
import { submitSummaryV2 } from "./submit-summary";

// ─── Helpers ───────────────────────────────────────────────────────────────

const CHAT_ID = "00000000-0000-0000-0000-000000000001";
const HOLD_TOKEN = "00000000-0000-0000-0000-000000000002";

function makeValidSessionRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: CHAT_ID,
    hold_token: HOLD_TOKEN,
    customer_id: 9999,
    vehicle_id: 8888,
    appointment_id: null,
    appointment_confirmed_at: null,
    entered_first_name: "Chris",
    appointment_type: "dropoff",
    ...overrides,
  };
}

function findCasClaimCall(): ChainCall | undefined {
  return chainCalls.find(
    (c) => c.table === "appointment_holds" && c.op === "update",
  );
}

function findDiagCall(): ChainCall | undefined {
  return chainCalls.find(
    (c) =>
      c.table === "appointment_holds" &&
      c.op === "select" &&
      c.selectCols === "released_at, expires_at",
  );
}

// ─── Suite ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  awtCalls.length = 0;
  confirmCalls.length = 0;
  chainCalls.length = 0;
  rpcCalls.length = 0;
  sessionRowResult = { data: makeValidSessionRow(), error: null };
  casClaimResult = { data: { id: HOLD_TOKEN }, error: null };
  diagResult = { data: null, error: null };
  confirmResult = { ok: true, appointment_id: 12345 };
  createManualReviewResult = {
    data: { id: 1, code: "AVM-ABCDEF" },
    error: null,
  };
  sentryCaptureExceptionMock.mockClear();
  sentryCaptureMessageMock.mockClear();
  logErrorMock.mockClear();
  createSupabaseAdminClientMock.mockClear();
});

describe("submitSummaryV2 confirm path — CAS claim happy path", () => {
  it("CAS succeeds → confirmBooking called with correct args", async () => {
    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    expect(confirmCalls).toHaveLength(1);
    expect(confirmCalls[0]).toMatchObject({
      op: "confirm_booking",
      session_id: CHAT_ID,
      hold_id: HOLD_TOKEN,
      customer_id: 9999,
      vehicle_id: 8888,
      color: "navy", // dropoff
    });
  });

  it("CAS claim chain uses correct table + columns + WHERE clauses", async () => {
    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    const casCall = findCasClaimCall();
    expect(casCall).toBeDefined();
    expect(casCall!.table).toBe("appointment_holds");
    expect(casCall!.op).toBe("update");
    // released_at gets stamped with an ISO timestamp.
    expect(typeof casCall!.payload?.released_at).toBe("string");
    expect(
      Date.parse(casCall!.payload!.released_at as string),
    ).not.toBeNaN();

    // Verify the 4 WHERE conditions in the right shape:
    //   eq(id, holdToken)
    //   eq(session_id, chatId)
    //   is(released_at, null)
    //   gt(expires_at, now)
    expect(casCall!.match).toEqual(
      expect.arrayContaining([
        { kind: "eq", col: "id", val: HOLD_TOKEN },
        { kind: "eq", col: "session_id", val: CHAT_ID },
        { kind: "is", col: "released_at", val: null },
        expect.objectContaining({ kind: "gt", col: "expires_at" }),
      ]),
    );
    expect(casCall!.selectCols).toBe("id");
  });

  it("uses id (not hold_token) per Phase 1B audit — appointment_holds has no hold_token column", async () => {
    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    const casCall = findCasClaimCall();
    expect(casCall!.match.some((m) => m.col === "hold_token")).toBe(false);
    expect(
      casCall!.match.some((m) => m.kind === "eq" && m.col === "id"),
    ).toBe(true);
  });
});

describe("submitSummaryV2 confirm path — CAS DB error path", () => {
  it("non-CAS DB error → escalates with cas_claim_db_error reason, no confirmBooking call", async () => {
    casClaimResult = {
      data: null,
      error: {
        code: "08006",
        message: "database connection terminated",
      },
    };

    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    expect(confirmCalls).toHaveLength(0);
    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("escalated");
    expect(awtCalls[0]!.updates).toMatchObject({
      status: "escalated",
      escalation_reason: "cas_claim_db_error",
    });
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock.mock.calls[0]![0]).toMatchObject({
      surface: "submit_summary_v2",
      error_code: "cas_claim_db_error",
      level: "error",
    });
  });
});

describe("submitSummaryV2 confirm path — CAS miss + diagnostic 3-state routing", () => {
  it("CAS miss + diag finds no row → 'timed out' copy + date_pick", async () => {
    casClaimResult = { data: null, error: null };
    diagResult = { data: null, error: null };

    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    expect(confirmCalls).toHaveLength(0);
    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("date_pick");
    expect(awtCalls[0]!.jeffBubble).toContain("timed out");

    // Diagnostic SELECT was performed.
    const diagCall = findDiagCall();
    expect(diagCall).toBeDefined();
    expect(diagCall!.match).toEqual([
      { kind: "eq", col: "id", val: HOLD_TOKEN },
      { kind: "eq", col: "session_id", val: CHAT_ID },
    ]);

    // Sentry warning fired for the CAS miss with diag context.
    expect(sentryCaptureMessageMock).toHaveBeenCalledWith(
      "submit_summary_v2_cas_missed",
      expect.objectContaining({
        level: "warning",
        extra: expect.objectContaining({
          chatId: CHAT_ID,
          holdToken: HOLD_TOKEN,
          diag_found: false,
        }),
      }),
    );
  });

  it("CAS miss + diag.released_at set → 'released' copy + date_pick", async () => {
    casClaimResult = { data: null, error: null };
    diagResult = {
      data: {
        released_at: "2026-05-24T20:00:00.000Z",
        expires_at: "2026-05-24T21:00:00.000Z",
      },
      error: null,
    };

    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    expect(confirmCalls).toHaveLength(0);
    expect(awtCalls[0]!.nextStep).toBe("date_pick");
    expect(awtCalls[0]!.jeffBubble).toContain("released");
  });

  it("CAS miss + diag released_at null + expires_at past → 'expired' copy + date_pick", async () => {
    casClaimResult = { data: null, error: null };
    diagResult = {
      data: {
        released_at: null,
        // Already past — only the TTL gate could have missed.
        expires_at: "2020-01-01T00:00:00.000Z",
      },
      error: null,
    };

    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    expect(confirmCalls).toHaveLength(0);
    expect(awtCalls[0]!.nextStep).toBe("date_pick");
    expect(awtCalls[0]!.jeffBubble).toContain("expired");
  });
});

describe("submitSummaryV2 confirm path — Tekmetric failure does NOT roll back CAS claim", () => {
  it("CAS succeeds + Tekmetric returns ok:false → hold stays released, NOT escalated as CAS error", async () => {
    confirmResult = { ok: false, error: "tekmetric_5xx" };

    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    // CAS claim was attempted + succeeded (recorded in chainCalls).
    const casCall = findCasClaimCall();
    expect(casCall).toBeDefined();
    // Tekmetric was called (because CAS succeeded).
    expect(confirmCalls).toHaveLength(1);
    // No CAS-error-path escalation fired (the CAS itself was fine).
    const cosFailureEscalation = awtCalls.find(
      (c) => c.updates?.escalation_reason === "cas_claim_db_error",
    );
    expect(cosFailureEscalation).toBeUndefined();
    // No CAS-miss diagnostic read happened either (CAS data was truthy).
    expect(findDiagCall()).toBeUndefined();
  });
});

describe("submitSummaryV2 confirm path — Plan 04 Phase 4 verification-mismatch envelope", () => {
  it("verification.ok=true → status='confirmed', diff=null, celebratory bubble, no manual review row", async () => {
    confirmResult = {
      ok: true,
      appointment_id: 12345,
      verification: { ok: true },
      start_time: "2026-06-10T14:00:00.000Z",
    };

    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("customer_notes");
    expect(awtCalls[0]!.updates).toMatchObject({
      appointment_id: 12345,
      appointment_verification_status: "confirmed",
      appointment_verification_diff: null,
    });
    // Celebratory bubble, not apology.
    expect(awtCalls[0]!.jeffBubble).toContain("All set");
    expect(awtCalls[0]!.jeffBubble).not.toContain("differently than expected");
    // No manual review RPC fired.
    expect(
      rpcCalls.find((c) => c.fn === "create_manual_review"),
    ).toBeUndefined();
    // No appointment_verification_mismatch Sentry capture.
    expect(sentryCaptureMessageMock).not.toHaveBeenCalledWith(
      "appointment_verification_mismatch",
      expect.anything(),
    );
  });

  it("verification.ok=false → status='needs_review', diff persisted, apology bubble, manual review created", async () => {
    confirmResult = {
      ok: true,
      appointment_id: 12345,
      verification: {
        ok: false,
        diff: "appointment.color: sent='navy' vs got='red'",
      },
      start_time: "2026-06-10T14:00:00.000Z",
    };

    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    // Customer still advances to customer_notes per Chris's UX call.
    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("customer_notes");
    expect(awtCalls[0]!.updates).toMatchObject({
      appointment_id: 12345,
      appointment_verification_status: "needs_review",
      // M3 post-validator fix: diff is wrapped as `{ raw: string }` so
      // the JSONB column is always object-shaped (advisors query
      // diff->>'raw' instead of dealing with bare JSON string literal).
      appointment_verification_diff: {
        raw: "appointment.color: sent='navy' vs got='red'",
      },
    });

    // Apology bubble — NOT the celebratory "All set" copy.
    expect(awtCalls[0]!.jeffBubble).toContain("differently than expected");
    expect(awtCalls[0]!.jeffBubble).not.toContain("All set");

    // Sentry error-level capture fired with the right tags + extras.
    expect(sentryCaptureMessageMock).toHaveBeenCalledWith(
      "appointment_verification_mismatch",
      expect.objectContaining({
        level: "error",
        tags: expect.objectContaining({
          surface: "submit_summary_v2_verify_mismatch",
          chat_id: CHAT_ID,
        }),
        extra: expect.objectContaining({
          appointment_id: 12345,
          diff: "appointment.color: sent='navy' vs got='red'",
        }),
      }),
    );

    // create_manual_review RPC called with the right category + prefix.
    const reviewCall = rpcCalls.find((c) => c.fn === "create_manual_review");
    expect(reviewCall).toBeDefined();
    expect(reviewCall!.args).toMatchObject({
      p_category: "appointment_verification_mismatch",
      p_prefix: "AVM",
      p_context: expect.objectContaining({
        chat_id: CHAT_ID,
        appointment_id: 12345,
        diff: "appointment.color: sent='navy' vs got='red'",
      }),
    });
    // 3 advisor options surface in the review.
    const options = reviewCall!.args.p_options as Array<{ key: string }>;
    expect(options).toHaveLength(3);
    expect(options.map((o) => o.key)).toEqual([
      "update_tekmetric",
      "update_our_records",
      "contact_customer",
    ]);
  });

  it("create_manual_review RPC error does NOT block the customer flow", async () => {
    confirmResult = {
      ok: true,
      appointment_id: 12345,
      verification: { ok: false, diff: "test diff" },
    };
    createManualReviewResult = {
      data: null,
      error: { code: "23503", message: "FK violation on shop_id" },
    };

    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    // Customer still advances + row still marked needs_review.
    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("customer_notes");
    expect(awtCalls[0]!.updates).toMatchObject({
      appointment_verification_status: "needs_review",
    });

    // The RPC error surfaces to Sentry as a warning (best-effort path).
    expect(sentryCaptureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({ code: "23503" }),
      expect.objectContaining({
        tags: expect.objectContaining({
          surface: "submit_summary_v2_create_manual_review",
        }),
        level: "warning",
      }),
    );
    // The earlier error-level Sentry capture for the mismatch itself
    // also fired (independent of the review-creation failure).
    expect(sentryCaptureMessageMock).toHaveBeenCalledWith(
      "appointment_verification_mismatch",
      expect.objectContaining({ level: "error" }),
    );
  });

  it("verification field is absent (legacy edge-fn response) → treated as confirmed, no mismatch handling", async () => {
    confirmResult = {
      ok: true,
      appointment_id: 12345,
      // verification field intentionally omitted (pre-Phase-12 edge fn)
    };

    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    // Defaults to confirmed path (verification undefined is NOT a mismatch).
    expect(awtCalls[0]!.updates).toMatchObject({
      appointment_verification_status: "confirmed",
      appointment_verification_diff: null,
    });
    expect(awtCalls[0]!.jeffBubble).toContain("All set");
    expect(
      rpcCalls.find((c) => c.fn === "create_manual_review"),
    ).toBeUndefined();
  });
});

describe("submitSummaryV2 confirm path — M1 post-validator (idempotency replay bubble matches prior state)", () => {
  it("idempotency replay with appointment_verification_status='needs_review' → apology bubble (NOT celebratory)", async () => {
    // Row was previously confirmed in needs_review state. Customer
    // double-tapped or had a network retry. We should re-emit the
    // apology bubble (matching the original confirm UX), NOT the
    // celebratory 'All set!' bubble that would contradict it.
    sessionRowResult = {
      data: makeValidSessionRow({
        appointment_id: 12345,
        appointment_verification_status: "needs_review",
      }),
      error: null,
    };

    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    // Single applyWizardTransition call: idempotency replay short-
    // circuit, no CAS-claim, no Tekmetric POST.
    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("customer_notes");
    expect(awtCalls[0]!.jeffBubble).toContain("differently than expected");
    expect(awtCalls[0]!.jeffBubble).not.toContain("All set");

    // No CAS claim (we short-circuited before that).
    expect(confirmCalls).toHaveLength(0);
    // No new manual review (the original confirm already created one).
    expect(
      rpcCalls.find((c) => c.fn === "create_manual_review"),
    ).toBeUndefined();
  });

  it("idempotency replay with appointment_verification_status='confirmed' → celebratory bubble (unchanged)", async () => {
    sessionRowResult = {
      data: makeValidSessionRow({
        appointment_id: 12345,
        appointment_verification_status: "confirmed",
      }),
      error: null,
    };

    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("customer_notes");
    expect(awtCalls[0]!.jeffBubble).toContain("All set");
    expect(awtCalls[0]!.jeffBubble).not.toContain("differently than expected");
  });
});
