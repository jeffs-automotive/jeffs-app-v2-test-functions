"use client";

/**
 * IssueDetailDialog (admin / service-advisor) — the full record for one queue item, opened
 * by clicking its row. Everything is READ-ONLY except the advisor's own fix notes: the SA
 * sees the complete office-manager note (untruncated), all the bill facts, and the
 * parts-invoice image, and can only add/submit their fix. Controlled by the row.
 */
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { BackOfficeStatusBadge, ChangeTypeBadge, IssueKindBadge } from "@/components/back-office/status";
import { ViewAttachmentButton } from "@/components/back-office/ViewAttachmentButton";
import { submitFixAction } from "@/actions/back-office/submit-fix";
import type { SaQueueIssue } from "@/lib/back-office";

function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function reference(i: SaQueueIssue): string {
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
  showSubmit,
  open,
  onOpenChange,
}: {
  issue: SaQueueIssue;
  showSubmit: boolean;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(submitFixAction, null);
  const ctx = issue.context ?? {};

  useEffect(() => {
    if (state?.ok) {
      onOpenChange(false);
      router.refresh();
    }
  }, [state?.timestamp, state?.ok, router, onOpenChange]);

  const hasImage = issue.qboTxnId && (issue.qboTxnType === "Bill" || issue.qboTxnType === "Purchase");
  const od = ctx["original_posted_date"] as string | undefined;
  const nd = ctx["new_posted_date"] as string | undefined;
  const ot = ctx["original_total_cents"] as number | undefined;
  const nt = ctx["new_total_cents"] as number | undefined;

  return (
    <Dialog open={open} onOpenChange={(next) => (pending && !next ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {reference(issue)}
            <IssueKindBadge kind={issue.kind} />
          </DialogTitle>
          <DialogDescription>Everything the office sent over. You can only edit your fix notes.</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[max-content_1fr] items-baseline gap-x-4 gap-y-2">
          <Row label="Status"><BackOfficeStatusBadge status={issue.status} /></Row>
          {issue.vendorName && <Row label="Vendor">{issue.vendorName}</Row>}
          {issue.billNo && <Row label={issue.qboTxnType === "Purchase" ? "Expense #" : "Bill #"}>{issue.billNo}</Row>}
          {issue.billDate && <Row label="Bill date"><span className="tabular-nums">{issue.billDate}</span></Row>}
          {issue.totalCents !== null && <Row label="Amount"><span className="tabular-nums">{money(issue.totalCents)}</span></Row>}
          {issue.roNumber && <Row label="RO #"><span className="font-mono">{issue.roNumber}</span></Row>}
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
                    <span className="text-muted-foreground line-through">{money(ot ?? null)}</span>{" "}
                    <span className="font-semibold">{money(nt ?? null)}</span>
                  </span>
                </Row>
              )}
            </>
          )}
        </dl>

        <div className="rounded-md border border-border bg-muted/40 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Office manager note</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{issue.boNotes || "—"}</p>
        </div>

        {hasImage && (
          <div>
            <ViewAttachmentButton qboTxnType={issue.qboTxnType as string} qboTxnId={issue.qboTxnId as string} />
          </div>
        )}

        {showSubmit ? (
          <form action={action}>
            <input type="hidden" name="issue_id" value={issue.id} />
            <label className="block text-xs uppercase tracking-wide text-muted-foreground">Your fix notes</label>
            <textarea
              name="sa_note"
              rows={4}
              maxLength={4000}
              required
              placeholder="What did you fix?"
              className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {state?.ok === false && <p className="mt-2 text-xs text-red-700 dark:text-red-400">{state.message}</p>}
            <DialogFooter className="mt-3">
              <DialogClose render={<Button type="button" variant="ghost" />}>Close</DialogClose>
              <Button type="submit" size="sm" loading={pending} loadingText="Submitting…">
                <SendHorizontal aria-hidden="true" />
                Submit fix
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="rounded-md border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Your submitted fix</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{issue.saNotes || "—"}</p>
            <p className="mt-2 text-xs text-muted-foreground">Waiting on the office to verify.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
