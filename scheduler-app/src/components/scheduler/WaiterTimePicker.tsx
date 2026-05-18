"use client";

import { useState } from "react";

import { Card } from "@/components/ui";

/**
 * WaiterTimePicker rendering tool component (Heritage Editorial refactor 2026-05-13).
 *
 * Per appointments_design.md §7.5:
 * - Input: { date: string, available_times: string[] }   // '08:00' or '09:00' or both
 * - Output: { selected_time: string }
 *
 * Used only for the WAITER appointment type (drop-offs skip time selection).
 * Phase 1 only has 8 AM + 9 AM but the component accepts any subset.
 */

export interface WaiterTimePickerProps {
  date: string;
  available_times: string[];
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
  const [picked, setPicked] = useState<string | null>(null);

  async function pick(time: string) {
    if (disabled || submitting) return;
    setSubmitting(true);
    setPicked(time);
    try {
      await onSubmit({ selected_time: time });
      // 2026-05-17 mirror of CalendarDatePicker fix: stay disabled after
      // a successful submit; parent revalidation unmounts us so the
      // lingering disabled state never reaches the customer's view.
    } catch (e) {
      setSubmitting(false);
      throw e;
    }
  }

  return (
    <Card aria-labelledby="waiter-time-heading">
      <Card.Eyebrow>Waiter time</Card.Eyebrow>
      <Card.Title id="waiter-time-heading">What time works? ☕</Card.Title>
      <Card.Description>{formatDateForDisplay(date)}</Card.Description>

      <Card.Body>
        {available_times.length === 0 ? (
          <p className="text-[14px] leading-relaxed text-ink-secondary">
            No waiter slots open that day. Pick a different day above, or
            call us at{" "}
            <a
              className="font-medium text-brand-burgundy-700 hover:underline"
              href="tel:6102536565"
            >
              (610) 253-6565
            </a>
            .
          </p>
        ) : (
          <div className="flex flex-wrap gap-2.5">
            {available_times.map((time) => {
              const isPicked = picked === time;
              return (
                <button
                  key={time}
                  type="button"
                  onClick={() => void pick(time)}
                  disabled={disabled || submitting}
                  aria-pressed={isPicked}
                  className={
                    "min-h-12 min-w-28 rounded-[var(--radius-card)] border px-5 py-3 " +
                    "text-[16px] font-display transition-colors duration-150 ease-out " +
                    "focus-visible:outline-2 focus-visible:outline-offset-2 " +
                    "focus-visible:outline-brand-burgundy-500 " +
                    "disabled:opacity-60 disabled:cursor-not-allowed " +
                    (isPicked
                      ? "border-brand-burgundy-700 bg-brand-burgundy-700 text-paper-100"
                      : "border-rule bg-paper-100 text-ink hover:border-brand-burgundy-500 hover:bg-brand-burgundy-50")
                  }
                >
                  {formatHHMMForDisplay(time)}
                </button>
              );
            })}
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
