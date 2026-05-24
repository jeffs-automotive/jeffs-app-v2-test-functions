/**
 * Unit tests for runDiagnosticsV2 — the per-concern parallel LLM aggregator
 * + dedup + routing brain. Anchored to Plan 01 Phase 4B.
 *
 * Surface under test (run-diagnostics.ts):
 *   1. Loads the chat row (idempotency check on diagnostic_processing_complete)
 *   2. Loads catalog + routine_services chip-hint map
 *   3. Per-concern Promise.all over diagnoseConcern() — FAIL-FAST behavior
 *      (the source code uses Promise.all, NOT Promise.allSettled, as of
 *      2026-05-22 — test #8 documents this).
 *   4. Aggregates recommendations (dedup by service_key, accumulates
 *      source_concerns[]) + flat pending-questions queue.
 *   5. Routes via routeAfterDiagnostics: pending > 0 → clarification_question,
 *      recs > 0 → testing_service_approval, neither → second_routine_pass.
 *   6. Persists via applyWizardTransition (single RPC on
 *      customer_chat_sessions) + fires ensureConcernSummaries when pending
 *      is empty.
 *   7. Sentry breadcrumbs per concern + an aggregate captureMessage.
 *
 * Plan 04 Phase 1A (2026-05-24): applyWizardTransition now routes through
 * `supabase.rpc('apply_wizard_transition', { p_chat_id, p_payload, ... })`
 * instead of `.from('customer_chat_sessions').update(...)`. The supabase
 * mock now tracks RPC calls alongside the existing chain-recording, and
 * the `findSessionUpdate()` helper inspects rpcCalls for the RPC's
 * p_payload (which carries what used to be the `.update` payload, plus
 * the `current_step: <nextStep>` and `status: 'active'` keys that
 * transition.ts adds before the RPC call).
 *
 * Scope note: the source does NOT write to scheduler_admin_audit_log. Test
 * #9 below therefore verifies the canonical "write surface" — the row
 * payload sent to apply_wizard_transition (NOT the table the task brief
 * mentioned, which doesn't apply to this action).
 *
 * Mocking pattern matches tests/unit/submit-start-over.test.ts (chain-
 * recording supabase mock + RPC-tracking) + tests/unit/get-current-card.test.ts
 * (Sentry + module mocks). No test seam added to the source.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

import type {
  DiagnoseConcernArgs,
  DiagnoseConcernResult,
} from "../llm/diagnose-concern";
import type {
  CatalogCategory,
  DiagnosticCatalog,
} from "../llm/load-diagnostic-catalog";

// ─── Module mocks ──────────────────────────────────────────────────────────

// Sentry — record breadcrumb + message + tag calls so the breadcrumb test
// can assert on call counts + payloads. `logger.info` is mocked separately
// for the aggregate-outcome telemetry call (migrated from captureMessage
// per PLAN-02 Phase 2B I-OBS-8 — info-level captureMessage created false-
// alarm issues; logger.info routes to the Sentry Logs UI instead).
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

// next/cache — applyWizardTransition calls revalidateTag + revalidatePath
// at the end (post-Plan-04-Phase-5B).
const revalidatePathMock: Mock = vi.fn();
const revalidateTagMock: Mock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (path: string, type?: string) =>
    revalidatePathMock(path, type),
  revalidateTag: (tag: string) => revalidateTagMock(tag),
}));

// Supabase admin client — chain-recording mock. Each query gets logged
// in `chainCalls` (for .from(...) builders) and `rpcCalls` (for
// .rpc(...)) so tests can assert on table/op/payload/match for chains
// and on fn/args for RPCs.
interface ChainCall {
  table: string;
  op: "select" | "update" | "insert" | "delete";
  payload?: Record<string, unknown>;
  match?: Array<{ col: string; val: unknown }>;
}
interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}
const chainCalls: ChainCall[] = [];
const rpcCalls: RpcCall[] = [];

// Per-test row snapshot returned by the FIRST select() on customer_chat_sessions.
let storedRow: Record<string, unknown> | null = null;

function makeMockClient() {
  return {
    from(table: string) {
      const eqs: Array<{ col: string; val: unknown }> = [];
      // Track which terminal we should return on the select. The action
      // queries (a) customer_chat_sessions with .maybeSingle(),
      // (b) routine_services as a plain awaited builder, and
      // (c) testing_services / concern_subcategories / concern_questions
      // via loadDiagnosticCatalog — but the catalog loader is MOCKED at
      // the module level (see below), so this client only sees (a) + (b).
      // The trailing applyWizardTransition write goes through .rpc(...),
      // tracked in rpcCalls.
      const builder = {
        eq(col: string, val: unknown) {
          eqs.push({ col, val });
          return builder;
        },
        async maybeSingle() {
          chainCalls.push({ table, op: "select", match: [...eqs] });
          return { data: storedRow, error: null };
        },
        // Bare thenable for awaited builder paths (routine_services).
        async then(resolve: (v: { data: unknown; error: null }) => unknown) {
          chainCalls.push({ table, op: "select", match: [...eqs] });
          // routine_services chip-hint lookup — return an empty array so
          // buildChipHint falls through to catalog lookup (still works
          // because catalog mock provides the testing-service category).
          return resolve({ data: [], error: null });
        },
      };
      return {
        select(_cols: string) {
          return builder;
        },
        update(payload: Record<string, unknown>) {
          chainCalls.push({ table, op: "update", payload });
          return {
            eq(col: string, val: unknown) {
              eqs.push({ col, val });
              return {
                async then(resolve: (v: { error: null }) => unknown) {
                  chainCalls[chainCalls.length - 1]!.match = [...eqs];
                  return resolve({ error: null });
                },
              };
            },
          };
        },
        insert(payload: Record<string, unknown>) {
          chainCalls.push({ table, op: "insert", payload });
          return {
            async then(resolve: (v: { error: null }) => unknown) {
              return resolve({ error: null });
            },
          };
        },
      };
    },
    // Plan 04 Phase 1A: applyWizardTransition routes the column-update +
    // optional bubble inserts through the apply_wizard_transition RPC.
    // Track every RPC call so tests can inspect p_payload (which carries
    // what used to land in `.from('customer_chat_sessions').update`).
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

// diagnoseConcern — mocked per-test via vi.mocked(...).mockResolvedValueOnce.
const diagnoseConcernMock: Mock = vi.fn();
vi.mock("@/lib/scheduler/wizard/llm/diagnose-concern", () => ({
  diagnoseConcern: (args: DiagnoseConcernArgs) => diagnoseConcernMock(args),
}));

// loadDiagnosticCatalog — mocked per-test. The real isTestingService is
// preserved (pure function, no mocking needed).
const loadDiagnosticCatalogMock: Mock = vi.fn();
vi.mock("@/lib/scheduler/wizard/llm/load-diagnostic-catalog", () => ({
  loadDiagnosticCatalog: (...args: unknown[]) =>
    loadDiagnosticCatalogMock(...args),
  isTestingService: (cat: CatalogCategory) => cat.kind === "testing_service",
  isOtherSubcategory: (cat: CatalogCategory) =>
    cat.kind === "other_subcategory",
}));

// ensureConcernSummaries — fire-and-await side-effect after no-pending path.
// Mock to a no-op so we don't have to mock summarizeConcern + Supabase calls
// it makes.
const ensureConcernSummariesMock: Mock = vi.fn(async () => undefined);
vi.mock("@/lib/scheduler/wizard/ensure-concern-summaries", () => ({
  ensureConcernSummaries: (...args: unknown[]) =>
    ensureConcernSummariesMock(...args),
}));

// logError — the action calls this in its top-level catch. Stub to no-op.
const logErrorMock: Mock = vi.fn(async () => undefined);
vi.mock("@/lib/scheduler/wizard/log-error", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

// append-bubble — applyWizardTransition calls it when a jeffBubble is
// passed. No-op in tests; we assert routing via update payload + chainCalls.
const appendBubbleMock: Mock = vi.fn(async () => undefined);
vi.mock("@/lib/scheduler/wizard/append-bubble", () => ({
  appendBubble: (...args: unknown[]) => appendBubbleMock(...args),
}));

// Import the action AFTER all vi.mock calls so they take effect.
import { runDiagnosticsV2 } from "./run-diagnostics";

// ─── Fixture helpers ───────────────────────────────────────────────────────

/**
 * Build a minimal DiagnosticCatalog with:
 *   - 1 testing_service category ("brake_inspection") with one subcategory
 *     ("brake_squeal") that has one question (id=101).
 *   - 1 testing_service category ("ac_diagnostic") with one subcategory
 *     ("ac_no_cool") that has one question (id=201).
 *   - 1 other_subcategory category ("noise_other") with one question
 *     (id=301) — used for the all-other / forward-to-advisor path.
 */
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
        question_text: "Blowing warm air or no air?",
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
            question_text: "Where does the noise come from?",
            options: [
              { label: "Engine", value: "engine" },
              { label: "Under car", value: "under" },
            ],
            display_order: 1,
            multi_select: false,
            required_facts: ["sound_or_smoke_location_zone"],
          },
        ],
      },
    ],
  };
}

