"use client";

/**
 * Dashboard Disconnect button (admin-only) — runs the SOFT disconnect
 * (disconnectQboAction: best-effort Intuit revoke + tombstone the Vault tokens +
 * expire the connection; mappings/COA are kept). A ConfirmDialog gates it
 * (destructive-ish but reversible); on success it routes to /qbo/disconnected.
 */
import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Unplug } from "lucide-react";
import { disconnectQboAction } from "@/actions/connection";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export default function DisconnectQboButton() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(disconnectQboAction, null);
  const [, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (state?.ok) router.push("/qbo/disconnected");
  }, [state?.timestamp, state?.ok, router]);

  // Same dispatch the window.confirm branch ran (no form fields — the action reads
  // the session server-side) — only the confirm UI changed.
  function run() {
    setConfirmOpen(false);
    start(() => formAction(new FormData()));
  }

  return (
    <div>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={() => setConfirmOpen(true)}
        loading={pending}
        loadingText="Disconnecting…"
      >
        <Unplug aria-hidden="true" />
        Disconnect QuickBooks
      </Button>
      {state && !state.ok && (
        <span className="ml-2 text-xs text-red-700 dark:text-red-400">{state.message}</span>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        isPending={pending}
        variant="destructive"
        title="Disconnect QuickBooks?"
        body="Syncing pauses until you reconnect. Your account mappings are kept."
        confirmLabel="Disconnect QuickBooks"
        confirmingLabel="Disconnecting…"
        onConfirm={run}
      />
    </div>
  );
}
