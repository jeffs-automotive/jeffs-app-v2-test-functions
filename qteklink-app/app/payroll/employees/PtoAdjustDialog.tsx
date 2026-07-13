"use client";

/**
 * PtoAdjustDialog — the roster's "Adjust" affordance (plan §6 / spec §1c).
 * Composes the Dialog primitives directly (like OverrideEditor) because it needs
 * inputs + a live resulting-balance preview, so it is NOT a ConfirmDialog.
 *
 * Two write paths, one modal:
 *   - Adjust (default): signed hours + a REQUIRED reason → adjustPtoAction
 *     (kind='adjustment'; the RPC + DB CHECK re-enforce the non-zero + reason).
 *   - Seed initial balance: when the employee has NO ledger rows yet, the same
 *     hours field seeds the starting balance → seedInitialBalanceAction
 *     (kind='initial'; reason optional). §8.6 seeding is a manual entry, never a
 *     pay_config migration.
 *
 * DESIGN-AND-WIRING ONLY: the client parse is preview UX; the RPCs are the source
 * of truth. On success → router.refresh() + close (the EmployeeManager pattern).
 */
import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Scale } from "lucide-react";
import { adjustPtoAction, seedInitialBalanceAction } from "@/actions/payroll-pto";
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
import { DeficitNotice, PtoBalance, fmtHours, fmtSignedHours } from "../payroll-ui";

const labelCls = "block text-xs font-medium uppercase tracking-wide text-muted-foreground";

/** Parse the signed-hours input to a finite 2dp number, or null (blank/NaN). */
function parseHours(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

export default function PtoAdjustDialog({
  employeeId,
  employeeName,
  currentBalanceHours,
  /** No ledger rows yet ⇒ the first entry SEEDS the balance (kind='initial'). */
  needsSeed = false,
  disabled = false,
}: {
  employeeId: string;
  employeeName: string;
  currentBalanceHours: number;
  needsSeed?: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState("");
  const [reason, setReason] = useState("");

  const action = needsSeed ? seedInitialBalanceAction : adjustPtoAction;
  const [state, dispatch, pending] = useActionState(action, null);

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      setOpen(false);
      setHours("");
      setReason("");
    }
  }, [state?.timestamp, state?.ok, router]);

  const delta = parseHours(hours);
  const hasValidDelta = delta !== null && delta !== 0;
  // Seed sets the balance to the entered value; an adjustment moves it by delta.
  const resultBalance = delta === null ? null : needsSeed ? delta : currentBalanceHours + delta;
  // A reason is required for an adjustment (client UX guard); optional for a seed.
  const reasonOk = needsSeed || reason.trim().length > 0;
  const canSave = hasValidDelta && reasonOk && !pending;

  function handleOpenChange(next: boolean) {
    if (pending && !next) return;
    setOpen(next);
  }

  function save() {
    if (!canSave || delta === null) return;
    const fd = new FormData();
    fd.set("employee_id", employeeId);
    fd.set("hours", String(delta));
    const trimmedReason = reason.trim();
    if (trimmedReason.length > 0) fd.set("reason", trimmedReason);
    start(() => dispatch(fd));
  }

  const title = needsSeed
    ? `Set ${employeeName}'s starting PTO balance`
    : `Adjust ${employeeName}'s PTO balance`;
  const description = needsSeed
    ? "This is the first entry, so it sets the starting balance. It's saved to the PTO activity log."
    : "Add or subtract hours. The reason is saved to the PTO activity log.";

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={disabled || pending}>
        <Scale aria-hidden="true" />
        {needsSeed ? "Set balance" : "Adjust"}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md shadow-lg" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Current: <PtoBalance hours={currentBalanceHours} />
            </p>

            <label className={labelCls}>
              {needsSeed ? "Starting balance (hours)" : "Change (hours, + adds / − subtracts)"}
              <Input
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                inputMode="decimal"
                className="mt-0.5 text-right tabular-nums"
                aria-label={needsSeed ? "Starting balance in hours" : "Adjustment in hours"}
                placeholder="0.00"
              />
            </label>

            <label className={labelCls}>
              {needsSeed ? "Reason (optional)" : "Reason (required)"}
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-0.5"
                aria-label={needsSeed ? "Starting balance reason" : "Adjustment reason"}
                placeholder="e.g. Starting balance as of last pay period"
              />
            </label>

            {resultBalance !== null && (
              <div className="space-y-2">
                <p className="text-sm text-foreground">
                  {needsSeed ? (
                    <>
                      Starting balance <PtoBalance hours={resultBalance} />
                    </>
                  ) : (
                    <>
                      Change {fmtSignedHours(delta ?? 0)} → New balance{" "}
                      <PtoBalance hours={resultBalance} />
                    </>
                  )}
                </p>
                {resultBalance < 0 && (
                  <DeficitNotice>
                    This leaves {employeeName} with a {fmtHours(Math.abs(resultBalance))}-hour
                    deficit. Negative balances are allowed.
                  </DeficitNotice>
                )}
              </div>
            )}

            {state?.ok === false && (
              <p className="text-sm text-red-700 dark:text-red-400">{state.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              loading={pending}
              loadingText="Saving…"
              disabled={!canSave}
              onClick={save}
            >
              {needsSeed ? "Save balance" : "Save adjustment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
