/**
 * LiveBoardPoller — two invariants this guards:
 *  1. It must NOT auto-poll on a timer (the 2026-06-25 PR#4 fix: the old 15s
 *     getBoardStateAction auto-tick was a recurring Server Action).
 *  2. After a manual Refresh resolves, the loading state must CLEAR (the
 *     2026-06-25 defect-② fix: the old code called setState after `await` inside
 *     startTransition, which per react.dev can leave isPending pinned → the
 *     Refresh button spun forever). This test fails on that old code.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
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

describe("LiveBoardPoller — manual refresh only, and its spinner clears", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(okState);
  });

  it("does NOT auto-poll on a timer (the spin-fix regression guard)", async () => {
    vi.useFakeTimers();
    try {
      render(<LiveBoardPoller generatedAt={STAMP} onState={() => {}} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000); // 4 of the OLD 15s intervals
      });
      expect(mockGet).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("polls once on Refresh and CLEARS the loading state afterward (defect-② guard)", async () => {
    const user = userEvent.setup();
    render(<LiveBoardPoller generatedAt={STAMP} onState={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /refresh/i });

    await user.click(btn);

    // The action ran exactly once...
    expect(mockGet).toHaveBeenCalledTimes(1);
    // ...and the button must NOT be stuck disabled/loading after it resolves.
    // (The old useTransition post-await-setState bug left this pinned forever.)
    await waitFor(() => expect(btn).not.toBeDisabled());
  });
});