/**
 * Build a DiagnoseConcernResult anchored to a testing-service match.
 * Defaults to brake_inspection / brake_squeal with no unanswered questions.
 */
function makeServiceMatch(
  overrides: Partial<DiagnoseConcernResult> = {},
): DiagnoseConcernResult {
  return {
    matched_category_key: "brake_inspection",
    matched_kind: "testing_service",
    matched_subcategory_slug: "brake_squeal",
    recommended_testing_service: {
      service_key: "brake_inspection",
      display_name: "Brake Inspection",
      description: "We inspect your brakes.",
      starting_price_cents: 4900,
    },
    unanswered_question_ids: [],
    extracted_facts: null,
    stage1_confidence: "high",
    stage2_confidence: "high",
    stage3_confidence: "high",
    parsed_ok: true,
    model: "claude-haiku-4-5",
    latency_ms: 250,
    tokens_in: 100,
    tokens_out: 50,
    error_message: "",
    ...overrides,
  };
}

/** Build an 'other'-subcategory match (no testing service recommended). */
function makeOtherMatch(
  overrides: Partial<DiagnoseConcernResult> = {},
): DiagnoseConcernResult {
  return {
    matched_category_key: "noise_other",
    matched_kind: "other_subcategory",
    matched_subcategory_slug: "noise_other",
    recommended_testing_service: null,
    unanswered_question_ids: [],
    extracted_facts: null,
    stage1_confidence: "medium",
    stage2_confidence: "medium",
    stage3_confidence: "medium",
    parsed_ok: true,
    model: "claude-haiku-4-5",
    latency_ms: 250,
    tokens_in: 100,
    tokens_out: 50,
    error_message: "",
    ...overrides,
  };
}

