"use client";

/**
 * IdleTimer — client-side idle / abandon detector.
 *
 * 2026-05-16 ephemeral-session rewrite per Chris's spec:
 *
 *   "The appointment process will time out after 5 minutes of
 *    inactivity. If it times out it will reload the page and start at
 *    step one."
 *
 * Behavior:
 *   - Every user interaction (pointer/key/scroll/touch) resets the
 *     5-minute timer.
 *   - After 5 minutes of inactivity → fire `navigator.sendBeacon` to
 *     /api/scheduler/mark-abandoned (which flips status='timed_out',
 *     stamps ended_at, and releases any active appointment_holds for
 *     the session). Then window.location.reload() — the next render
 *     calls hydrateSession which sees the stale row + wipes it in
 *     place, surfacing the greeting card.
 *   - `beforeunload` / `pagehide` also fire the beacon — tab-close
 *     while in-flight releases the hold + marks the session abandoned.
 *
 * Phase 14's 2-minute "Still there?" nudge was dropped in this
 * rewrite. The spec is single-threshold and abrupt by design — the
 * customer should treat the wizard as ephemeral, not a long-lived
 * session.
 *
 * Disabled at terminal steps (escalated / completed) — those have no
 * abandon flow since the session is already terminal.
 */
import { useEffect, useRef } from "react";

export interface IdleTimerProps {
  chatId: string;
  /** Current step at mount — included in the abandon beacon's audit. */
  currentStep: string;
  /**
   * Skip when the session is in a terminal state (completed / escalated).
   * Defaults to false; parent passes true when the wizard's step is one
   * of those terminals.
   */
  disabled?: boolean;
}

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — per 2026-05-16 spec
const INTERACTIVE_EVENTS: Array<keyof DocumentEventMap> = [
  "pointerdown",
  "keydown",
  "scroll",
  "touchstart",
];

export function IdleTimer({
  chatId,
  currentStep,
  disabled = false,
}: IdleTimerProps) {
  // Track abandonment so the idle-timer + pagehide handlers don't
  // double-fire if both happen to run.
  const abandonedRef = useRef(false);

  useEffect(() => {
    if (disabled) return;

    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    function fireBeacon(source: "idle_timer" | "tab_close") {
      if (abandonedRef.current) return;
      abandonedRef.current = true;
      try {
        const params = new URLSearchParams({
          chat_id: chatId,
          step: currentStep,
          source,
        });
        navigator.sendBeacon?.(
          `/api/scheduler/mark-abandoned?${params.toString()}`,
        );
      } catch {
        // beacon failure is acceptable — server-side cron will reap
        // orphan rows long-term; the hold's TTL also bounds the impact.
      }
    }

    function resetTimer() {
      if (abandonedRef.current) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        fireBeacon("idle_timer");
        // Reload to a clean state. hydrateSession will detect the
        // just-stamped timed_out row and wipe-in-place → greeting.
        try {
          window.location.reload();
        } catch {
          // ignore — beacon already fired
        }
      }, TIMEOUT_MS);
    }

    function onUnload() {
      // pagehide / beforeunload covers tab-close, navigation away, and
      // history pops. Beacon releases the hold + marks abandoned.
      fireBeacon("tab_close");
    }

    for (const evt of INTERACTIVE_EVENTS) {
      document.addEventListener(evt, resetTimer, { passive: true });
    }
    window.addEventListener("pagehide", onUnload);
    window.addEventListener("beforeunload", onUnload);

    resetTimer();

    return () => {
      for (const evt of INTERACTIVE_EVENTS) {
        document.removeEventListener(evt, resetTimer);
      }
      window.removeEventListener("pagehide", onUnload);
      window.removeEventListener("beforeunload", onUnload);
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, [chatId, currentStep, disabled]);

  // No rendered UI — this component is purely a side-effect harness.
  return null;
}
