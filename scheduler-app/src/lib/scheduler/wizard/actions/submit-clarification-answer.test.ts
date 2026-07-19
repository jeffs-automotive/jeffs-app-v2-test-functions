/**
 * Unit tests for submitClarificationAnswerV2 — the per-question clarification
 * card resolver. Anchored to docs/scheduler/concern-triage-and-unsure-path-plan.md
 * (B5 + INV-4 + INV-8) and chat-design.md §Step 7.
 *
 * Surface under test (submit-clarification-answer.ts):
 *   1. B5 step guard: current_step must be "clarification_question" — a stale
 *      submit (back-button then submit after the wizard moved on) is a no-op
 *      so a pending triage/clarify queue is never orphaned.
 *   2. Pops the head of clarification_questions_pending; writes the value (or
 *      "skipped") into clarification_questions_answered[question_id].
 *   3. Drained-queue routing (B5/INV-4): triage-queue > clarify-queue >
 *      routeAfterDiagnostics(UNDECIDED recs, INV-8) — both the head-null early
 *      branch and the normal drain branch.
 *   4. INV-8: routeAfterDiagnostics is passed recommended − approved − declined.
 *   5. Queue-head-mismatch + missing-row guards → ok:false.
 *
 * Mocking pattern mirrors submit-concern-clarify.test.ts (chain-recording
 * supabase mock + RPC-tracking via findSessionUpdate).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// ─── Module mocks ──────────────────────────────────────────────────────────

const sentryCaptureMessage: Mock = vi.fn();
const sentryCaptureException: Mock = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: vi.fn(),
  captureMessage: (...args: unknown[]) => sentryCaptureMessage(...args),
  captureException: (...args: unknown[]) => sentryCaptureException(...args),
  setTag: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  withServerActionInstrumentation: (
    _name: string,
    _options: unknown,
    callback: () => Promise<unknown>,
  ) => callback(),
}));

const revalidatePathMock: Mock = vi.fn();
const revalidateTagMock: Mock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (path: string, type?: string) =>
    revalidatePathMock(path, type),
  revalidateTag: (tag: string) => revalidateTagMock(tag),
}));

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}
const rpcCalls: RpcCall[] = [];
let storedRow: Record<string, unknown> | null = null;

function makeMockClient() {
  return {
    from(_table: string) {
      const builder = {
        eq() {
          return builder;
        },
        async maybeSingle() {
          return { data: storedRow, error: null };
        },
      };
      return {
        select(_cols: string) {
          return builder;
        },
      };
    },
    async rpc(fnName: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn: fnName, args });
      return {
        data: {
          row: {},
          user_bubble_inserted: false,
          assistant_bubble_inserted: false,
        },
        error: null,
      };
    },
  };
}

const createSupabaseAdminClientMock: Mock = vi.fn(() => makeMockClient());
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => createSupabaseAdminClientMock(),
}));

const ensureConcernSummariesMock: Mock = vi.fn(async () => undefined);
vi.mock("@/lib/scheduler/wizard/ensure-concern-summaries", () => ({
  ensureConcernSummaries: (...args: unknown[]) =>
    ensureConcernSummariesMock(...args),
}));

const logErrorMock: Mock = vi.fn(async () => undefined);
vi.mock("@/lib/scheduler/wizard/log-error", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

import { submitClarificationAnswerV2 } from "./submit-clarification-answer";

// ─── Fixtures ──────────────────────────────────────────────────────────────

function pendingQ(
  id: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    question_id: id,
    question_text: `Question ${id}?`,
    options: [
      { label: "A", value: "a" },
      { label: "B", value: "b" },
    ],
    service_key: "noise_brakes",
    category: "brakes",
    subcategory_slug: "brake_squeal",
    multi_select: false,
    ...overrides,
  };
}

function rec(service_key: string): Record<string, unknown> {
  return {
    service_key,
    display_name: service_key,
    description: null,
    starting_price_cents: 4900,
    source_concerns: ["noise_brakes"],
  };
}

/** A minimal object-shaped queue entry (only its object-ness is counted). */
function queueEntry(concern_id: string): Record<string, unknown> {
  return { concern_id, concern_index: 0 };
}

function baseRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "sess-1",
    current_step: "clarification_question",
    clarification_questions_pending: [pendingQ(101)],
    clarification_questions_answered: {},
    recommended_testing_services: [rec("brake_inspection")],
    approved_testing_services: [],
    declined_testing_services: [],
    concern_triage_state: [],
    concern_clarify_candidates: [],
    ...overrides,
  };
}

function findSessionUpdate(): Record<string, unknown> | undefined {
  const rpc = rpcCalls.find((c) => c.fn === "apply_wizard_transition");
  return rpc?.args.p_payload as Record<string, unknown> | undefined;
}

function transitionStep(): string | undefined {
  const update = findSessionUpdate();
  return update?.current_step as string | undefined;
}

// ─── Suite ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  rpcCalls.length = 0;
  storedRow = baseRow();
  createSupabaseAdminClientMock.mockClear();
  revalidatePathMock.mockClear();
  revalidateTagMock.mockClear();
  sentryCaptureMessage.mockClear();
  sentryCaptureException.mockClear();
  ensureConcernSummariesMock.mockClear();
  logErrorMock.mockClear();
});

describe("submitClarificationAnswerV2 — answer + advance", () => {
  it("answers a question and advances to the next pending question", async () => {
    storedRow = baseRow({
      clarification_questions_pending: [pendingQ(101), pendingQ(102)],
    });

    const result = await submitClarificationAnswerV2({
      chatId: "sess-1",
      question_id: 101,
      action: { kind: "answer", value: "a" },
    });

    expect(result).toEqual({ ok: true, next_step: "clarification_question" });
    const update = findSessionUpdate();
    // 101 recorded; 102 still pending.
    expect(update?.clarification_questions_answered).toEqual({ "101": "a" });
    expect((update?.clarification_questions_pending as unknown[]).length).toBe(
      1,
    );
    // Still asking → summaries deferred.
    expect(ensureConcernSummariesMock).not.toHaveBeenCalled();
  });

  it("drains the queue with recommendations → testing_service_approval + summaries", async () => {
    const result = await submitClarificationAnswerV2({
      chatId: "sess-1",
      question_id: 101,
      action: { kind: "skip" },
    });

    expect(result).toEqual({ ok: true, next_step: "testing_service_approval" });
    expect(ensureConcernSummariesMock).toHaveBeenCalledTimes(1);
  });

  it("drains the queue with NO recommendations → second_routine_pass", async () => {
    storedRow = baseRow({ recommended_testing_services: [] });

    const result = await submitClarificationAnswerV2({
      chatId: "sess-1",
      question_id: 101,
      action: { kind: "answer", value: "b" },
    });

    expect(result).toEqual({ ok: true, next_step: "second_routine_pass" });
    expect(ensureConcernSummariesMock).toHaveBeenCalledTimes(1);
  });
});

describe("submitClarificationAnswerV2 — INV-8 undecided recommendation count", () => {
  it("routes to second_routine_pass (NOT approval) when every rec is already approved/declined", async () => {
    // One recommended service, already approved → 0 UNDECIDED. Routing on the
    // raw recommended count would land on an empty approval card.
    storedRow = baseRow({
      recommended_testing_services: [rec("brake_inspection")],
      approved_testing_services: ["brake_inspection"],
      declined_testing_services: [],
    });

    const result = await submitClarificationAnswerV2({
      chatId: "sess-1",
      question_id: 101,
      action: { kind: "skip" },
    });

    expect(result).toEqual({ ok: true, next_step: "second_routine_pass" });
  });

  it("still routes to approval when at least one rec is undecided", async () => {
    storedRow = baseRow({
      recommended_testing_services: [rec("brake_inspection"), rec("ac_diag")],
      approved_testing_services: ["brake_inspection"],
      declined_testing_services: [],
    });

    const result = await submitClarificationAnswerV2({
      chatId: "sess-1",
      question_id: 101,
      action: { kind: "skip" },
    });

    expect(result).toEqual({ ok: true, next_step: "testing_service_approval" });
  });
});

