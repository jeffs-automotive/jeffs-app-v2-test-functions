"use client";

/**
 * Posting-queue row controls (admin-only): Approve the date change / Undo an
 * accidental approval / "Check again" (re-scan Tekmetric). Approve + Undo update
 * QuickBooks (they move the repair order between the two days' journal entries),
 * so both confirm with the user first.
 */
import { useActionState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveDateMoveAction, unapproveDateMoveAction, refreshDateMovesAction } from "@/actions/date-moves";

const btn = "rounded px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60";

export function ApproveMoveButton({ id, roNumber, fromDate, toDate }: { id: string; roNumber: string; fromDate: string; toDate: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(approveDateMoveAction, null);
  const [, start] = useTransition();

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.timestamp, state?.ok, router]);

  function confirmAndRun() {
    const ok = window.confirm(
      `Move RO ${roNumber} from ${fromDate} to ${toDate}?\n\n` +
        `QTekLink will take it out of ${fromDate}'s journal entry and put it into ${toDate}'s. ` +
        `This changes QuickBooks right away.`,
    );
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", id);
    start(() => action(fd));
  }

  return (
    <span>
      <button onClick={confirmAndRun} disabled={pending} className={`${btn} bg-[#96003C] text-white hover:bg-[#7a0030]`}>
        {pending ? "Moving…" : "Approve the date change"}
      </button>
      {state?.ok === false && <span className="ml-2 text-xs text-red-700">{state.message}</span>}
    </span>
  );
}

export function UnapproveMoveButton({ id, roNumber }: { id: string; roNumber: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(unapproveDateMoveAction, null);
  const [, start] = useTransition();

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.timestamp, state?.ok, router]);

  function confirmAndRun() {
    const ok = window.confirm(
      `Undo the date change for RO ${roNumber}?\n\n` +
        `QTekLink will put the repair order back where it was. This changes QuickBooks right away.`,
    );
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", id);
    start(() => action(fd));
  }

  return (
    <span>
      <button onClick={confirmAndRun} disabled={pending} className={`${btn} border border-stone-300 text-stone-700 hover:bg-stone-50`}>
        {pending ? "Undoing…" : "Undo approval"}
      </button>
      {state?.ok === false && <span className="ml-2 text-xs text-red-700">{state.message}</span>}
    </span>
  );
}

export function RefreshQueueButton() {
  const router = useRouter();
  const [state, action, pending] = useActionState(refreshDateMovesAction, null);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.timestamp, state?.ok, router]);

  return (
    <form action={action} className="inline">
      <button type="submit" disabled={pending} className={`${btn} border border-[#96003C] text-[#96003C] hover:bg-[#96003C]/5`}>
        {pending ? "Checking…" : "Check again"}
      </button>
      {state?.ok && (
        <span className="ml-2 text-xs text-stone-600">
          Checked. {state.data.cleared > 0 ? `${state.data.cleared} item${state.data.cleared === 1 ? "" : "s"} cleared.` : "No changes."}
        </span>
      )}
      {state?.ok === false && <span className="ml-2 text-xs text-red-700">{state.message}</span>}
    </form>
  );
}
