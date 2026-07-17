"use client";

/**
 * SubmitFixDialog — the service advisor records what they fixed and submits it back to the
 * office manager to verify. Shows the office manager's note AND the issue facts (amount /
 * date, and for reopened ROs what changed) so the advisor can act without leaving the queue.
 * Drives submitFixAction via useActionState and router.refresh()es on success. The dialog
 * won't close mid-submit (so a failed action's inline error isn't lost).
 */
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { ChangeTypeBadge } from "@/components/back-office/status";
import { submitFixAction } from "@/actions/back-office/submit-fix";
import type { SaQueueIssue } from "@/lib/back-office";

function reference(i: SaQueueIssue): string {
  if (i.roNumber) return `RO #${i.roNumber}`;
  if (i.billNo) return `#${i.billNo}`;
  return i.title ?? "Issue";
}

function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function Facts({ issue }: { issue: SaQueueIssue }) {
  const ctx = issue.context ?? {};
  const rows: Array<[string, string]> = [];
  if (issue.vendorName) rows.push(["Vendor", issue.vendorName]);
  if (issue.billDate) rows.push(["Bill date", issue.billDate]);
  if (issue.totalCents !== null) rows.push(["Amount", money(issue.totalCents)]);
  if (issue.kind === "reopened_ro") {
    const od = ctx["original_posted_date"] as string | undefined;
    const nd = ctx["new_posted_date"] as string | undefined;
    if (od || nd) rows.push(["Posted date", `${od ?? "—"} → ${nd ?? "—"}`]);
    const ot = ctx["original_total_cents"] as number | undefined;
    const nt = ctx["new_total_cents"] as number | undefined;
    if (ot !== undefined || nt !== undefined) rows.push(["Total sales", `${money(ot ?? null)} → ${money(nt ?? null)}`]);
  }
  const changeType = issue.kind === "reopened_ro" ? ((ctx["change_type"] as string) ?? null) : null;
  if (rows.length === 0 && !changeType) return null;
  return (
    <div className="mt-3 rounded-md border border-border bg-muted/40 p-3">
      {changeType && <ChangeTypeBadge changeType={changeType} />}
      {rows.length > 0 && (
        <dl className={`grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs ${changeType ? "mt-2" : ""}`}>
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="tabular-nums text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function SubmitFixDialog({ issue }: { issue: SaQueueIssue }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(submitFixAction, null);

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      router.refresh();
    }
  }, [state?.timestamp, state?.ok, router]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending && !next) return; // don't close mid-submit — the error would be lost
        setOpen(next);
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <SendHorizontal aria-hidden="true" />
        Submit fix
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <input type="hidden" name="issue_id" value={issue.id} />
          <DialogHeader>
            <DialogTitle>Submit fix — {reference(issue)}</DialogTitle>
            <DialogDescription>
              {issue.boNotes ? `Office note: ${issue.boNotes}` : "Describe what you did to fix this."}
            </DialogDescription>
          </DialogHeader>
          <Facts issue={issue} />
          <textarea
            name="sa_note"
            rows={4}
            maxLength={4000}
            required
            placeholder="What did you fix?"
            className="mt-3 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {state?.ok === false && <p className="mt-2 text-xs text-red-700 dark:text-red-400">{state.message}</p>}
          <DialogFooter className="mt-3">
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" size="sm" loading={pending} loadingText="Submitting…">
              <SendHorizontal aria-hidden="true" />
              Submit fix
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
