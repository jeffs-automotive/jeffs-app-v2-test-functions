/**
 * loadBoardState merges three sources into the board's untagged list:
 *   - open manual reviews (kind 'review')
 *   - released-while-WIP ROs needing a tag (kind 'released_wip')
 * with reviews winning the de-dup (an RO surfaced by an open review must not also
 * appear as a released_wip row). This is the core of the 2026-06-24 Bug 2 fix
 * (keep a just-released WIP RO on the board so it can be re-tagged in place).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// `server-only` is aliased to a no-op stub in vitest.config.ts (test alias).
vi.mock("@/lib/orchestrator/client", () => ({ callKeytagTool: vi.fn() }));

import { callKeytagTool } from "@/lib/orchestrator/client";
import { loadBoardState } from "@/lib/keytag/load-board-state";

const mockTool = vi.mocked(callKeytagTool);

function wire(opts: {
  tags?: unknown[];
  reviews?: unknown[];
  releasedWip?: unknown[];
}) {
  const { tags = [], reviews = [], releasedWip = [] } = opts;
  mockTool.mockImplementation((name: string) => {
    if (name === "listWipKeyTags") {
      return Promise.resolve({ ok: true, count: tags.length, shop_id: 7476, results: tags });
    }
    if (name === "listManualReviews") {
      return Promise.resolve({ results: reviews });
    }
    if (name === "listReleasedWipNeedingTag") {
      return Promise.resolve({ ok: true, count: releasedWip.length, window_days: 3, results: releasedWip });
    }
    return Promise.resolve({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as unknown as typeof mockTool;
}

const review = (ro: number) => ({
  ro_id: ro,
  ro_number: ro,
  category: "ar_regression",
  code: `REG-${ro}`,
  issued_at: "2026-06-24T15:00:00Z",
  resolved_at: null,
});
const releasedWip = (ro: number, tag = "R75") => ({
  ro_id: ro,
  ro_number: ro,
  released_tag: tag,
  released_color: "red",
  released_number: 75,
  released_at: "2026-06-24T15:11:16Z",
  released_by: "chris@jeffsautomotive.com",
  ro_url: `https://shop.tekmetric.com/ro/${ro}`,
});

describe("loadBoardState — untagged source merge + de-dup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("surfaces a released-while-WIP RO with no review as a released_wip row", async () => {
    wire({ releasedWip: [releasedWip(200)] });
    const state = await loadBoardState("chris@jeffsautomotive.com");
    const row = state.untagged.find((r) => r.ro_number === 200);
    expect(row).toBeDefined();
    expect(row!.kind).toBe("released_wip");
    expect(row!.released_tag).toBe("R75");
    expect(row!.review_code).toBe("rw-200");
  });

  it("de-dupes: an RO with BOTH an open review and a released_wip event shows once (review wins)", async () => {
    wire({ reviews: [review(100)], releasedWip: [releasedWip(100), releasedWip(200)] });
    const state = await loadBoardState("chris@jeffsautomotive.com");
    const for100 = state.untagged.filter((r) => r.ro_number === 100);
    expect(for100).toHaveLength(1);
    expect(for100[0].kind).toBe("review");
    // 200 (no review) still appears as released_wip
    expect(state.untagged.find((r) => r.ro_number === 200)?.kind).toBe("released_wip");
  });

  it("tags review-sourced rows with kind 'review'", async () => {
    wire({ reviews: [review(100)] });
    const state = await loadBoardState("chris@jeffsautomotive.com");
    expect(state.untagged.find((r) => r.ro_number === 100)?.kind).toBe("review");
  });
});
