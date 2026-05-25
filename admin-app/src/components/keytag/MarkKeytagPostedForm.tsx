"use client";

/**
 * MarkKeytagPostedForm — flip a WIP tag to posted-A/R.
 * Pattern A confirmation always.
 */
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  markKeytagPostedAction,
  type MarkKeytagPostedState,
} from "@/actions/keytag/mark-keytag-posted";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { TagBadge } from "./TagBadge";

const initial: MarkKeytagPostedState = { kind: "idle" };

export function MarkKeytagPostedForm() {
  const [state, dispatch, isPending] = useActionState(markKeytagPostedAction, initial);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (state.kind === "needs_confirmation") setDialogOpen(true);
  }, [state]);

  useEffect(() => {
    if (state.kind === "success") {
      toast.success(`Marked ${state.data.tag_label} as posted A/R`, {
        description: `RO #${state.data.ro_number} at ${new Date(state.data.posted_at).toLocaleString()}`,
      });
      setDialogOpen(false);
    }
    if (state.kind === "tool_error") {
      toast.error(`Couldn't mark posted: ${state.data.message}`);
    }
    if (state.kind === "transport_error") {
      toast.error("Transport error", { description: state.message });
    }
  }, [state]);

  function handleConfirm() {
    if (state.kind !== "needs_confirmation") return;
    const fd = new FormData();
    fd.set("ro_number", String(state.args.ro_number));
    if (state.args.posted_at) fd.set("posted_at", state.args.posted_at);
    fd.set("confirmation_token", state.confirmation.token_id);
    dispatch(fd);
  }

  return (
    <div className="space-y-4">
      <form action={dispatch} className="flex flex-wrap items-end gap-3">
        <div className="flex-1 space-y-1">
          <Label htmlFor="post-ro" className="text-xs uppercase tracking-wider text-muted-foreground">
            RO #
          </Label>
          <Input
            id="post-ro"
            name="ro_number"
            type="number"
            min="1"
            required
            placeholder="e.g. 152222"
          />
        </div>
        <Button type="submit" disabled={isPending} className="gap-1.5">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          {isPending ? "Posting…" : "Mark posted"}
        </Button>
      </form>

      <p className="text-xs text-muted-foreground">
        Sets posted_at to now (UTC). The tag stays attached to the RO but moves from WIP-view to A/R-view.
      </p>

      {state.kind === "validation_error" && (
        <p className="text-sm text-destructive">{state.message}</p>
      )}

      {state.kind === "success" && (
        <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
          <TagBadge color={state.data.tag_color} number={state.data.tag_number} size="sm" />
          <span className="flex-1">
            <span className="font-medium">Marked posted A/R</span> on RO #{state.data.ro_number}
          </span>
          <a
            href={state.data.ro_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Open
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
      )}

      {state.kind === "needs_confirmation" && (
        <ConfirmationDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          scopeSummary={state.confirmation.scope_summary}
          expiresAt={state.confirmation.expires_at}
          actionLabel="Mark posted"
          variant="default"
          isPending={isPending}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
}