/** Build a null-match (LLM couldn't categorize the concern). */
function makeNullMatch(
  overrides: Partial<DiagnoseConcernResult> = {},
): DiagnoseConcernResult {
  return {
    matched_category_key: null,
    matched_kind: null,
    matched_subcategory_slug: null,
    recommended_testing_service: null,
    unanswered_question_ids: [],
    extracted_facts: null,
    stage1_confidence: "low",
    stage2_confidence: "low",
    stage3_confidence: "low",
    parsed_ok: true,
    model: "claude-haiku-4-5",
    latency_ms: 200,
    tokens_in: 80,
    tokens_out: 30,
    error_message: "",
    ...overrides,
  };
}

/**
 * Find the customer_chat_sessions update payload in rpcCalls.
 *
 * Plan 04 Phase 1A: applyWizardTransition no longer calls
 * `.from('customer_chat_sessions').update(...)`. It calls
 * `supabase.rpc('apply_wizard_transition', { p_chat_id, p_payload, ... })`
 * where `p_payload` carries everything that used to land in the .update
 * call (plus the `status: 'active'` default and `current_step: <nextStep>`
 * that transition.ts spreads in).
 *
 * Returns the p_payload of the first apply_wizard_transition call, or
 * undefined if the action never reached the persistence step (e.g., a
 * top-level catch fired before applyWizardTransition was invoked).
 */
function findSessionUpdate(): Record<string, unknown> | undefined {
  const rpc = rpcCalls.find((c) => c.fn === "apply_wizard_transition");
  return rpc?.args.p_payload as Record<string, unknown> | undefined;
}

// ─── Test suite ────────────────────────────────────────────────────────────

