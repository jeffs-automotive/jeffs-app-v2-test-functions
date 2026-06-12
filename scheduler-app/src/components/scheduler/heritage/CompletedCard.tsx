"use client";

import { useState } from "react";
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";

import { Button, Card } from "@/components/ui";

/**
 * Step 10.5 — Final completed card.
 *
 * Terminal state after Step 10.3 (CustomerQuestionCard) submits — confirms
 * the appointment is booked and offers a "Schedule another" CTA per
 * chat-design.md §10.5 (lines 2473-2497). The customer's confirmation
 * details + reminders were already shown in SummaryCard; this card is the
 * editorial close-out: warm Jeff-voice thanks + (optional) restart path.
 *
 * Props are sparse on purpose — the row + summary already carries the
 * appointment details. This card is presentation-only.
 */

export interface CompletedCardProps {
  /** Customer first name (verified or entered) — for warm greeting. */
  first_name?: string | null;
  /** Optional appointment time string for friendly recap, e.g. "Tue, May 14 at 9:00 AM". */
  appointment_label?: string | null;
  /** Whether "Schedule another" should be shown — defaults to true. */
  allow_schedule_another?: boolean;
  /** Disable buttons (e.g., while a refresh is in flight). */
  disabled?: boolean;
  /** Fires on "Schedule another" — server-side starts a fresh session. */
  onScheduleAnother?: () => void | Promise<void>;
  /** Fires on "Close" — typically a no-op (tab close); we just dismiss the card. */
  onClose?: () => void | Promise<void>;
}

export function CompletedCard({
  first_name,
  appointment_label,
  allow_schedule_another = true,
  disabled = false,
  onScheduleAnother,
  onClose,
}: CompletedCardProps) {
  const [pending, setPending] = useState<"another" | "close" | null>(null);
  // motion/react JS animations are NOT covered by the CSS reduced-motion
  // kill-switch in globals.css (it only zeroes CSS durations) — gate via hook.
  const reduceMotion = useReducedMotion();

  async function fire(kind: "another" | "close", fn?: () => void | Promise<void>) {
    if (pending || disabled || !fn) return;
    setPending(kind);
    try {
      await fn();
    } finally {
      setPending(null);
    }
  }

  const greeting = first_name?.trim().length
    ? `You're all set, ${first_name.trim()}.`
    : "You're all set.";

  return (
    <Card aria-labelledby="completed-card-title">
      <Card.Eyebrow>All done</Card.Eyebrow>
      {/* Confirmed tick badge — one-shot scale+fade celebration, contained in
          the card. LazyMotion strict (m.* not motion.*); reduced-motion gated
          via useReducedMotion (the CSS kill-switch can't reach JS animations). */}
      <LazyMotion features={domAnimation} strict>
        <m.div
          initial={reduceMotion ? false : { opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 0.35, ease: [0.16, 1, 0.3, 1] }
          }
          aria-hidden
          className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-burgundy-700 text-paper-100"
        >
          <span className="text-[18px] leading-none">✓</span>
        </m.div>
      </LazyMotion>
      <Card.Title id="completed-card-title">{greeting} 🎉</Card.Title>
      <Card.Description>
        We&apos;ll see you{" "}
        {appointment_label ? (
          <strong className="text-ink">{appointment_label}</strong>
        ) : (
          "soon"
        )}
        . If anything comes up, text or call us at{" "}
        <a
          href="tel:6102536565"
          className="font-medium text-brand-burgundy-700 underline-offset-2 hover:underline"
        >
          (610) 253-6565
        </a>{" "}
        and someone on our team will help you out.
      </Card.Description>

      <Card.Body>
        {/* What-happens-next — static, presentational copy in Jeff's voice
            (reflects what the system already does). Generic enough to be true
            for every booking; no per-appointment claims beyond the existing
            appointment_label prop. */}
        <p className="label-eyebrow mb-2">What happens next</p>
        <ul className="space-y-2 text-[14px] leading-relaxed text-ink-secondary">
          <li className="flex gap-2.5">
            <span aria-hidden className="shrink-0">
              ✅
            </span>
            <span>We&apos;ve booked it in our system</span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden className="shrink-0">
              📲
            </span>
            <span>You&apos;ll get a text/call confirmation</span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden className="shrink-0">
              🔑
            </span>
            <span>Bring your keys and we&apos;ll take it from here</span>
          </li>
        </ul>

        <Card.Divider />

        <p className="text-sm leading-relaxed text-ink-secondary">
          Thanks for choosing Jeff&apos;s Automotive — we appreciate it. A
          confirmation summary stays in this chat for your reference.
        </p>
      </Card.Body>

      <Card.Actions align="between">
        <Button
          variant="ghost"
          size="md"
          disabled={pending !== null || disabled}
          onClick={() => fire("close", onClose)}
          fullWidthOnMobile
        >
          Close
        </Button>
        {allow_schedule_another ? (
          <Button
            variant="primary"
            size="md"
            loading={pending === "another"}
            disabled={pending !== null || disabled}
            onClick={() => fire("another", onScheduleAnother)}
            fullWidthOnMobile
          >
            Schedule another
          </Button>
        ) : null}
      </Card.Actions>

      <Card.Footnote>
        Family-owned since 1976 · Questions?{" "}
        <a
          href="tel:6102536565"
          className="font-medium text-brand-burgundy-700 underline-offset-2 hover:underline"
        >
          (610) 253-6565
        </a>
      </Card.Footnote>
    </Card>
  );
}
