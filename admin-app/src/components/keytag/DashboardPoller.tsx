"use client";

/**
 * DashboardPoller — keeps the Dashboard tab live via POLLING (not realtime).
 *
 * Every 60s it calls `router.refresh()`, which re-runs the Dashboard Server
 * Component. The data behind it is cached (see `lib/keytag/dashboard-cache.ts`)
 * so the refresh reads the cached snapshot unless the 60s TTL has elapsed — no
 * page flash, no full re-pull every tick. Also exposes a manual refresh.
 *
 * Calm-poll affordance (design spec §5): a quiet status dot (solid emerald →
 * amber pulse while refreshing), an "Updated HH:MM · auto-refreshes every
 * minute" line, and a ghost manual-refresh button. No overlay, no page-blank —
 * the last good data stays on screen and React swaps it in place. Reduced
 * motion is respected via Tailwind `motion-reduce`.
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

const POLL_MS = 60_000;

export function DashboardPoller({ generatedAt }: { generatedAt: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Render the snapshot time only after mount to avoid an SSR/CSR locale
  // mismatch (toLocaleTimeString differs by environment).
  const [stamp, setStamp] = useState<string>("");

  useEffect(() => {
    setStamp(
      new Date(generatedAt).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      }),
    );
  }, [generatedAt]);

  useEffect(() => {
    const id = setInterval(() => {
      startTransition(() => router.refresh());
    }, POLL_MS);
    return () => clearInterval(id);
  }, [router]);

  return (
    <div
      className="flex items-center gap-3 text-xs text-muted-foreground"
      aria-busy={isPending}
    >
      <span className="inline-flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`inline-block size-2 rounded-full ${
            isPending
              ? "bg-amber-400 motion-safe:animate-pulse"
              : "bg-emerald-500"
          }`}
        />
        <span aria-live="polite">
          {stamp ? `Updated ${stamp} ET` : "Live"}
          {isPending ? " · refreshing…" : " · auto-refreshes every minute"}
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => startTransition(() => router.refresh())}
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
