"use client";

/**
 * ArchiveEmployeeDialog — the archive-with-termination-date modal (plan §6 /
 * spec §1d). Composes Dialog directly (it needs a date input) using the
 * ConfirmDialog VISUAL language — the amber-circle warning header — but with a
 * body field. Captures a termination_date (defaulting to today so the common
 * case is one click) and submits archiveEmployeeAction (ONE profile-RPC call:
 * p_patch {termination_date}, p_archived: true).
 *
 * Unarchive is NOT here — it stays a plain ConfirmDialog in EmployeeManager
 * (unarchiveEmployeeAction clears the termination date server-side).
 *
 * On success → router.refresh() + close (the roster re-partitions).
 */
import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { archiveEmployeeAction } from "@/actions/payroll-pto";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const labelCls = "block text-xs font-medium uppercase tracking-wide text-muted-foreground";

/** Today as a LOCAL-calendar YYYY-MM-DD (the date input's prefill). Built from local
 *  date parts, NOT `toISOString()` — that is UTC, so after ~8 PM Eastern it would
 *  prefill TOMORROW's date, and this value is submitted as the termination date that
 *  stops PTO accrual (the office manager's browser runs in the shop's timezone). */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ArchiveEmployeeDialog({
  open,
  onOpenChange,
  employeeId,
  employeeName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  employeeName: string;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [state, dispatch, pending] = useActionState(archiveEmployeeAction, null);
  const [terminationDate, setTerminationDate] = useState(todayIso);

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      onOpenChange(false);
    }
    // onOpenChange is stable enough for the roster's usage; key on the result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.timestamp, state?.ok, router]);

  function handleOpenChange(next: boolean) {
    if (pending && !next) return;
    onOpenChange(next);
  }

  function archive() {
    const fd = new FormData();
    fd.set("employee_id", employeeId);
    fd.set("termination_date", terminationDate);
    start(() => dispatch(fd));
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg shadow-lg" showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
              <AlertTriangle className="size-5 text-amber-800" aria-hidden="true" />
            </div>
            <DialogTitle>Archive {employeeName}?</DialogTitle>
          </div>
          <DialogDescription>
            Archived employees keep their history but stop appearing on new payroll runs. You can
            unarchive them any time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className={labelCls}>
            Termination date
            <Input
              type="date"
              value={terminationDate}
              onChange={(e) => setTerminationDate(e.target.value)}
              className="mt-0.5 w-44"
              aria-label="Termination date"
            />
            <span className="mt-0.5 block text-xs font-normal normal-case text-muted-foreground">
              Their last day — used to stop PTO accrual.
            </span>
          </label>
          {state?.ok === false && (
            <p className="text-sm text-red-700 dark:text-red-400">{state.message}</p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" loading={pending} loadingText="Archiving…" onClick={archive}>
            Archive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
