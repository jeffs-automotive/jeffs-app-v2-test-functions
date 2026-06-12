"use client";

/**
 * RecentUploadsList — per-surface audit-log table with Revert button per row.
 *
 * Consumed by `<CatalogEditorTab>`. Renders `AuditLogEntry[]` from
 * `list_scheduler_admin_audit_log` (fetched at the parent layer — Server
 * Component or via the listRecentUploadsAction). On Revert click, opens
 * `<RevertConfirmDialog>` with the target row + computed newer-uploads list
 * (filtered to rows where `occurred_at > target.occurred_at`).
 *
 * Revert button enabled/disabled per `revert_eligibility.is_revertable`.
 * UI hint only — edge enforces authoritatively per plan v0.5 §4.
 */
import { useActionState, useEffect, useState, startTransition } from "react";
import { toast } from "sonner";
import { History, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { revertMdUploadAction } from "@/actions/scheduler/revert-md-upload";
import { formatEastern } from "@/lib/format-time";
import type {
  AuditLogEntry,
  SchedulerRevertState,
  SchedulerAdminSurface,
} from "@/lib/scheduler/types";
import { RevertConfirmDialog } from "./RevertConfirmDialog";

const initialRevert: SchedulerRevertState = { kind: "idle" };

export interface RecentUploadsListProps {
  rows: AuditLogEntry[];
  surface: SchedulerAdminSurface;
  surfaceLabel: string;
}

export function RecentUploadsList({ rows, surface, surfaceLabel }: RecentUploadsListProps) {
  const [revertState, dispatchRevert, isRevertPending] = useActionState(
    revertMdUploadAction,
    initialRevert,
  );
  const [openDialogFor, setOpenDialogFor] = useState<number | null>(null);

  // Open dialog when user clicks a Revert row button.
  function handleRevertClick(rowId: number) {
    setOpenDialogFor(rowId);
  }

  // Fire dry-run preview from dialog.
  function handlePreview(rowId: number) {
    const fd = new FormData();
    fd.set("upload_id", String(rowId));
    fd.set("dry_run", "true");
    startTransition(() => dispatchRevert(fd));
  }

  // Fire apply with the dry-run's confirm_token.
  function handleConfirm(rowId: number) {
    if (revertState.kind !== "needs_confirmation") return;
    const fd = new FormData();
    fd.set("upload_id", String(rowId));
    fd.set("dry_run", "false");
    fd.set("expected_confirm_token", revertState.confirmation.confirm_token);
    startTransition(() => dispatchRevert(fd));
  }

  // React to terminal states with toasts + dialog close.
  useEffect(() => {
    if (revertState.kind === "success") {
      toast.success(`Reverted upload`, {
        description: `Restored ${revertState.data.restored}, deactivated ${revertState.data.deactivated}, deleted ${revertState.data.deleted}. New audit row #${revertState.data.audit_log_id}.`,
      });
      setOpenDialogFor(null);
    }
    if (revertState.kind === "tool_error") {
      toast.error(`Revert failed${revertState.data.reason_code ? ` — ${revertState.data.reason_code}` : ""}`, {
        description: revertState.data.message,
      });
      // Keep dialog open for `current_state_drift` so user can re-preview.
      if (revertState.data.reason_code !== "current_state_drift") {
        setOpenDialogFor(null);
      }
    }
    if (revertState.kind === "transport_error") {
      toast.error("Transport error", { description: revertState.message });
      setOpenDialogFor(null);
    }
  }, [revertState]);

  // Find newer uploads to this surface for the lost-update banner.
  const targetRow = openDialogFor !== null ? rows.find((r) => r.id === openDialogFor) : null;
  const newerUploads = targetRow
    ? rows.filter(
        (r) =>
          r.id !== targetRow.id &&
          new Date(r.occurred_at).getTime() > new Date(targetRow.occurred_at).getTime() &&
          r.error_message === null,
      )
    : [];

  // Map current dispatch state to the dialog's `phase` prop.
  type DialogPhase = Parameters<typeof RevertConfirmDialog>[0]["phase"];
  const dialogPhase: DialogPhase = (() => {
    if (revertState.kind === "needs_confirmation") {
      return { kind: "needs_confirmation", confirmation: revertState.confirmation };
    }
    if (revertState.kind === "tool_error") {
      return {
        kind: "rejected",
        message: revertState.data.message,
        reason_code: revertState.data.reason_code ?? null,
      };
    }
    if (isRevertPending) {
      // Distinguish preview-pending vs apply-pending by checking if we have a
      // prior dry-run confirmation in state.
      // For simplicity: if state was needs_confirmation before we dispatched,
      // this is apply-pending. Otherwise preview-pending.
      // Heuristic: revertState.kind === "idle" + isPending → preview-pending.
      // revertState.kind === "needs_confirmation" can't coexist with pending
      // because dispatch resets state. So the only way to tell is fresh: always
      // treat as preview-pending; the dialog shows "Applying revert…" body
      // only when phase.kind === 'apply-pending' which we never produce here.
      // Compromise: just use preview-pending — phrasing is "Computing revert plan…"
      // which works for both.
      return { kind: "preview-pending" };
    }
    return { kind: "idle" };
  })();

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center">
        <History className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">No recent uploads.</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          No recent uploads to {surfaceLabel}. Paste or upload an .md above to make a change.
        </p>
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[14ch]">When</TableHead>
            <TableHead>By</TableHead>
            <TableHead className="text-right">Δ</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-[14ch] text-right">Revert</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const isFailed = row.error_message !== null;
            const isRevert = row.operation === "revert_upload";
            const eligible = row.revert_eligibility.is_revertable;
            const wasReverted = row.successor_revert_id !== null;
            return (
              <TableRow key={row.id} className={isFailed ? "opacity-60" : undefined}>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatEastern(row.occurred_at)}
                </TableCell>
                <TableCell className="text-xs">{row.user_label ?? "—"}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">
                  +{row.rows_added} ~{row.rows_modified} −{row.rows_deactivated}
                </TableCell>
                <TableCell className="text-xs">
                  {isFailed ? (
                    <StatusBadge status="error">failed</StatusBadge>
                  ) : isRevert ? (
                    <StatusBadge status="info">revert</StatusBadge>
                  ) : wasReverted ? (
                    <StatusBadge status="warning">
                      reverted by #{row.successor_revert_id}
                    </StatusBadge>
                  ) : (
                    <StatusBadge status="ok">ok</StatusBadge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRevertClick(row.id)}
                    disabled={!eligible || isRevertPending}
                    title={
                      !eligible
                        ? `Not revertable: ${row.revert_eligibility.reasons.join(", ")}`
                        : "Open revert dialog"
                    }
                    className="gap-1"
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                    Revert
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {targetRow && (
        <RevertConfirmDialog
          open={openDialogFor !== null}
          onOpenChange={(next) => {
            if (!next) setOpenDialogFor(null);
          }}
          targetRow={targetRow}
          newerUploads={newerUploads}
          surfaceLabel={surfaceLabel}
          phase={dialogPhase}
          onPreview={() => handlePreview(targetRow.id)}
          onConfirm={() => handleConfirm(targetRow.id)}
        />
      )}

      <p className="mt-2 text-xs text-muted-foreground">
        Surface: <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{surface}</code>
        {" · "}30-day retention · revert is authoritative server-side
      </p>
    </>
  );
}
