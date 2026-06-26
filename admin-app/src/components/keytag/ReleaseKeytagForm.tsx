"use client";

/**
 * ReleaseKeytagForm — release the tag from a given RO. Always Pattern A
 * confirmation for safety.
 *
 * SPIN FIX (2026-06-26): runs the Server Action IMPERATIVELY with a plain
 * `loading` flag instead of `useActionState`. useActionState ties `isPending` to
 * the React transition that applies the post-action RSC re-render; on the
 * force-dynamic six-tab /keytags page that re-render re-suspends the other tabs'
 * Suspense boundaries and the transition WAITS for them, pinning the spinner long
 * after the (fast) release already succeeded server-side. An imperative await
 * resolves on the action's RETURN, decoupled from the re-render — so the spinner
 * clears immediately. Same pattern as LiveBoardPoller / KeytagActionRow.
 */
import { useCallback, useState, type FormEvent } from "react";
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
  const [state, setState] = useState<ReleaseKeytagState>(initial);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const run = useCallback(async (fd: FormData) => {
    setLoading(true);
    try {
      // Imperative await — resolves on the action's RETURN, not the route
      // re-render commit (see the file header). The action ignores prevState.
      const result = await releaseKeytagAction(initial, fd);
      setState(result);
      if (result.kind === "needs_confirmation") {
        setDialogOpen(true);
      } else if (result.kind === "success") {
        toast.success(`Released tag from RO #${result.data.ro_number}`, {
          description: result.data.released_tag
            ? `Was ${result.data.released_tag.label}. Tekmetric ${result.data.tekmetric_cleared ? "cleared" : "clear failed: " + (result.data.tekmetric_clear_error ?? "unknown")}.`
            : result.data.message,
        });
        setDialogOpen(false);
      } else if (result.kind === "tool_error") {
        toast.error(`Couldn't release: ${result.data.message}`);
        // Terminal failure — close dialog (Gemini cross-verify 2026-05-25).
        setDialogOpen(false);
      } else if (result.kind === "transport_error") {
        toast.error("Transport error", { description: result.message });
        setDialogOpen(false);
      }
    } catch (e) {
      toast.error("Couldn't release", {
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
        <Button
          type="submit"
          variant="destructive"
          loading={loading}
          loadingText="Releasing…"
          className="gap-1.5"
        >
          <Eraser className="h-4 w-4" aria-hidden="true" />
          Release tag
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
          isPending={loading}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
}
