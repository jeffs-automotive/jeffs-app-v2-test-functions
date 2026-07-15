"use client";

/**
 * CompleteRunButton — the "Mark payroll complete" flow (design spec §3, Mark-
 * payroll-complete). The Pattern S dance (dry-run → state hash → single-use
 * token → confirm) runs entirely SERVER-SIDE inside completePayrollRunAction;
 * this dialog is the HUMAN confirmation surface. It shows the run's totals
 * summary and — when the Tekmetric mirror is older than the period end — a
 * required freshness acknowledgment checkbox before Confirm unlocks.
 *
 * UNSAVED-ENTRIES BLOCK: the completion snapshot is built server-side from
 * SAVED state only, so typed-but-unsaved grid cells would be silently excluded
 * from the frozen payroll record (and the completed-alert emails). The dialog
 * reads the #43 unsaved-entries registry when it opens (and re-checks at
 * confirm) and BLOCKS completion until the grid is saved or cleared.
 *
 * Composes the Dialog primitives directly (ConfirmDialog has no input slot)
 * with the same visual language: amber circle + AlertTriangle, outline Cancel,
 * primary Confirm, close-guard while pending. On success the page refreshes
 * and re-renders locked.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Lock } from "lucide-react";
import { completePayrollRunAction } from "@/actions/payroll";
import { fmtUsd } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DeficitNotice, fmtAsOf, fmtHours, fmtShortDate } from "../../payroll-ui";
import { getUnsavedEntryCount } from "./unsaved-entries";

/** One employee still projected negative after this run (plan §4 / #59). */
export interface ProjectedNegativeEmployee {
  employeeId: string;
  displayName: string;
  /** Positive magnitude of the projected deficit. */
  deficitHours: number;
}

export function CompleteRunButton({
  runId,
  employeeCount,
  totalPayCents,
  totalHours,
  dataAsOf,
  periodEnd,
  stale,
  missingPersonalEmail = [],
  projectedNegative = [],
}: {
  runId: string;
  employeeCount: number;
  totalPayCents: number;
  totalHours: number;
  /** snapshot.derived_provenance.as_of — mirror freshness. */
  dataAsOf: string;
  periodEnd: string;
  /** True when the mirror was last refreshed before the END of the period-end
   *  day, shop-local (server-computed — see the [period] page's staleMirror). */
  stale: boolean;
  /** Round-11 (plan §4.2 / #53.3): employees with no personal_email — they won't
   *  get a pay summary. Non-empty ⇒ a warning notice + the confirm relabels to
   *  "Skip emails & mark complete". Defaults to [] so the completed contract is
   *  unchanged for callers that don't pass it (C20). */
  missingPersonalEmail?: string[];
  /** Round-11 (plan §4 / #59): employees still projected negative after this run
   *  — an advisory deficit notice (negatives are allowed, never blocks). Defaults
   *  to []. */
  projectedNegative?: ProjectedNegativeEmployee[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Typed-but-unsaved grid cells (the #43 registry, read when the dialog
  // opens). Non-zero BLOCKS completion: the frozen snapshot only sees SAVED
  // state, so completing now would silently leave those hours out.
  const [unsaved, setUnsaved] = useState(0);

  function handleOpenChange(next: boolean) {
    if (pending && !next) return;
    setOpen(next);
    if (next) {
      setAcknowledged(false);
      setErr(null);
      setUnsaved(getUnsavedEntryCount());
    }
  }

  function confirm() {
    // Belt-and-braces re-check at the moment of truth (the count was captured
    // at dialog-open; block if the grid is dirty NOW).
    const unsavedNow = getUnsavedEntryCount();
    setUnsaved(unsavedNow);
    if (unsavedNow > 0) return;
    setErr(null);
    start(async () => {
      const fd = new FormData();
      fd.set("run_id", runId);
      const res = await completePayrollRunAction(null, fd);
      if (res.ok) {
        setOpen(false);
        router.refresh(); // the run re-renders locked
      } else {
        setErr(res.message);
      }
    });
  }

  return (
    <>
      <Button type="button" onClick={() => handleOpenChange(true)}>
        <Lock aria-hidden="true" />
        Mark payroll complete
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg shadow-lg" showCloseButton={false}>
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
                <AlertTriangle className="size-5 text-amber-800" aria-hidden="true" />
              </div>
              <DialogTitle>Mark this payroll complete?</DialogTitle>
            </div>
            <DialogDescription>
              Once you mark it complete, the numbers are frozen — this run becomes a read-only
              record you can view and print but can&apos;t change, even if Tekmetric data changes
              later. Make sure you&apos;ve entered everything into the payroll system first.
            </DialogDescription>
          </DialogHeader>

          <dl className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Employees</dt>
              <dd className="mt-0.5 font-bold tabular-nums text-foreground">{employeeCount}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Worked hours</dt>
              <dd className="mt-0.5 font-bold tabular-nums text-foreground">{fmtHours(totalHours)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total pay</dt>
              <dd className="mt-0.5 font-bold tabular-nums text-foreground">{fmtUsd(totalPayCents)}</dd>
            </div>
          </dl>

          {unsaved > 0 && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
            >
              <p>
                <span className="font-semibold">
                  The entry grid has {unsaved} unsaved {unsaved === 1 ? "change" : "changes"}
                </span>{" "}
                — the totals above don&apos;t include {unsaved === 1 ? "it" : "them"}, and
                completing now would leave {unsaved === 1 ? "it" : "them"} out of the frozen
                payroll record. Save (or clear) your changes on the entry grid first.
              </p>
            </div>
          )}

          {missingPersonalEmail.length > 0 && (
            <div
              role="alert"
              className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
            >
              <p>
                <span className="font-semibold">
                  {missingPersonalEmail.length === 1
                    ? "This employee has"
                    : "These employees have"}{" "}
                  no personal email
                </span>
                , so they won&apos;t get a pay summary:
              </p>
              <ul className="mt-1 list-disc pl-5">
                {missingPersonalEmail.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
              <p className="mt-2">
                Add a personal email on the{" "}
                <Link href="/payroll/employees" className="font-medium underline">
                  employees page
                </Link>
                , or skip and complete anyway.
              </p>
            </div>
          )}

          {projectedNegative.length > 0 && (
            <DeficitNotice>
              <p className="font-semibold">
                {projectedNegative.length === 1
                  ? "One person will be in the hole after this run:"
                  : "These people will be in the hole after this run:"}
              </p>
              <ul className="mt-1 list-disc pl-5">
                {projectedNegative.map((emp) => (
                  <li key={emp.employeeId} className="tabular-nums">
                    {emp.displayName} — {fmtHours(emp.deficitHours)} h deficit
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                Negative balances are allowed. They&apos;ll be emailed the deficit when you complete.
              </p>
            </DeficitNotice>
          )}

          {stale && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <p>
                Tekmetric data was last refreshed{" "}
                <span className="font-semibold">{fmtAsOf(dataAsOf)}</span> — before this period
                ended ({fmtShortDate(periodEnd)}). If work was posted after that, refresh the
                Tekmetric data first.
              </p>
              <label className="mt-2 flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5"
                  disabled={pending}
                />
                <span className="font-medium">Use these numbers anyway — I&apos;ve checked them.</span>
              </label>
            </div>
          )}

          {err && <p className="text-sm text-red-700 dark:text-red-400">{err}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              loading={pending}
              loadingText="Locking…"
              disabled={pending || unsaved > 0 || (stale && !acknowledged)}
              onClick={confirm}
            >
              {missingPersonalEmail.length > 0 ? "Skip emails & mark complete" : "Mark complete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
