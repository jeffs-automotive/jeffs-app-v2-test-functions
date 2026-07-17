"use client";

/**
 * SubmitFixDialog — the service advisor records what they fixed and submits it back to the
 * office manager to verify. Shows the office manager's note for context; drives
 * submitFixAction via useActionState and router.refresh()es the queue on success.
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
import { submitFixAction } from "@/actions/back-office/submit-fix";
import type { SaQueueIssue } from "@/lib/back-office";

function reference(i: SaQueueIssue): string {
  if (i.roNumber) return `RO #${i.roNumber}`;
  if (i.billNo) return `#${i.billNo}`;
  return i.title ?? "Issue";
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
    <Dialog open={open} onOpenChange={setOpen}>
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
