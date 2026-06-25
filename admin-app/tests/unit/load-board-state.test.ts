/**
 * loadBoardState builds the board's untagged ("needs a tag") list from OPEN
 * manual reviews of the "needs a tag" categories (work_approved_drift /
 * ar_regression / ar_no_prior_tag) — reconciled review data, NOT raw
 * webhook-lifecycle inference (which surfaced paid-out ROs). The tagged
 * ("in use") list comes from listWipKeyTags.
 *
 * (2026-06-24 board-residual-fixes: the audit-derived `released_wip` source was
 * dropped — it produced only false positives like the paid/closed RO 153688;
 * the genuine "released but still WIP" case is covered by the reconciler's
 * ar_regression / work_approved_drift review instead.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// `server-only` is aliased to a no-op stub in vitest.config.ts (test alias).
vi.mock("@/lib/orchestrator/client", () => ({ callKeytagTool: vi.fn() }));

import { callKeytagTool } from "@/lib/orchestrator/client";
import { loadBoardState } from "@/lib/keytag/load-board-state";

const mockTool = vi.mocked(callKeytagTool);

function wire(opts: { tags?: unknown[]; reviews?: unknown[] }) {
  const { tags = [], reviews = [] } = opts;
  // Cast the impl to the real tool type — the test returns loose per-tool shapes.
  mockTool.mockImplementation(((name: string) => {
    if (name === "listWipKeyTags") {
      return Promise.resolve({ ok: true, count: tags.length, shop_id: 7476, results: tags });
    }
    if (name === "listManualReviews") {
      return Promise.resolve({ results: reviews });
    }
    return Promise.resolve({ ok: true });
  }) as unknown as typeof callKeytagTool);
}

const review = (ro: number, over: Record<string, unknown> = {}) => ({
  ro_id: ro,
  ro_number: ro,
  category: "ar_regression",
  code: `REG-${ro}`,
  issued_at: "2026-06-24T15:00:00Z",
  resolved_at: null,
  ...over,
});

describe("loadBoardState — untagged list from open reviews", () => {
  beforeEach(() => vi.clearAllMocks());

  it("surfaces an open 'needs a tag' review as an untagged row keyed by its code", async () => {
    wire({ reviews: [review(100)] });
    const state = await loadBoardState("chris@jeffsautomotive.com");
    const row = state.untagged.find((r) => r.ro_number === 100);
    expect(row).toBeDefined();
    expect(row!.review_code).toBe("REG-100");
    expect(row!.category).toBe("ar_regression");
  });

  it("excludes resolved reviews", async () => {
    wire({ reviews: [review(100, { resolved_at: "2026-06-24T16:00:00Z" })] });
    const state = await loadBoardState("chris@jeffsautomotive.com");
    expect(state.untagged.find((r) => r.ro_number === 100)).toBeUndefined();
  });

  it("excludes reviews whose category is not a 'needs a tag' category", async () => {
    // Any category outside UNTAGGED_CATEGORIES (work_approved_drift /
    // ar_regression / ar_no_prior_tag) must not appear on the board.
    wire({ reviews: [review(100, { category: "duplicate_active_tag" })] });
    const state = await loadBoardState("chris@jeffsautomotive.com");
    expect(state.untagged.find((r) => r.ro_number === 100)).toBeUndefined();
  });

  it("passes listWipKeyTags results through as the tagged (in-use) list", async () => {
    const tag = {
      ro_number: 5,
      ro_id: 5,
      tag: "R4",
      tag_color: "red",
      tag_number: 4,
      status: "assigned",
      customer_id: null,
      customer_name: null,
      vehicle_id: null,
      ro_url: "https://shop.tekmetric.com/ro/5",
      last_activity_at: null,
    };
    wire({ tags: [tag] });
    const state = await loadBoardState("chris@jeffsautomotive.com");
    expect(state.tagged).toHaveLength(1);
    expect(state.tagged[0]?.ro_number).toBe(5);
  });
});
