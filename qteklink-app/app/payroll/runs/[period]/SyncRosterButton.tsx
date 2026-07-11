"use client";

/**
 * SyncRosterButton — admin affordance on an OPEN run: dispatches the existing
 * syncPayrollRosterAction (adds newly-active employees, removes entry-less rows
 * for archived ones) and reports the delta inline. Used on the data band and in
 * the empty-roster state.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { syncPayrollRosterAction } from "@/actions/payroll";
import { Button } from "@/components/ui/button";

export function SyncRosterButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function sync() {
    setMsg(null);
    start(async () => {
      const fd = new FormData();
      fd.set("run_id", runId);
      const res = await syncPayrollRosterAction(null, fd);
      if (res.ok) {
        setMsg({
          kind: "ok",
          text:
            res.data.added.length === 0 && res.data.removed.length === 0
              ? "Roster already up to date."
              : `${res.data.added.length} added · ${res.data.removed.length} removed.`,
        });
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.message });
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" loading={pending} loadingText="Syncing…" onClick={sync}>
        <Users aria-hidden="true" />
        Sync roster
      </Button>
      {msg && (
        <span
          className={`text-xs ${msg.kind === "ok" ? "text-emerald-800 dark:text-emerald-300" : "text-red-700 dark:text-red-400"}`}
        >
          {msg.text}
        </span>
      )}
    </span>
  );
}
