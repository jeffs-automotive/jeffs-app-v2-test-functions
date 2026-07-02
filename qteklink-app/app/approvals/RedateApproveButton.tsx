"use client";

/**
 * RedateApproveButton (admin-only, resolution-workflow Part A) — the escape hatch on
 * a late-payment card: "Post to this day anyway" lifts the redate hold; the normal
 * correction flow then stages the update (a deposit-locked day continues into the
 * Retry/Accept resolution). The HAPPY path needs no button at all — voiding +
 * re-dating the payment in Tekmetric clears the card automatically.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { approvePaymentRedateAction } from "@/actions/payment-redates";
import { Button } from "@/components/ui/button";

export default function RedateApproveButton({ redateId }: { redateId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function run() {
    setErr(null);
    start(async () => {
      const fd = new FormData();
      fd.set("id", redateId);
      const res = await approvePaymentRedateAction(null, fd);
      if (res.ok) router.refresh();
      else setErr(res.message);
      setConfirming(false);
    });
  }

  return (
    <div className="space-y-1">
      {!confirming ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setConfirming(true)}>
          <CalendarClock aria-hidden="true" />
          Post to this day anyway
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            This puts the payment back into the already-posted day (the update may need the deposit unlinked in QuickBooks).
          </span>
          <Button size="sm" loading={pending} loadingText="Saving…" disabled={pending} onClick={run}>Yes, post it to this day</Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setConfirming(false)}>Cancel</Button>
        </div>
      )}
      {err && <p className="text-sm text-red-700 dark:text-red-400">{err}</p>}
    </div>
  );
}
