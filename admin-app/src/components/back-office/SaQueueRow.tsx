"use client";

/**
 * SaQueueRow — one clickable queue row. Clicking (or Enter/Space) opens the full-detail
 * modal (IssueDetailDialog); the row itself is a compact, truncated summary. All actions
 * live in the modal, so the table stays scannable.
 */
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { BackOfficeStatusBadge, ChangeTypeBadge, IssueKindBadge } from "@/components/back-office/status";
import { IssueDetailDialog, reference } from "./IssueDetailDialog";
import type { SaQueueIssue } from "@/lib/back-office";

export function SaQueueRow({ issue, showSubmit }: { issue: SaQueueIssue; showSubmit: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TableRow
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "cursor-pointer hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
          showSubmit && "border-l-2 border-l-amber-400 dark:border-l-amber-500",
        )}
      >
        <TableCell><IssueKindBadge kind={issue.kind} /></TableCell>
        <TableCell className="font-mono text-xs tabular-nums">{reference(issue)}</TableCell>
        <TableCell className="text-sm">
          <div className="max-w-[20ch] truncate">{issue.vendorName ?? "—"}</div>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {issue.kind === "reopened_ro" ? (
            <ChangeTypeBadge changeType={(issue.context?.change_type as string) ?? null} />
          ) : (
            <div className="max-w-[36ch] truncate">{issue.boNotes ?? "—"}</div>
          )}
        </TableCell>
        <TableCell><BackOfficeStatusBadge status={issue.status} /></TableCell>
        <TableCell className="text-right">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            {showSubmit ? "Fix" : "View"}
            <ChevronRight aria-hidden="true" className="size-3.5" />
          </span>
        </TableCell>
      </TableRow>
      <IssueDetailDialog issue={issue} showSubmit={showSubmit} open={open} onOpenChange={setOpen} />
    </>
  );
}
