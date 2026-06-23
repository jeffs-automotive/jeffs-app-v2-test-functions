"use client";

/**
 * LiveBoardPoller — keeps the Live board fresh by polling our DB (~15s).
 *
 * Unlike the Dashboard's router.refresh, this calls getBoardStateAction (two
 * cheap DB reads, no Tekmetric) and hands the fresh state up to BoardClient,
 * which merges it (preserving any in-flight row). Re-reading the whole small
 * set each tick keeps it authoritative even for out-of-band releases.
 *
 * Calm-poll affordance modeled on DashboardPoller; visual polish applied later.
 */
import { useEffect, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBoardStateAction } from "@/actions/keytag/board-state";
import type { BoardState } from "@/lib/orchestrator/types";

const POLL_MS = 15_000;

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

  function poll() {
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

  useEffect(() => {
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          {failed ? " · refresh failed" : isPending ? " · refreshing…" : " · auto-refreshes"}
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={poll}
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
