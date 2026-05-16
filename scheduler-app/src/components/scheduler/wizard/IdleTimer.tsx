"use client";

/**
 * IdleTimer — Phase 14 client-side idle / abandon detector.
 *
 * Per chat-design.md §B "Idle / abandon flow" (lines 3188-3223):
 *
 *   - Every user interaction (pointer down, key down, scroll, touch
 *     start) resets the idle timer.
 *   - 2 minutes of inactivity → surface a soft nudge: "Still there? 👋
 *     Take your time."
 *   - 7 minutes of total inactivity → fire `navigator.sendBeacon` to
 *     /api/scheduler/mark-abandoned and reload the page (the row's
 *     status will read 'timed_out' on the next render and the resume
 *     flow takes over).
 *   - `beforeunload` / `pagehide` also fire the beacon — so tab close
 *     while the customer was actively in-flight still surfaces as
 *     'abandoned' to the service team.
 *
 * The 2-minute nudge is RENDER-ONLY (no row write). The 7-minute
 * abandon IS a row write (via the beacon endpoint).
 *
 * Design note: this component is invisible most of the time; it only
 * appears when the 2-minute mark is hit. Visibility is `aria-live` so
 * screen readers announce the nudge.
 *
 * Phase 14 scope: terminal-step sessions (status='ended' / 'escalated')
 * are silently skipped — those don't need the abandon flow.
 */
import { useEffect, useRef, useState } from "react";

export interface IdleTimerProps {
  chatId: string;
  /** Current step at mount — used as the source in the abandon beacon. */
  currentStep: string;
  /**
   * Skip when the session is in a terminal state (completed / escalated /
   * timed_out). Defaults to false; parent should pass true when the
   * wizard's step is one of those terminals.
   */
  disabled?: boolean;
}

const IDLE_NUDGE_MS = 2 * 60 * 1000; // 2 minutes
const ABANDON_AFTER_NUDGE_MS = 5 * 60 * 1000; // +5 minutes = 7 total
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
  const [nudgeVisible, setNudgeVisible] = useState(false);
  // Track abandonment state so we don't double-fire if onUnload also runs.
  const abandonedRef = useRef(false);

  useEffect(() => {
    if (disabled) return;

    let nudgeTimer: ReturnType<typeof setTimeout> | null = null;
    let abandonTimer: ReturnType<typeof setTimeout> | null = null;

    function fireBeacon(source: "idle_timer" | "tab_close") {
      if (abandonedRef.current) return;
      abandonedRef.current = true;
      try {
        const params = new URLSearchParams({
          chat_id: chatId,
          step: currentStep,
          source,
        });
        // sendBeacon is fire-and-forget; the browser flushes even on
        // page tear-down. POST is the default. We don't await — even on
        // success the response is empty.
        navigator.sendBeacon?.(
          `/api/scheduler/mark-abandoned?${params.toString()}`,
        );
      } catch {
        // beacon failure is acceptable — server-side cron will reap
      }
    }

    function resetTimers() {
      if (abandonedRef.current) return;
      if (nudgeTimer) clearTimeout(nudgeTimer);
      if (abandonTimer) clearTimeout(abandonTimer);
      setNudgeVisible(false);
      nudgeTimer = setTimeout(() => {
        setNudgeVisible(true);
        abandonTimer = setTimeout(() => {
          fireBeacon("idle_timer");
          // Reload so the page re-reads the row (now status='timed_out')
          // and surfaces the appropriate "abandoned" state. Phase 15
          // will deepen this into a dedicated abandoned card.
          try {
            window.location.reload();
          } catch {
            // ignore — beacon already fired
          }
        }, ABANDON_AFTER_NUDGE_MS);
      }, IDLE_NUDGE_MS);
    }

    function onUnload() {
      // pagehide / beforeunload covers tab-close, navigation away,
      // and history pops. Only beacon if we haven't already.
      fireBeacon("tab_close");
    }

    for (const evt of INTERACTIVE_EVENTS) {
      document.addEventListener(evt, resetTimers, { passive: true });
    }
    window.addEventListener("pagehide", onUnload);
    window.addEventListener("beforeunload", onUnload);

    resetTimers();

    return () => {
      for (const evt of INTERACTIVE_EVENTS) {
        document.removeEventListener(evt, resetTimers);
      }
      window.removeEventListener("pagehide", onUnload);
      window.removeEventListener("beforeunload", onUnload);
      if (nudgeTimer) clearTimeout(nudgeTimer);
      if (abandonTimer) clearTimeout(abandonTimer);
    };
  }, [chatId, currentStep, disabled]);

  if (!nudgeVisible || disabled) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto mb-4 max-w-3xl rounded-[var(--radius-card)] border border-brand-gold-300 bg-brand-gold-50 px-4 py-3 text-[14px] leading-relaxed text-ink-secondary"
    >
      Still there? 👋 Take your time — I&apos;ll wait. Just tap any card
      or type to continue.
    </div>
  );
}
