"use client";

/**
 * AssignKeytagForm — auto-assign OR force-assign a tag to an RO.
 * Force-assign triggers Pattern A confirmation dialog.
 */
import { useActionState, useEffect, useState, startTransition } from "react";
import { toast } from "sonner";
import { ExternalLink, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  assignKeytagAction,
  type AssignKeytagState,
} from "@/actions/keytag/assign-keytag";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { TagBadge } from "./TagBadge";

const initial: AssignKeytagState = { kind: "idle" };

export function AssignKeytagForm() {
  const [state, dispatch, isPending] = useActionState(assignKeytagAction, initial);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Open dialog when state transitions to needs_confirmation
  useEffect(() => {
    if (state.kind === "needs_confirmation") setDialogOpen(true);
  }, [state]);

  // Surface success/failure as toasts
  useEffect(() => {
    if (state.kind === "success") {
      toast.success(
        `Assigned ${state.data.tag.label} to RO #${state.data.ro_number}`,
        {
          description: state.data.tekmetric_patched
            ? "Tekmetric synced."
            : `Tekmetric sync failed: ${state.data.tekmetric_patch_error ?? "unknown"}`,
        },
      );
      setDialogOpen(false);
    }
    if (state.kind === "tool_error") {
      toast.error(`Couldn't assign: ${state.data.message}`);
    }
    if (state.kind === "transport_error") {
      toast.error("Transport error", { description: state.message });
    }
  }, [state]);

  function handleConfirm() {
    if (state.kind !== "needs_confirmation") return;
    const fd = new FormData();
    fd.set("ro_number", String(state.args.ro_number));
    if (state.args.color) fd.set("color", state.args.color);
    if (state.args.tag_number != null) fd.set("tag_number", String(state.args.tag_number));
    fd.set("confirmation_token", state.confirmation.token_id);
    // Programmatic dispatch needs startTransition wrap or isPending may
    // not flip reliably + React warns. (GPT cross-verify 2026-05-25.)
    startTransition(() => {
      dispatch(fd);
    });
  }

  const errorMsg =
    state.kind === "validation_error" ? state.message : null;

  return (
    <div className="space-y-4">
      <form action={dispatch} className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
        <div className="space-y-1">
          <Label htmlFor="assign-ro" className="text-xs uppercase tracking-wider text-muted-foreground">
            RO #
          </Label>
          <Input
            id="assign-ro"
            name="ro_number"
            type="number"
            min="1"
            required
            placeholder="e.g. 152222"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="assign-color" className="text-xs uppercase tracking-wider text-muted-foreground">
            Color (optional)
          </Label>
          <select
            id="assign-color"
            name="color"
            defaultValue=""
            className="flex h-9 w-28 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
          >
            <option value="">Auto</option>
            <option value="red">Red</option>
            <option value="yellow">Yellow</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="assign-num" className="text-xs uppercase tracking-wider text-muted-foreground">
            Tag # (optional)
          </Label>
          <Input
            id="assign-num"
            name="tag_number"
            type="number"
            min="1"
            max="90"
            className="w-24"
            placeholder="1–90"
          />
        </div>
        <div className="flex items-end">
          <Button
            type="submit"
            loading={isPending}
            loadingText="Assigning…"
            className="gap-1.5"
          >
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Assign
          </Button>
        </div>
      </form>

      <p className="text-xs text-muted-foreground">
        Leave color + number blank to auto-assign the next tag round-robin. Specify both to force-assign a specific tag (requires confirmation).
      </p>

      {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}

      {/* Hide stale success card while a follow-up submit is pending,
          otherwise the old "Assigned to RO …" lingers next to an
          "Assigning…" button. (Cross-verify 2026-05-25.) */}
      {!isPending && state.kind === "success" && (
        <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
          <TagBadge color={state.data.tag.color} number={state.data.tag.number} size="sm" />
          <span className="flex-1">
            <span className="font-medium">Assigned to RO #{state.data.ro_number}.</span>
            {state.data.auto_assigned && <span className="ml-2 text-xs text-muted-foreground">(auto)</span>}
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
          actionLabel="Assign tag"
          variant="default"
          isPending={isPending}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
}
