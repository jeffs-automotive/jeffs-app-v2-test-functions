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
