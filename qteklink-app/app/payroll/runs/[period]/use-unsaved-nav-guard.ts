"use client";

/**
 * useUnsavedNavGuard — the round-8 #43 leave guard's ROUTE-LEAVE half.
 *
 * WHY: Next.js App Router soft navigations (every next/link click — the
 * QtlTabs module tabs, the "Back to payroll" button, the empty-state employees
 * link, the lineage links) fire NO beforeunload and expose NO cancelable route
 * event. They unmount EntryGrid and silently discard every dirty cell. The
 * sanctioned seam is a CAPTURE-PHASE document click listener: it runs before
 * React's root-delegated handlers (next/link's onClick included), so a
 * window.confirm can gate the navigation and a cancel can stop it with
 * preventDefault + stopPropagation.
 *
 * Scope — only clicks that would actually soft-navigate away:
 *   - unmodified LEFT clicks (modified/middle clicks open a new tab: this
 *     page — and its dirty state — stays alive);
 *   - on an INTERNAL anchor (href starting "/"): external/absolute hrefs are
 *     hard navigations, which the beforeunload guard in EntryGrid already
 *     covers (guarding them here would double-prompt);
 *   - not `target`ed elsewhere and not a download (neither unmounts the page);
 *   - NOT the run-view tab pills (`data-run-view-tab`): those keep every panel
 *     mounted and run their OWN tab-switch confirm in RunViewTabs.
 *
 * Active only while the grid is dirty; the listener detaches when the grid
 * saves, goes pristine, or unmounts.
 */
import { useEffect } from "react";
import { UNSAVED_ENTRIES_LEAVE_CONFIRM } from "./unsaved-entries";

export function useUnsavedNavGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const guard = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.dataset.runViewTab !== undefined) return; // pills self-guard in RunViewTabs
      if (anchor.target !== "" && anchor.target !== "_self") return; // new tab/window
      if (anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href.startsWith("/")) return; // internal soft navs only; hard navs hit beforeunload
      if (!window.confirm(UNSAVED_ENTRIES_LEAVE_CONFIRM)) {
        e.preventDefault();
        e.stopPropagation(); // keep next/link's client handler from routing
      }
    };

    document.addEventListener("click", guard, true); // capture: before React's delegated handlers
    return () => document.removeEventListener("click", guard, true);
  }, [active]);
}
