"use client";

/**
 * BlockDayDialog — soft-confirm modal for block_appointment_capacity.
 *
 * Per plan v0.5 §7. Single-row mutation, no dry-run / token / revert
 * (these are NOT Pattern S surfaces — that's only for MD upload paths).
 * Shows the date + optional reason input; on submit, dispatches the
 * blockAppointmentCapacityAction and surfaces the result via toast.
 *
 * Close-guard while pending — same pattern as keytag ConfirmationDialog.
 */
import { useActionState, useEffect, useState, startTransition } from "react";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  blockAppointmentCapacityAction,
  type BlockAppointmentCapacityState,
} from "@/actions/scheduler/block-appointment-capacity";
import { formatEasternDate } from "@/lib/format-time";

const initial: BlockAppointmentCapacityState = { kind: "idle" };

export interface BlockDayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** ISO YYYY-MM-DD. */
  date: string;
  /** Callback fired after a successful block — parent triggers a refresh. */
  onBlocked: () => void;
}

export function BlockDayDialog({
  open,
  onOpenChange,
  date,
  onBlocked,
}: BlockDayDialogProps) {
  const [state, dispatch, isPending] = useActionState(
    blockAppointmentCapacityAction,
    initial,
  );
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (state.kind === "success") {
      toast.success(`Day blocked — ${date}`, {
        description: reason
          ? `Reason: ${reason}`
          : "No reason recorded.",
      });
      setReason("");
      onBlocked();
      onOpenChange(false);
    }
    if (state.kind === "tool_error") {
      toast.error("Block failed", { description: state.data.message });
    }
    if (state.kind === "transport_error") {
      toast.error("Transport error", { description: state.message });
    }
    if (state.kind === "validation_error") {
      toast.error("Validation error", { description: state.message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function handleOpenChange(next: boolean) {
    if (isPending && !next) return;
    onOpenChange(next);
  }

  function handleConfirm() {
    const fd = new FormData();
    fd.set("date", date);
    if (reason.trim().length > 0) fd.set("reason", reason.trim());
    // Whole-day block (no type / time) per Phase 1 scope.
    startTransition(() => dispatch(fd));
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-4 w-4 text-destructive" aria-hidden="true" />
            Block whole day
          </DialogTitle>
          <DialogDescription>
            Blocks all appointment capacity on{" "}
            <span className="font-mono">{formatEasternDate(date)}</span>. Customers
            won&apos;t be able to book this day until you unblock it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="block-reason" className="text-xs uppercase tracking-wider text-muted-foreground">
              Reason (optional)
            </Label>
            <Input
              id="block-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isPending}
              placeholder="e.g. shop closed for inventory"
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">
              Recorded on the block row for audit purposes. Visible in the
              calendar strip.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            loading={isPending}
            loadingText="Blocking…"
            className="gap-1.5"
          >
            <Ban className="h-4 w-4" aria-hidden="true" />
            Block day
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
