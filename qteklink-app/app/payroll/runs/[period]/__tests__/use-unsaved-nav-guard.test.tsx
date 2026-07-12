/**
 * useUnsavedNavGuard — the round-8 #43 ROUTE-LEAVE guard's contract:
 *   - while ACTIVE, an unmodified left-click on an INTERNAL anchor
 *     (a[href^="/"]) prompts window.confirm with the LEAVE copy ("will be
 *     LOST" — a soft nav unmounts the grid, unlike a tab switch);
 *   - cancel STOPS the navigation (preventDefault + stopPropagation, so
 *     next/link's delegated onClick never routes); OK lets it through;
 *   - never prompts on: modified clicks (new tab keeps this page alive),
 *     external hrefs (beforeunload owns hard navs), target="_blank" /
 *     download anchors, the run-view tab pills (data-run-view-tab — they
 *     self-guard in RunViewTabs), or non-anchor clicks;
 *   - inactive/unmounted = no listener (no prompt, no interception).
 *
 * The listener is CAPTURE-PHASE on document. Each click test installs a
 * document-level BUBBLE listener that (a) proves propagation survived, (b)
 * records whether the guard preventDefault-ed, and (c) then preventDefaults
 * itself — jsdom doesn't implement navigation, so an un-prevented anchor
 * click must be swallowed (same trick as RunViewTabs.test.tsx).
 */
import { describe, expect, it, vi, afterEach, type MockInstance } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useUnsavedNavGuard } from "../use-unsaved-nav-guard";

function Harness({ active }: { active: boolean }) {
  useUnsavedNavGuard(active);
  return (
    <div>
      <a href="/payroll">Back to payroll</a>
      <a href="/payroll/employees">
        <span>employees page</span>
      </a>
      <a href="https://tekmetric.com/ro/1">external</a>
      <a href="/payroll/export" target="_blank">
        new tab
      </a>
      <a href="/payroll/export.csv" download>
        download
      </a>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- fixture mirrors RunViewTabs' real raw <a> pills */}
      <a href="/payroll/runs/2026-06-28?view=sheets" data-run-view-tab="">
        Pay sheets pill
      </a>
      <button type="button">not a link</button>
    </div>
  );
}

/** Dispatch a click and report how the capture-phase guard treated it.
 *  `bubbled=false` means the guard stopPropagation-ed (nothing downstream —
 *  next/link's delegated handler included — would have run). */
function click(el: Element, init?: MouseEventInit): { bubbled: boolean; prevented: boolean } {
  let bubbled = false;
  let prevented = false;
  const swallow = (e: Event) => {
    bubbled = true;
    prevented = e.defaultPrevented;
    e.preventDefault(); // jsdom can't navigate — swallow the un-prevented default
  };
  document.addEventListener("click", swallow);
  try {
    const notPrevented = fireEvent.click(el, init);
    if (!bubbled) prevented = !notPrevented; // propagation stopped: read fireEvent's verdict
  } finally {
    document.removeEventListener("click", swallow);
  }
  return { bubbled, prevented };
}

let confirmSpy: MockInstance<Window["confirm"]> | undefined;

function spyConfirm(returns: boolean) {
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(returns);
  return confirmSpy;
}

afterEach(() => {
  confirmSpy?.mockRestore();
  confirmSpy = undefined;
});

describe("useUnsavedNavGuard (#43 route-leave guard)", () => {
  it("cancel BLOCKS an internal-anchor click: prevented AND propagation stopped", () => {
    const spy = spyConfirm(false);
    render(<Harness active />);
    const res = click(screen.getByText("Back to payroll"));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toMatch(/will be LOST if you leave/);
    expect(res.prevented).toBe(true);
    expect(res.bubbled).toBe(false); // next/link's delegated onClick never routes
  });

  it("OK lets the navigation through untouched", () => {
    const spy = spyConfirm(true);
    render(<Harness active />);
    const res = click(screen.getByText("Back to payroll"));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.bubbled).toBe(true);
    expect(res.prevented).toBe(false);
  });

  it("catches clicks on elements NESTED inside an internal anchor (closest)", () => {
    const spy = spyConfirm(false);
    render(<Harness active />);
    const res = click(screen.getByText("employees page"));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.prevented).toBe(true);
  });

  it("never prompts on modified clicks — a new tab keeps this page (and its edits) alive", () => {
    const spy = spyConfirm(false);
    render(<Harness active />);
    expect(click(screen.getByText("Back to payroll"), { ctrlKey: true }).prevented).toBe(false);
    expect(click(screen.getByText("Back to payroll"), { metaKey: true }).prevented).toBe(false);
    expect(click(screen.getByText("Back to payroll"), { button: 1 }).prevented).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("never prompts on external hrefs (hard navs — the beforeunload guard owns those)", () => {
    const spy = spyConfirm(false);
    render(<Harness active />);
    expect(click(screen.getByText("external")).prevented).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("never prompts on target=_blank or download anchors (neither unmounts the page)", () => {
    const spy = spyConfirm(false);
    render(<Harness active />);
    expect(click(screen.getByText("new tab")).prevented).toBe(false);
    expect(click(screen.getByText("download")).prevented).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("never prompts on the run-view tab pills — they self-guard in RunViewTabs", () => {
    const spy = spyConfirm(false);
    render(<Harness active />);
    expect(click(screen.getByText("Pay sheets pill")).prevented).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("never prompts on non-anchor clicks", () => {
    const spy = spyConfirm(false);
    render(<Harness active />);
    expect(click(screen.getByRole("button", { name: "not a link" })).prevented).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("inactive = no interception at all", () => {
    const spy = spyConfirm(false);
    render(<Harness active={false} />);
    const res = click(screen.getByText("Back to payroll"));
    expect(res.prevented).toBe(false);
    expect(res.bubbled).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("detaches on unmount — no orphaned document listener", () => {
    const spy = spyConfirm(false);
    const { unmount } = render(<Harness active />);
    unmount();
    const a = document.createElement("a");
    a.href = "/payroll";
    a.textContent = "after unmount";
    document.body.appendChild(a);
    try {
      expect(click(a).prevented).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      a.remove();
    }
  });
});
