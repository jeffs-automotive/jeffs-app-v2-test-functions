"use client";

import { useState } from "react";

/**
 * ConfirmationCard rendering tool component.
 *
 * Per appointments_design.md §7.5 + §9 (slot hold + confirmation flow):
 * - Input: { appointment_id?, summary, starts_at, customer, vehicle, type, reminders[] }
 * - Output: { confirmed: boolean }
 *
 * Final read-back the customer sees before the orchestrator calls
 * confirm_appointment → Tekmetric POST /appointments. Customer taps
 * "Confirm" or "Cancel."
 *
 * For DROP-OFF appointments per §5: do NOT display a time. The orchestrator
 * uses 12:00 PM internally as a Tekmetric placeholder; customers never see
 * that. The starts_at field arrives as a date-only ISO ('2026-05-13') for
 * drop-offs vs full timestamp for waiters.
 */

export interface ConfirmationCardProps {
  /** Appointment summary (e.g., "Oil Change", "State Inspection + Brake Inspection"). */
  summary: string;
  /** ISO date or datetime depending on type. */
  starts_at: string;
  /** Customer display name (e.g., "Vince Zulauf"). */
  customer: string;
  /** Vehicle display label (e.g., "2018 Toyota Camry"). */
  vehicle: string;
  /** Appointment type — drives whether time is shown. */
  type: "waiter" | "dropoff";
  /** Service-specific reminders shown above the buttons. Per §5: */
  /**   - drop-off: "Please drop off your vehicle before 10 AM..." */
  /**   - state inspection: "Please bring up-to-date insurance and registration cards." */
  reminders?: string[];
  onSubmit: (output: { confirmed: boolean }) => void | Promise<void>;
  disabled?: boolean;
}

function formatStartsAt(iso: string, type: "waiter" | "dropoff"): string {
  // For dropoff, we get just a date (YYYY-MM-DD) — we never display the
  // placeholder 12:00 PM time per design §5.
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
  // Waiter: full datetime
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
    <div
      role="group"
      aria-labelledby="confirmation-heading"
      className="rounded-md border border-brand-burgundy-200 bg-brand-burgundy-50 p-4 shadow-sm"
    >
      <h3
        id="confirmation-heading"
        className="mb-3 text-base font-semibold text-brand-burgundy-800"
      >
        Just to confirm
      </h3>

      <dl className="mb-3 space-y-1 text-sm text-gray-800">
        <div className="flex flex-wrap">
          <dt className="w-28 font-medium">{type === "dropoff" ? "Drop off:" : "Appointment:"}</dt>
          <dd>{formatStartsAt(starts_at, type)}</dd>
        </div>
        <div className="flex flex-wrap">
          <dt className="w-28 font-medium">Customer:</dt>
          <dd>{customer}</dd>
        </div>
        <div className="flex flex-wrap">
          <dt className="w-28 font-medium">Vehicle:</dt>
          <dd>{vehicle}</dd>
        </div>
        <div className="flex flex-wrap">
          <dt className="w-28 font-medium">Service:</dt>
          <dd>{summary}</dd>
        </div>
      </dl>

      {reminders.length > 0 ? (
        <ul className="mb-3 list-disc rounded border border-brand-gold-300 bg-brand-gold-50 p-3 pl-7 text-sm text-gray-800">
          {reminders.map((r, idx) => (
            // eslint-disable-next-line react/no-array-index-key
            <li key={idx}>{r}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => void emit(false)}
          disabled={disabled || submitting}
          className="rounded border border-gray-300 bg-white px-4 py-2 text-base font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void emit(true)}
          disabled={disabled || submitting}
          className="rounded bg-brand-burgundy-700 px-4 py-2 text-base font-medium text-white hover:bg-brand-burgundy-800 disabled:opacity-50"
        >
          Confirm appointment
        </button>
      </div>
    </div>
  );
}
