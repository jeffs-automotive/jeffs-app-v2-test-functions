"use client";

/**
 * VoidCloneButton — the void-and-clone flow on a COMPLETED run (design spec
 * addendum §2). A deliberately heavy destructive affordance that stands alone
 * below the LockBanner. Composes the Dialog primitives directly (ConfirmDialog
 * has no input slot) with the same visual language, adds the REQUIRED reason
 * field (Confirm disabled until non-empty), and dispatches the existing
 * voidPayrollRunAction — the Pattern S dance runs server-side. On success it
 * navigates to the clone (the period route's default run is now the new open
 * copy).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileX } from "lucide-react";
import { voidPayrollRunAction } from "@/actions/payroll";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function VoidCloneButton({ runId, period }: { runId: string; period: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (pending && !next) return;
    setOpen(next);
    if (next) {
      setReason("");
      setErr(null);
    }
  }

  function confirm() {
    setErr(null);
    start(async () => {
      const fd = new FormData();
      fd.set("run_id", runId);
      fd.set("reason", reason.trim());
      const res = await voidPayrollRunAction(null, fd);
      if (res.ok) {
        setOpen(false);
        // The clone shares the period, and the period route defaults to the
        // non-voided run — navigating to the period IS navigating to the clone.
        router.push(`/payroll/runs/${period}`);
        router.refresh();
      } else {
        setErr(res.message);
      }
    });
  }

  return (
    <>
      <Button type="button" variant="destructive" onClick={() => handleOpenChange(true)}>
        <FileX aria-hidden="true" />
        Void &amp; clone this run
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg shadow-lg" showCloseButton={false}>
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
                <AlertTriangle className="size-5 text-amber-800" aria-hidden="true" />
              </div>
              <DialogTitle>Void this completed payroll and start a fresh copy?</DialogTitle>
            </div>
            <DialogDescription>
              Voiding keeps this run as a permanent record marked{" "}
              <span className="font-semibold text-foreground">Voided</span>, then creates a new open
              copy you can re-enter and complete again. Use this only to correct a payroll that was
              already marked complete. Everyone on the void-alert list is emailed.
            </DialogDescription>
          </DialogHeader>

          <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Why are you voiding it? (required)
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-label="Void reason"
              rows={3}
              disabled={pending}
              placeholder="e.g. Week 2 clock hours were wrong for two technicians"
              className="mt-0.5 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Saved on the record and included in the alert email.
          </p>

          {err && <p className="text-sm text-red-700 dark:text-red-400">{err}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={pending}
              loadingText="Voiding…"
              disabled={pending || reason.trim().length === 0}
              onClick={confirm}
            >
              Void &amp; clone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