beforeEach(() => {
  chainCalls.length = 0;
  rpcCalls.length = 0;
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
  diagnoseConcernMock.mockReset();
  loadDiagnosticCatalogMock.mockReset();
  ensureConcernSummariesMock.mockClear();
  appendBubbleMock.mockClear();
  logErrorMock.mockClear();

  // Default: a row with one brake-noise concern. Tests override as needed.
  storedRow = {
    id: "sess-1",
    explanation_required_items: [
      {
        service_key: "noise_brakes",
        display_name: "Brake noise",
        explanation_text: "Squeaking when I brake at low speed.",
        category: "brakes",
      },
    ],
    new_vehicle_info: null,
    diagnostic_processing_complete: false,
    clarification_questions_pending: [],
    recommended_testing_services: [],
  };
  loadDiagnosticCatalogMock.mockResolvedValue(makeCatalog());
});

describe("runDiagnosticsV2 — single concern, testing-service match", () => {
  it("routes to clarification_question when there ARE unanswered question ids", async () => {
    diagnoseConcernMock.mockResolvedValueOnce(
      makeServiceMatch({ unanswered_question_ids: [101] }),
    );

    const result = await runDiagnosticsV2({ chatId: "sess-1" });

    expect(result).toEqual({
      ok: true,
      next_step: "clarification_question",
    });

    const update = findSessionUpdate();
    expect(update).toBeDefined();
    expect(update?.diagnostic_processing_complete).toBe(true);
    expect(Array.isArray(update?.recommended_testing_services)).toBe(true);
    expect(
      (update?.recommended_testing_services as Array<{ service_key: string }>)
        .length,
    ).toBe(1);
    expect(
      (update?.recommended_testing_services as Array<{ service_key: string }>)[0]!
        .service_key,
    ).toBe("brake_inspection");

    const pending = update?.clarification_questions_pending as Array<{
      question_id: number;
      service_key: string;
    }>;
    expect(pending).toHaveLength(1);
    expect(pending[0]!.question_id).toBe(101);

    // No pending → ensureConcernSummaries should NOT fire on this path.
    expect(ensureConcernSummariesMock).not.toHaveBeenCalled();
  });

  it("routes to testing_service_approval when there are NO unanswered question ids", async () => {
    diagnoseConcernMock.mockResolvedValueOnce(
      makeServiceMatch({ unanswered_question_ids: [] }),
    );

    const result = await runDiagnosticsV2({ chatId: "sess-1" });

    expect(result).toEqual({
      ok: true,
      next_step: "testing_service_approval",
    });

    const update = findSessionUpdate();
    expect(
      (update?.recommended_testing_services as unknown[]).length,
    ).toBe(1);
    expect(
      (update?.clarification_questions_pending as unknown[]).length,
    ).toBe(0);

    // Pending empty + recs present → summaries fire NOW.
    expect(ensureConcernSummariesMock).toHaveBeenCalledTimes(1);
  });
});

