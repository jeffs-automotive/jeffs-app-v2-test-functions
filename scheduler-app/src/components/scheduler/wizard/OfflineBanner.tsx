"use client";

/**
 * OfflineBanner — Phase 14 client-side connectivity indicator.
 *
 * Per chat-design.md §D.1 "Loss of internet mid-session" (lines
 * 3276-3289): listens for browser `online` / `offline` events and shows
 * a dismissible warning banner at the top of the page when the
 * connection drops. The banner auto-hides when connectivity returns.
 *
 * Behavior on Server Action submits while offline: the action's
 * Network-error path surfaces a Sentry warning + the card's loading
 * spinner times out via the action's own AbortSignal. The banner is the
 * primary signal to the customer that "your progress is saved — we'll
 * pick up where you left off." No work is lost because the
 * server-state-driven wizard reads the row on every render.
 *
 * Phase 14 scope: read-only indicator. Phase 1.1 may add automatic
 * retry of the in-flight Server Action when `online` fires.
 */
import { useEffect, useState } from "react";

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    // Initial check — navigator.onLine is the synchronous truth.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setIsOffline(true);
    }

    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => setIsOffline(false);

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="sticky top-0 z-20 animate-pop-in border-b border-brand-burgundy-300 bg-brand-burgundy-50 px-4 py-2 text-center text-[13px] leading-snug text-brand-burgundy-700"
    >
      ⚠️ You&apos;re offline. We&apos;ll save your progress — come back
      when you&apos;re connected.
    </div>
  );
}
