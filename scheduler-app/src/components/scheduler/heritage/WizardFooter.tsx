"use client";

import { useState } from "react";

import { Button } from "@/components/ui";

/**
 * Always-visible footer affordances per Chris's design lock 2026-05-13:
 *
 *   [🔄 Start over]                          [📞 Talk to a person]
 *
 * Per chat-design.md, these buttons are present at the bottom of EVERY
 * wizard step — the customer can bail out anytime. Each button shows a
 * 2-tap confirmation (the design lock specifies "Are you sure?" because
 * accidental taps would destroy in-flight data).
 *
 * The footer calls the onStartOver / onEscalate callbacks the parent
 * provides.
 */

export interface WizardFooterProps {
  /** Called when the customer confirms "start over". Restart wipes session
   *  state and returns the wizard to the greeting. */
  onStartOver: () => void | Promise<void>;
  /** Called when the customer confirms "talk to a person". Escalates the
   *  session and surfaces the shop phone. */
  onEscalate: () => void | Promise<void>;
  /** Disabled while an action is in flight (no double-fire). */
  disabled?: boolean;
}

export function WizardFooter({
  onStartOver,
  onEscalate,
  disabled = false,
}: WizardFooterProps) {
  const [confirming, setConfirming] = useState<"start" | "escalate" | null>(null);
  const [pending, setPending] = useState(false);

  async function handleStart() {
    if (pending) return;
    if (confirming !== "start") {
      setConfirming("start");
      return;
    }
    setPending(true);
    try {
      await onStartOver();
    } finally {
      setPending(false);
      setConfirming(null);
    }
  }

  async function handleEscalate() {
    if (pending) return;
    if (confirming !== "escalate") {
      setConfirming("escalate");
      return;
    }
    setPending(true);
    try {
      await onEscalate();
    } finally {
      setPending(false);
      setConfirming(null);
    }
  }

  return (
    <footer
      aria-label="Wizard actions"
      className="sticky bottom-0 z-10 mt-6 border-t border-rule bg-paper-100/95 px-4 py-3 backdrop-blur"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || pending}
            onClick={handleStart}
            leadingIcon="🔄"
            fullWidthOnMobile={false}
            aria-pressed={confirming === "start"}
          >
            {confirming === "start" ? "Tap again to confirm" : "Start over"}
          </Button>
          {confirming === "start" ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled || pending}
              onClick={() => setConfirming(null)}
              fullWidthOnMobile={false}
            >
              Never mind
            </Button>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {confirming === "escalate" ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled || pending}
              onClick={() => setConfirming(null)}
              fullWidthOnMobile={false}
            >
              Never mind
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || pending}
            loading={pending && confirming === "escalate"}
            onClick={handleEscalate}
            leadingIcon="📞"
            fullWidthOnMobile={false}
            aria-pressed={confirming === "escalate"}
          >
            {confirming === "escalate" ? "Tap again to confirm" : "Talk to a person"}
          </Button>
        </div>
      </div>
    </footer>
  );
}
