"use client";

/**
 * Per-row keytag actions for the Live board.
 *
 * Each rendered row instantiates its OWN action component (own useActionState +
 * own dialogOpen + own ConfirmationDialog) — N rows can't share one action
 * state, so this mirrors the standalone-form pattern per row.
 *
 *   - ReleaseRowAction (tagged rows): release the RO's tag. A/R-status releases
 *     return needs_confirmation → this row's ConfirmationDialog (destructive).
 *   - AssignRowAction (untagged rows): AUTO round-robin assign (ro_number only,
 *     no color/tag#), so it never returns needs_confirmation — no dialog.
 *
 * `onResolved(roNumber)` lets the parent BoardClient splice the row out
 * optimistically; `onPendingChange` lets it freeze the row (so an incoming poll
 * can't mutate a row mid-action). Functional wiring — visual polish applied
 * later per the design spec.
 */
import { useActionState, useEffect, useState, startTransition } from "react";
import { toast } from "sonner";
import { Eraser, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  assignKeytagAction,
  type AssignKeytagState,
} from "@/actions/keytag/assign-keytag";
import {
  releaseKeytagAction,
  type ReleaseKeytagState,
} from "@/actions/keytag/release-keytag";
import { ConfirmationDialog } from "./ConfirmationDialog";

const assignInitial: AssignKeytagState = { kind: "idle" };
const releaseInitial: ReleaseKeytagState = { kind: "idle" };

export interface RowActionProps {
  roNumber: number;
  onResolved: (roNumber: number) => void;
  /** Reports busy (pending OR a confirmation dialog open) so the parent freezes the row. */
  onPendingChange?: (busy: boolean) => void;
}

export function ReleaseRowAction({
  roNumber,
  onResolved,
  onPendingChange,
}: RowActionProps) {
  const [state, dispatch, isPending] = useActionState(releaseKeytagAction, releaseInitial);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (state.kind === "needs_confirmation") setDialogOpen(true);
  }, [state]);

  useEffect(() => {
    if (state.kind === "success") {
      toast.success(`Released tag from RO #${roNumber}`, {
        description: state.data.released_tag
          ? `Was ${state.data.released_tag.label}.`
          : state.data.message,
      });
      setDialogOpen(false);
      onResolved(roNumber);
    }
    if (state.kind === "tool_error") {
      toast.error(`Couldn't release: ${state.data.message}`);
      setDialogOpen(false);
    }
    if (state.kind === "transport_error") {
      toast.error("Transport error", { description: state.message });
      setDialogOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    onPendingChange?.(isPending || dialogOpen);
  }, [isPending, dialogOpen, onPendingChange]);

  function handleConfirm() {
    if (state.kind !== "needs_confirmation") return;
    const fd = new FormData();
    fd.set("ro_number", String(roNumber));
    fd.set("confirmation_token", state.confirmation.token_id);
    startTransition(() => dispatch(fd));
  }

  return (
    <>
      <form action={dispatch} className="inline">
        <input type="hidden" name="ro_number" value={roNumber} />
        <Button
          type="submit"
          variant="destructive"
          size="sm"
          loading={isPending}
          loadingText="Releasing…"
          className="gap-1.5"
        >
          <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
          Release
        </Button>
      </form>

      {state.kind === "needs_confirmation" && (
        <ConfirmationDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          scopeSummary={state.confirmation.scope_summary}
          expiresAt={state.confirmation.expires_at}
          actionLabel="Release tag"
          variant="destructive"
          isPending={isPending}
          onConfirm={handleConfirm}
        />
      )}
    </>
  );
}

export function AssignRowAction({
  roNumber,
  onResolved,
  onPendingChange,
}: RowActionProps) {
  const [state, dispatch, isPending] = useActionState(assignKeytagAction, assignInitial);

  useEffect(() => {
    if (state.kind === "success") {
      toast.success(`Assigned ${state.data.tag.label} to RO #${roNumber}`, {
        description: state.data.tekmetric_patched
          ? "Tekmetric synced."
          : `Tekmetric sync failed: ${state.data.tekmetric_patch_error ?? "unknown"}`,
      });
      onResolved(roNumber);
    }
    if (state.kind === "tool_error") {
      toast.error(`Couldn't assign: ${state.data.message}`);
    }
    if (state.kind === "transport_error") {
      toast.error("Transport error", { description: state.message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    onPendingChange?.(isPending);
  }, [isPending, onPendingChange]);

  // Auto round-robin: ro_number only (no color/tag#) → never needs_confirmation.
  return (
    <form action={dispatch} className="inline">
      <input type="hidden" name="ro_number" value={roNumber} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        loading={isPending}
        loadingText="Assigning…"
        className="gap-1.5 text-primary"
      >
        <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
        Assign
      </Button>
    </form>
  );
}
