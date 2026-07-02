"use client";

/**
 * RedateApproveButton (admin-only, resolution-workflow Part A) — the escape hatch on
 * a late-payment card: "Post to this day anyway" lifts the redate hold; the normal
 * correction flow then stages the update (a deposit-locked day continues into the
 * Retry/Accept resolution). The HAPPY path needs no button at all — voiding +
 * re-dating the payment in Tekmetric clears the card automatically. Confirmation via
 * the app's shared ConfirmDialog (Chris-approved 2026-06-11) — never a bespoke prompt.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { approvePaymentRedateAction } from "@/actions/payment-redates";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export default function RedateApproveButton({ redateId }: { redateId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function run() {
    setErr(null);
    start(async () => {
      const fd = new FormData();
      fd.set("id", redateId);
      const res = await approvePaymentRedateAction(null, fd);
      setOpen(false);
      if (res.ok) router.refresh();
      else setErr(res.message);
    });
  }

  return (
    <div className="space-y-1">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => setOpen(true)}>
        <CalendarClock aria-hidden="true" />
        Post to this day anyway
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Post this payment to the already-posted day?"
        body="This puts the payment back into the posted day's journal entry. If that day's money is already deposited in QuickBooks, the update will need the deposit unlinked first — the normal fix is still to void + re-date the payment in Tekmetric."
        confirmLabel="Yes, post it to this day"
        confirmingLabel="Saving…"
        isPending={pending}
        onConfirm={run}
      />
      {err && <p className="text-sm text-red-700 dark:text-red-400">{err}</p>}
    </div>
  );
}
