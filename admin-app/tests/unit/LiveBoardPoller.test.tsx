/**
 * LiveBoardPoller — the 15s auto-tick must PAUSE while a board row has an
 * action in flight (busy), so a poll Server Action can't serialize ahead of the
 * user's release/assign (Next.js dispatches Server Actions one-at-a-time per
 * client). Secondary half of the 2026-06-24 board-release spin fix. Manual
 * Refresh is unaffected (not covered here — it's an explicit user click).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";

vi.mock("@/actions/keytag/board-state", () => ({ getBoardStateAction: vi.fn() }));

import { getBoardStateAction } from "@/actions/keytag/board-state";
import { LiveBoardPoller } from "@/components/keytag/LiveBoardPoller";

const mockGet = vi.mocked(getBoardStateAction);
const STAMP = new Date(0).toISOString();
const okState = {
  kind: "ok" as const,
  data: { generated_at: STAMP, tagged: [], untagged: [] },
};

describe("LiveBoardPoller — pause while busy (poll-contention fix)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGet.mockResolvedValue(okState);
  });
  afterEach(() => vi.useRealTimers());

  it("skips the 15s auto-tick while a row is busy", async () => {
    render(<LiveBoardPoller generatedAt={STAMP} onState={() => {}} busy />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("polls on the auto-tick when not busy", async () => {
    render(<LiveBoardPoller generatedAt={STAMP} onState={() => {}} busy={false} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    expect(mockGet).toHaveBeenCalled();
  });
});
