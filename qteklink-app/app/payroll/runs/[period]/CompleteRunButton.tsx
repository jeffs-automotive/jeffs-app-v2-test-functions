"use client";

/**
 * CompleteRunButton — the "Mark payroll complete" flow (design spec §3, Mark-
 * payroll-complete). The Pattern S dance (dry-run → state hash → single-use
 * token → confirm) runs entirely SERVER-SIDE inside completePayrollRunAction;
 * this dialog is the HUMAN confirmation surface. It shows the run's totals
 * summary and — when the Tekmetric mirror is older than the period end — a
 * required freshness acknowledgment checkbox before Confirm unlocks.
 *
 * Composes the Dialog primitives directly (ConfirmDialog has no input slot)
 * with the same visual language: amber circle + AlertTriangle, outline Cancel,
 * primary Confirm, close-guard while pending. On success the page refreshes
 * and re-renders locked.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { fmtAsOf, fmtHours, fmtShortDate } from "./run-ui";

export function CompleteRunButton({
  runId,
  employeeCount,
  totalPayCents,
  totalHours,
  dataAsOf,
  periodEnd,
  stale,
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
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (pending && !next) return;
    setOpen(next);
    if (next) {
      setAcknowledged(false);
      setErr(null);
    }
  }

  function confirm() {
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
              disabled={pending || (stale && !acknowledged)}
              onClick={confirm}
            >
              Mark complete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
