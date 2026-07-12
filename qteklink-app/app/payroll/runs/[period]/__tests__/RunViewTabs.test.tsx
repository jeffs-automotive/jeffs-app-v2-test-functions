/**
 * RunViewTabs — the round-7 #41 instant-tabs contract:
 *   - ALL three panels are in the DOM from the one server render; only
 *     visibility toggles (class-based — jsdom doesn't apply Tailwind CSS, so
 *     the assertions pin the class contract itself);
 *   - switching is CLIENT-SIDE: history.replaceState syncs ?view=, aria-current
 *     moves, and no navigation happens;
 *   - deep links (initialView from the server-resolved searchParam) land on the
 *     right tab at first render;
 *   - modified clicks (ctrl/meta) keep native link behavior (no switch);
 *   - print contract: the inactive summary keeps `hidden print:block` when
 *     printable and plain `hidden` when the run is empty (placeholder never prints);
 *   - the #42 dry-run affordance mounts under the pay sheets and its Accept
 *     switches to the Summary tab (the DryRunButton itself is stubbed here —
 *     its own contract lives in DryRunButton.test.tsx);
 *   - the round-8 #43 LEAVE GUARD: leaving the ENTRY tab while the entry grid
 *     has unsaved cells (the unsaved-entries registry) is gated behind a
 *     window.confirm — cancel stays, OK proceeds, pristine/other-tab switches
 *     never prompt.
 */
import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../DryRunButton", () => ({
  DryRunButton: ({ onAccepted, locked }: { onAccepted: () => void; locked?: boolean }) => (
    <button type="button" disabled={locked} onClick={onAccepted}>
      Dry run (stub)
    </button>
  ),
}));

import { RunViewTabs, type RunView } from "../RunViewTabs";
import { setUnsavedEntryCount } from "../unsaved-entries";