describe("runDiagnosticsV2 — multi-concern aggregation", () => {
  it("dedups recommendations by service_key (2 concerns → 1 brake_inspection entry, accumulated source_concerns)", async () => {
    storedRow = {
      ...storedRow!,
      explanation_required_items: [
        {
          service_key: "noise_brakes",
          display_name: "Brake noise",
          explanation_text: "Squeaking when I brake.",
          category: "brakes",
        },
        {
          service_key: "noise_grind",
          display_name: "Grinding",
          explanation_text: "Grinding sound when stopping.",
          category: "brakes",
        },
      ],
    };
    // BOTH concerns diagnose to brake_inspection.
    diagnoseConcernMock
      .mockResolvedValueOnce(makeServiceMatch({ unanswered_question_ids: [] }))
      .mockResolvedValueOnce(makeServiceMatch({ unanswered_question_ids: [] }));

    const result = await runDiagnosticsV2({ chatId: "sess-1" });

    expect(result).toEqual({
      ok: true,
      next_step: "testing_service_approval",
    });

    const update = findSessionUpdate();
    const recs = update?.recommended_testing_services as Array<{
      service_key: string;
      source_concerns: string[];
    }>;
    expect(recs).toHaveLength(1);
    expect(recs[0]!.service_key).toBe("brake_inspection");
    // Both picker chips should appear in source_concerns (de-dup yields a single rec,
    // both source_concerns accumulated).
    expect(recs[0]!.source_concerns.sort()).toEqual(
      ["noise_brakes", "noise_grind"].sort(),
    );
  });

  it("ALL concerns return null → second_routine_pass with empty recommendations", async () => {
    storedRow = {
      ...storedRow!,
      explanation_required_items: [
        {
          service_key: "other_issue",
          display_name: "Other Issue",
          explanation_text: "Something weird.",
          category: null,
        },
        {
          service_key: "noise_brakes",
          display_name: "Brake noise",
          explanation_text: "I dunno, weird.",
          category: "brakes",
        },
      ],
    };
    diagnoseConcernMock
      .mockResolvedValueOnce(makeNullMatch())
      .mockResolvedValueOnce(makeNullMatch());

    const result = await runDiagnosticsV2({ chatId: "sess-1" });

    expect(result).toEqual({
      ok: true,
      next_step: "second_routine_pass",
    });
    const update = findSessionUpdate();
    expect((update?.recommended_testing_services as unknown[]).length).toBe(0);
    expect((update?.clarification_questions_pending as unknown[]).length).toBe(
      0,
    );
    // Forward-to-advisor path also fires summaries (pending empty).
    expect(ensureConcernSummariesMock).toHaveBeenCalledTimes(1);
  });

  it("ALL concerns matched to 'other' subcategory (no testing service) → second_routine_pass", async () => {
    storedRow = {
      ...storedRow!,
      explanation_required_items: [
        {
          service_key: "other_issue",
          display_name: "Other Issue",
          explanation_text: "Hood vibrates at idle.",
          category: null,
        },
        {
          service_key: "other_issue",
          display_name: "Other Issue 2",
          explanation_text: "Steering column sticky.",
          category: null,
        },
      ],
    };
    // Both → other_subcategory match with no recommended service.
    diagnoseConcernMock
      .mockResolvedValueOnce(makeOtherMatch())
      .mockResolvedValueOnce(makeOtherMatch());

    const result = await runDiagnosticsV2({ chatId: "sess-1" });

    expect(result).toEqual({
      ok: true,
      next_step: "second_routine_pass",
    });
    const update = findSessionUpdate();
    expect((update?.recommended_testing_services as unknown[]).length).toBe(0);
  });

  it("MIXED: 2 testing-service matches + 1 'other' → testing_service_approval (other is dropped from recs)", async () => {
    storedRow = {
      ...storedRow!,
      explanation_required_items: [
        {
          service_key: "noise_brakes",
          display_name: "Brake noise",
          explanation_text: "Squeaking.",
          category: "brakes",
        },
        {
          service_key: "ac_problem",
          display_name: "AC issue",
          explanation_text: "AC not blowing cold.",
          category: "ac",
        },
        {
          service_key: "other_issue",
          display_name: "Other",
          explanation_text: "Random thump.",
          category: null,
        },
      ],
    };
    diagnoseConcernMock
      .mockResolvedValueOnce(makeServiceMatch({ unanswered_question_ids: [] }))
      .mockResolvedValueOnce(
        makeServiceMatch({
          matched_category_key: "ac_diagnostic",
          matched_subcategory_slug: "ac_no_cool",
          recommended_testing_service: {
            service_key: "ac_diagnostic",
            display_name: "AC Diagnostic",
            description: "We diagnose the A/C.",
            starting_price_cents: 9900,
          },
          unanswered_question_ids: [],
        }),
      )
      .mockResolvedValueOnce(makeOtherMatch());

    const result = await runDiagnosticsV2({ chatId: "sess-1" });

    expect(result).toEqual({
      ok: true,
      next_step: "testing_service_approval",
    });
    const update = findSessionUpdate();
    const recs = update?.recommended_testing_services as Array<{
      service_key: string;
    }>;
    expect(recs).toHaveLength(2);
    expect(recs.map((r) => r.service_key).sort()).toEqual(
      ["ac_diagnostic", "brake_inspection"].sort(),
    );
  });
});

