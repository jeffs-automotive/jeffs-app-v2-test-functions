"use client";

/**
 * IdleTimer — client-side idle / abandon detector.
 *
 * 2026-05-16 ephemeral-session spec (Chris):
 *
 *   "The appointment process will time out after 5 minutes of
 *    inactivity. If it times out it will reload the page and start at
 *    step one."
 *
 * Behavior (updated 2026-05-16 per R6-D-2 WCAG 2.2.1):
 *   - Every user interaction (pointer/key/scroll/touch) resets the
 *     full 5-minute timer.
 *   - At 4:40 (20 seconds before reload) a warning dialog appears with
 *     a live countdown + "Keep me here" button. Clicking the button OR
 *     ANY other interaction (typing in a field, scrolling, etc.) extends
 *     the session another 5 minutes. WCAG 2.2.1 requires at least 20
 *     seconds + a simple action to extend; this satisfies both.
 *   - If the user doesn't interact within the 20s window, fire
 *     navigator.sendBeacon to /api/scheduler/mark-abandoned (releases
 *     the hold + flips status='timed_out'), then window.location.reload.
 *   - pagehide / beforeunload also fire the beacon — tab-close while
 *     in-flight releases the hold + marks abandoned.
 *
 * Disabled at terminal steps (escalated / completed) — those have no
 * abandon flow since the session is already terminal.
 *
 * The role="alertdialog" wrapper makes the warning announce on
 * appearance to screen readers without interrupting current speech
 * (aria-live="off" on the countdown number avoids re-announcing every
 * second).
 */
import { useEffect, useRef, useState } from "react";

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

const TOTAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — per 2026-05-16 spec
const WARNING_BEFORE_MS = 20 * 1000; // 20s warning window (WCAG 2.2.1)
const TIME_TO_WARNING_MS = TOTAL_TIMEOUT_MS - WARNING_BEFORE_MS;

// Widened 2026-05-21 (idle-reset reliability fix). Original set was missing
// mousemove + click + visibilitychange — a customer who's READING a card
// (e.g. a clarification question) without scrolling/typing was timing out
// after 5 min from page-mount with no resets. Also attaching to `window`
// with `capture: true` so events caught at the capture phase still reset
// the timer even if downstream handlers call stopPropagation.
const INTERACTIVE_EVENTS: Array<keyof WindowEventMap> = [
  "pointerdown",
  "pointermove",
  "mousedown",
  "mousemove",
  "click",
  "keydown",
  "scroll",
  "wheel",
  "touchstart",
  "touchmove",
  "focus",
];

