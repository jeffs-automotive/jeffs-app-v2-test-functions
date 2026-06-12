"use client";

/**
 * ConfirmationDialog — shared modal for Pattern A two-step confirmation.
 *
 * Opens when a Server Action returns `kind: "needs_confirmation"`.
 * Shows the orchestrator's `scope_summary` so the actor sees exactly
 * what's about to happen, plus a countdown to the 5-minute token expiry.
 *
 * On Confirm: caller invokes `onConfirm()` which (typically) reuses the
 * same form's dispatch + adds the hidden `confirmation_token` field.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scopeSummary: string;
  expiresAt: string;
  actionLabel: string;
  /** Use "destructive" for release/revert; "default" for assign/post. */
  variant?: "default" | "destructive";
  isPending: boolean;
  onConfirm: () => void;
}

function useCountdown(expiresAt: string): number {
  const expiresMs = new Date(expiresAt).getTime();
  const [now, setNow] = useState(() => Date.now());

  // Reset on expiresAt change — fragile if hook is reused with a
  // dynamic expiry. Today the dialog remounts per new confirmation so
  // this matters less, but a brittle empty-deps array is easy to fix.
  // (Gemini cross-verify 2026-05-25.)
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  return Math.max(0, Math.ceil((expiresMs - now) / 1000));
}

export function ConfirmationDialog({
  open,
  onOpenChange,
  scopeSummary,
  expiresAt,
  actionLabel,
  variant = "default",
  isPending,
  onConfirm,
}: ConfirmationDialogProps) {
  const secondsLeft = useCountdown(expiresAt);
  const expired = secondsLeft <= 0;

  // Guard against Escape / outside-click closing the dialog while the
  // orchestrator is mid-Pattern-A round-trip. Buttons are disabled but
  // Dialog default close affordances aren't blocked otherwise.
  // (GPT cross-verify finding 2026-05-25.)
  function handleOpenChange(next: boolean) {
    if (isPending && !next) return;
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full border border-amber-300 bg-amber-50 sm:mx-0">
            <AlertTriangle className="h-5 w-5 text-amber-900" aria-hidden="true" />
          </div>
          <DialogTitle className="text-center sm:text-left">
            Confirm: {actionLabel}
          </DialogTitle>
          <DialogDescription className="text-center sm:text-left">
            Double-check the details below before applying.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-border bg-muted/50 p-3">
            <p className="text-sm leading-relaxed text-foreground">{scopeSummary}</p>
          </div>

          <div
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs",
              expired
                ? "border-destructive/30 bg-destructive/5 text-destructive"
                : "border-border bg-background text-muted-foreground",
            )}
          >
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {expired ? (
              <span>This confirmation has expired. Re-submit the form to get a fresh one.</span>
            ) : (
              <span>
                Expires in <span className="font-mono font-medium tabular-nums text-foreground">{secondsLeft}s</span>
              </span>
            )}
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
            variant={variant === "destructive" ? "destructive" : "default"}
            onClick={onConfirm}
            loading={isPending}
            loadingText="Applying…"
            disabled={expired}
            className="gap-1.5"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Confirm {actionLabel.toLowerCase()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
