"use client";

import { useState } from "react";

import { Button, Card } from "@/components/ui";

/**
 * Step 8 — Appointment type picker (waiter vs dropoff).
 *
 * Renders two clear options:
 *   - Waiter ☕  ("wait while we work — usually 30-60 min for the services
 *     you picked")
 *   - Dropoff 🚗 ("drop off in the morning, pick up later")
 *
 * One option may be DISABLED when the customer's service set is not
 * wait-eligible (e.g. brake job). The disabled state shows a brief reason.
 * The orchestrator pre-computes eligibility from routine_services.wait_eligible.
 */

export interface AppointmentTypeCardProps {
  /** Available types. Each carries a label + optional disabled-reason. */
  options: Array<{
    type: "waiter" | "dropoff";
    available: boolean;
    /** Reason shown when available=false (e.g. "service can't be done while you wait"). */
    unavailable_reason?: string;
    /** Earliest available date hint for the choice (e.g. "Mon May 19"). */
    earliest_hint?: string;
  }>;
  disabled?: boolean;
  onSubmit: (output: { appointment_type: "waiter" | "dropoff" }) => void | Promise<void>;
}

const TYPE_META: Record<
  "waiter" | "dropoff",
  { title: string; description: string; emoji: string }
> = {
  waiter: {
    title: "Wait while we work",
    description:
      "Grab a coffee — most waiter jobs are 30 to 60 minutes. Available at 8 AM or 9 AM.",
    emoji: "☕",
  },
  dropoff: {
    title: "Drop off in the morning",
    description:
      "Drop your car off by 10 AM. We'll text or call when it's ready.",
    emoji: "🚗",
  },
};

export function AppointmentTypeCard({
  options,
  disabled = false,
  onSubmit,
}: AppointmentTypeCardProps) {
  const [pending, setPending] = useState(false);
  const [picked, setPicked] = useState<"waiter" | "dropoff" | null>(null);

  async function submit(type: "waiter" | "dropoff") {
    if (pending || disabled) return;
    setPicked(type);
    setPending(true);
    try {
      await onSubmit({ appointment_type: type });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card aria-labelledby="appt-type-title">
      <Card.Eyebrow>How would you like to come in?</Card.Eyebrow>
      <Card.Title id="appt-type-title">Waiter or dropoff?</Card.Title>

      <Card.Body className="space-y-3">
        {options.map((opt) => {
          const meta = TYPE_META[opt.type];
          const isPicked = picked === opt.type;
          const isAvailable = opt.available;
          return (
            <button
              key={opt.type}
              type="button"
              disabled={!isAvailable || pending || disabled}
              onClick={() => submit(opt.type)}
              aria-pressed={isPicked}
              aria-describedby={
                !isAvailable && opt.unavailable_reason
                  ? `appt-type-${opt.type}-reason`
                  : undefined
              }
              className={
                "block w-full rounded-[var(--radius-card)] border px-5 py-4 " +
                "text-left transition-colors duration-150 ease-out " +
                "focus-visible:outline-2 focus-visible:outline-offset-2 " +
                "focus-visible:outline-brand-burgundy-500 " +
                (isAvailable
                  ? isPicked
                    ? "border-brand-burgundy-700 bg-brand-burgundy-50"
                    : "border-rule bg-paper-100 hover:border-rule-strong hover:bg-paper-200"
                  : "border-rule bg-paper-200 opacity-60 cursor-not-allowed")
              }
            >
              <span className="flex items-start gap-3">
                <span aria-hidden className="text-2xl">
                  {meta.emoji}
                </span>
                <span className="flex-1">
                  <span className="block font-display text-lg leading-tight text-ink">
                    {meta.title}
                  </span>
                  <span className="mt-1 block text-[14px] leading-relaxed text-ink-secondary">
                    {meta.description}
                  </span>
                  {opt.earliest_hint && isAvailable ? (
                    <span className="mt-2 block text-[13px] text-brand-burgundy-700">
                      Earliest: {opt.earliest_hint}
                    </span>
                  ) : null}
                  {!isAvailable && opt.unavailable_reason ? (
                    <span
                      id={`appt-type-${opt.type}-reason`}
                      className="mt-2 block text-[13px] text-ink-tertiary"
                    >
                      {opt.unavailable_reason}
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
          );
        })}
      </Card.Body>

      <Card.Footnote>
        Tap a card to continue. You&apos;ll pick the date next.
      </Card.Footnote>
    </Card>
  );
}
