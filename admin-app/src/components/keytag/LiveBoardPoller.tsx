"use client";

/**
 * LiveBoardPoller — a manual "Refresh" control + last-updated stamp for the Live
 * board. (Name kept for import stability; it does NOT auto-poll.)
 *
 * History:
 *  - It used to auto-poll every 15s via a Server Action, which co-batched with
 *    the user's release/assign Actions (PR#4 removed that auto-tick).
 *  - 2026-06-25: ALSO fix a real client bug here — the refresh ran
 *    getBoardStateAction inside `startTransition` and called setState AFTER the
 *    `await` without re-wrapping. Per react.dev, "state updates after an `await`
 *    inside `startTransition` are not marked as Transitions," which can leave
 *    `isPending` stuck (the lone-Refresh spinner that never cleared). A single
 *    awaited refresh needs no transition semantics — a plain `loading` flag is
 *    correct and cannot get pinned.
 */
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBoardStateAction } from "@/actions/keytag/board-state";
import type { BoardState } from "@/lib/orchestrator/types";

export function LiveBoardPoller({
  generatedAt,
  onState,
}: {
  generatedAt: string;
  onState: (s: BoardState) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [stamp, setStamp] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setStamp(
      new Date(generatedAt).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      }),
    );
  }, [generatedAt]);

  // User-initiated refresh ONLY — never on a timer. Plain async + a `loading`
  // flag (NOT useTransition): a single awaited Server Action needs no transition
  // semantics, and a loading flag can't be left pending by the post-await
  // setState footgun (react.dev/reference/react/useTransition).
  function refresh() {
    setLoading(true);
    void (async () => {
      try {
        const res = await getBoardStateAction();
        if (res.kind === "ok") {
          setFailed(false);
          onState(res.data);
        } else {
          setFailed(true);
        }
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    })();
  }

  return (
    <div
      className="flex items-center gap-3 text-xs text-muted-foreground"
      aria-busy={loading}
    >
      <span className="inline-flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`inline-block size-2 rounded-full ${
            failed
              ? "bg-red-500"
              : loading
                ? "bg-amber-400 motion-safe:animate-pulse"
                : "bg-emerald-500"
          }`}
        />
        <span aria-live="polite">
          {stamp ? `Updated ${stamp} ET` : "Live"}
          {failed
            ? " · couldn't refresh"
            : loading
              ? " · refreshing…"
              : " · Refresh to update"}
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={refresh}
        disabled={loading}
        className="gap-1.5"
      >
        <RefreshCw
          className={`h-3.5 w-3.5 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`}
          aria-hidden="true"
        />
        Refresh
      </Button>
    </div>
  );
}
