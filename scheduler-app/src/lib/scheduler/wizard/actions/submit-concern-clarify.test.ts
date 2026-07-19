/**
 * Unit tests for submitConcernClarifyV2 — the act-or-ask AO4 chip-tap
 * resolver. Anchored to docs/scheduler/act-or-ask-stage1-plan.md.
 *
 * Surface under test (submit-concern-clarify.ts):
 *   1. Re-reads the row; validates current_step === "concern_clarify" +
 *      head entry exists + chosen_key ∈ head.candidate keys (or null).
 *   2. CHOSEN testing_service candidate → hydrates precomputed
 *      unanswered_question_ids into clarification_questions_pending (via
 *      loadDiagnosticCatalog), dedupes recommended_testing_services by
 *      service_key (accumulating source_concerns), annotates
 *      explanation_required_items[concern_index].unanswered_question_ids.
 *   3. CHOSEN other_subcategory OR none-of-these → no rec, no questions.
 *   4. Pops the head; more entries → concern_clarify again; else routes on
 *      merged totals + fires deferred ensureConcernSummaries when the queue
 *      drains AND no questions were queued.
 *   5. Stale current_step + queue-head guards → ok:false.
 *
 * Mocking pattern mirrors run-diagnostics.test.ts (chain-recording supabase
 * mock + RPC-tracking via findSessionUpdate) + get-current-card.test.ts
 * (Sentry + module mocks).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

import type {
  CatalogCategory,
  DiagnosticCatalog,
} from "../llm/load-diagnostic-catalog";

// ─── Module mocks ──────────────────────────────────────────────────────────

const sentryAddBreadcrumb: Mock = vi.fn();
const sentryCaptureMessage: Mock = vi.fn();
const sentryCaptureException: Mock = vi.fn();
const sentrySetTag: Mock = vi.fn();
const sentryLoggerInfo: Mock = vi.fn();
const sentryLoggerWarn: Mock = vi.fn();
const sentryLoggerError: Mock = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: (...args: unknown[]) => sentryAddBreadcrumb(...args),
  captureMessage: (...args: unknown[]) => sentryCaptureMessage(...args),
  captureException: (...args: unknown[]) => sentryCaptureException(...args),
  setTag: (...args: unknown[]) => sentrySetTag(...args),
  logger: {
    info: (...args: unknown[]) => sentryLoggerInfo(...args),
    warn: (...args: unknown[]) => sentryLoggerWarn(...args),
    error: (...args: unknown[]) => sentryLoggerError(...args),
  },
  // wrapAction calls withServerActionInstrumentation; pass through.
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
interface InsertCall {
  table: string;
  payload: Record<string, unknown>;
}
const rpcCalls: RpcCall[] = [];
const insertCalls: InsertCall[] = [];

let storedRow: Record<string, unknown> | null = null;

function makeMockClient() {
  return {
    from(table: string) {
      const eqs: Array<{ col: string; val: unknown }> = [];
      const builder = {
        eq(col: string, val: unknown) {
          eqs.push({ col, val });
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
        insert(payload: Record<string, unknown>) {
          insertCalls.push({ table, payload });
          return {
            // submit-concern-clarify uses .insert(...).then(...) (no await
            // chain) — support the thenable shape.
            then(resolve: (v: { error: null }) => unknown) {
              return Promise.resolve(resolve({ error: null }));
            },
          };
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

const loadDiagnosticCatalogMock: Mock = vi.fn();
vi.mock("@/lib/scheduler/wizard/llm/load-diagnostic-catalog", () => ({
  loadDiagnosticCatalog: (...args: unknown[]) =>
    loadDiagnosticCatalogMock(...args),
  isTestingService: (cat: CatalogCategory) => cat.kind === "testing_service",
  isOtherSubcategory: (cat: CatalogCategory) =>
    cat.kind === "other_subcategory",
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

import { submitConcernClarifyV2 } from "./submit-concern-clarify";

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeCatalog(): DiagnosticCatalog {
  const brakeSub = {
    slug: "brake_squeal",
    display_label: "Brake squeal",
    concern_category: "brakes",
    eligible_testing_service_keys: [],
    description: "",
    positive_examples: [],
    negative_examples: [],
    synonyms: [],
    questions: [
      {
        id: 101,
        question_text: "Where does it squeal?",
        options: [
          { label: "Front", value: "front" },
          { label: "Rear", value: "rear" },
        ],
        display_order: 1,
        multi_select: false,
        required_facts: ["location_axle"],
      },
      {
        id: 102,
        question_text: "How long has it squealed?",
        options: [
          { label: "Days", value: "days" },
          { label: "Weeks", value: "weeks" },
        ],
        display_order: 2,
        multi_select: false,
        required_facts: ["duration"],
      },
    ],
  };
  const acSub = {
    slug: "ac_no_cool",
    display_label: "AC not cooling",
    concern_category: "ac",
    eligible_testing_service_keys: [],
    description: "",
    positive_examples: [],
    negative_examples: [],
    synonyms: [],
    questions: [
      {
        id: 201,
        question_text: "Warm air or no air?",
        options: [
          { label: "Warm", value: "warm" },
          { label: "No air", value: "no_air" },
        ],
        display_order: 1,
        multi_select: false,
        required_facts: ["airflow_state"],
      },
    ],
  };
  return {
    categories: [
      {
        kind: "testing_service",
        service_key: "brake_inspection",
        display_name: "Brake Inspection",
        description: "We inspect your brakes.",
        starting_price_cents: 4900,
        concern_categories: ["brakes"],
        subcategories: [brakeSub],
      },
      {
        kind: "testing_service",
        service_key: "ac_diagnostic",
        display_name: "AC Diagnostic",
        description: "We diagnose the A/C.",
        starting_price_cents: 9900,
        concern_categories: ["ac"],
        subcategories: [acSub],
      },
      {
        kind: "other_subcategory",
        subcategory_slug: "noise_other",
        display_label: "Other noise",
        questions: [
          {
            id: 301,
            question_text: "When does the noise happen?",
            options: [
              { label: "At idle", value: "idle" },
              { label: "While driving", value: "driving" },
            ],
            display_order: 1,
            multi_select: false,
            required_facts: [],
          },
        ],
      },
    ],
  };
}

/** A ConcernClarifyEntry with 2 testing-service candidates (brake + ac). */
function makeClarifyEntry(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    concern_index: 0,
    service_key: "noise_brakes",
    display_name: "Brake noise",
    concern_text: "Squeaking when I brake at low speed.",
    candidates: [
      {
        key: "brake_inspection",
        kind: "testing_service",
        display_name: "Brake Inspection",
        starting_price_cents: 4900,
        description: "We inspect your brakes.",
        precomputed: {
          matched_subcategory_slug: "brake_squeal",
          unanswered_question_ids: [101],
        },
      },
      {
        key: "ac_diagnostic",
        kind: "testing_service",
        display_name: "AC Diagnostic",
        starting_price_cents: 9900,
        description: "We diagnose the A/C.",
        precomputed: {
          matched_subcategory_slug: "ac_no_cool",
          unanswered_question_ids: [201],
        },
      },
    ],
    ...overrides,
  };
}

function baseRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "sess-1",
    current_step: "concern_clarify",
    concern_clarify_candidates: [makeClarifyEntry()],
    recommended_testing_services: [],
    clarification_questions_pending: [],
    explanation_required_items: [
      {
        service_key: "noise_brakes",
        display_name: "Brake noise",
        explanation_text: "Squeaking when I brake at low speed.",
        category: "brakes",
      },
    ],
    ...overrides,
  };
}

function findSessionUpdate(): Record<string, unknown> | undefined {
  const rpc = rpcCalls.find((c) => c.fn === "apply_wizard_transition");
  return rpc?.args.p_payload as Record<string, unknown> | undefined;
}

// ─── Suite ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  rpcCalls.length = 0;
  insertCalls.length = 0;
  storedRow = null;
  createSupabaseAdminClientMock.mockClear();
  revalidatePathMock.mockClear();
  revalidateTagMock.mockClear();
  sentryAddBreadcrumb.mockClear();
  sentryCaptureMessage.mockClear();
  sentryCaptureException.mockClear();
  sentrySetTag.mockClear();
  sentryLoggerInfo.mockClear();
  sentryLoggerWarn.mockClear();
  sentryLoggerError.mockClear();
  loadDiagnosticCatalogMock.mockReset();
  ensureConcernSummariesMock.mockClear();
  logErrorMock.mockClear();

  storedRow = baseRow();
  loadDiagnosticCatalogMock.mockResolvedValue(makeCatalog());
});