export function IdleTimer({
  chatId,
  currentStep,
  disabled = false,
}: IdleTimerProps) {
  // Track abandonment so the idle-timer + pagehide handlers don't
  // double-fire if both happen to run.
  const abandonedRef = useRef(false);
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(20);
  // Hold a ref to the resetTimer closure so the "Keep me here" button
  // can call it without re-creating the effect (which would re-attach
  // the global listeners on every render).
  const resetTimerRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (disabled) return;

    let warningTimer: ReturnType<typeof setTimeout> | null = null;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    let countdownInterval: ReturnType<typeof setInterval> | null = null;

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

    function clearAllTimers() {
      if (warningTimer) {
        clearTimeout(warningTimer);
        warningTimer = null;
      }
      if (reloadTimer) {
        clearTimeout(reloadTimer);
        reloadTimer = null;
      }
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
    }

    function resetTimer() {
      if (abandonedRef.current) return;
      clearAllTimers();
      setShowWarning(false);
      setSecondsLeft(20);

      warningTimer = setTimeout(() => {
        // 4:40 reached — show the warning toast + start the 20s
        // countdown to reload.
        setShowWarning(true);
        setSecondsLeft(20);
        countdownInterval = setInterval(() => {
          setSecondsLeft((s) => Math.max(0, s - 1));
        }, 1000);

        reloadTimer = setTimeout(() => {
          if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
          }
          fireBeacon("idle_timer");
          try {
            window.location.reload();
          } catch {
            // ignore — beacon already fired
          }
        }, WARNING_BEFORE_MS);
      }, TIME_TO_WARNING_MS);
    }

    resetTimerRef.current = resetTimer;

    // 2026-05-23 bug fix: spurious-pagehide guard.
    //
    // The earlier version fired `fireBeacon("tab_close")` unconditionally on
    // any pagehide / beforeunload event, which on iOS Safari triggers
    // frequently during NORMAL booking flow:
    //   - Tapping a Server-Action-bound button (the browser fires a
    //     transient pagehide while the POST is in-flight, then pageshow
    //     when the response lands)
    //   - Pulling the notification tray, tapping the URL bar, brief
    //     home-button / app-switcher touches
    //   - Any back-forward cache (bfcache) transition (the page WILL be
    //     restored — event.persisted is true)
    //
    // The empirical signal: SQL queries showed appointment_holds being
    // released 2.5-7 seconds after creation (way too fast for the
    // 5-minute idle timer). The session was at status='timed_out' but
    // the audit log had no `session_abandoned` entry for that release —
    // because mark-abandoned's `void supabase.insert(...)` audit was
    // dropped by Vercel's response-flush before the insert completed.
    // The mark-abandoned UPDATE was the silent culprit.
    //
    // The fix has three layers (defense in depth):
    //   1. (HERE) Skip the beacon when event.persisted is true — bfcache
    //      transitions are NOT real abandons.
    //   2. (mark-abandoned route) Refuse to release a hold when
    //      last_active_at is < 5 seconds old — the user is mid-action.
    //   3. (applyWizardTransition) Write status='active' explicitly so a
    //      racing mark-abandoned that already flipped status='timed_out'
    //      gets corrected on the next wizard step.

    function onPagehide(event: PageTransitionEvent) {
      if (event.persisted) return;
      fireBeacon("tab_close");
    }
    function onBeforeUnload() {
      fireBeacon("tab_close");
    }

    // Attach to `window` (catches more than `document`) and use the
    // capture phase so stopPropagation()'d events still wake the timer.
    for (const evt of INTERACTIVE_EVENTS) {
      window.addEventListener(evt, resetTimer, { passive: true, capture: true });
    }
    // visibilitychange fires when the tab regains focus — treat that as
    // activity so coming back to a backgrounded tab resets the clock.
    document.addEventListener("visibilitychange", resetTimer, { passive: true });
    window.addEventListener("pagehide", onPagehide);
    window.addEventListener("beforeunload", onBeforeUnload);

    resetTimer();

    return () => {
      for (const evt of INTERACTIVE_EVENTS) {
        window.removeEventListener(evt, resetTimer, { capture: true });
      }
      document.removeEventListener("visibilitychange", resetTimer);
      window.removeEventListener("pagehide", onPagehide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      clearAllTimers();
    };
  }, [chatId, currentStep, disabled]);

  function handleExtend() {
    resetTimerRef.current();
  }

  if (!showWarning) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="idle-warn-title"
      aria-describedby="idle-warn-body"
      className={
        "fixed left-1/2 top-4 z-50 w-[calc(100%-2rem)] max-w-md " +
        "-translate-x-1/2 rounded-[var(--radius-card)] border border-rule " +
        "bg-paper-100 px-5 py-4 shadow-lg"
      }
    >
      <p
        id="idle-warn-title"
        className="font-display text-[18px] leading-tight text-ink"
      >
        Are you still there?
      </p>
      <p
        id="idle-warn-body"
        className="mt-2 text-[14px] leading-snug text-ink-secondary"
      >
        We&apos;ll reload this page in{" "}
        <span aria-live="off" className="font-medium text-ink">
          {secondsLeft}
        </span>{" "}
        seconds if there&apos;s no activity. Any interaction keeps you here.
      </p>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={handleExtend}
          className={
            "rounded-[var(--radius-card)] bg-brand-burgundy-700 px-4 py-2 " +
            "text-[14px] font-medium text-paper-100 " +
            "transition-colors duration-150 ease-out " +
            "hover:bg-brand-burgundy-800 " +
            "focus-visible:outline-2 focus-visible:outline-offset-2 " +
            "focus-visible:outline-brand-burgundy-500"
          }
        >
          Keep me here
        </button>
      </div>
    </div>
  );
}
