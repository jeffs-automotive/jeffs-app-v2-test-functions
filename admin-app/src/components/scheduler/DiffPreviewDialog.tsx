"use client";

/**
 * DiffPreviewDialog — Pattern S two-step confirm modal for catalog uploads.
 *
 * Opens when a Server Action returns `kind: "needs_confirmation"`. Shows
 * row counts + per-row breakdown (collapsible) + soft warnings. On Apply,
 * caller invokes `onConfirm()` which re-dispatches the same form action
 * with `expected_confirm_token` + `dry_run: false`.
 *
 * Close-guard pattern copied from `keytag/ConfirmationDialog.tsx:72-75`
 * — dialog won't close mid-apply via Escape / outside-click.
 *
 * Per plan v0.5 §11 row 7 "pending-state guards beyond dialog": the Apply
 * button uses `disabled={pending}` to prevent double-click.
 */
import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type {
  SchedulerUploadConfirmation,
  UploadValidationWarning,
} from "@/lib/scheduler/types";

export interface DiffPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surfaceLabel: string;
  confirmation: SchedulerUploadConfirmation;
  isPending: boolean;
  onConfirm: () => void;
}

/**
 * Threshold for the "DEACTIVATIONS" callout per plan v0.5 §11 row 3.
 * Surfaces a 2nd-checkbox guard when >=10 rows or >=50% of changes are
 * deactivations.
 */
const DEACTIVATION_THRESHOLD_ABS = 10;
const DEACTIVATION_THRESHOLD_PCT = 0.5;

export function DiffPreviewDialog({
  open,
  onOpenChange,
  surfaceLabel,
  confirmation,
  isPending,
  onConfirm,
}: DiffPreviewDialogProps) {
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [deactivationAck, setDeactivationAck] = useState(false);

  const total =
    confirmation.rows_added +
    confirmation.rows_modified +
    confirmation.rows_deactivated;
  const deactivationPct = total > 0 ? confirmation.rows_deactivated / total : 0;
  const showDeactivationGuard =
    confirmation.rows_deactivated >= DEACTIVATION_THRESHOLD_ABS ||
    (total > 0 && deactivationPct >= DEACTIVATION_THRESHOLD_PCT);

  const warnings: UploadValidationWarning[] = confirmation.validation_warnings ?? [];

  function handleOpenChange(next: boolean) {
    if (isPending && !next) return; // mirror keytag close-guard
    onOpenChange(next);
  }

  const applyDisabled =
    isPending || (showDeactivationGuard && !deactivationAck);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Preview changes — {surfaceLabel}</DialogTitle>
          <DialogDescription>
            Review the diff below. The MD was not applied yet — clicking
            Apply will commit these changes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Row count summary */}
          <div className="grid grid-cols-3 gap-3">
            <SummaryStat label="Added" value={confirmation.rows_added} variant="success" />
            <SummaryStat label="Modified" value={confirmation.rows_modified} variant="default" />
            <SummaryStat
              label="Deactivated"
              value={confirmation.rows_deactivated}
              variant={showDeactivationGuard ? "destructive" : "default"}
            />
          </div>

          {/* Soft warnings (e.g. price moved >50%, ambiguous slug) */}
          {warnings.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-amber-900">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                {warnings.length} warning{warnings.length === 1 ? "" : "s"}
              </div>
              <ul className="space-y-1 text-xs text-amber-900">
                {warnings.map((w, i) => (
                  <li key={`${w.key}-${w.field}-${i}`}>
                    <span className="font-mono">{w.key}</span> · {w.field}: {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Deactivation guard — plan §11 row 3 */}
          {showDeactivationGuard && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                Many deactivations
              </div>
              <p className="mb-2 text-xs text-foreground">
                This upload would deactivate {confirmation.rows_deactivated} row
                {confirmation.rows_deactivated === 1 ? "" : "s"} ({Math.round(deactivationPct * 100)}% of the diff).
                Confirm you intended this.
              </p>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={deactivationAck}
                  onChange={(e) => setDeactivationAck(e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                I reviewed the deactivations and want to proceed.
              </label>
            </div>
          )}

          {/* Per-row breakdown (collapsible) — best-effort JSON dump */}
          {confirmation.diff_summary && (
            <div>
              <button
                type="button"
                onClick={() => setBreakdownOpen((v) => !v)}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {breakdownOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                {breakdownOpen ? "Hide" : "Show"} per-row breakdown
              </button>
              {breakdownOpen && (
                <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs">
                  {JSON.stringify(confirmation.diff_summary, null, 2)}
                </pre>
              )}
            </div>
          )}

          {/* Confirm token (for transparency / debugging) */}
          <p className="text-xs text-muted-foreground">
            Token: <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{confirmation.confirm_token.slice(0, 16)}…</code>
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={onConfirm}
            loading={isPending}
            loadingText="Applying…"
            disabled={applyDisabled}
            className="gap-1.5"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Apply changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryStat({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: "success" | "default" | "destructive";
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold">{value}</span>
        {value > 0 && variant !== "default" && (
          <Badge
            variant={variant === "success" ? "outline" : "destructive"}
            className={variant === "success" ? "border-green-300 bg-green-50 text-green-900" : ""}
          >
            {variant === "success" ? "+new" : "−out"}
          </Badge>
        )}
      </div>
    </div>
  );
}