describe("submitConcernClarifyV2 — chosen testing_service candidate", () => {
  it("hydrates the precomputed questions + dedupes the recommendation, routes to clarification_question", async () => {
    const result = await submitConcernClarifyV2({
      chatId: "sess-1",
      chosen_key: "brake_inspection",
    });

    expect(result).toEqual({ ok: true, next_step: "clarification_question" });

    const update = findSessionUpdate();
    expect(update).toBeDefined();

    // Recommendation merged (dedupe by service_key; source_concerns accumulated).
    const recs = update?.recommended_testing_services as Array<{
      service_key: string;
      starting_price_cents: number;
      source_concerns: string[];
    }>;
    expect(recs).toHaveLength(1);
    expect(recs[0]!.service_key).toBe("brake_inspection");
    expect(recs[0]!.starting_price_cents).toBe(4900);
    expect(recs[0]!.source_concerns).toEqual(["noise_brakes"]);

    // Precomputed question 101 hydrated into pending (with catalog text/options).
    const pending = update?.clarification_questions_pending as Array<{
      question_id: number;
      question_text: string;
      service_key: string;
      subcategory_slug: string;
      category: string;
      options: Array<{ label: string; value: string }>;
    }>;
    expect(pending).toHaveLength(1);
    expect(pending[0]!.question_id).toBe(101);
    expect(pending[0]!.question_text).toBe("Where does it squeal?");
    expect(pending[0]!.service_key).toBe("noise_brakes");
    expect(pending[0]!.subcategory_slug).toBe("brake_squeal");
    expect(pending[0]!.category).toBe("brakes");
    expect(pending[0]!.options).toHaveLength(2);

    // explanation_required_items[0] annotated with the queued question ids.
    const items = update?.explanation_required_items as Array<{
      service_key: string;
      unanswered_question_ids: number[];
    }>;
    expect(items[0]!.unanswered_question_ids).toEqual([101]);

    // Head popped → column cleared to [].
    expect(update?.concern_clarify_candidates).toEqual([]);

    // Pending non-empty → summaries deferred to submit-clarification-answer.
    expect(ensureConcernSummariesMock).not.toHaveBeenCalled();

    // User-voice bubble is the tapped candidate name.
    const rpc = rpcCalls.find((c) => c.fn === "apply_wizard_transition")!;
    expect(rpc.args.p_user_bubble_text).toBe("Brake Inspection");
  });

  it("INDEX-SAFE annotation: two duplicate `other_issue` concerns — only the head's concern_index entry is annotated (no service_key clobber)", async () => {
    // Two duplicate `other_issue` entries share a service_key. The clarify
    // head is concern_index 1 (the SECOND entry). The annotation must land
    // on index 1 ONLY. Pre-fix, the `|| item.service_key === head.service_key`
    // fallback ALSO matched index 0, clobbering the first entry's own
    // (empty) annotation with the head's ids (2026-07-04 fix — same class as
    // the run-diagnostics write-back bug).
    storedRow = baseRow({
      concern_clarify_candidates: [
        makeClarifyEntry({ concern_index: 1, service_key: "other_issue" }),
      ],
      explanation_required_items: [
        {
          service_key: "other_issue",
          display_name: "Other issue",
          explanation_text: "Clunk over bumps.",
          category: null,
          unanswered_question_ids: [],
        },
        {
          service_key: "other_issue",
          display_name: "Other issue",
          explanation_text: "Squeal when braking.",
          category: null,
        },
      ],
    });

    await submitConcernClarifyV2({
      chatId: "sess-1",
      chosen_key: "brake_inspection",
    });

    const update = findSessionUpdate();
    const items = update?.explanation_required_items as Array<{
      unanswered_question_ids?: number[];
    }>;
    // Index 0 (the OTHER duplicate) is UNTOUCHED — still empty.
    expect(items[0]!.unanswered_question_ids ?? []).toEqual([]);
    // Index 1 (the head) got the queued ids.
    expect(items[1]!.unanswered_question_ids).toEqual([101]);
  });

  it("routes to testing_service_approval + fires ensureConcernSummaries when the chosen candidate has NO precomputed questions", async () => {
    storedRow = baseRow({
      concern_clarify_candidates: [
        makeClarifyEntry({
          candidates: [
            {
              key: "brake_inspection",
              kind: "testing_service",
              display_name: "Brake Inspection",
              starting_price_cents: 4900,
              description: "We inspect your brakes.",
              precomputed: {
                matched_subcategory_slug: "brake_squeal",
                unanswered_question_ids: [], // nothing unanswered
              },
            },
            {
              key: "ac_diagnostic",
              kind: "testing_service",
              display_name: "AC Diagnostic",
              starting_price_cents: 9900,
              description: "We diagnose the A/C.",
              precomputed: {
                matched_subcategory_slug: "ac_no_cool",
                unanswered_question_ids: [201],
              },
            },
          ],
        }),
      ],
    });

    const result = await submitConcernClarifyV2({
      chatId: "sess-1",
      chosen_key: "brake_inspection",
    });

    expect(result).toEqual({ ok: true, next_step: "testing_service_approval" });
    const update = findSessionUpdate();
    expect((update?.recommended_testing_services as unknown[]).length).toBe(1);
    expect((update?.clarification_questions_pending as unknown[]).length).toBe(
      0,
    );
    // Queue drained + no questions → summaries fire NOW.
    expect(ensureConcernSummariesMock).toHaveBeenCalledTimes(1);
  });

  it("MERGES with an existing recommendation on the row (dedupe + accumulate source_concerns)", async () => {
    storedRow = baseRow({
      recommended_testing_services: [
        {
          service_key: "brake_inspection",
          display_name: "Brake Inspection",
          description: "We inspect your brakes.",
          starting_price_cents: 4900,
          source_concerns: ["other_concern"],
        },
      ],
    });

    await submitConcernClarifyV2({
      chatId: "sess-1",
      chosen_key: "brake_inspection",
    });

    const update = findSessionUpdate();
    const recs = update?.recommended_testing_services as Array<{
      service_key: string;
      source_concerns: string[];
    }>;
    expect(recs).toHaveLength(1);
    expect(recs[0]!.source_concerns.sort()).toEqual(
      ["noise_brakes", "other_concern"].sort(),
    );
  });
});

