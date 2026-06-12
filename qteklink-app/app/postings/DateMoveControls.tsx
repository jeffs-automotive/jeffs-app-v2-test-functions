"use client";

/**
 * Posting-queue row controls (admin-only): Approve the date change / Undo an
 * accidental approval / "Check again" (re-scan Tekmetric). Approve + Undo update
 * QuickBooks (they move the repair order between the two days' journal entries),
 * so both confirm with the user first.
 */
import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, RefreshCw, Undo2 } from "lucide-react";
import { approveDateMoveAction, unapproveDateMoveAction, refreshDateMovesAction } from "@/actions/date-moves";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export function ApproveMoveButton({ id, roNumber, fromDate, toDate }: { id: string; roNumber: string; fromDate: string; toDate: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(approveDateMoveAction, null);
  const [, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.timestamp, state?.ok, router]);

  // Same wiring the window.confirm branch ran — only the confirm UI changed.
  function run() {
    setConfirmOpen(false);
    const fd = new FormData();
    fd.set("id", id);
    start(() => action(fd));
  }

  return (
    <span className="inline-flex items-center">
      <Button onClick={() => setConfirmOpen(true)} loading={pending} loadingText="Moving…">
        <ArrowLeftRight aria-hidden="true" />
        Approve the date change
      </Button>
      {state?.ok === false && <span className="ml-2 text-xs text-red-700 dark:text-red-400">{state.message}</span>}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        isPending={pending}
        title={`Move RO ${roNumber} from ${fromDate} to ${toDate}?`}
        body={`QTekLink will take it out of ${fromDate}'s journal entry and put it into ${toDate}'s. This changes QuickBooks right away.`}
        confirmLabel="Approve the date change"
        confirmingLabel="Moving…"
        onConfirm={run}
      />
    </span>
  );
}

export function UnapproveMoveButton({ id, roNumber }: { id: string; roNumber: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(unapproveDateMoveAction, null);
  const [, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.timestamp, state?.ok, router]);

  function run() {
    setConfirmOpen(false);
    const fd = new FormData();
    fd.set("id", id);
    start(() => action(fd));
  }

  return (
    <span className="inline-flex items-center">
      <Button variant="outline" onClick={() => setConfirmOpen(true)} loading={pending} loadingText="Undoing…">
        <Undo2 aria-hidden="true" />
        Undo approval
      </Button>
      {state?.ok === false && <span className="ml-2 text-xs text-red-700 dark:text-red-400">{state.message}</span>}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        isPending={pending}
        variant="destructive"
        title={`Undo the date change for RO ${roNumber}?`}
        body="QTekLink will put the repair order back where it was. This changes QuickBooks right away."
        confirmLabel="Undo approval"
        confirmingLabel="Undoing…"
        onConfirm={run}
      />
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
    <form action={action} className="inline-flex items-center">
      <Button type="submit" variant="outline" loading={pending} loadingText="Checking…">
        <RefreshCw aria-hidden="true" />
        Check again
      </Button>
      {state?.ok && (
        <span className="ml-2 text-xs text-muted-foreground">
          Checked. {state.data.cleared > 0 ? `${state.data.cleared} item${state.data.cleared === 1 ? "" : "s"} cleared.` : "No changes."}
        </span>
      )}
      {state?.ok === false && <span className="ml-2 text-xs text-red-700 dark:text-red-400">{state.message}</span>}
    </form>
  );
}
