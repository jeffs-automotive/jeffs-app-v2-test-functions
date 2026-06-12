"use client";

/**
 * AutoRefresh — keeps a live page current without the user touching anything
 * (Chris 2026-06-12: "see what has posted… not have to wait"). Every `intervalMs`
 * it re-pulls the server render via router.refresh() — but ONLY while the tab is
 * visible (hidden tabs pause; switching back refreshes immediately). refresh()
 * preserves client state (sort order, open dialogs, scroll), so updates are
 * seamless. Renders nothing.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AutoRefresh({ intervalMs = 45_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(refreshIfVisible, intervalMs);
    // Coming back to the tab → catch up right away instead of waiting a tick.
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [intervalMs, router]);

  return null;
}
