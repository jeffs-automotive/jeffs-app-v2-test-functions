"use client";

/**
 * RunViewTabs — the round-7 #41 INSTANT tab switcher for the run detail page.
 * ONE server render supplies all three panels (the page computes everything in
 * a single live-snapshot read); switching tabs only toggles panel visibility
 * client-side — NO navigation, NO router.refresh, NO server round-trip (was
 * 10–20s per switch before the live snapshot; still a full re-render after).
 * Entry-grid SAVES keep their existing server round-trip (they must recompute)
 * — only tab switches went client-side.
 *
 * URL contract: `?view=` stays in sync via native history.replaceState (the
 * App-Router-sanctioned shallow update — usePathname/useSearchParams stay
 * consistent), so copy/refresh/deep-links land on the same tab server-side.
 * The tab pills stay real <a href> links: middle/ctrl-click opens the deep
 * link natively; only plain left-clicks are intercepted.
 *
 * Print contract (preserved verbatim from the server-rendered original): the
 * entry + sheets panels are print-hidden; the SUMMARY panel is ALWAYS in the
 * DOM — visible as its tab on screen, `hidden print:block` otherwise — so
 * printing any tab prints the summary sheet with its self-labeling header.
 * (`summaryPrintable=false` = empty run: the placeholder never prints.)
 *
 * All three panels stay MOUNTED across switches, so unsaved entry-grid edits
 * survive a peek at the pay sheets. The #42 DryRunButton mounts at the bottom
 * of the pay-sheets panel; its Accept switches to the Summary tab through the
 * same selectView.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DryRunButton } from "./DryRunButton";

export type RunView = "entry" | "sheets" | "summary";

const TABS: { key: RunView; label: string }[] = [
  { key: "entry", label: "Entry grid" },
  { key: "sheets", label: "Pay sheets" },
  { key: "summary", label: "Summary" },
];

export interface RunDryRunProps {
  runId: string;
  /** snapshot.derived_provenance.ro_count — the "Checking N…" pending figure. */
  roCount: number | null;
  /** Defensive lock (the page only passes this for open runs). */
  locked: boolean;
}

export function RunViewTabs({
  initialView,
  period,
  runParam,
  entryPanel,
  sheetsPanel,
  summaryPanel,
  summaryPrintable,
  dryRun,
}: {
  /** The server-resolved `?view=` — deep links land correctly on first render. */
  initialView: RunView;
  period: string;
  /** `?run=` lineage param — carried into the deep-link hrefs. */
  runParam?: string;
  entryPanel: ReactNode;
  sheetsPanel: ReactNode;
  summaryPanel: ReactNode;
  /** False = empty run (placeholder panel) — never printed. */
  summaryPrintable: boolean;
  /** Non-null = render the #42 dry-run affordance under the pay sheets (admin, open runs). */
  dryRun: RunDryRunProps | null;
}) {
  const [view, setView] = useState<RunView>(initialView);

  function selectView(v: RunView) {
    setView(v);
    // Shallow URL sync — no server round-trip (Next.js native-history integration).
    const url = new URL(window.location.href);
    url.searchParams.set("view", v);
    window.history.replaceState(window.history.state, "", url.toString());
  }

  const hrefFor = (v: RunView) =>
    `/payroll/runs/${period}?view=${v}${runParam ? `&run=${runParam}` : ""}`;

  return (
    <>
      {/* ── Tabs (same visual + aria contract as the server-rendered original) ── */}
      <nav className="mt-6 flex gap-2 print:hidden" aria-label="Run views">
        {TABS.map((t) => (
          <a
            key={t.key}
            href={hrefFor(t.key)}
            aria-current={view === t.key ? "page" : undefined}
            onClick={(e) => {
              // Modified/middle clicks keep native link behavior (new tab = a
              // fresh server render of the deep link); plain clicks switch here.
              if (e.defaultPrevented || e.button !== 0) return;
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              selectView(t.key);
            }}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              view === t.key
                ? "border border-transparent bg-primary/10 font-semibold text-primary"
                : "border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </a>
        ))}
      </nav>

      {/* ── Panels: all mounted; visibility toggles client-side ── */}
      <section
        data-run-panel="entry"
        className={cn("mt-6 print:hidden", view !== "entry" && "hidden")}
      >
        {entryPanel}
      </section>

      <section
        data-run-panel="sheets"
        className={cn("mt-6 print:hidden", view !== "sheets" && "hidden")}
      >
        {sheetsPanel}
        {dryRun && (
          <div className="mt-6 border-t border-border pt-4">
            <DryRunButton
              runId={dryRun.runId}
              roCount={dryRun.roCount}
              locked={dryRun.locked}
              onAccepted={() => selectView("summary")}
            />
          </div>
        )}
      </section>

      {/* Summary: on-screen as its tab; ALWAYS in the DOM for print (the print
          header inside SummaryView labels the sheet) — unless the run is empty. */}
      <section
        data-run-panel="summary"
        className={
          view === "summary" ? "mt-6" : summaryPrintable ? "hidden print:block" : "hidden"
        }
      >
        {summaryPanel}
      </section>
    </>
  );
}
