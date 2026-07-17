"use client";

/**
 * IssueDetailDialog (office manager) — the full record for one issue, opened by clicking its
 * row. Shows every field in full (untruncated notes, the QBO facts, the reopened before→after
 * diff) plus the parts-invoice image and the row actions (Send to SA / Add note & re-send /
 * Verify). Controlled by the row.
 */
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { BackOfficeStatusBadge, StaleBadge, ChangeTypeBadge, IssueKindBadge } from "./status";
import { RowActions } from "./RowActions";
import { ViewAttachmentButton } from "./ViewAttachmentButton";
import { centsToUsd, isStale, daysSince } from "@/lib/back-office/format";
import type { BackOfficeIssue } from "@/lib/dal/back-office";
import type { VendorDocType } from "@/lib/qbo/vendor-docs";

export function issueRef(i: BackOfficeIssue): string {
  if (i.roNumber) return `RO #${i.roNumber}`;
  if (i.billNo) return `#${i.billNo}`;
  return i.title ?? "Issue";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </>
  );
}

export function IssueDetailDialog({
  issue,
  staleHours,
  open,
  onOpenChange,
}: {
  issue: BackOfficeIssue;
  staleHours: number;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const ctx = issue.context ?? {};
  const stale = isStale(issue.lastActivityAt, staleHours);
  const hasImage = issue.qboTxnId && (issue.qboTxnType === "Bill" || issue.qboTxnType === "Purchase");
  const isInvoice = issue.kind === "invoice_issue" || issue.kind === "open_ro";
  const od = ctx["original_posted_date"] as string | undefined;
  const nd = ctx["new_posted_date"] as string | undefined;
  const ot = ctx["original_total_cents"] as number | undefined;
  const nt = ctx["new_total_cents"] as number | undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {issueRef(issue)}
            <IssueKindBadge kind={issue.kind} />
          </DialogTitle>
          <DialogDescription>The full record for this item.</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[max-content_1fr] items-baseline gap-x-4 gap-y-2">
          <Row label="Status">
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <BackOfficeStatusBadge status={issue.status} />
              {stale && <StaleBadge days={Math.max(1, daysSince(issue.createdAt))} />}
            </span>
          </Row>
          {issue.title && <Row label="Title">{issue.title}</Row>}
          {isInvoice && issue.vendorName && <Row label="Vendor">{issue.vendorName}</Row>}
          {isInvoice && issue.billNo && (
            <Row label={issue.qboTxnType === "Purchase" ? "Expense #" : "Bill #"}>
              <span className="font-mono">{issue.billNo}</span>
            </Row>
          )}
          {issue.roNumber && <Row label="RO #"><span className="font-mono">{issue.roNumber}</span></Row>}
          {isInvoice && issue.billDate && <Row label="Bill date"><span className="tabular-nums">{issue.billDate}</span></Row>}
          {isInvoice && issue.totalCents !== null && <Row label="Amount"><span className="tabular-nums">{centsToUsd(issue.totalCents)}</span></Row>}
          {issue.kind === "open_ro" && (
            <Row label="RO state">{(ctx["ro_status"] as string) === "ro_closed" ? "Closed" : "Open"}</Row>
          )}
          {issue.kind === "reopened_ro" && (
            <>
              <Row label="What changed"><ChangeTypeBadge changeType={(ctx["change_type"] as string) ?? null} /></Row>
              {(od || nd) && (
                <Row label="Posted date">
                  <span className="tabular-nums">
                    <span className="text-muted-foreground line-through">{od ?? "—"}</span>{" "}
                    <span className="font-semibold">{nd ?? "—"}</span>
                  </span>
                </Row>
              )}
              {(ot !== undefined || nt !== undefined) && (
                <Row label="Total sales">
                  <span className="tabular-nums">
                    <span className="text-muted-foreground line-through">{centsToUsd(ot ?? null)}</span>{" "}
                    <span className="font-semibold">{centsToUsd(nt ?? null)}</span>
                  </span>
                </Row>
              )}
              {ctx["unposted_by"] ? <Row label="Unposted by">{String(ctx["unposted_by"])}</Row> : null}
            </>
          )}
        </dl>

        {issue.boNotes && (
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Back-office note</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{issue.boNotes}</p>
          </div>
        )}
        {issue.saNotes && (
          <div className="rounded-md border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Service-advisor fix</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{issue.saNotes}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          {hasImage ? (
            <ViewAttachmentButton qboTxnType={issue.qboTxnType as VendorDocType} qboTxnId={issue.qboTxnId as string} />
          ) : (
            <span />
          )}
          <RowActions issue={issue} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