function panel(name: string): HTMLElement {
  const el = document.querySelector(`[data-run-panel="${name}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`missing panel ${name}`);
  return el;
}

function renderTabs(over: Partial<Parameters<typeof RunViewTabs>[0]> = {}) {
  return render(
    <RunViewTabs
      initialView={"entry" as RunView}
      period="2026-06-28"
      entryPanel={<p>ENTRY PANEL</p>}
      sheetsPanel={<p>SHEETS PANEL</p>}
      summaryPanel={<p>SUMMARY PANEL</p>}
      summaryPrintable
      dryRun={null}
      {...over}
    />,
  );
}

let replaceState: MockInstance<History["replaceState"]>;

beforeEach(() => {
  window.history.replaceState(null, "", "/payroll/runs/2026-06-28?view=entry");
  replaceState = vi.spyOn(window.history, "replaceState");
});

afterEach(() => {
  replaceState.mockRestore();
  setUnsavedEntryCount(0); // the #43 registry is module-scoped — never leak between tests
});

describe("RunViewTabs (#41 instant tabs)", () => {
  it("one render carries ALL THREE panels; only the active one is un-hidden", () => {
    renderTabs();
    expect(screen.getByText("ENTRY PANEL")).toBeInTheDocument();
    expect(screen.getByText("SHEETS PANEL")).toBeInTheDocument();
    expect(screen.getByText("SUMMARY PANEL")).toBeInTheDocument();

    expect(panel("entry").className).not.toMatch(/(^| )hidden( |$)/); // active on screen…
    expect(panel("entry").className).toContain("print:hidden"); // …but never printed
    expect(panel("sheets").className).toMatch(/(^| )hidden( |$)/);
    expect(panel("summary").className).toBe("hidden print:block"); // ALWAYS printable
  });

  it("keeps the existing tab semantics: nav landmark + links with aria-current", () => {
    renderTabs();
    expect(screen.getByRole("navigation", { name: "Run views" })).toBeInTheDocument();
    const entry = screen.getByRole("link", { name: "Entry grid" });
    expect(entry).toHaveAttribute("aria-current", "page");
    expect(entry).toHaveAttribute("href", "/payroll/runs/2026-06-28?view=entry");
    expect(screen.getByRole("link", { name: "Pay sheets" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Summary" })).not.toHaveAttribute("aria-current");
  });

  it("carries the ?run= lineage param into the deep-link hrefs", () => {
    renderTabs({ runParam: "7f0a1b2c-3d4e-4f5a-8b9c-0d1e2f3a4b5c" });
    expect(screen.getByRole("link", { name: "Summary" })).toHaveAttribute(
      "href",
      "/payroll/runs/2026-06-28?view=summary&run=7f0a1b2c-3d4e-4f5a-8b9c-0d1e2f3a4b5c",
    );
  });

  it("a click switches panels CLIENT-SIDE and replaceState-syncs ?view=", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("link", { name: "Pay sheets" }));

    expect(panel("sheets").className).not.toMatch(/(^| )hidden( |$)/);
    expect(panel("entry").className).toMatch(/(^| )hidden( |$)/);
    expect(screen.getByRole("link", { name: "Pay sheets" })).toHaveAttribute("aria-current", "page");

    expect(replaceState).toHaveBeenCalledTimes(1);
    const url = String(replaceState.mock.calls[0]?.[2]);
    expect(url).toContain("view=sheets");
    expect(window.location.search).toContain("view=sheets");
  });

  it("a modified click (ctrl) keeps native link behavior — no client switch, no replaceState", () => {
    renderTabs();
    // jsdom doesn't navigate; swallow the un-prevented default at the document level.
    const swallow = (e: Event) => e.preventDefault();
    document.addEventListener("click", swallow);
    try {
      fireEvent.click(screen.getByRole("link", { name: "Summary" }), { ctrlKey: true });
    } finally {
      document.removeEventListener("click", swallow);
    }
    expect(panel("entry").className).not.toMatch(/(^| )hidden( |$)/); // still on entry
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("deep link: initialView='summary' renders the summary tab active on FIRST render", () => {
    renderTabs({ initialView: "summary" });
    expect(panel("summary").className).toBe("mt-6");
    expect(panel("entry").className).toMatch(/(^| )hidden( |$)/);
    expect(screen.getByRole("link", { name: "Summary" })).toHaveAttribute("aria-current", "page");
  });

  it("empty run: the summary placeholder never prints (plain hidden, no print:block)", () => {
    renderTabs({ summaryPrintable: false });
    expect(panel("summary").className).toBe("hidden");
  });

  it("#42: the dry-run affordance mounts under the pay sheets; Accept switches to Summary", () => {
    renderTabs({
      initialView: "sheets",
      dryRun: { runId: "7f0a1b2c-3d4e-4f5a-8b9c-0d1e2f3a4b5c", roCount: 42, locked: false },
    });
    const stub = screen.getByRole("button", { name: "Dry run (stub)" });
    expect(panel("sheets").contains(stub)).toBe(true);

    fireEvent.click(stub); // the stub invokes onAccepted directly
    expect(panel("summary").className).toBe("mt-6");
    expect(screen.getByRole("link", { name: "Summary" })).toHaveAttribute("aria-current", "page");
    expect(String(replaceState.mock.calls.at(-1)?.[2])).toContain("view=summary");
  });

  it("no dry-run affordance when the page passes null (viewer, or a locked run)", () => {
    renderTabs({ initialView: "sheets" });
    expect(screen.queryByRole("button", { name: "Dry run (stub)" })).not.toBeInTheDocument();
  });
});

// ── Round-8 #43: the unsaved-entries leave guard on the client-side switch ────

describe("RunViewTabs leave guard (#43)", () => {
  it("confirms before leaving the entry tab with unsaved cells — cancel STAYS put", () => {
    setUnsavedEntryCount(2);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      renderTabs();
      fireEvent.click(screen.getByRole("link", { name: "Pay sheets" }));

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(String(confirmSpy.mock.calls[0]?.[0])).toMatch(/unsaved entry changes/i);
      // Still on the entry tab: no panel switch, no URL sync.
      expect(panel("entry").className).not.toMatch(/(^| )hidden( |$)/);
      expect(screen.getByRole("link", { name: "Entry grid" })).toHaveAttribute("aria-current", "page");
      expect(replaceState).not.toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("OK proceeds with the switch (the edits survive — panels stay mounted)", () => {
    setUnsavedEntryCount(1);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      renderTabs();
      fireEvent.click(screen.getByRole("link", { name: "Pay sheets" }));

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(panel("sheets").className).not.toMatch(/(^| )hidden( |$)/);
      expect(screen.getByText("ENTRY PANEL")).toBeInTheDocument(); // still mounted
      expect(String(replaceState.mock.calls.at(-1)?.[2])).toContain("view=sheets");
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("never prompts when the grid is pristine", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    try {
      renderTabs();
      fireEvent.click(screen.getByRole("link", { name: "Summary" }));
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(panel("summary").className).toBe("mt-6");
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("never prompts when switching between NON-entry tabs (the grid was already left)", () => {
    setUnsavedEntryCount(3);
    const confirmSpy = vi.spyOn(window, "confirm");
    try {
      renderTabs({ initialView: "sheets" });
      fireEvent.click(screen.getByRole("link", { name: "Summary" }));
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(panel("summary").className).toBe("mt-6");
    } finally {
      confirmSpy.mockRestore();
    }
  });
});
