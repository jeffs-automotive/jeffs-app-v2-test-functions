/**
 * KeytagsTabs — the active tab must be URL-synced so a reload keeps the user on
 * their current tab instead of resetting to Dashboard (2026-06-24
 * board-release-fix). A tab click persists ?tab= via window.history.replaceState
 * (no Next navigation → no RSC refetch of the six tabs on this force-dynamic
 * page); the first paint is seeded from defaultValue (which the page computes
 * from ?tab=).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KeytagsTabs } from "@/components/keytag/KeytagsTabs";

const tabs = {
  dashboard: <div>DASHBOARD_CONTENT</div>,
  live: <div>BOARD_CONTENT</div>,
  postedRevert: <div>POSTED_CONTENT</div>,
  reconcile: <div>RECONCILE_CONTENT</div>,
  manualReviews: <div>REVIEWS_CONTENT</div>,
  auditHistory: <div>AUDIT_CONTENT</div>,
};

describe("KeytagsTabs — URL-synced active tab (reload-keeps-tab fix)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/keytags");
  });

  it("opens the tab named by defaultValue (a reload with ?tab= seeds this)", () => {
    render(<KeytagsTabs defaultValue="live" {...tabs} />);
    expect(screen.getByText("BOARD_CONTENT")).toBeVisible();
  });

  it("persists the selected tab into the URL via replaceState (so a reload keeps it)", async () => {
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    render(<KeytagsTabs defaultValue="dashboard" {...tabs} />);

    await userEvent.click(screen.getByRole("tab", { name: /^board$/i }));

    expect(replaceSpy).toHaveBeenCalled();
    const lastUrl = String(replaceSpy.mock.calls.at(-1)?.[2] ?? "");
    expect(lastUrl).toContain("tab=live");
  });
});