describe("runDiagnosticsV2 — idempotency + error paths", () => {
  it("re-invoking after diagnostic_processing_complete=true does NOT call diagnoseConcern; re-routes from persisted state", async () => {
    storedRow = {
      id: "sess-1",
      explanation_required_items: [
        {
          service_key: "noise_brakes",
          display_name: "Brake noise",
          explanation_text: "Squeak.",
          category: "brakes",
        },
      ],
      new_vehicle_info: null,
      diagnostic_processing_complete: true,
      clarification_questions_pending: [],
      recommended_testing_services: [
        {
          service_key: "brake_inspection",
          display_name: "Brake Inspection",
          description: "...",
          starting_price_cents: 4900,
          source_concerns: ["noise_brakes"],
        },
      ],
    };

    const result = await runDiagnosticsV2({ chatId: "sess-1" });

    expect(result).toEqual({
      ok: true,
      next_step: "testing_service_approval",
    });
    // LLM NOT called.
    expect(diagnoseConcernMock).not.toHaveBeenCalled();
    // Catalog NOT loaded (idempotency short-circuits before catalog).
    expect(loadDiagnosticCatalogMock).not.toHaveBeenCalled();
    // ensureConcernSummaries NOT re-run on the idempotency path.
    expect(ensureConcernSummariesMock).not.toHaveBeenCalled();
  });

  it("loadDiagnosticCatalog throws → action returns ok:false with the catalog error", async () => {
    loadDiagnosticCatalogMock.mockRejectedValueOnce(
      new Error("testing_services lookup: connection refused"),
    );

    const result = await runDiagnosticsV2({ chatId: "sess-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("testing_services lookup");
    }
    // Top-level catch fires Sentry.captureException.
    expect(sentryCaptureException).toHaveBeenCalledTimes(1);
    // Diagnose NOT called — catalog blew up before per-concern loop.
    expect(diagnoseConcernMock).not.toHaveBeenCalled();
  });

  it("one concern's diagnoseConcern rejects → Promise.all fail-fast surfaces ok:false (documented behavior)", async () => {
    storedRow = {
      ...storedRow!,
      explanation_required_items: [
        {
          service_key: "noise_brakes",
          display_name: "Brake noise",
          explanation_text: "Squeaking.",
          category: "brakes",
        },
        {
          service_key: "ac_problem",
          display_name: "AC issue",
          explanation_text: "AC bad.",
          category: "ac",
        },
      ],
    };
    // First resolves, second rejects → Promise.all rejects whole batch.
    diagnoseConcernMock
      .mockResolvedValueOnce(makeServiceMatch({ unanswered_question_ids: [] }))
      .mockRejectedValueOnce(new Error("LLM unreachable: 503 upstream"));

    const result = await runDiagnosticsV2({ chatId: "sess-1" });

    // run-diagnostics.ts uses Promise.all (NOT Promise.allSettled) as of
    // 2026-05-22. The rejected concern fails the entire batch; the action
    // catches via its top-level try/catch and returns ok:false. If this
    // ever changes to allSettled, update this test to assert graceful
    // continuation.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("LLM unreachable");
    }
    expect(sentryCaptureException).toHaveBeenCalled();
    // No applyWizardTransition RPC should have run — pipeline never
    // got past the per-concern aggregation.
    expect(findSessionUpdate()).toBeUndefined();
  });
});

