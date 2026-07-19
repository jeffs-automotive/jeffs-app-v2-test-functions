/**
 * Unit tests for ensureConcernSummaries — focused on the concern-triage
 * additions:
 *
 *   - D2 (INV-13): summaries are matched back to items by concern_id, NOT
 *     service_key — two "other_issue" concerns must NOT clobber each other.
 *   - triage threading: a concern's chosen triage CATEGORY (triage_answers
 *     .label) is surfaced in its advisor-facing summary.
 *   - INV-3: concern_id + triage fields survive the parser + write-back.
 *
 * buildConcernSummary is the REAL pure builder (no mock). The supabase client,
 * next/cache, cache tag, and Sentry are mocked at the module boundary.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/scheduler/cache", () => ({
  sessionTag: (id: string) => `session:${id}`,
}));
vi.mock("@/lib/scheduler/shop-config", () => ({ SHOP_ID: 7476 }));

let sessionRow: Record<string, unknown> | null = null;
let writtenItems: Array<Record<string, unknown>> | undefined;

function makeMockClient() {
  return {
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: unknown) {
              return {
                async maybeSingle() {
                  return { data: sessionRow, error: null };
                },
                // concern_questions.select().eq().in() (not reached when there
                // are no answered question ids).
                in() {
                  return Promise.resolve({ data: [], error: null });
                },
              };
            },
          };
        },
        update(payload: Record<string, unknown>) {
          return {
            eq(_col: string, _val: unknown) {
              if (table === "customer_chat_sessions") {
                writtenItems = payload.explanation_required_items as Array<
                  Record<string, unknown>
                >;
              }
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}
const createSupabaseAdminClientMock: Mock = vi.fn(() => makeMockClient());
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => createSupabaseAdminClientMock(),
}));

import { ensureConcernSummaries } from "./ensure-concern-summaries";

const CHAT_ID = "00000000-0000-0000-0000-000000000001";

beforeEach(() => {
  writtenItems = undefined;
  sessionRow = null;
  createSupabaseAdminClientMock.mockClear();
});

describe("ensureConcernSummaries — D2 duplicate other_issue (match by concern_id)", () => {
  it("gives each duplicate other_issue concern its OWN summary (no clobber)", async () => {
    sessionRow = {
      explanation_required_items: [
        {
          concern_id: "id-A",
          service_key: "other_issue",
          display_name: "Other issue",
          explanation_text: "weird smell",
          category: null,
        },
        {
          concern_id: "id-B",
          service_key: "other_issue",
          display_name: "Other issue",
          explanation_text: "clunk over bumps",
          category: null,
        },
      ],
      clarification_questions_answered: {},
    };

    const result = await ensureConcernSummaries({ chatId: CHAT_ID });
    expect(result.persisted).toBe(true);
    expect(writtenItems).toHaveLength(2);
    // Each concern kept its DISTINCT summary — the service_key match would
    // have assigned "weird smell" to both.
    expect(writtenItems![0]!.concern_id).toBe("id-A");
    expect(writtenItems![0]!.summary).toContain("weird smell");
    expect(writtenItems![1]!.concern_id).toBe("id-B");
    expect(writtenItems![1]!.summary).toContain("clunk over bumps");
  });
});

describe("ensureConcernSummaries — triage category threading", () => {
  it("appends the customer's triage CATEGORY label to the advisor summary", async () => {
    sessionRow = {
      explanation_required_items: [
        {
          concern_id: "id-A",
          service_key: "other_issue",
          display_name: "Other issue",
          explanation_text: "car feels weird",
          category: null,
          triage_round: 1,
          triage_answers: {
            allowed_service_keys: ["brake_inspection"],
            chip_key: "brakes",
            label: "The brakes",
          },
        },
      ],
      clarification_questions_answered: {},
    };

    await ensureConcernSummaries({ chatId: CHAT_ID });
    const summary = writtenItems![0]!.summary as string;
    expect(summary).toContain("car feels weird");
    expect(summary).toContain("Customer indicated this is related to: The brakes.");
  });

  it("does NOT add a triage clause when the concern was never triaged", async () => {
    sessionRow = {
      explanation_required_items: [
        {
          concern_id: "id-A",
          service_key: "other_issue",
          display_name: "Other issue",
          explanation_text: "brakes squeak",
          category: null,
        },
      ],
      clarification_questions_answered: {},
    };

    await ensureConcernSummaries({ chatId: CHAT_ID });
    expect(writtenItems![0]!.summary).not.toContain("indicated this is related to");
  });
});

describe("ensureConcernSummaries — INV-3 field preservation on write-back", () => {
  it("keeps concern_id + triage_round + triage_answers through the write-back", async () => {
    const triageAnswers = {
      allowed_service_keys: ["brake_inspection"],
      chip_key: "brakes",
      label: "The brakes",
    };
    sessionRow = {
      explanation_required_items: [
        {
          concern_id: "keep-me",
          service_key: "other_issue",
          display_name: "Other issue",
          explanation_text: "car feels weird",
          category: null,
          triage_round: 1,
          triage_answers: triageAnswers,
          handoff_reason: null,
        },
      ],
      clarification_questions_answered: {},
    };

    await ensureConcernSummaries({ chatId: CHAT_ID });
    expect(writtenItems![0]!.concern_id).toBe("keep-me");
    expect(writtenItems![0]!.triage_round).toBe(1);
    expect(writtenItems![0]!.triage_answers).toEqual(triageAnswers);
  });

  it("mints a concern_id for a legacy item lacking one (write-back only)", async () => {
    sessionRow = {
      explanation_required_items: [
        {
          service_key: "other_issue",
          display_name: "Other issue",
          explanation_text: "car feels weird",
          category: null,
        },
      ],
      clarification_questions_answered: {},
    };

    await ensureConcernSummaries({ chatId: CHAT_ID });
    expect(typeof writtenItems![0]!.concern_id).toBe("string");
    expect((writtenItems![0]!.concern_id as string).length).toBeGreaterThan(0);
  });
});
