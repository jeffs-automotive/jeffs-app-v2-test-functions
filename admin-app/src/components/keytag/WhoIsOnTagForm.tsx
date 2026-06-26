"use client";

/**
 * WhoIsOnTagForm — pick a color + tag number, see who has it.
 * Client component that displays the lookup result inline.
 *
 * SPIN FIX (2026-06-26): runs the Server Action IMPERATIVELY with a plain
 * `loading` flag instead of `useActionState`. useActionState ties `isPending` to
 * the React transition that applies the post-action RSC re-render; on the
 * force-dynamic six-tab /keytags page that re-render re-suspends the other tabs'
 * Suspense boundaries and the transition WAITS for them, pinning the spinner long
 * after this (fast) read already returned. An imperative await resolves on the
 * action's RETURN, decoupled from the re-render — so the spinner clears
 * immediately. Same pattern as LiveBoardPoller / KeytagActionRow.
 */
import { useCallback, useState, type FormEvent } from "react";
import { ExternalLink, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  whoIsOnTagAction,
  type WhoIsOnTagState,
} from "@/actions/keytag/who-is-on-tag";
import { formatEastern } from "@/lib/format-time";
import { TagBadge } from "./TagBadge";

const initialState: WhoIsOnTagState = { kind: "idle" };

export function WhoIsOnTagForm() {
  const [state, setState] = useState<WhoIsOnTagState>(initialState);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async (fd: FormData) => {
    setLoading(true);
    try {
      // Imperative await — resolves on the action's RETURN, not the route
      // re-render commit (see the file header). The action ignores prevState.
      const result = await whoIsOnTagAction(initialState, fd);
      setState(result);
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void run(new FormData(e.currentTarget));
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="who-color" className="text-xs uppercase tracking-wider text-muted-foreground">
            Color
          </Label>
          <select
            id="who-color"
            name="color"
            defaultValue="red"
            className="flex h-9 w-28 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring"
          >
            <option value="red">Red</option>
            <option value="yellow">Yellow</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="who-number" className="text-xs uppercase tracking-wider text-muted-foreground">
            Number
          </Label>
          <Input
            id="who-number"
            name="tag_number"
            type="number"
            min="1"
            max="90"
            required
            className="w-28"
            placeholder="1–90"
          />
        </div>
        <Button
          type="submit"
          loading={loading}
          loadingText="Looking up…"
          className="gap-1.5"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          Look up
        </Button>
      </form>

      {state.kind === "validation_error" && (
        <p className="text-sm text-destructive">{state.message}</p>
      )}
      {state.kind === "error" && (
        <p className="text-sm text-destructive">
          Couldn&apos;t look up the tag. {state.message}
        </p>
      )}
      {state.kind === "result" && <WhoIsOnTagResultDisplay state={state} />}
    </div>
  );
}

function WhoIsOnTagResultDisplay({
  state,
}: {
  state: Extract<WhoIsOnTagState, { kind: "result" }>;
}) {
  const r = state.data;

  if (!r.found) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
        <div className="flex items-center gap-2">
          <TagBadge color={r.tag_color} number={r.tag_number} size="sm" />
          <span className="text-muted-foreground">— {r.message}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <TagBadge color={r.tag_color} number={r.tag_number} />
          <div>
            <p className="text-sm font-semibold">
              RO #{r.ro_number}
              <span className="ml-2 inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
                {r.status === "assigned" ? "WIP" : "Posted A/R"}
              </span>
            </p>
            {r.customer_name && (
              <p className="text-xs text-muted-foreground">{r.customer_name}</p>
            )}
            {r.vehicle_display && (
              <p className="text-xs text-muted-foreground">{r.vehicle_display}</p>
            )}
          </div>
        </div>
        <a
          href={r.ro_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Open in Tekmetric
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>
      {r.last_activity_at && (
        <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
          Last activity: {formatEastern(r.last_activity_at)}
        </p>
      )}
    </div>
  );
}
