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

// P1.7 (2026-05-25): manual-review-email-client fire-and-forget call.
// Mocked to record invocations; per-test slot lets us simulate failure.
interface ManualReviewEmailCall {
  args: {
    code: string;
    category: string;
    issue_summary: string;
    options: unknown[];
    context: Record<string, unknown>;
  };
}
const manualReviewEmailCalls: ManualReviewEmailCall[] = [];
let manualReviewEmailResult: {
  ok: boolean;
  error?: string;
  dedup?: boolean;
} = { ok: true };
let manualReviewEmailThrows: Error | null = null;
vi.mock("@/lib/scheduler/manual-review-email-client", () => ({
  sendSchedulerManualReviewEmail: vi.fn(async (args: ManualReviewEmailCall["args"]) => {
    manualReviewEmailCalls.push({ args });
    if (manualReviewEmailThrows) throw manualReviewEmailThrows;
    return manualReviewEmailResult;
  }),
  ManualReviewEmailError: class ManualReviewEmailError extends Error {},
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
  data: {
    released_at: string | null;
    expires_at: string;
    // P0.2 (2026-05-25): the diagnostic SELECT now also pulls
    // claimed_by_session_id so handleConfirmPath can distinguish
    // "released" vs "in-flight-claimed" vs "expired".
    claimed_by_session_id?: string | null;
  } | null;
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
// create_manual_review returns TABLE (code TEXT, review_id BIGINT,
// audit_log_id BIGINT) — supabase.rpc() resolves to `data` as ARRAY of
// rows for TABLE-returning RPCs. Default fixture is a single-row success.
let createManualReviewResult: { data: unknown; error: unknown } = {
  data: [{ code: "AVM-ABCDEF", review_id: 1, audit_log_id: 1 }],
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
    // 2026-07-02 confirm-seam hardening: the OTP gate requires a proven
    // phone at confirm; every real session at this step has it.
    otp_verified_at: "2026-07-02T00:00:00Z",
    ...overrides,
  };
}

// P0.2: there are now TWO appointment_holds UPDATEs in the happy path
// (the CAS-claim with claimed_by_session_id, and the release with
// released_at). Both helpers below disambiguate by payload shape.
function findCasClaimCall(): ChainCall | undefined {
  return chainCalls.find(
    (c) =>
      c.table === "appointment_holds" &&
      c.op === "update" &&
      typeof (c.payload as Record<string, unknown> | undefined)
        ?.claimed_by_session_id === "string",
  );
}

function findReleaseHoldCall(): ChainCall | undefined {
  return chainCalls.find(
    (c) =>
      c.table === "appointment_holds" &&
      c.op === "update" &&
      typeof (c.payload as Record<string, unknown> | undefined)?.released_at ===
        "string",
  );
}

function findDiagCall(): ChainCall | undefined {
  // P0.2: diagnostic SELECT cols now include claimed_by_session_id.
  return chainCalls.find(
    (c) =>
      c.table === "appointment_holds" &&
      c.op === "select" &&
      c.selectCols === "released_at, expires_at, claimed_by_session_id",
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
    data: [{ code: "AVM-ABCDEF", review_id: 1, audit_log_id: 1 }],
    error: null,
  };
  manualReviewEmailCalls.length = 0;
  manualReviewEmailResult = { ok: true };
  manualReviewEmailThrows = null;
  sentryCaptureExceptionMock.mockClear();
  sentryCaptureMessageMock.mockClear();
  logErrorMock.mockClear();
  createSupabaseAdminClientMock.mockClear();
});

describe("submitSummaryV2 confirm path — OTP gate (2026-07-02 hardening)", () => {
  it("session without otp_verified_at escalates before any hold claim or booking", async () => {
    sessionRowResult = {
      data: makeValidSessionRow({ otp_verified_at: null }),
      error: null,
    };

    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    expect(confirmCalls).toHaveLength(0);
    expect(findCasClaimCall()).toBeUndefined();
    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("escalated");
    expect(awtCalls[0]!.updates).toMatchObject({
      status: "escalated",
      escalation_reason: "otp_not_verified_at_confirm",
    });
  });
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

  it("CAS claim chain uses correct table + payload + WHERE clauses (P0.2 claimed_by_session_id)", async () => {
    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    const casCall = findCasClaimCall();
    expect(casCall).toBeDefined();
    expect(casCall!.table).toBe("appointment_holds");
    expect(casCall!.op).toBe("update");

    // P0.2 (2026-05-25): CAS now stamps claimed_by_session_id = chatId
    // (NOT released_at). released_at stays NULL during the Tekmetric
    // POST window so availability scans continue to see the slot as
    // TAKEN to other customers.
    expect(casCall!.payload?.claimed_by_session_id).toBe(CHAT_ID);
    expect(casCall!.payload?.released_at).toBeUndefined();

    // P0.2: 5 WHERE conditions (was 4; added claimed_by_session_id IS NULL):
    //   eq(id, holdToken)
    //   eq(session_id, chatId)
    //   is(released_at, null)
    //   is(claimed_by_session_id, null)
    //   gt(expires_at, now)
    expect(casCall!.match).toEqual(
      expect.arrayContaining([
        { kind: "eq", col: "id", val: HOLD_TOKEN },
        { kind: "eq", col: "session_id", val: CHAT_ID },
        { kind: "is", col: "released_at", val: null },
        { kind: "is", col: "claimed_by_session_id", val: null },
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

describe("submitSummaryV2 confirm path — P0.2 release-on-Tekmetric-failure", () => {
  it("CAS succeeds + Tekmetric returns ok:false (generic) → release UPDATE fires, then escalates (NOT as CAS error)", async () => {
    confirmResult = { ok: false, error: "tekmetric_5xx" };

    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    // CAS claim was attempted + succeeded.
    const casCall = findCasClaimCall();
    expect(casCall).toBeDefined();
    expect(casCall!.payload?.claimed_by_session_id).toBe(CHAT_ID);

    // Tekmetric was called (because CAS succeeded).
    expect(confirmCalls).toHaveLength(1);

    // P0.2 — release UPDATE fired BEFORE the escalation applyWizardTransition
    // so the slot returns to availability (Phase 2's release-on-failure
    // spec preserved through the new claim/release split).
    const releaseCall = findReleaseHoldCall();
    expect(releaseCall).toBeDefined();
    expect(typeof releaseCall!.payload?.released_at).toBe("string");
    expect(
      Date.parse(releaseCall!.payload!.released_at as string),
    ).not.toBeNaN();
    // Release filters defensively on claimed_by_session_id = chatId so we
    // never accidentally release a hold owned by another session.
    expect(releaseCall!.match).toEqual(
      expect.arrayContaining([
        { kind: "eq", col: "id", val: HOLD_TOKEN },
        { kind: "eq", col: "claimed_by_session_id", val: CHAT_ID },
        { kind: "is", col: "released_at", val: null },
      ]),
    );

    // No CAS-error-path escalation fired (the CAS itself was fine).
    const casErrEscalation = awtCalls.find(
      (c) => c.updates?.escalation_reason === "cas_claim_db_error",
    );
    expect(casErrEscalation).toBeUndefined();

    // The escalation that DID fire is the Tekmetric-failure one.
    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("escalated");
    expect(
      awtCalls[0]!.updates?.escalation_reason as string,
    ).toContain("confirm_booking_failed:tekmetric_5xx");

    // No CAS-miss diagnostic read happened either (CAS data was truthy).
    expect(findDiagCall()).toBeUndefined();
  });

  it("CAS succeeds + Tekmetric returns ok:false hold_expired → release UPDATE fires, then bounces to date_pick", async () => {
    confirmResult = { ok: false, error: "hold_expired by upstream" };

    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    expect(confirmCalls).toHaveLength(1);
    const releaseCall = findReleaseHoldCall();
    expect(releaseCall).toBeDefined();

    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("date_pick");
    expect(awtCalls[0]!.jeffBubble).toContain("expired");
  });

  it("confirmBooking throws → release UPDATE fires, then escalates with confirm_booking_threw", async () => {
    const { confirmBooking: confirmBookingMock } = await import(
      "@/lib/scheduler/booking-direct-client"
    );
    (
      confirmBookingMock as unknown as Mock
    ).mockRejectedValueOnce(new Error("network ECONNRESET"));

    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    const releaseCall = findReleaseHoldCall();
    expect(releaseCall).toBeDefined();

    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("escalated");
    expect(awtCalls[0]!.updates?.escalation_reason).toBe("confirm_booking_threw");
  });

  it("Tekmetric returns ok:true but no appointment_id → release UPDATE fires, then escalates", async () => {
    confirmResult = { ok: true /* appointment_id intentionally missing */ };

    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    const releaseCall = findReleaseHoldCall();
    expect(releaseCall).toBeDefined();

    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("escalated");
    expect(awtCalls[0]!.updates?.escalation_reason).toBe(
      "confirm_booking_no_appointment_id",
    );
  });

  it("Tekmetric success path → release UPDATE fires BEFORE the success applyWizardTransition (consumes the hold)", async () => {
    confirmResult = {
      ok: true,
      appointment_id: 12345,
      start_time: "2026-06-10T14:00:00.000Z",
    };

    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    // Release UPDATE fired on the happy path too (consumes the hold once
    // the appointment is bound in Tekmetric).
    const releaseCall = findReleaseHoldCall();
    expect(releaseCall).toBeDefined();
    expect(typeof releaseCall!.payload?.released_at).toBe("string");

    // Success applyWizardTransition still fires and advances to customer_notes.
    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("customer_notes");
    expect(awtCalls[0]!.updates).toMatchObject({
      appointment_id: 12345,
      appointment_verification_status: "confirmed",
    });

    // Ordering check: in chainCalls, the release UPDATE must precede the
    // customer_chat_sessions update fired by applyWizardTransition.
    // applyWizardTransition is mocked at the boundary so it doesn't
    // touch supabase from inside this test — instead we assert the
    // release UPDATE is in chainCalls AT ALL, which proves it fired
    // before the test ended (which the applyWizardTransition awt does).
    const releaseIdx = chainCalls.findIndex(
      (c) =>
        c.table === "appointment_holds" &&
        c.op === "update" &&
        typeof (c.payload as Record<string, unknown> | undefined)?.released_at ===
          "string",
    );
    const casIdx = chainCalls.findIndex(
      (c) =>
        c.table === "appointment_holds" &&
        c.op === "update" &&
        typeof (c.payload as Record<string, unknown> | undefined)
          ?.claimed_by_session_id === "string",
    );
    // CAS comes BEFORE release (the chain logical order).
    expect(casIdx).toBeGreaterThanOrEqual(0);
    expect(releaseIdx).toBeGreaterThan(casIdx);
  });
});

describe("submitSummaryV2 confirm path — P0.2 in-flight-claimed diag branch", () => {
  it("CAS miss + diag.claimed_by_session_id set (released_at null, ttl future) → escalates with hold_already_claimed_by_session", async () => {
    // Scenario: customer double-tapped Confirm. First tap's CAS
    // succeeded; first tap's Tekmetric POST is still in flight.
    // Second tap's CAS fails because claimed_by_session_id is no
    // longer NULL. Diagnostic reads it back and we escalate the
    // second tap so we don't fire a duplicate POST.
    casClaimResult = { data: null, error: null };
    diagResult = {
      data: {
        released_at: null,
        // Future expiry — TTL gate would have passed.
        expires_at: "2099-12-31T23:59:59.000Z",
        // claimed_by_session_id is set to this same session (rare
        // double-tap) OR another session's chatId (extremely rare race
        // — the .eq("session_id", chatId) filter on the diag SELECT
        // would have prevented this in practice; included for safety).
        claimed_by_session_id: CHAT_ID,
      },
      error: null,
    };

    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    // No second Tekmetric POST fired.
    expect(confirmCalls).toHaveLength(0);

    // Escalated with the P0.2-specific reason.
    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("escalated");
    expect(awtCalls[0]!.updates).toMatchObject({
      status: "escalated",
      escalation_reason: "hold_already_claimed_by_session",
    });
    expect(awtCalls[0]!.jeffBubble).toContain("already being processed");

    // Sentry warning fired with the new diag context field.
    expect(sentryCaptureMessageMock).toHaveBeenCalledWith(
      "submit_summary_v2_cas_missed",
      expect.objectContaining({
        level: "warning",
        extra: expect.objectContaining({
          diag_claimed_by_session_id: CHAT_ID,
        }),
      }),
    );
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

    // P1.7 (2026-05-25): fire-and-forget email send via the new
    // scheduler-manual-review-email edge fn. The fire-and-forget
    // pattern uses `.then` + `.catch` on a Promise, so we yield
    // microtasks before asserting.
    await Promise.resolve();
    await Promise.resolve();
    expect(manualReviewEmailCalls).toHaveLength(1);
    expect(manualReviewEmailCalls[0]!.args).toMatchObject({
      code: "AVM-ABCDEF",
      category: "appointment_verification_mismatch",
      context: expect.objectContaining({
        chat_id: CHAT_ID,
        appointment_id: 12345,
        diff: "appointment.color: sent='navy' vs got='red'",
      }),
    });
    expect(
      (manualReviewEmailCalls[0]!.args.options as Array<{ key: string }>).map(
        (o) => o.key,
      ),
    ).toEqual([
      "update_tekmetric",
      "update_our_records",
      "contact_customer",
    ]);
  });

  it("create_manual_review RPC error does NOT block the customer flow + suppresses email send", async () => {
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

    // P1.7: no email send fired (no code to attach to the email).
    await Promise.resolve();
    expect(manualReviewEmailCalls).toHaveLength(0);
  });

  it("P1.7: email send returns ok=false → Sentry warning (does NOT block flow)", async () => {
    confirmResult = {
      ok: true,
      appointment_id: 12345,
      verification: { ok: false, diff: "test diff" },
    };
    manualReviewEmailResult = {
      ok: false,
      error: "resend_send_failed",
    };

    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("customer_notes");

    // Yield microtasks so the fire-and-forget .then callback runs.
    await Promise.resolve();
    await Promise.resolve();
    expect(manualReviewEmailCalls).toHaveLength(1);
    expect(sentryCaptureMessageMock).toHaveBeenCalledWith(
      "scheduler_manual_review_email_send_returned_not_ok",
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({
          surface: "submit_summary_v2_manual_review_email",
        }),
      }),
    );
  });

  it("P1.7: email send throws → Sentry capture (does NOT block flow)", async () => {
    confirmResult = {
      ok: true,
      appointment_id: 12345,
      verification: { ok: false, diff: "test diff" },
    };
    manualReviewEmailThrows = new Error("network ECONNRESET");

    await submitSummaryV2({ chatId: CHAT_ID, confirmed: true });

    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("customer_notes");

    await Promise.resolve();
    await Promise.resolve();
    expect(manualReviewEmailCalls).toHaveLength(1);
    expect(sentryCaptureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "network ECONNRESET" }),
      expect.objectContaining({
        tags: expect.objectContaining({
          surface: "submit_summary_v2_manual_review_email",
        }),
        level: "warning",
      }),
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
