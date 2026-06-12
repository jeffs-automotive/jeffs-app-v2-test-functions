"use client";

/**
 * "Refresh COA" button (C1). Drives refreshCoaAction via React 19
 * useActionState, shows the result inline (the action's `timestamp` field
 * makes each result a fresh object), and router.refresh()es on success so the
 * server-rendered "N accounts mirrored · last synced …" status line updates.
 */
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { refreshCoaAction } from "@/actions/coa";
import { Button } from "@/components/ui/button";

export default function RefreshCoaButton() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(refreshCoaAction, null);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.timestamp, state?.ok, router]);

  return (
    <div>
      <form action={formAction}>
        <Button type="submit" loading={pending} loadingText="Refreshing…">
          <RefreshCw aria-hidden="true" />
          Refresh chart of accounts
        </Button>
      </form>

      {state?.ok && (
        <p className="mt-3 text-sm text-emerald-800 dark:text-emerald-300">
          Synced {state.data.synced} account{state.data.synced === 1 ? "" : "s"} from
          QuickBooks.
        </p>
      )}
      {state && !state.ok && (
        <p className="mt-3 text-sm text-red-700 dark:text-red-400">
          {state.reason === "reconnect_required"
            ? "QuickBooks needs to be reconnected before the chart of accounts can sync."
            : state.message}
        </p>
      )}
    </div>
  );
}
