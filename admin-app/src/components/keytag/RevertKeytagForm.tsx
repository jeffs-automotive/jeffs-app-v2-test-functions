"use client";

/**
 * RevertKeytagForm — flip a posted-A/R tag back to WIP-assigned.
 * Pattern A confirmation when current status is posted_ar.
 *
 * SPIN FIX (2026-06-26): runs the Server Action IMPERATIVELY with a plain
 * `loading` flag instead of `useActionState`. useActionState ties `isPending` to
 * the React transition that applies the post-action RSC re-render; on the
 * force-dynamic six-tab /keytags page that re-render re-suspends the other tabs'
 * Suspense boundaries and the transition WAITS for them, pinning the spinner long
 * after the (fast) revert already succeeded server-side. An imperative await
 * resolves on the action's RETURN, decoupled from the re-render — so the spinner
 * clears immediately. Same pattern as LiveBoardPoller / KeytagActionRow.
 */
import { useCallback, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Undo2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  revertKeytagAction,
  type RevertKeytagState,
} from "@/actions/keytag/revert-keytag";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { TagBadge } from "./TagBadge";

const initial: RevertKeytagState = { kind: "idle" };

export function RevertKeytagForm() {
  const [state, setState] = useState<RevertKeytagState>(initial);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const run = useCallback(async (fd: FormData) => {
    setLoading(true);
    try {
      // Imperative await — resolves on the action's RETURN, not the route
      // re-render commit (see the file header). The action ignores prevState.
      const result = await revertKeytagAction(initial, fd);
      setState(result);
      if (result.kind === "needs_confirmation") {
        setDialogOpen(true);
      } else if (result.kind === "success") {
        toast.success(`Reverted ${result.data.tag_label} to WIP`, {
          description: `RO #${result.data.ro_number}. Was ${result.data.prior_status === "posted_ar" ? "posted A/R" : "already assigned"}.`,
        });
        setDialogOpen(false);
      } else if (result.kind === "tool_error") {
        toast.error(`Couldn't revert: ${result.data.message}`);
        // Terminal failure — close dialog (Gemini cross-verify 2026-05-25).
        setDialogOpen(false);
      } else if (result.kind === "transport_error") {
        toast.error("Transport error", { description: result.message });
        setDialogOpen(false);
      }
    } catch (e) {
      toast.error("Couldn't revert", {
        description: e instanceof Error ? e.message : String(e),
      });
      setDialogOpen(false);
    } finally {
      setLoading(false);
    }
  }, []);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void run(new FormData(e.currentTarget));
  }

  function handleConfirm() {
    if (state.kind !== "needs_confirmation") return;
    const fd = new FormData();
    fd.set("ro_number", String(state.args.ro_number));
    fd.set("confirmation_token", state.confirmation.token_id);
    void run(fd);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <div className="flex-1 space-y-1">
          <Label htmlFor="revert-ro" className="text-xs uppercase tracking-wider text-muted-foreground">
            RO #
          </Label>
          <Input
            id="revert-ro"
            name="ro_number"
            type="number"
            min="1"
            required
            placeholder="e.g. 152222"
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          loading={loading}
          loadingText="Reverting…"
          className="gap-1.5"
        >
          <Undo2 className="h-4 w-4" aria-hidden="true" />
          Revert to WIP
        </Button>
      </form>

      <p className="text-xs text-muted-foreground">
        Use when a tag was marked posted A/R too early and needs to come back into WIP.
      </p>

      {state.kind === "validation_error" && (
        <p className="text-sm text-destructive">{state.message}</p>
      )}

      {/* Gate on !loading so stale success doesn't show during a
          follow-up submit. (Cross-verify 2026-05-25.) */}
      {!loading && state.kind === "success" && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <TagBadge color={state.data.tag_color} number={state.data.tag_number} size="sm" />
          <span className="flex-1">
            <span className="font-medium">Reverted to WIP</span> on RO #{state.data.ro_number}
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
          actionLabel="Revert to WIP"
          variant="default"
          isPending={loading}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
}
