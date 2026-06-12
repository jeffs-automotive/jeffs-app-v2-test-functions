"use client";

/**
 * ConfirmDialog — a styled confirmation modal that replaces window.confirm at
 * QTekLink's destructive-action call sites (Chris-approved, 2026-06-11). Matches
 * admin-app's Pattern A visual language: amber warning header, scope text, an
 * outline Cancel + a primary/destructive Confirm.
 *
 * CONFIRMATION SEMANTICS ARE UNCHANGED: this is purely the confirmation UI. The
 * caller owns the actual mutation — onConfirm() runs exactly what the old
 * `if (window.confirm(...)) { ...dispatch }` branch ran, and the body text
 * carries the same information window.confirm showed. While the action is
 * pending the dialog can't be dismissed (Esc / overlay / Cancel) — admin-app's
 * close-guard idiom `if (isPending && !next) return;`.
 */
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** The body — the same information window.confirm previously showed. */
  body: ReactNode;
  confirmLabel: string;
  /** Label shown on the confirm button while the action is pending. */
  confirmingLabel?: string;
  cancelLabel?: string;
  /** "destructive" for undo/turn-off style actions; "default" otherwise. */
  variant?: "default" | "destructive";
  isPending: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  confirmingLabel = "Working…",
  cancelLabel = "Cancel",
  variant = "default",
  isPending,
  onConfirm,
}: ConfirmDialogProps) {
  function handleOpenChange(next: boolean) {
    if (isPending && !next) return;
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg shadow-lg" showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
              <AlertTriangle className="size-5 text-amber-800" aria-hidden="true" />
            </div>
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription className="whitespace-pre-line">{body}</DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant}
            onClick={onConfirm}
            loading={isPending}
            loadingText={confirmingLabel}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
