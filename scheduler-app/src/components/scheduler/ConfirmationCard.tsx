"use client";

import { useState } from "react";

import { Button, Card } from "@/components/ui";

/**
 * ConfirmationCard rendering tool component (Heritage Editorial refactor 2026-05-13).
 *
 * Per appointments_design.md §7.5 + §9:
 * - Input: { summary, starts_at, customer, vehicle, type, reminders[] }
 * - Output: { confirmed: boolean }
 *
 * Legacy single-line summary view. The richer Step 10.1 review surface
 * lives in `heritage/SummaryCard.tsx` and is rendered via the new
 * `show_summary_card` directive. This card is kept for any orchestrator
 * paths still emitting the legacy `show_confirmation_card` / `render_confirmation_card`
 * directive — eventual deprecation TBD once all callers migrate.
 *
 * For DROP-OFF appointments: never display the 12:00 PM Tekmetric
 * placeholder. starts_at arrives as date-only for drop-offs.
 */

export interface ConfirmationCardProps {
  summary: string;
  starts_at: string;
  customer: string;
  vehicle: string;
  type: "waiter" | "dropoff";
  reminders?: string[];
  onSubmit: (output: { confirmed: boolean }) => void | Promise<void>;
  disabled?: boolean;
}

function formatStartsAt(iso: string, type: "waiter" | "dropoff"): string {
  if (type === "dropoff") {
    const [y, m, d] = iso.slice(0, 10).split("-").map((s) => Number.parseInt(s, 10));
    const date = new Date(y!, (m ?? 1) - 1, d ?? 1);
    return date.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }
  const date = new Date(iso);
  return `${date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })} at ${date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

export function ConfirmationCard({
  summary,
  starts_at,
  customer,
  vehicle,
  type,
  reminders = [],
  onSubmit,
  disabled = false,
}: ConfirmationCardProps) {
  const [submitting, setSubmitting] = useState(false);

  async function emit(confirmed: boolean) {
    if (disabled || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({ confirmed });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card aria-labelledby="confirmation-heading">
      <Card.Eyebrow>Step 10 · Just to confirm</Card.Eyebrow>
      <Card.Title id="confirmation-heading">
        Does this look right? ✅
      </Card.Title>

      <Card.Body className="space-y-3">
        <dl className="space-y-2 text-[15px]">
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="w-28 text-[13px] uppercase tracking-wider text-ink-tertiary">
              {type === "dropoff" ? "Drop off" : "Appointment"}
            </dt>
            <dd className="flex-1 font-display text-ink">
              {formatStartsAt(starts_at, type)}
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="w-28 text-[13px] uppercase tracking-wider text-ink-tertiary">
              Customer
            </dt>
            <dd className="flex-1 text-ink">{customer}</dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="w-28 text-[13px] uppercase tracking-wider text-ink-tertiary">
              Vehicle
            </dt>
            <dd className="flex-1 text-ink">{vehicle}</dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="w-28 text-[13px] uppercase tracking-wider text-ink-tertiary">
              Service
            </dt>
            <dd className="flex-1 text-ink">{summary}</dd>
          </div>
        </dl>

        {reminders.length > 0 ? (
          <div
            className="rounded-[var(--radius-input)] border-l-2 border-brand-gold-400 bg-paper-200 px-3 py-2 text-[14px] leading-relaxed text-ink"
            role="note"
          >
            <p className="mb-1 text-[12px] font-medium uppercase tracking-wider text-ink-tertiary">
              Please bring
            </p>
            <ul className="space-y-1">
              {reminders.map((r, idx) => (
                // eslint-disable-next-line react/no-array-index-key
                <li key={idx}>• {r}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card.Body>

      <Card.Actions align="between">
        <Button
          variant="secondary"
          size="md"
          disabled={disabled || submitting}
          onClick={() => void emit(false)}
          fullWidthOnMobile
        >
          Edit something
        </Button>
        <Button
          variant="primary"
          size="md"
          loading={submitting}
          disabled={disabled}
          onClick={() => void emit(true)}
          fullWidthOnMobile
        >
          Confirm appointment 🔑
        </Button>
      </Card.Actions>
    </Card>
  );
}
