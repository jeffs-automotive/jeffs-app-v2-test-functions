/**
 * Unit tests for submitSecondRoutinePassV2 — focused on the EH2
 * describe-another-issue branch (plus a regression guard for the normal
 * add-on path).
 *
 * Surface under test (submit-second-routine-pass.ts):
 *   - Normal path: validates `added` against the active routine catalog +
 *     the already-picked set, writes additional_routine_services_round2,
 *     advances to appointment_type.
 *   - describe_issue branch: FIRST persists the validated routine adds
 *     exactly as the normal path, THEN appends a fresh empty `other_issue`
 *     entry to explanation_required_items, resets
 *     diagnostic_processing_complete=false, and routes to concern_explanation.
 *
 * Mocking pattern mirrors submit-concern-clarify.test.ts: a chain-recording
 * supabase mock + RPC payload capture via findSessionUpdate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// ─── Module mocks ──────────────────────────────────────────────────────────

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setTag: vi.fn(),
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

let sessionRow: Record<string, unknown> | null = null;
// service_key → requires_explanation for the routine_services catalog lookup.
let routineCatalog: Array<{ service_key: string; requires_explanation: boolean }> =
  [];
// service_key → display_name for the transition-bubble name lookups.
let routineNames: Array<{ service_key: string; display_name: string }> = [];
let testingNames: Array<{ service_key: string; display_name: string }> = [];

function makeMockClient() {
  return {
    from(table: string) {
      // Terminal reads resolve differently per table:
      //   customer_chat_sessions → .select().eq().maybeSingle()
      //   routine_services       → .select().eq().eq().in()  (awaited directly)
      //   routine_services/testing_services (bubble) → .select().eq().in()
      const builder: Record<string, unknown> = {
        eq() {
          return builder;
        },
        in() {
          if (table === "routine_services") {
            return Promise.resolve({ data: routineNames, error: null });
          }
          if (table === "testing_services") {
            return Promise.resolve({ data: testingNames, error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
        async maybeSingle() {
          return { data: sessionRow, error: null };
        },
      };
      return {
        select(cols: string) {
          // The validation catalog lookup selects requires_explanation and
          // ends in `.in(...)` — override that terminal to return the
          // catalog rows (with requires_explanation).
          if (
            table === "routine_services" &&
            cols.includes("requires_explanation")
          ) {
            return {
              eq() {
                return this;
              },
              in() {
                return Promise.resolve({ data: routineCatalog, error: null });
              },
            };
          }
          return builder;
        },
      };
    },
    async rpc(fnName: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn: fnName, args });
      return { data: {}, error: null };
    },
  };
}

const createSupabaseAdminClientMock: Mock = vi.fn(() => makeMockClient());
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => createSupabaseAdminClientMock(),
}));

vi.mock("@/lib/scheduler/shop-config", () => ({ SHOP_ID: 7476 }));

import { submitSecondRoutinePassV2 } from "./submit-second-routine-pass";

function findSessionUpdate(): Record<string, unknown> | undefined {
  const rpc = rpcCalls.find((c) => c.fn === "apply_wizard_transition");
  return rpc?.args.p_payload as Record<string, unknown> | undefined;
}

interface ExplanationEntry {
  service_key: string;
  display_name: string;
  explanation_text: string;
  category: string | null;
}

// ─── Suite ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  rpcCalls.length = 0;
  revalidatePathMock.mockClear();
  revalidateTagMock.mockClear();
  createSupabaseAdminClientMock.mockClear();
  sessionRow = {
    selected_simple_services: ["oil_change"],
    approved_testing_services: [],
    explanation_required_items: [
      {
        service_key: "brake_inspection",
        display_name: "Brake Inspection",
        explanation_text: "Squeaks",
        category: "brakes",
      },
    ],
  };
  routineCatalog = [
    { service_key: "tire_rotation", requires_explanation: false },
  ];
  routineNames = [
    { service_key: "oil_change", display_name: "Oil Change" },
    { service_key: "tire_rotation", display_name: "Tire Rotation" },
  ];
  testingNames = [];
});

describe("submitSecondRoutinePassV2 — normal add-on path", () => {
  it("writes additional_routine_services_round2 + advances to appointment_type", async () => {
    const result = await submitSecondRoutinePassV2({
      chatId: "sess-1",
      added: ["tire_rotation"],
    });

    expect(result).toEqual({ ok: true, next_step: "appointment_type" });
    const update = findSessionUpdate();
    expect(update?.additional_routine_services_round2).toEqual([
      "tire_rotation",
    ]);
    // Normal path does NOT touch explanation_required_items or the
    // diagnostic flag.
    expect(update).not.toHaveProperty("explanation_required_items");
    expect(update).not.toHaveProperty("diagnostic_processing_complete");
  });
});

describe("submitSecondRoutinePassV2 — describe-another-issue branch (EH2)", () => {
  it("appends a fresh other_issue entry, preserves existing concerns + round2 adds, routes to concern_explanation", async () => {
    const result = await submitSecondRoutinePassV2({
      chatId: "sess-1",
      added: ["tire_rotation"],
      describe_issue: true,
    });

    expect(result).toEqual({ ok: true, next_step: "concern_explanation" });
    const update = findSessionUpdate();

    // Round2 routine adds persisted exactly as the normal path.
    expect(update?.additional_routine_services_round2).toEqual([
      "tire_rotation",
    ]);

    // Existing concern survived; a fresh empty other_issue entry appended.
    const items = update?.explanation_required_items as ExplanationEntry[];
    expect(items).toHaveLength(2);
    expect(items[0]!.service_key).toBe("brake_inspection");
    expect(items[0]!.explanation_text).toBe("Squeaks");
    expect(items[1]).toEqual({
      service_key: "other_issue",
      display_name: "Other issue",
      explanation_text: "",
      category: null,
    });

    // Diagnostic pass re-armed.
    expect(update?.diagnostic_processing_complete).toBe(false);
  });

  it("works with no prior concerns (appends the first other_issue entry)", async () => {
    sessionRow = {
      selected_simple_services: ["oil_change"],
      approved_testing_services: [],
      explanation_required_items: [],
    };

    const result = await submitSecondRoutinePassV2({
      chatId: "sess-1",
      added: [],
      describe_issue: true,
    });

    expect(result).toEqual({ ok: true, next_step: "concern_explanation" });
    const update = findSessionUpdate();
    const items = update?.explanation_required_items as ExplanationEntry[];
    expect(items).toHaveLength(1);
    expect(items[0]!.service_key).toBe("other_issue");
    expect(update?.additional_routine_services_round2).toEqual([]);
  });

  it("drops an invalid routine add before persisting on the describe branch", async () => {
    // "not_a_service" is not in the catalog → filtered out.
    const result = await submitSecondRoutinePassV2({
      chatId: "sess-1",
      added: ["not_a_service"],
      describe_issue: true,
    });

    expect(result).toEqual({ ok: true, next_step: "concern_explanation" });
    const update = findSessionUpdate();
    expect(update?.additional_routine_services_round2).toEqual([]);
    const items = update?.explanation_required_items as ExplanationEntry[];
    expect(items[items.length - 1]!.service_key).toBe("other_issue");
  });

  it("returns ok:false when the session row is missing", async () => {
    sessionRow = null;
    const result = await submitSecondRoutinePassV2({
      chatId: "sess-missing",
      added: [],
      describe_issue: true,
    });
    expect(result.ok).toBe(false);
  });
});
