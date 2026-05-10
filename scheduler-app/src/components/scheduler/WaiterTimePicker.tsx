"use client";

import { useState } from "react";

/**
 * WaiterTimePicker rendering tool component.
 *
 * Per appointments_design.md §7.5:
 * - Input: { date: string, available_times: string[] }   // '08:00' or '09:00' or both
 * - Output: { selected_time: string }
 *
 * Used only for the WAITER appointment type, after the customer picks a date
 * via CalendarDatePicker. Never rendered for drop-off (drop-offs skip the
 * time selection entirely per design §5).
 *
 * Phase 1 has only two possible times — 08:00 and 09:00 — but this component
 * accepts any subset (and could be extended to other times in Phase 2 by
 * just passing a longer available_times array).
 */

export interface WaiterTimePickerProps {
  date: string;                           // ISO YYYY-MM-DD for display
  available_times: string[];              // 'HH:MM' format
  onSubmit: (output: { selected_time: string }) => void | Promise<void>;
  disabled?: boolean;
}

function formatHHMMForDisplay(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number.parseInt(hStr ?? "0", 10);
  const m = Number.parseInt(mStr ?? "0", 10);
  const period = h < 12 ? "AM" : "PM";
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return m === 0
    ? `${displayHour} ${period}`
    : `${displayHour}:${String(m).padStart(2, "0")} ${period}`;
}

function formatDateForDisplay(iso: string): string {
  const [y, m, d] = iso.split("-").map((s) => Number.parseInt(s, 10));
  const date = new Date(y!, (m ?? 1) - 1, d ?? 1);
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function WaiterTimePicker({
  date,
  available_times,
  onSubmit,
  disabled = false,
}: WaiterTimePickerProps) {
  const [submitting, setSubmitting] = useState(false);

  async function pick(time: string) {
    if (disabled || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({ selected_time: time });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="group"
      aria-labelledby="waiter-time-heading"
      className="rounded-md border border-gray-200 bg-white p-4 shadow-sm"
    >
      <h3
        id="waiter-time-heading"
        className="mb-1 text-sm font-medium text-gray-900"
      >
        Pick a time
      </h3>
      <p className="mb-3 text-sm text-gray-600">
        {formatDateForDisplay(date)}
      </p>

      {available_times.length === 0 ? (
        <p className="text-sm text-gray-700">
          No waiter slots open that day. Please pick a different day or call us
          at{" "}
          <a
            className="font-medium text-brand-burgundy-700 underline"
            href="tel:6102536565"
          >
            (610) 253-6565
          </a>
          .
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {available_times.map((time) => (
            <button
              key={time}
              type="button"
              onClick={() => void pick(time)}
              disabled={disabled || submitting}
              className="rounded border border-gray-300 px-4 py-3 text-base hover:border-brand-burgundy-700 hover:bg-brand-burgundy-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-burgundy-700"
            >
              {formatHHMMForDisplay(time)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