describe("submitClarificationAnswerV2 — B5 step guard", () => {
  it("rejects a stale submit when current_step is no longer clarification_question", async () => {
    storedRow = baseRow({ current_step: "summary" });

    const result = await submitClarificationAnswerV2({
      chatId: "sess-1",
      question_id: 101,
      action: { kind: "skip" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("stale_current_step");
    // No write when the submit is rejected.
    expect(findSessionUpdate()).toBeUndefined();
    expect(sentryCaptureMessage).toHaveBeenCalled();
  });
});

describe("submitClarificationAnswerV2 — B5/INV-4 drained-branch queue awareness", () => {
  it("head-null drained branch with a pending TRIAGE queue → concern_triage (not routeAfterDiagnostics)", async () => {
    // The queue is already empty but the wizard is still on
    // clarification_question (a race). A pending triage concern must be
    // routed to, not skipped past.
    storedRow = baseRow({
      clarification_questions_pending: [],
      concern_triage_state: [queueEntry("t-1")],
    });

    const result = await submitClarificationAnswerV2({
      chatId: "sess-1",
      question_id: 101,
      action: { kind: "skip" },
    });

    expect(result).toEqual({ ok: true, next_step: "concern_triage" });
    // Early drained branch does not synthesize summaries.
    expect(ensureConcernSummariesMock).not.toHaveBeenCalled();
  });

  it("head-null drained branch with a pending CLARIFY queue → concern_clarify", async () => {
    storedRow = baseRow({
      clarification_questions_pending: [],
      concern_clarify_candidates: [queueEntry("c-1")],
    });

    const result = await submitClarificationAnswerV2({
      chatId: "sess-1",
      question_id: 101,
      action: { kind: "skip" },
    });

    expect(result).toEqual({ ok: true, next_step: "concern_clarify" });
  });

  it("triage OUTRANKS clarify in the drained branch", async () => {
    storedRow = baseRow({
      clarification_questions_pending: [],
      concern_triage_state: [queueEntry("t-1")],
      concern_clarify_candidates: [queueEntry("c-1")],
    });

    const result = await submitClarificationAnswerV2({
      chatId: "sess-1",
      question_id: 101,
      action: { kind: "skip" },
    });

    expect(result).toEqual({ ok: true, next_step: "concern_triage" });
  });

  it("NORMAL drain (last question answered) with a pending triage queue → concern_triage even with recs present", async () => {
    storedRow = baseRow({
      clarification_questions_pending: [pendingQ(101)],
      recommended_testing_services: [rec("brake_inspection")],
      concern_triage_state: [queueEntry("t-1")],
    });

    const result = await submitClarificationAnswerV2({
      chatId: "sess-1",
      question_id: 101,
      action: { kind: "answer", value: "a" },
    });

    expect(result).toEqual({ ok: true, next_step: "concern_triage" });
    // The answer was still recorded before routing.
    const update = findSessionUpdate();
    expect(update?.clarification_questions_answered).toEqual({ "101": "a" });
    expect(transitionStep()).toBe("concern_triage");
    // A triage concern is still owed → summaries deferred.
    expect(ensureConcernSummariesMock).not.toHaveBeenCalled();
  });
});

describe("submitClarificationAnswerV2 — guards", () => {
  it("rejects a queue-head mismatch (submitted a non-head question_id)", async () => {
    storedRow = baseRow({
      clarification_questions_pending: [pendingQ(101), pendingQ(102)],
    });

    const result = await submitClarificationAnswerV2({
      chatId: "sess-1",
      question_id: 102, // not the head
      action: { kind: "skip" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("queue_head_mismatch");
    expect(findSessionUpdate()).toBeUndefined();
  });

  it("returns session_not_found when the row is missing", async () => {
    storedRow = null;

    const result = await submitClarificationAnswerV2({
      chatId: "sess-missing",
      question_id: 101,
      action: { kind: "skip" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("session_not_found");
  });

  it("rejects an invalid option value", async () => {
    const result = await submitClarificationAnswerV2({
      chatId: "sess-1",
      question_id: 101,
      action: { kind: "answer", value: "not_an_option" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_option_value");
  });
});
