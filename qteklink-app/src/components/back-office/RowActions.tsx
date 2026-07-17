"use client";

/**
 * RowActions — the office manager's per-issue controls: Send to SA / Add note & re-send
 * (a note dialog) and Verify & close (a confirm dialog). Both drive their server action via
 * useActionState and router.refresh() the list on success. Send is only offered from a
 * from-state the machine accepts (open / awaiting_verify).
 */
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, MessageSquarePlus, SendHorizontal } from "lucide-react";
import { sendToSaAction, verifyIssueAction } from "@/actions/back-office/issues";
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
import type { BackOfficeIssue } from "@/lib/dal/back-office";

export function RowActions({ issue }: { issue: BackOfficeIssue }) {
  const router = useRouter();
  const [sendOpen, setSendOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [sendState, sendAction, sendPending] = useActionState(sendToSaAction, null);
  const [verifyState, verifyAction, verifyPending] = useActionState(verifyIssueAction, null);

  useEffect(() => {
    if (sendState?.ok) {
      setSendOpen(false);
      router.refresh();
    }
  }, [sendState?.timestamp, sendState?.ok, router]);
  useEffect(() => {
    if (verifyState?.ok) {
      setVerifyOpen(false);
      router.refresh();
    }
  }, [verifyState?.timestamp, verifyState?.ok, router]);

  const canSend = issue.status === "open" || issue.status === "awaiting_verify";
  const resend = issue.status === "awaiting_verify";
  const sendLabel = resend ? "Add note & re-send" : "Send to SA";
  const SendIcon = resend ? MessageSquarePlus : SendHorizontal;

  // Decision #12: an open-RO issue can only be verified once the RO has actually closed
  // (the ro-watch cron flips context.ro_status). The RPC enforces this too.
  const roStatus = typeof issue.context?.ro_status === "string" ? issue.context.ro_status : "ro_open";
  const verifyBlocked = issue.kind === "open_ro" && roStatus !== "ro_closed";

  return (
    <div className="flex items-center justify-end gap-2">
      {canSend && (
        <Dialog open={sendOpen} onOpenChange={setSendOpen}>
          <DialogTrigger render={<Button size="sm" variant="outline" />}>
            <SendIcon aria-hidden="true" />
            {sendLabel}
          </DialogTrigger>
          <DialogContent>
            <form action={sendAction}>
              <input type="hidden" name="issue_id" value={issue.id} />
              <DialogHeader>
                <DialogTitle>{sendLabel}</DialogTitle>
                <DialogDescription>
                  Add a note for the service advisor. They&apos;ll get an email and see it in their queue.
                </DialogDescription>
              </DialogHeader>
              <textarea
                name="note"
                maxLength={4000}
                rows={4}
                placeholder="What needs fixing?"
                className="mt-3 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                defaultValue={issue.status === "awaiting_verify" ? "" : issue.boNotes ?? ""}
              />
              {sendState?.ok === false && (
                <p className="mt-2 text-xs text-red-700 dark:text-red-400">{sendState.message}</p>
              )}
              <DialogFooter className="mt-3">
                <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
                <Button type="submit" size="sm" loading={sendPending} loadingText="Sending…">
                  <SendIcon aria-hidden="true" />
                  {sendLabel}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {verifyBlocked ? (
        <Button size="sm" disabled title="You can verify once the repair order has closed.">
          <CheckCircle2 aria-hidden="true" />
          Verify
        </Button>
      ) : (
        <Dialog open={verifyOpen} onOpenChange={setVerifyOpen}>
        <DialogTrigger render={<Button size="sm" />}>
          <CheckCircle2 aria-hidden="true" />
          Verify
        </DialogTrigger>
        <DialogContent>
          <form action={verifyAction}>
            <input type="hidden" name="issue_id" value={issue.id} />
            <DialogHeader>
              <DialogTitle>Verify &amp; close?</DialogTitle>
              <DialogDescription>
                This marks the issue resolved and removes it from the list. Everyone gets a confirmation email.
              </DialogDescription>
            </DialogHeader>
            {verifyState?.ok === false && (
              <p className="mt-2 text-xs text-red-700 dark:text-red-400">{verifyState.message}</p>
            )}
            <DialogFooter className="mt-3">
              <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
              <Button type="submit" size="sm" loading={verifyPending} loadingText="Verifying…">
                <CheckCircle2 aria-hidden="true" />
                Verify
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
