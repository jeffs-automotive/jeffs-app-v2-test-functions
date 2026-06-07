"use client";

/**
 * Dashboard Disconnect button (admin-only) — runs the SOFT disconnect
 * (disconnectQboAction: best-effort Intuit revoke + tombstone the Vault tokens +
 * expire the connection; mappings/COA are kept). A window.confirm gates it
 * (destructive-ish but reversible); on success it routes to /qbo/disconnected.
 */
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { disconnectQboAction } from "@/actions/connection";

export default function DisconnectQboButton() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(disconnectQboAction, null);

  useEffect(() => {
    if (state?.ok) router.push("/qbo/disconnected");
  }, [state?.timestamp, state?.ok, router]);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            "Disconnect QuickBooks? Syncing pauses until you reconnect. Your account mappings are kept.",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        disabled={pending}
        className="text-sm font-medium text-red-700 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Disconnecting…" : "Disconnect QuickBooks"}
      </button>
      {state && !state.ok && (
        <span className="ml-2 text-xs text-red-700">{state.message}</span>
      )}
    </form>
  );
}
