"use client";

/**
 * "Mark as covered by Accounting Link" (admin-only) — records the day as approved
 * WITHOUT posting anything to QuickBooks (the old system already posted it).
 * Terminal for the day, so it confirms first.
 */
import { useActionState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acknowledgeDayAction } from "@/actions/acknowledge-day";

export default function AcknowledgeDayButton({ date }: { date: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(acknowledgeDayAction, null);
  const [, start] = useTransition();

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.timestamp, state?.ok, router]);

  function confirmAndRun() {
    const ok = window.confirm(
      `Mark ${date} as covered by Accounting Link?\n\n` +
        `QTekLink will record this day as done WITHOUT posting anything to QuickBooks ` +
        `(the old system already posted it). This can't be undone.`,
    );
    if (!ok) return;
    const fd = new FormData();
    fd.set("date", date);
    start(() => action(fd));
  }

  return (
    <span>
      <button onClick={confirmAndRun} disabled={pending}
        className="rounded border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60">
        {pending ? "Marking…" : "Mark as covered by Accounting Link"}
      </button>
      {state?.ok === false && <span className="ml-2 text-xs text-red-700">{state.message}</span>}
    </span>
  );
}
