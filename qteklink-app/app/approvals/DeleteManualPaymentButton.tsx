"use client";

/**
 * DeleteManualPaymentButton (admin-only, resolution-workflow Part E) — the real
 * resolution for a manual_payment_conflict: a REAL payment arrived for the RO, so
 * the manual method-pick must be removed (otherwise the conflict re-spawns after
 * every reconcile, forever). The server refuses while the pick is part of a
 * posted/in-flight journal entry. Confirmation via the app's shared ConfirmDialog
 * (destructive variant) — never a bespoke prompt.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteManualPaymentAction } from "@/actions/payments";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export default function DeleteManualPaymentButton({ manualPaymentId }: { manualPaymentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function run() {
    setErr(null);
    start(async () => {
      const fd = new FormData();
      fd.set("id", manualPaymentId);
      const res = await deleteManualPaymentAction(null, fd);
      setOpen(false);
      if (res.ok) router.refresh();
      else setErr(res.message);
    });
  }

  return (
    <div className="space-y-1">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => setOpen(true)}>
        <Trash2 aria-hidden="true" />
        Delete the manual pick
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this manual payment pick?"
        body="A real payment arrived for this repair order, so the manual pick is no longer needed — the real payment posts on its own. This only removes the pick; nothing in QuickBooks changes."
        confirmLabel="Yes, delete it"
        confirmingLabel="Deleting…"
        variant="destructive"
        isPending={pending}
        onConfirm={run}
      />
      {err && <p className="text-sm text-red-700 dark:text-red-400">{err}</p>}
    </div>
  );
}
