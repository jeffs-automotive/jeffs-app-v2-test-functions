/**
 * AutoRefresh — the live-page polling timer: refreshes on the interval ONLY while
 * the tab is visible, catches up immediately when the tab becomes visible again,
 * and tears its timer/listener down on unmount.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import AutoRefresh from "../AutoRefresh";

let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AutoRefresh", () => {
  it("refreshes on the interval while the tab is visible", () => {
    render(<AutoRefresh intervalMs={1000} />);
    expect(refreshMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(refreshMock).toHaveBeenCalledTimes(3);
  });

  it("does NOT refresh while the tab is hidden, and catches up the moment it's visible again", () => {
    render(<AutoRefresh intervalMs={1000} />);
    visibility = "hidden";
    vi.advanceTimersByTime(5000);
    expect(refreshMock).not.toHaveBeenCalled(); // hidden ticks are skipped

    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refreshMock).toHaveBeenCalledTimes(1); // immediate catch-up
  });

  it("stops refreshing after unmount (timer + listener cleaned up)", () => {
    const { unmount } = render(<AutoRefresh intervalMs={1000} />);
    unmount();
    vi.advanceTimersByTime(3000);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