describe("submitConcernClarifyV2 — soft advisor branches", () => {
  it("chosen other_subcategory candidate with NO precomputed questions → no rec, no questions, second_routine_pass", async () => {
    storedRow = baseRow({
      concern_clarify_candidates: [
        makeClarifyEntry({
          candidates: [
            {
              key: "noise_other",
              kind: "other_subcategory",
              display_name: "Other noise",
              starting_price_cents: null,
              description: null,
              precomputed: {
                matched_subcategory_slug: "noise_other",
                unanswered_question_ids: [],
              },
            },
            {
              key: "brake_inspection",
              kind: "testing_service",
              display_name: "Brake Inspection",
              starting_price_cents: 4900,
              description: "We inspect your brakes.",
              precomputed: {
                matched_subcategory_slug: "brake_squeal",
                unanswered_question_ids: [101],
              },
            },
          ],
        }),
      ],
    });

    const result = await submitConcernClarifyV2({
      chatId: "sess-1",
      chosen_key: "noise_other",
    });

    expect(result).toEqual({ ok: true, next_step: "second_routine_pass" });
    const update = findSessionUpdate();
    // No fee-bearing recommendation for an other_subcategory pick.
    expect((update?.recommended_testing_services as unknown[]).length).toBe(0);
    // Empty precomputed set → nothing hydrated.
    expect((update?.clarification_questions_pending as unknown[]).length).toBe(
      0,
    );
    // Drained + no questions → summaries fire.
    expect(ensureConcernSummariesMock).toHaveBeenCalledTimes(1);
    // User bubble is the tapped candidate name.
    const rpc = rpcCalls.find((c) => c.fn === "apply_wizard_transition")!;
    expect(rpc.args.p_user_bubble_text).toBe("Other noise");
  });

  it("B3: chosen other_subcategory candidate WITH precomputed questions → hydrates them (no rec), routes clarification_question", async () => {
    storedRow = baseRow({
      concern_clarify_candidates: [
        makeClarifyEntry({
          candidates: [
            {
              key: "noise_other",
              kind: "other_subcategory",
              display_name: "Other noise",
              starting_price_cents: null,
              description: null,
              precomputed: {
                // The ids were ALREADY persisted; the pre-B3 code dropped them.
                matched_subcategory_slug: "noise_other",
                unanswered_question_ids: [301],
              },
            },
            {
              key: "brake_inspection",
              kind: "testing_service",
              display_name: "Brake Inspection",
              starting_price_cents: 4900,
              description: "We inspect your brakes.",
              precomputed: {
                matched_subcategory_slug: "brake_squeal",
                unanswered_question_ids: [101],
              },
            },
          ],
        }),
      ],
    });

    const result = await submitConcernClarifyV2({
      chatId: "sess-1",
      chosen_key: "noise_other",
    });

    expect(result).toEqual({ ok: true, next_step: "clarification_question" });
    const update = findSessionUpdate();
    // No recommendation (other_subcategory carries no testing service).
    expect((update?.recommended_testing_services as unknown[]).length).toBe(0);
    // B3: the precomputed question 301 is hydrated from the catalog.
    const pending = update?.clarification_questions_pending as Array<{
      question_id: number;
      question_text: string;
      service_key: string;
      subcategory_slug: string;
      category: string;
    }>;
    expect(pending).toHaveLength(1);
    expect(pending[0]!.question_id).toBe(301);
    expect(pending[0]!.question_text).toBe("When does the noise happen?");
    expect(pending[0]!.subcategory_slug).toBe("noise_other");
    // 'other' subcategories carry the 'other' parent category.
    expect(pending[0]!.category).toBe("other");
    // The concern item is annotated with the queued id.
    const items = update?.explanation_required_items as Array<{
      unanswered_question_ids?: number[];
    }>;
    expect(items[0]!.unanswered_question_ids).toEqual([301]);
    // Questions pending → summaries deferred.
    expect(ensureConcernSummariesMock).not.toHaveBeenCalled();
  });

  it("none-of-these (chosen_key null) → no rec, no questions, second_routine_pass, 'None of these' bubble", async () => {
    const result = await submitConcernClarifyV2({
      chatId: "sess-1",
      chosen_key: null,
    });

    expect(result).toEqual({ ok: true, next_step: "second_routine_pass" });
    const update = findSessionUpdate();
    expect((update?.recommended_testing_services as unknown[]).length).toBe(0);
    expect((update?.clarification_questions_pending as unknown[]).length).toBe(
      0,
    );
    expect(loadDiagnosticCatalogMock).not.toHaveBeenCalled();
    expect(ensureConcernSummariesMock).toHaveBeenCalledTimes(1);
    const rpc = rpcCalls.find((c) => c.fn === "apply_wizard_transition")!;
    expect(rpc.args.p_user_bubble_text).toBe("None of these");
  });
});

