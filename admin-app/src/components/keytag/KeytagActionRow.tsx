"use client";

/**
 * Per-row keytag actions for the Live board.
 *
 * Each rendered row instantiates its OWN action component (own state + own
 * dialogOpen + own ConfirmationDialog) — N rows can't share one action state,
 * so this mirrors the standalone-form pattern per row.
 *
 *   - ReleaseRowAction (tagged rows): release the RO's tag. A/R-status releases
 *     return needs_confirmation → this row's ConfirmationDialog (destructive).
 *   - AssignRowAction (untagged rows): AUTO round-robin assign (ro_number only,
 *     no color/tag#), so it never returns needs_confirmation — no dialog.
 *
 * `onResolved(roNumber)` lets the parent BoardClient splice the row out
 * optimistically; `onPendingChange` lets it freeze the row (so an incoming poll
 * can't mutate a row mid-action).
 *
 * SPIN FIX (2026-06-26): these used `useActionState`, whose `isPending` is tied
 * to the React TRANSITION that applies the post-action RSC re-render. /keytags is
 * `force-dynamic` and renders all six tabs; every Server Action re-renders the
 * whole route, re-running + RE-SUSPENDING the five Suspense-wrapped tabs, and a
 * transition WAITS for those boundaries before it completes — so the button
 * spinner stayed pinned long after the (fast, ≤1s — confirmed in the edge logs)
 * mutation already succeeded server-side. We now run the action IMPERATIVELY and
 * track a plain `loading` flag: an awaited Server Action resolves on its RETURN,
 * decoupled from the re-render commit, so the spinner clears immediately. This is
 * the exact pattern LiveBoardPoller already uses for the same reason. The board
 * updates optimistically via onResolved, so no route re-render is needed for
 * correctness (the 15s poller reconverges).
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
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

export interface ReleaseRowActionProps extends RowActionProps {
  /** The tag label (e.g. "R4") — woven into the button's accessible name so a
   *  screen-reader user navigating row-by-row by button hears which tag/RO each
   *  "Release" acts on. Visible label stays "Release". */
  tagLabel?: string;
}

export function ReleaseRowAction({
  roNumber,
  onResolved,
  onPendingChange,
  tagLabel,
}: ReleaseRowActionProps) {
  const [state, setState] = useState<ReleaseKeytagState>(releaseInitial);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const run = useCallback(
    async (fd: FormData) => {
      setLoading(true);
      try {
        // Imperative await — resolves on the action's RETURN, NOT the route
        // re-render commit (see the file header). The action ignores prevState.
        const result = await releaseKeytagAction(releaseInitial, fd);
        setState(result);
        if (result.kind === "needs_confirmation") {
          setDialogOpen(true);
        } else if (result.kind === "success") {
          toast.success(`Released tag from RO #${roNumber}`, {
            description: result.data.released_tag
              ? `Was ${result.data.released_tag.label}.`
              : result.data.message,
          });
          setDialogOpen(false);
          onResolved(roNumber);
        } else if (result.kind === "tool_error") {
          toast.error(`Couldn't release: ${result.data.message}`);
          setDialogOpen(false);
        } else if (result.kind === "transport_error") {
          toast.error("Transport error", { description: result.message });
          setDialogOpen(false);
        } else if (result.kind === "validation_error") {
          toast.error(result.message);
        }
      } catch (e) {
        toast.error("Couldn't release", {
          description: e instanceof Error ? e.message : String(e),
        });
        setDialogOpen(false);
      } finally {
        setLoading(false);
      }
    },
    [roNumber, onResolved],
  );

  useEffect(() => {
    onPendingChange?.(loading || dialogOpen);
  }, [loading, dialogOpen, onPendingChange]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void run(new FormData(e.currentTarget));
  }

  function handleConfirm() {
    if (state.kind !== "needs_confirmation") return;
    const fd = new FormData();
    fd.set("ro_number", String(roNumber));
    fd.set("confirmation_token", state.confirmation.token_id);
    void run(fd);
  }

  return (
    <>
      <form onSubmit={onSubmit} className="inline">
        <input type="hidden" name="ro_number" value={roNumber} />
        {/* Soft-destructive ghost: the `text-destructive` ink on the `/10` fill
         *  is only 3.98:1 — below AA for this small label. Darken the LABEL to
         *  text-red-800 (≈7.6:1 on the tint, the same AA ink the in-use grid
         *  token uses) while keeping the icon at the destructive hue (icon is a
         *  UI component → 3:1 suffices). Affordance unchanged (labeled button). */}
        <Button
          type="submit"
          variant="destructive"
          size="sm"
          loading={loading}
          loadingText="Releasing…"
          aria-label={
            tagLabel
              ? `Release tag ${tagLabel} from RO #${roNumber}`
              : `Release tag from RO #${roNumber}`
          }
          className="gap-1.5 text-red-800 hover:text-red-800"
        >
          <Eraser className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
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
          isPending={loading}
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
  const [loading, setLoading] = useState(false);

  const run = useCallback(
    async (fd: FormData) => {
      setLoading(true);
      try {
        // Imperative await — see ReleaseRowAction / the file header.
        const result = await assignKeytagAction(assignInitial, fd);
        if (result.kind === "success") {
          toast.success(`Assigned ${result.data.tag.label} to RO #${roNumber}`, {
            description: result.data.tekmetric_patched
              ? "Tekmetric synced."
              : `Tekmetric sync failed: ${result.data.tekmetric_patch_error ?? "unknown"}`,
          });
          onResolved(roNumber);
        } else if (result.kind === "tool_error") {
          toast.error(`Couldn't assign: ${result.data.message}`);
        } else if (result.kind === "transport_error") {
          toast.error("Transport error", { description: result.message });
        } else if (result.kind === "validation_error") {
          toast.error(result.message);
        }
        // Auto-assign (ro_number only) never returns needs_confirmation.
      } catch (e) {
        toast.error("Couldn't assign", {
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setLoading(false);
      }
    },
    [roNumber, onResolved],
  );

  useEffect(() => {
    onPendingChange?.(loading);
  }, [loading, onPendingChange]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void run(new FormData(e.currentTarget));
  }

  // Auto round-robin: ro_number only (no color/tag#) → never needs_confirmation.
  return (
    <form onSubmit={onSubmit} className="inline">
      <input type="hidden" name="ro_number" value={roNumber} />
      {/* Burgundy ghost (not solid): one of many in a column — a solid-burgundy
       *  column would shout. Ghost keeps the column calm; the burgundy text +
       *  KeyRound carry the "primary action" read. Burgundy on the /10 hover
       *  fill is 7.40:1 (AA pass). */}
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        loading={loading}
        loadingText="Assigning…"
        aria-label={`Assign a tag to RO #${roNumber}`}
        className="gap-1.5 text-primary hover:bg-primary/10 hover:text-primary"
      >
        <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
        Assign
      </Button>
    </form>
  );
}
