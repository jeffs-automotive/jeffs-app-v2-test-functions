"use client";

/**
 * RevertConfirmDialog — Pattern S two-step revert modal.
 *
 * Per plan v0.5 §4 "Revert lost-update warning" — shows newer uploads to
 * the same surface that will ALSO be undone by this revert. Closes GPT v0.4
 * BLOCKER + Gemini IMP (revert wipes subsequent legitimate changes).
 *
 * Two-step flow:
 *   1. User clicks Revert in <RecentUploadsList>
 *      → parent opens this dialog with `targetRow` + `newerUploads`
 *   2. Dialog shows lost-update warning + dispatches dry_run on mount
 *      via a `useEffect` triggered by parent (or parent calls onDryRun)
 *   3. Dry-run returns `kind: "needs_confirmation"` → Apply button enables
 *   4. User clicks Apply → onConfirm() dispatches dry_run=false with the
 *      confirm_token
 *
 * State is owned by the parent (via `useActionState`); this component is
 * purely presentational.
 */
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatEasternLong } from "@/lib/format-time";
import type {
  AuditLogEntry,
  SchedulerRevertConfirmation,
  RevertReasonCode,
} from "@/lib/scheduler/types";

export interface RevertConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The audit row the user is reverting. */
  targetRow: AuditLogEntry;
  /** Newer uploads to the same surface that will ALSO be undone (plan §4
   * lost-update warning). Pass `[]` if none. */
  newerUploads: AuditLogEntry[];
  surfaceLabel: string;
  /** Current dispatch state — drives the body shape. */
  phase:
    | { kind: "idle" }
    | { kind: "preview-pending" }
    | { kind: "needs_confirmation"; confirmation: SchedulerRevertConfirmation }
    | { kind: "apply-pending" }
    | {
        kind: "rejected";
        message: string;
        reason_code: RevertReasonCode | null;
      };
  /** Fire to start the dry-run preview. */
  onPreview: () => void;
  /** Fire to apply with the dry-run's confirm_token. */
  onConfirm: () => void;
}

export function RevertConfirmDialog({
  open,
  onOpenChange,
  targetRow,
  newerUploads,
  surfaceLabel,
  phase,
  onPreview,
  onConfirm,
}: RevertConfirmDialogProps) {
  const isPending = phase.kind === "preview-pending" || phase.kind === "apply-pending";

  function handleOpenChange(next: boolean) {
    if (isPending && !next) return; // close-guard
    onOpenChange(next);
  }

  const targetWhenStr = formatEasternLong(targetRow.occurred_at);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Revert upload — {surfaceLabel}</DialogTitle>
          <DialogDescription>
            Audit row #{targetRow.id} by{" "}
            <span className="font-mono">{targetRow.user_label ?? "unknown"}</span> at{" "}
            {targetWhenStr}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Lost-update warning banner — plan v0.5 §4 */}
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-amber-900">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              {newerUploads.length === 0
                ? "Revert restores prior state"
                : `Revert may wipe ${newerUploads.length} newer upload${newerUploads.length === 1 ? "" : "s"}`}
            </div>
            <p className="text-xs text-amber-900">
              This will restore the catalog state to before upload #{targetRow.id}{" "}
              ({targetWhenStr}).
              {newerUploads.length === 0 ? (
                " No newer uploads to this surface — straightforward revert."
              ) : (
                <>
                  {" "}
                  The following newer uploads to <span className="font-mono">{surfaceLabel}</span>{" "}
                  will ALSO be undone:
                </>
              )}
            </p>
            {newerUploads.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-amber-900">
                {newerUploads.map((r) => (
                  <li key={r.id}>
                    <span className="font-mono">#{r.id}</span> · {formatEasternLong(r.occurred_at)} ·{" "}
                    {r.user_label ?? "unknown"} · +{r.rows_added} mod {r.rows_modified} deact {r.rows_deactivated}{" "}
                    <span className="font-medium">(will be undone)</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Phase-specific body */}
          {phase.kind === "idle" && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              Click <strong>Preview revert</strong> to see what would change.
            </div>
          )}
          {phase.kind === "preview-pending" && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              Computing revert plan…
            </div>
          )}
          {phase.kind === "needs_confirmation" && (
            <div className="rounded-md border border-border bg-background p-3">
              <div className="mb-2 text-sm font-medium">Revert plan</div>
              <ul className="space-y-1 text-sm">
                <li>
                  <strong>Restore</strong> {phase.confirmation.restored} row
                  {phase.confirmation.restored === 1 ? "" : "s"} to prior state
                </li>
                <li>
                  <strong>Deactivate</strong> {phase.confirmation.deactivated} row
                  {phase.confirmation.deactivated === 1 ? "" : "s"} added by this upload
                </li>
                <li>
                  <strong>Delete</strong> {phase.confirmation.deleted} row
                  {phase.confirmation.deleted === 1 ? "" : "s"} (hard-delete; no soft-delete column)
                </li>
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Attempt #{phase.confirmation.attempt_id ?? "?"} · Token:{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                  {phase.confirmation.confirm_token.slice(0, 16)}…
                </code>
              </p>
            </div>
          )}
          {phase.kind === "apply-pending" && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              Applying revert…
            </div>
          )}
          {phase.kind === "rejected" && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-sm font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                Cannot revert
                {phase.reason_code ? ` — ${phase.reason_code}` : ""}
              </div>
              <p className="text-xs text-foreground">{phase.message}</p>
              {phase.reason_code === "current_state_drift" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  State changed since this upload. Click <strong>Preview revert</strong> again to
                  see the fresh diff.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          {phase.kind === "needs_confirmation" ? (
            <Button
              type="button"
              variant="destructive"
              onClick={onConfirm}
              loading={phase.kind !== "needs_confirmation" ? isPending : false}
              loadingText="Reverting…"
              disabled={isPending}
              className="gap-1.5"
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Apply revert
            </Button>
          ) : (
            <Button
              type="button"
              variant="default"
              onClick={onPreview}
              loading={phase.kind === "preview-pending"}
              loadingText="Loading…"
              disabled={isPending}
            >
              Preview revert
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
