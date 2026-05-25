"use client";

/**
 * ReleaseKeytagForm — release the tag from a given RO. Always Pattern A
 * confirmation for safety.
 */
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  releaseKeytagAction,
  type ReleaseKeytagState,
} from "@/actions/keytag/release-keytag";
import { ConfirmationDialog } from "./ConfirmationDialog";

const initial: ReleaseKeytagState = { kind: "idle" };

export function ReleaseKeytagForm() {
  const [state, dispatch, isPending] = useActionState(releaseKeytagAction, initial);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (state.kind === "needs_confirmation") setDialogOpen(true);
  }, [state]);

  useEffect(() => {
    if (state.kind === "success") {
      toast.success(`Released tag from RO #${state.data.ro_number}`, {
        description: state.data.released_tag
          ? `Was ${state.data.released_tag.label}. Tekmetric ${state.data.tekmetric_cleared ? "cleared" : "clear failed: " + (state.data.tekmetric_clear_error ?? "unknown")}.`
          : state.data.message,
      });
      setDialogOpen(false);
    }
    if (state.kind === "tool_error") {
      toast.error(`Couldn't release: ${state.data.message}`);
    }
    if (state.kind === "transport_error") {
      toast.error("Transport error", { description: state.message });
    }
  }, [state]);

  function handleConfirm() {
    if (state.kind !== "needs_confirmation") return;
    const fd = new FormData();
    fd.set("ro_number", String(state.args.ro_number));
    fd.set("confirmation_token", state.confirmation.token_id);
    dispatch(fd);
  }

  return (
    <div className="space-y-4">
      <form action={dispatch} className="flex flex-wrap items-end gap-3">
        <div className="flex-1 space-y-1">
          <Label htmlFor="release-ro" className="text-xs uppercase tracking-wider text-muted-foreground">
            RO #
          </Label>
          <Input
            id="release-ro"
            name="ro_number"
            type="number"
            min="1"
            required
            placeholder="e.g. 152222"
          />
        </div>
        <Button type="submit" variant="destructive" disabled={isPending} className="gap-1.5">
          <Eraser className="h-4 w-4" aria-hidden="true" />
          {isPending ? "Releasing…" : "Release tag"}
        </Button>
      </form>

      {state.kind === "validation_error" && (
        <p className="text-sm text-destructive">{state.message}</p>
      )}

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
    </div>
  );
}
