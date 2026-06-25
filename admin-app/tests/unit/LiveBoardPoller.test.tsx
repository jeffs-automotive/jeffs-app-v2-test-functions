/**
 * LiveBoardPoller — must NOT auto-poll. This is the regression guard for the
 * 2026-06-25 board-spin-fix: the old 15s getBoardStateAction auto-tick was a
 * recurring SERVER ACTION that co-batched with the user's release/assign
 * Actions (React batches concurrent Actions; isPending stays true "until all
 * Actions complete") and pinned their spinner forever. The board now refreshes
 * only on the user's own action, a manual Refresh click, or a page reload.
 *
 * Test 1 proves no timer ever fires getBoardStateAction; test 2 proves the
 * manual Refresh button still polls once.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/actions/keytag/board-state", () => ({ getBoardStateAction: vi.fn() }));

import { getBoardStateAction } from "@/actions/keytag/board-state";
import { LiveBoardPoller } from "@/components/keytag/LiveBoardPoller";

const mockGet = vi.mocked(getBoardStateAction);
const STAMP = new Date(0).toISOString();
const okState = {
  kind: "ok" as const,
  data: { generated_at: STAMP, tagged: [], untagged: [] },
};

describe("LiveBoardPoller — manual refresh only (no auto-poll)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(okState);
  });

  it("does NOT auto-poll on a timer (the spin-fix regression guard)", async () => {
    vi.useFakeTimers();
    try {
      render(<LiveBoardPoller generatedAt={STAMP} onState={() => {}} />);
      await act(async () => {
        // Four+ of the OLD 15s intervals — nothing should fire.
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(mockGet).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("polls exactly once when the user clicks Refresh", async () => {
    const user = userEvent.setup();
    const onState = vi.fn();
    render(<LiveBoardPoller generatedAt={STAMP} onState={onState} />);
    await user.click(screen.getByRole("button", { name: /refresh/i }));
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});