describe("runDiagnosticsV2 — observability + persistence shape", () => {
  it("writes ONE customer_chat_sessions RPC update with the canonical column set + revalidates", async () => {
    diagnoseConcernMock.mockResolvedValueOnce(
      makeServiceMatch({ unanswered_question_ids: [101] }),
    );

    await runDiagnosticsV2({ chatId: "sess-1" });

    // Exactly one apply_wizard_transition RPC call (applyWizardTransition
    // now routes through the RPC instead of `.from(...).update(...)` per
    // Plan 04 Phase 1A — see migration 20260524220000).
    const rpcCallsList = rpcCalls.filter(
      (c) => c.fn === "apply_wizard_transition",
    );
    expect(rpcCallsList).toHaveLength(1);
    const payload = rpcCallsList[0]!.args.p_payload as Record<string, unknown>;
    // Payload carries the canonical column set from run-diagnostics.ts:
    expect(payload).toHaveProperty("diagnostic_processing_complete", true);
    expect(payload).toHaveProperty("explanation_required_items");
    expect(payload).toHaveProperty("clarification_questions_pending");
    expect(payload).toHaveProperty("clarification_questions_answered");
    expect(payload).toHaveProperty("recommended_testing_services");
    // transition.ts spreads { status: 'active', ...updates, current_step:
    // nextStep } before invoking the RPC, so both keys land in p_payload.
    expect(payload).toHaveProperty("current_step", "clarification_question");
    expect(payload).toHaveProperty("status", "active");
    // last_active_at is NOT in p_payload — transition.ts strips it
    // (and the RPC ignores any incoming value, server-canonicalizing via
    // pg_catalog.now()).
    expect(payload).not.toHaveProperty("last_active_at");
    // updated explanation_required_items[0] should carry unanswered_question_ids
    const items = payload.explanation_required_items as Array<{
      service_key: string;
      unanswered_question_ids: number[];
    }>;
    expect(items[0]!.unanswered_question_ids).toEqual([101]);
    // The RPC is invoked against the correct session.
    expect(rpcCallsList[0]!.args.p_chat_id).toBe("sess-1");
    // Plan 04 Phase 5B: applyWizardTransition now fires revalidateTag
    // (per-session granular) + a single-path revalidatePath fallback
    // (down from the pre-Phase-5B 3-path loop ["/", "/book", "/book-v2"]).
    expect(revalidateTagMock).toHaveBeenCalledWith("session-sess-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "page");
  });

  it("fires per-concern Sentry breadcrumbs + an aggregate captureMessage at the expected checkpoints", async () => {
    storedRow = {
      ...storedRow!,
      explanation_required_items: [
        {
          service_key: "noise_brakes",
          display_name: "Brake noise",
          explanation_text: "Squeak.",
          category: "brakes",
        },
        {
          service_key: "ac_problem",
          display_name: "AC issue",
          explanation_text: "AC bad.",
          category: "ac",
        },
      ],
    };
    diagnoseConcernMock
      .mockResolvedValueOnce(makeServiceMatch({ unanswered_question_ids: [] }))
      .mockResolvedValueOnce(
        makeServiceMatch({
          matched_category_key: "ac_diagnostic",
          matched_subcategory_slug: "ac_no_cool",
          recommended_testing_service: {
            service_key: "ac_diagnostic",
            display_name: "AC Diagnostic",
            description: "...",
            starting_price_cents: 9900,
          },
          unanswered_question_ids: [],
        }),
      );

    await runDiagnosticsV2({ chatId: "sess-1" });

    // One breadcrumb per concern.
    const concernBreadcrumbs = sentryAddBreadcrumb.mock.calls.filter((call) => {
      const arg = call[0] as { category?: string };
      return arg?.category === "scheduler.diagnose";
    });
    expect(concernBreadcrumbs).toHaveLength(2);
    // Each breadcrumb carries the diagnostic payload shape.
    for (const call of concernBreadcrumbs) {
      const arg = call[0] as {
        category: string;
        message: string;
        data: Record<string, unknown>;
      };
      expect(arg.message).toContain("diagnoseConcern:");
      expect(arg.data).toHaveProperty("chip_service_key");
      expect(arg.data).toHaveProperty("matched_kind");
      expect(arg.data).toHaveProperty("parsed_ok");
    }
    // Aggregate outcome telemetry — migrated FROM captureMessage('info') TO
    // logger.info per PLAN-02 Phase 2B (I-OBS-8). Assert NO info-level
    // captureMessage was fired (would create a Sentry issue) AND logger.info
    // got the runDiagnostics: prefix message with the expected attributes.
    const outcomeCaptureMessages = sentryCaptureMessage.mock.calls.filter((call) => {
      const msg = call[0] as string;
      return msg.startsWith("runDiagnostics: ");
    });
    expect(outcomeCaptureMessages).toHaveLength(0);

    const outcomeLogs = sentryLoggerInfo.mock.calls.filter((call) => {
      const msg = call[0] as string;
      return msg.startsWith("runDiagnostics: ");
    });
    expect(outcomeLogs).toHaveLength(1);
    const outcomeAttrs = outcomeLogs[0]![1] as {
      surface: string;
      next_step: string;
      concern_count: number;
      recommendation_count: number;
    };
    expect(outcomeAttrs.surface).toBe("run_diagnostics_v2_outcome");
    expect(outcomeAttrs.next_step).toBe("testing_service_approval");
  });
});
