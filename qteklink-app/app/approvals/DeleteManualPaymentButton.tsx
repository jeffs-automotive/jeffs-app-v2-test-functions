"use client";

/**
 * DeleteManualPaymentButton (admin-only, resolution-workflow Part E) — the real
 * resolution for a manual_payment_conflict: a REAL payment arrived for the RO, so
 * the manual method-pick must be removed (otherwise the conflict re-spawns after
 * every reconcile, forever). The server refuses while the pick is part of a
 * posted/in-flight journal entry.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteManualPaymentAction } from "@/actions/payments";
import { Button } from "@/components/ui/button";

export default function DeleteManualPaymentButton({ manualPaymentId }: { manualPaymentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function run() {
    setErr(null);
    start(async () => {
      const fd = new FormData();
      fd.set("id", manualPaymentId);
      const res = await deleteManualPaymentAction(null, fd);
      if (res.ok) router.refresh();
      else setErr(res.message);
      setConfirming(false);
    });
  }

  return (
    <div className="space-y-1">
      {!confirming ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setConfirming(true)}>
          <Trash2 aria-hidden="true" />
          Delete the manual pick
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">The real payment posts on its own — the manual pick is no longer needed.</span>
          <Button size="sm" loading={pending} loadingText="Deleting…" disabled={pending} onClick={run}>Yes, delete it</Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setConfirming(false)}>Cancel</Button>
        </div>
      )}
      {err && <p className="text-sm text-red-700 dark:text-red-400">{err}</p>}
    </div>
  );
}
