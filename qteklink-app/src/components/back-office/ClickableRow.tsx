"use client";

/**
 * ClickableRow — makes an issue table row open the full-detail modal (IssueDetailDialog) on
 * click / Enter / Space. The row's summary cells are passed as children (rendered by the
 * server table); this thin client wrapper only adds the interaction + the dialog.
 */
import { useState } from "react";
import { TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { IssueDetailDialog } from "./IssueDetailDialog";
import type { BackOfficeIssue } from "@/lib/dal/back-office";

export function ClickableRow({
  issue,
  staleHours,
  rowClassName,
  children,
}: {
  issue: BackOfficeIssue;
  staleHours: number;
  rowClassName?: string;
  children: React.ReactNode;
}) {
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
          rowClassName,
        )}
      >
        {children}
      </TableRow>
      <IssueDetailDialog issue={issue} staleHours={staleHours} open={open} onOpenChange={setOpen} />
    </>
  );
}
