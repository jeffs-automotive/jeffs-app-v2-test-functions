/**
 * LiveBoardPoller — the 15s auto-tick must PAUSE while ANY board mutation is in
 * flight, so a poll Server Action can't co-batch / serialize with the user's
 * release/assign and pin its useActionState isPending (the post-success "keeps
 * spinning" bug). The signal is the module-level boardMutationStore, fed by
 * every mutation source (per-row buttons + the bottom manual forms) — this test
 * drives that real store directly. Manual Refresh is unaffected (an explicit
 * user click; not covered here). 2026-06-24 board-residual-fixes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";

vi.mock("@/actions/keytag/board-state", () => ({ getBoardStateAction: vi.fn() }));

import { getBoardStateAction } from "@/actions/keytag/board-state";
import { LiveBoardPoller } from "@/components/keytag/LiveBoardPoller";
import { boardMutationStore } from "@/components/keytag/board-mutation-store";

const mockGet = vi.mocked(getBoardStateAction);
const STAMP = new Date(0).toISOString();
const okState = {
  kind: "ok" as const,
  data: { generated_at: STAMP, tagged: [], untagged: [] },
};

describe("LiveBoardPoller — pause while a mutation is in flight (poll-contention fix)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGet.mockResolvedValue(okState);
  });
  afterEach(() => {
    vi.useRealTimers();
    // Drain any leftover hold so the module-level store can't leak across tests.
    while (boardMutationStore.isMutating()) boardMutationStore.end();
  });

  it("skips the 15s auto-tick while a mutation is in flight", async () => {
    boardMutationStore.begin(); // a release/assign is in flight
    render(<LiveBoardPoller generatedAt={STAMP} onState={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    expect(mockGet).not.toHaveBeenCalled();
    boardMutationStore.end();
  });

  it("polls on the auto-tick when no mutation is in flight", async () => {
    render(<LiveBoardPoller generatedAt={STAMP} onState={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    expect(mockGet).toHaveBeenCalled();
  });
});
