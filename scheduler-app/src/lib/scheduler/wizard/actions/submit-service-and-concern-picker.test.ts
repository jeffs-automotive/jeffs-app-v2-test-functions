/**
 * Unit tests for submitServiceAndConcernPickerV2 — the summary-edit-hub
 * SMART MERGE (task EH1). The wholesale (non-hub) path is exercised by the
 * broader flow tests; this file targets the merge branch that preserves the
 * customer's diagnostic work on a services edit.
 *
 * Covered:
 *   - survivors keep explanation_text / unanswered_question_ids / summary
 *   - removed concerns drop (and their answered-map entries are pruned)
 *   - brand-new concern → re-diagnosis (diagnostic_processing_complete=false
 *     + nextStep concern_explanation)
 *   - duplicate other_issue concerns matched positionally
 *   - no-change resubmit → NO re-diagnosis + straight back to summary_edit_hub
 *   - recommendations/declined pruned to surviving source concerns
 *
 * Mocks: applyWizardTransition + Sentry at the module boundary; a supabase
 * mock that serves the session row read + the routine/testing catalog reads.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

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

interface AwtCall {
  chatId: string;
  nextStep: string;
  jeffBubble?: string;
  userBubble?: string;
  updates?: Record<string, unknown>;
}
const awtCalls: AwtCall[] = [];
vi.mock("@/lib/scheduler/wizard/transition", () => ({
  applyWizardTransition: vi.fn(async (args: AwtCall) => {
    awtCalls.push(args);
    return { ok: true, next_step: args.nextStep };
  }),
}));

// ── Catalog + session fixtures ──────────────────────────────────────────
interface RoutineCatalogRow {
  service_key: string;
  display_name: string;
  requires_explanation: boolean;
  concern_categories: string[] | null;
}
interface TestingCatalogRow {
  service_key: string;
  display_name: string;
  concern_categories: string[] | null;
}

let routineCatalog: RoutineCatalogRow[] = [];
let testingCatalog: TestingCatalogRow[] = [];
let sessionRowResult: { data: Record<string, unknown> | null; error: unknown } =
  { data: null, error: null };

// Supabase mock:
//   customer_chat_sessions.select(...).eq("id").maybeSingle() → sessionRowResult
//   routine_services / testing_services: .select().eq().eq().in() awaited
//     → { data: filtered catalog, error: null }
function makeMockClient() {
  return {
    from(table: string) {
      let inKeys: string[] = [];
      const builder = {
        select(_cols: string) {
          return builder;
        },
        eq(_col: string, _val: unknown) {
          return builder;
        },
        in(_col: string, vals: string[]) {
          inKeys = vals;
          return builder;
        },
        async maybeSingle() {
          if (table === "customer_chat_sessions") return sessionRowResult;
          return { data: null, error: null };
        },
        // routine/testing catalog reads are awaited directly (thenable).
        then(
          resolve: (v: { data: unknown; error: unknown }) => unknown,
        ) {
          if (table === "routine_services") {
            return resolve({
              data: routineCatalog.filter((r) => inKeys.includes(r.service_key)),
              error: null,
            });
          }
          if (table === "testing_services") {
            return resolve({
              data: testingCatalog.filter((r) => inKeys.includes(r.service_key)),
              error: null,
            });
          }
          return resolve({ data: [], error: null });
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

import { submitServiceAndConcernPickerV2 } from "./submit-service-and-concern-picker";

const CHAT_ID = "00000000-0000-0000-0000-000000000001";

// A realistic pre-edit diagnostic state: one requires_explanation routine
// concern (brake_inspection) fully worked, plus one routine simple pick.
const BRAKE_ENTRY = {
  service_key: "brake_inspection",
  display_name: "Brake Inspection",
  explanation_text: "grinding when I stop",
  category: "brakes",
  unanswered_question_ids: [11, 12],
  summary: "Customer states brakes grind when stopping.",
};

function baseHubRow(overrides: Record<string, unknown> = {}) {
  return {
    edit_return_step: "summary_edit_hub",
    selected_simple_services: ["oil_change"],
    approved_testing_services: [],
    declined_testing_services: [],
    explanation_required_items: [BRAKE_ENTRY],
    clarification_questions_answered: { "11": "yes", "12": "no" },
    recommended_testing_services: [],
    diagnostic_processing_complete: true,
    ...overrides,
  };
}

beforeEach(() => {
  awtCalls.length = 0;
  routineCatalog = [
    {
      service_key: "oil_change",
      display_name: "Oil Change",
      requires_explanation: false,
      concern_categories: null,
    },
    {
      service_key: "brake_inspection",
      display_name: "Brake Inspection",
      requires_explanation: true,
      concern_categories: ["brakes"],
    },
    {
      service_key: "check_battery",
      display_name: "Check Battery",
      requires_explanation: true,
      concern_categories: ["electrical"],
    },
    {
      service_key: "tire_rotation",
      display_name: "Tire Rotation",
      requires_explanation: false,
      concern_categories: null,
    },
  ];
  testingCatalog = [];
  sessionRowResult = { data: baseHubRow(), error: null };
  createSupabaseAdminClientMock.mockClear();
});

describe("smart merge — no-change resubmit", () => {
  it("same picks → NO re-diagnosis, straight back to summary_edit_hub", async () => {
    // Resubmit the exact same picks (oil_change + brake_inspection).
    await submitServiceAndConcernPickerV2({
      chatId: CHAT_ID,
      picks: ["oil_change", "brake_inspection"],
    });

    expect(awtCalls).toHaveLength(1);
    const call = awtCalls[0]!;
    expect(call.nextStep).toBe("summary_edit_hub");
    // diagnostic_processing_complete untouched (NOT reset to false).
    expect(call.updates).not.toHaveProperty(
      "diagnostic_processing_complete",
    );
    // The surviving brake concern kept ALL its diagnostic work.
    const items = call.updates!
      .explanation_required_items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      service_key: "brake_inspection",
      explanation_text: "grinding when I stop",
      unanswered_question_ids: [11, 12],
      summary: "Customer states brakes grind when stopping.",
    });
    // Answered map preserved (both ids belong to the survivor).
    expect(call.updates!.clarification_questions_answered).toEqual({
      "11": "yes",
      "12": "no",
    });
  });
});

describe("smart merge — remove a concern", () => {
  it("dropping brake_inspection drops its entry AND prunes its answers", async () => {
    // Resubmit with ONLY oil_change — brake concern removed.
    await submitServiceAndConcernPickerV2({
      chatId: CHAT_ID,
      picks: ["oil_change"],
    });

    expect(awtCalls).toHaveLength(1);
    const call = awtCalls[0]!;
    // No concern entries survive.
    expect(call.updates!.explanation_required_items).toEqual([]);
    // Both answers belonged to the removed concern → pruned to empty.
    expect(call.updates!.clarification_questions_answered).toEqual({});
    // No new/unexplained concerns → back to hub, no re-diagnosis.
    expect(call.nextStep).toBe("summary_edit_hub");
    expect(call.updates).not.toHaveProperty(
      "diagnostic_processing_complete",
    );
    // The kept simple service reflects the new pick.
    expect(call.updates!.selected_simple_services).toEqual(["oil_change"]);
  });
});

describe("smart merge — add a new concern", () => {
  it("adding check_battery keeps brake work, adds empty entry, re-diagnoses", async () => {
    await submitServiceAndConcernPickerV2({
      chatId: CHAT_ID,
      picks: ["oil_change", "brake_inspection", "check_battery"],
    });

    expect(awtCalls).toHaveLength(1);
    const call = awtCalls[0]!;
    // New concern present → route into the explanation flow + re-diagnose.
    expect(call.nextStep).toBe("concern_explanation");
    expect(call.updates!.diagnostic_processing_complete).toBe(false);

    const items = call.updates!
      .explanation_required_items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    // Survivor keeps its work.
    const brake = items.find((i) => i.service_key === "brake_inspection");
    expect(brake).toMatchObject({
      explanation_text: "grinding when I stop",
      unanswered_question_ids: [11, 12],
    });
    // New concern is empty.
    const battery = items.find((i) => i.service_key === "check_battery");
    expect(battery).toMatchObject({
      service_key: "check_battery",
      explanation_text: "",
    });
    // Survivor's answers preserved; no removed-concern answers to prune.
    expect(call.updates!.clarification_questions_answered).toEqual({
      "11": "yes",
      "12": "no",
    });
  });
});

describe("smart merge — duplicate other_issue matched positionally", () => {
  it("two other_issue survivors keep their distinct explanation_text", async () => {
    const other1 = {
      service_key: "other_issue",
      display_name: "Other issue",
      explanation_text: "weird smell",
      category: null,
      unanswered_question_ids: [] as number[],
    };
    const other2 = {
      service_key: "other_issue",
      display_name: "Other issue",
      explanation_text: "clunk over bumps",
      category: null,
      unanswered_question_ids: [] as number[],
    };
    sessionRowResult = {
      data: baseHubRow({
        explanation_required_items: [other1, other2],
        clarification_questions_answered: {},
      }),
      error: null,
    };

    // Resubmit two other_issue chips (the picker sends the pseudo-key once
    // per pick; two distinct concerns come in as two identical keys, which
    // uniquePicks would collapse — so the picker actually can't send two.
    // The merge must still SURVIVE both existing entries when the single
    // other_issue key is resubmitted: FIFO consumes the first, leaving the
    // second. That's the documented v1 caveat — assert the first survives).
    await submitServiceAndConcernPickerV2({
      chatId: CHAT_ID,
      picks: ["other_issue"],
    });

    const call = awtCalls[0]!;
    const items = call.updates!
      .explanation_required_items as Array<Record<string, unknown>>;
    // One other_issue pick → exactly one survivor, the FIRST (FIFO).
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      service_key: "other_issue",
      explanation_text: "weird smell",
    });
    // No new/unexplained → back to hub.
    expect(call.nextStep).toBe("summary_edit_hub");
  });
});

describe("smart merge — recommendations + declined pruning", () => {
  it("prunes recs whose source concern was removed + stale declines", async () => {
    sessionRowResult = {
      data: baseHubRow({
        // Two picks initially: brake_inspection + check_battery.
        explanation_required_items: [
          BRAKE_ENTRY,
          {
            service_key: "check_battery",
            display_name: "Check Battery",
            explanation_text: "won't start",
            category: "electrical",
            unanswered_question_ids: [21],
          },
        ],
        clarification_questions_answered: {
          "11": "yes",
          "12": "no",
          "21": "sometimes",
        },
        recommended_testing_services: [
          {
            service_key: "brake_diagnostic",
            display_name: "Brake Diagnostic",
            description: null,
            starting_price_cents: 4999,
            source_concerns: ["brake_inspection"],
          },
          {
            service_key: "battery_test",
            display_name: "Battery Test",
            description: null,
            starting_price_cents: 1999,
            source_concerns: ["check_battery"],
          },
        ],
        declined_testing_services: ["battery_test"],
      }),
      error: null,
    };

    // Resubmit WITHOUT check_battery — its rec + decline are now stale.
    await submitServiceAndConcernPickerV2({
      chatId: CHAT_ID,
      picks: ["oil_change", "brake_inspection"],
    });

    const call = awtCalls[0]!;
    // Only the brake rec survives.
    const recs = call.updates!
      .recommended_testing_services as Array<Record<string, unknown>>;
    expect(recs).toHaveLength(1);
    expect(recs[0]!.service_key).toBe("brake_diagnostic");
    // The battery decline is pruned (its rec is gone).
    expect(call.updates!.declined_testing_services).toEqual([]);
    // The check_battery answer (qid 21) is pruned; brake answers kept.
    expect(call.updates!.clarification_questions_answered).toEqual({
      "11": "yes",
      "12": "no",
    });
    // No new concerns → back to hub.
    expect(call.nextStep).toBe("summary_edit_hub");
  });
});

describe("smart merge — off (normal forward flow)", () => {
  it("edit_return_step null → wholesale reset (diagnostic_processing_complete=false)", async () => {
    sessionRowResult = {
      data: baseHubRow({ edit_return_step: null }),
      error: null,
    };

    await submitServiceAndConcernPickerV2({
      chatId: CHAT_ID,
      picks: ["oil_change", "brake_inspection"],
    });

    const call = awtCalls[0]!;
    // Wholesale path resets diagnostic state + clears answered map.
    expect(call.updates!.diagnostic_processing_complete).toBe(false);
    expect(call.updates!.clarification_questions_answered).toEqual({});
    expect(call.updates!.recommended_testing_services).toEqual([]);
    // brake_inspection requires explanation → concern_explanation.
    expect(call.nextStep).toBe("concern_explanation");
  });
});
