"use client";

/**
 * "Mark as covered by Accounting Link" (admin-only) — records the day as approved
 * WITHOUT posting anything to QuickBooks (the old system already posted it).
 * Terminal for the day, so it confirms first.
 */
import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { acknowledgeDayAction } from "@/actions/acknowledge-day";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export default function AcknowledgeDayButton({ date }: { date: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(acknowledgeDayAction, null);
  const [, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.timestamp, state?.ok, router]);

  // Same wiring the window.confirm branch ran — only the confirm UI changed.
  function run() {
    setConfirmOpen(false);
    const fd = new FormData();
    fd.set("date", date);
    start(() => action(fd));
  }

  return (
    <span className="inline-flex items-center">
      <Button variant="outline" onClick={() => setConfirmOpen(true)} loading={pending} loadingText="Marking…">
        <CheckCheck aria-hidden="true" />
        Mark as covered by Accounting Link
      </Button>
      {state?.ok === false && <span className="ml-2 text-xs text-red-700 dark:text-red-400">{state.message}</span>}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        isPending={pending}
        title={`Mark ${date} as covered by Accounting Link?`}
        body={`QTekLink will record this day as done WITHOUT posting anything to QuickBooks (the old system already posted it). This can't be undone.`}
        confirmLabel="Mark as covered"
        confirmingLabel="Marking…"
        onConfirm={run}
      />
    </span>
  );
}
