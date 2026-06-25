"use client";

/**
 * LiveBoardPoller — a manual "Refresh" control + last-updated stamp for the Live
 * board. (Name kept for import stability; it no longer auto-polls.)
 *
 * IMPORTANT (2026-06-25 board-spin-fix — PROVEN root cause): this used to
 * auto-poll every 15s by calling getBoardStateAction (a SERVER ACTION) on a
 * timer. That recurring Server Action co-batched / serialized with the user's
 * release/assign Server Actions: React batches concurrent Actions and keeps
 * isPending true "until all Actions complete and the final state is shown to the
 * user" (react.dev), and Next.js 15 "dispatches and awaits them one at a time"
 * (nextjs.org). So a Release/Assign button spun forever while the 15s poll kept
 * re-entering the batch. The board now refreshes only on (a) the user's own
 * action (BoardClient.onResolved splices the row optimistically), (b) this
 * user-initiated Refresh (a single, solitary Action — can't co-batch with a
 * click), or (c) a page reload — exactly how the pre-merge Assign/Release tab
 * worked. No background Server Action lives next to the mutation forms anymore.
 */
import { useEffect, useState, useTransition } from "react";
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
  const [isPending, startTransition] = useTransition();
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

  // User-initiated refresh ONLY — never on a timer (see file header). A solitary
  // user-clicked Action can't co-batch with a release/assign the way the old 15s
  // auto-poll did, so it never pins the mutation buttons' isPending.
  function refresh() {
    startTransition(async () => {
      const res = await getBoardStateAction();
      if (res.kind === "ok") {
        setFailed(false);
        onState(res.data);
      } else {
        setFailed(true);
      }
    });
  }

  return (
    <div
      className="flex items-center gap-3 text-xs text-muted-foreground"
      aria-busy={isPending}
    >
      <span className="inline-flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`inline-block size-2 rounded-full ${
            failed
              ? "bg-red-500"
              : isPending
                ? "bg-amber-400 motion-safe:animate-pulse"
                : "bg-emerald-500"
          }`}
        />
        <span aria-live="polite">
          {stamp ? `Updated ${stamp} ET` : "Live"}
          {failed
            ? " · couldn't refresh"
            : isPending
              ? " · refreshing…"
              : " · Refresh to update"}
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={refresh}
        disabled={isPending}
        className="gap-1.5"
      >
        <RefreshCw
          className={`h-3.5 w-3.5 ${isPending ? "animate-spin motion-reduce:animate-none" : ""}`}
          aria-hidden="true"
        />
        Refresh
      </Button>
    </div>
  );
}