describe("submitConcernClarifyV2 — queue drain vs next clarify", () => {
  it("more clarify entries remain → routes to concern_clarify again (head popped)", async () => {
    storedRow = baseRow({
      concern_clarify_candidates: [
        makeClarifyEntry(),
        makeClarifyEntry({
          concern_index: 1,
          service_key: "ac_problem",
          display_name: "AC issue",
          concern_text: "Blows warm.",
        }),
      ],
    });

    const result = await submitConcernClarifyV2({
      chatId: "sess-1",
      chosen_key: "brake_inspection",
    });

    expect(result).toEqual({ ok: true, next_step: "concern_clarify" });
    const update = findSessionUpdate();
    // Head popped → one entry left (the second concern).
    const remaining = update?.concern_clarify_candidates as Array<{
      service_key: string;
      concern_index: number;
    }>;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.service_key).toBe("ac_problem");
    expect(remaining[0]!.concern_index).toBe(1);
    // Still owe a tap → summaries deferred even though this concern had a rec.
    expect(ensureConcernSummariesMock).not.toHaveBeenCalled();
  });
});

describe("submitConcernClarifyV2 — guards", () => {
  it("rejects an invalid chosen_key (not one of the head's candidates)", async () => {
    const result = await submitConcernClarifyV2({
      chatId: "sess-1",
      chosen_key: "not_a_candidate",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_chosen_key");
    // No write when the tap is rejected.
    expect(findSessionUpdate()).toBeUndefined();
    expect(sentryCaptureMessage).toHaveBeenCalled();
  });

  it("rejects a stale tap when current_step is no longer concern_clarify", async () => {
    storedRow = baseRow({ current_step: "clarification_question" });

    const result = await submitConcernClarifyV2({
      chatId: "sess-1",
      chosen_key: "brake_inspection",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("stale_current_step");
    expect(findSessionUpdate()).toBeUndefined();
  });

  it("rejects when the clarify queue is already drained (empty array)", async () => {
    storedRow = baseRow({ concern_clarify_candidates: [] });

    const result = await submitConcernClarifyV2({
      chatId: "sess-1",
      chosen_key: "brake_inspection",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("clarify_queue_empty");
    expect(findSessionUpdate()).toBeUndefined();
  });

  it("returns ok:false with the session_not_found error when the row is missing", async () => {
    storedRow = null;

    const result = await submitConcernClarifyV2({
      chatId: "sess-missing",
      chosen_key: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("session_not_found");
  });
});

describe("submitConcernClarifyV2 — audit", () => {
  it("best-effort inserts a concern_clarify_choice audit row with the chosen + candidate keys", async () => {
    await submitConcernClarifyV2({
      chatId: "sess-1",
      chosen_key: "brake_inspection",
    });

    const audit = insertCalls.find(
      (c) => c.table === "scheduler_audit_log",
    );
    expect(audit).toBeDefined();
    expect(audit?.payload.event_type).toBe("concern_clarify_choice");
    const detail = audit?.payload.event_detail as Record<string, unknown>;
    expect(detail.chosen_key).toBe("brake_inspection");
    expect(detail.candidate_keys).toEqual(["brake_inspection", "ac_diagnostic"]);
    expect(detail.concern_index).toBe(0);
  });
});

// ─── B1 — confidence gate at tap ─────────────────────────────────────────────

/** A single-testing-service clarify entry whose brake candidate carries the
 *  given per-candidate confidence values. */
function brakeEntryWithConfidence(
  s2: "high" | "medium" | "low" | undefined,
  s3: "high" | "medium" | "low" | undefined,
): Record<string, unknown> {
  return makeClarifyEntry({
    candidates: [
      {
        key: "brake_inspection",
        kind: "testing_service",
        display_name: "Brake Inspection",
        starting_price_cents: 4900,
        description: "We inspect your brakes.",
        precomputed: {
          matched_subcategory_slug: "brake_squeal",
          unanswered_question_ids: [101],
          ...(s2 ? { stage2_confidence: s2 } : {}),
          ...(s3 ? { stage3_confidence: s3 } : {}),
        },
      },
    ],
  });
}

describe("submitConcernClarifyV2 — B1 confidence gate at tap", () => {
  it("stage2 'low' → advisor handoff (no rec, no questions, handoff_reason, second_routine_pass)", async () => {
    storedRow = baseRow({
      concern_clarify_candidates: [brakeEntryWithConfidence("low", "high")],
    });

    const result = await submitConcernClarifyV2({
      chatId: "sess-1",
      chosen_key: "brake_inspection",
    });

    expect(result).toEqual({ ok: true, next_step: "second_routine_pass" });
    const update = findSessionUpdate();
    // Stripped to the advisor path — no rec, no questions.
    expect((update?.recommended_testing_services as unknown[]).length).toBe(0);
    expect((update?.clarification_questions_pending as unknown[]).length).toBe(
      0,
    );
    // The concern is annotated with the handoff reason (observability).
    const items = update?.explanation_required_items as Array<{
      handoff_reason?: string | null;
    }>;
    expect(items[0]!.handoff_reason).toBe("stage2_low");
    // Stage-2-low strips BEFORE any catalog load.
    expect(loadDiagnosticCatalogMock).not.toHaveBeenCalled();
    // Drained + no questions → summaries fire.
    expect(ensureConcernSummariesMock).toHaveBeenCalledTimes(1);
  });

  it("stage3 'low' → over-ask: the FULL subcategory question list is queued (not just the precomputed set)", async () => {
    storedRow = baseRow({
      concern_clarify_candidates: [brakeEntryWithConfidence("high", "low")],
    });

    const result = await submitConcernClarifyV2({
      chatId: "sess-1",
      chosen_key: "brake_inspection",
    });

    expect(result).toEqual({ ok: true, next_step: "clarification_question" });
    const update = findSessionUpdate();
    // Rec still recommended (Stage-2 was fine).
    expect((update?.recommended_testing_services as unknown[]).length).toBe(1);
    // Over-ask: brake_squeal has questions [101, 102]; precomputed only had
    // [101]. The Stage-3-low gate re-queues the WHOLE subcategory.
    const pending = update?.clarification_questions_pending as Array<{
      question_id: number;
    }>;
    expect(pending.map((p) => p.question_id).sort()).toEqual([101, 102]);
    // The annotation reflects the full over-ask set.
    const items = update?.explanation_required_items as Array<{
      unanswered_question_ids?: number[];
    }>;
    expect(items[0]!.unanswered_question_ids!.sort()).toEqual([101, 102]);
  });

  it("MISSING confidence (legacy rows) → PASS, never gate (INV-8 back-compat)", async () => {
    // No stage2/stage3 confidence on the candidate at all.
    storedRow = baseRow({
      concern_clarify_candidates: [
        brakeEntryWithConfidence(undefined, undefined),
      ],
    });

    const result = await submitConcernClarifyV2({
      chatId: "sess-1",
      chosen_key: "brake_inspection",
    });

    expect(result).toEqual({ ok: true, next_step: "clarification_question" });
    const update = findSessionUpdate();
    // Normal resolution: rec kept + only the precomputed question (no gate).
    expect((update?.recommended_testing_services as unknown[]).length).toBe(1);
    const pending = update?.clarification_questions_pending as Array<{
      question_id: number;
    }>;
    expect(pending.map((p) => p.question_id)).toEqual([101]);
    const items = update?.explanation_required_items as Array<{
      handoff_reason?: string | null;
    }>;
    // No handoff — the concern was resolved, not stripped.
    expect(items[0]!.handoff_reason ?? null).toBeNull();
  });
});

// ─── B4 — answered / queued guards ──────────────────────────────────────────

describe("submitConcernClarifyV2 — B4 answered/queued guards", () => {
  it("skips a precomputed question that was already answered", async () => {
    // Question 101 was already answered on a prior pass — the tap must NOT
    // re-queue it. Over-ask is off, so only 101 would have been hydrated →
    // pending stays empty and the wizard routes on recs.
    storedRow = baseRow({
      clarification_questions_answered: { "101": "front" },
    });

    const result = await submitConcernClarifyV2({
      chatId: "sess-1",
      chosen_key: "brake_inspection",
    });

    const update = findSessionUpdate();
    const pending = update?.clarification_questions_pending as unknown[];
    // 101 already answered → not re-queued.
    expect(pending.length).toBe(0);
    // Rec still present → testing_service_approval, summaries fire.
    expect(result).toEqual({ ok: true, next_step: "testing_service_approval" });
    // The annotation still records 101 as belonging to the concern (canonical).
    const items = update?.explanation_required_items as Array<{
      unanswered_question_ids?: number[];
    }>;
    expect(items[0]!.unanswered_question_ids).toEqual([101]);
  });

  it("does not double-queue a question already carried forward in pending", async () => {
    // The existing pending queue already holds 101 (a carried-forward entry).
    // The tap's precomputed 101 must not be pushed a second time.
    storedRow = baseRow({
      clarification_questions_pending: [
        {
          question_id: 101,
          question_text: "Where does it squeal?",
          options: [
            { label: "Front", value: "front" },
            { label: "Rear", value: "rear" },
          ],
          service_key: "noise_brakes",
          category: "brakes",
          subcategory_slug: "brake_squeal",
          multi_select: false,
        },
      ],
    });

    await submitConcernClarifyV2({
      chatId: "sess-1",
      chosen_key: "brake_inspection",
    });

    const update = findSessionUpdate();
    const pending = update?.clarification_questions_pending as Array<{
      question_id: number;
    }>;
    // Exactly one 101 — carried forward once, not re-queued by the tap.
    expect(pending.filter((p) => p.question_id === 101)).toHaveLength(1);
  });
});

// ─── INV-3 — triage field preservation on round-trip ────────────────────────

describe("submitConcernClarifyV2 — INV-3 field preservation", () => {
  it("preserves concern_id / triage_round / triage_answers through the write-back", async () => {
    const triageAnswers = {
      allowed_service_keys: ["brake_inspection"],
      chip_key: "brakes",
      label: "The brakes",
    };
    storedRow = baseRow({
      explanation_required_items: [
        {
          service_key: "noise_brakes",
          display_name: "Brake noise",
          explanation_text: "Squeaking when I brake at low speed.",
          category: "brakes",
          concern_id: "11111111-1111-1111-1111-111111111111",
          triage_round: 1,
          triage_answers: triageAnswers,
        },
      ],
    });

    await submitConcernClarifyV2({
      chatId: "sess-1",
      chosen_key: "brake_inspection",
    });

    const update = findSessionUpdate();
    const items = update?.explanation_required_items as Array<
      Record<string, unknown>
    >;
    expect(items[0]!.concern_id).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
    expect(items[0]!.triage_round).toBe(1);
    expect(items[0]!.triage_answers).toEqual(triageAnswers);
    // The annotation still landed on top of the preserved fields.
    expect(items[0]!.unanswered_question_ids).toEqual([101]);
  });
});

// ─── INV-4 — triage-first routing ───────────────────────────────────────────

describe("submitConcernClarifyV2 — INV-4 triage-first routing", () => {
  it("a pending triage queue outranks the clarify queue AND the normal route", async () => {
    // Two clarify entries remain AND a triage entry is pending. After the tap
    // resolves the head, triage wins → concern_triage (not concern_clarify).
    storedRow = baseRow({
      concern_clarify_candidates: [
        makeClarifyEntry(),
        makeClarifyEntry({ concern_index: 1, service_key: "ac_problem" }),
      ],
      concern_triage_state: [
        {
          concern_id: "22222222-2222-2222-2222-222222222222",
          concern_index: 2,
          service_key: "other_issue",
          concern_text: "It feels weird.",
          chips: [{ chip_key: "brakes", display_label: "The brakes" }],
          allowed_by_chip: { brakes: ["brake_inspection"] },
          triage_round: 0,
          created_version: "v1",
        },
      ],
    });

    const result = await submitConcernClarifyV2({
      chatId: "sess-1",
      chosen_key: "brake_inspection",
    });

    expect(result).toEqual({ ok: true, next_step: "concern_triage" });
    // A triage concern is still owed → summaries deferred even though this
    // concern produced a rec + question.
    expect(ensureConcernSummariesMock).not.toHaveBeenCalled();
  });
});
