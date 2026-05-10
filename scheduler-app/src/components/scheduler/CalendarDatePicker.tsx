"use client";

import { useMemo, useState } from "react";

/**
 * CalendarDatePicker rendering tool component.
 *
 * Per appointments_design.md §7.5:
 * - Input: {
 *     available_dates: string[]   // ISO YYYY-MM-DD; only these are clickable
 *     type: 'waiter' | 'dropoff'
 *     initial_focus_date?: string
 *     range_end?: string          // default = today + 60 days
 *   }
 * - Output: { selected_date: string }
 *
 * Phase 1 calendar UI: simple month grid (current month + next month visible
 * on demand). Mobile-first. Accessible (keyboard arrow-nav, aria-disabled,
 * date-button labels). Re-uses brand tokens.
 *
 * Phase 2 may swap in a richer calendar (react-day-picker) — for now this
 * stays minimal-deps + correct.
 */

export interface CalendarDatePickerProps {
  available_dates: string[];
  type: "waiter" | "dropoff";
  initial_focus_date?: string;
  /** Inclusive end-of-range. Defaults to today + 60 days. */
  range_end?: string;
  onSubmit: (output: { selected_date: string }) => void | Promise<void>;
  disabled?: boolean;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function toIso(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map((s) => Number.parseInt(s, 10));
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/** Build the grid for one month: an array of 42 (6 weeks × 7 days) values; null = padding. */
function buildMonthGrid(year: number, month: number): Array<Date | null> {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const grid: Array<Date | null> = [];
  for (let i = 0; i < startOffset; i++) grid.push(null);
  for (let d = 1; d <= daysInMonth; d++) grid.push(new Date(year, month, d));
  while (grid.length < 42) grid.push(null);
  return grid;
}

export function CalendarDatePicker({
  available_dates,
  type,
  initial_focus_date,
  range_end,
  onSubmit,
  disabled = false,
}: CalendarDatePickerProps) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const rangeEndDate = useMemo(
    () =>
      range_end
        ? parseIso(range_end)
        : new Date(today.getFullYear(), today.getMonth(), today.getDate() + 60),
    [range_end, today]
  );

  // Track which month we're showing — start with the month of today (or the
  // initial_focus_date if provided)
  const initialFocus = initial_focus_date ? parseIso(initial_focus_date) : today;
  const [viewYear, setViewYear] = useState(initialFocus.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialFocus.getMonth());
  const [submitting, setSubmitting] = useState(false);

  const availableSet = useMemo(
    () => new Set(available_dates),
    [available_dates]
  );

  const grid = useMemo(
    () => buildMonthGrid(viewYear, viewMonth),
    [viewYear, viewMonth]
  );

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString(
    undefined,
    { month: "long", year: "numeric" }
  );

  function isInRange(d: Date): boolean {
    return d >= today && d <= rangeEndDate;
  }

  async function pick(iso: string) {
    if (disabled || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({ selected_date: iso });
    } finally {
      setSubmitting(false);
    }
  }

  function nav(deltaMonths: number) {
    let m = viewMonth + deltaMonths;
    let y = viewYear;
    while (m < 0) {
      m += 12;
      y -= 1;
    }
    while (m > 11) {
      m -= 12;
      y += 1;
    }
    setViewYear(y);
    setViewMonth(m);
  }

  // Allow nav when there's at least one available date in the target window.
  // Disable "back" if all available dates are in the future and we're at the
  // current month.
  const minViewMonth = today.getMonth();
  const minViewYear = today.getFullYear();
  const canNavBack =
    viewYear > minViewYear ||
    (viewYear === minViewYear && viewMonth > minViewMonth);

  return (
    <div
      role="group"
      aria-labelledby="calendar-heading"
      className="rounded-md border border-gray-200 bg-white p-4 shadow-sm"
    >
      <div className="mb-3 flex items-center justify-between">
        <h3
          id="calendar-heading"
          className="text-sm font-medium text-gray-900"
        >
          Pick a date
          <span className="ml-1 font-normal text-gray-500">
            ({type === "waiter" ? "wait while we work on it" : "drop off"})
          </span>
        </h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => nav(-1)}
            disabled={!canNavBack || disabled}
            aria-label="Previous month"
            className="rounded p-1 text-gray-600 hover:bg-gray-100 disabled:opacity-30"
          >
            ←
          </button>
          <span className="px-2 text-sm font-medium text-gray-700">
            {monthLabel}
          </span>
          <button
            type="button"
            onClick={() => nav(1)}
            disabled={disabled}
            aria-label="Next month"
            className="rounded p-1 text-gray-600 hover:bg-gray-100 disabled:opacity-30"
          >
            →
          </button>
        </div>
      </div>

      <div role="grid" aria-label="Calendar dates" className="grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            role="columnheader"
            className="py-1 text-center text-xs font-medium text-gray-500"
          >
            {label}
          </div>
        ))}

        {grid.map((d, idx) => {
          if (!d) {
            return (
              // eslint-disable-next-line react/no-array-index-key
              <div key={`pad-${idx}`} role="gridcell" aria-hidden="true" />
            );
          }
          const iso = toIso(d);
          const inRange = isInRange(d);
          const isAvailable = inRange && availableSet.has(iso);
          const isPast = d < today;

          return (
            <button
              key={iso}
              type="button"
              role="gridcell"
              onClick={() => isAvailable && void pick(iso)}
              disabled={disabled || !isAvailable}
              aria-disabled={!isAvailable}
              aria-label={`${d.toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}${isAvailable ? "" : " (unavailable)"}`}
              className={[
                "aspect-square rounded text-sm",
                isAvailable
                  ? "bg-brand-burgundy-50 text-brand-burgundy-800 hover:bg-brand-burgundy-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-burgundy-700"
                  : isPast || !inRange
                    ? "text-gray-300"
                    : "bg-gray-50 text-gray-400 line-through",
              ].join(" ")}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-gray-500">
        <span className="inline-block h-3 w-3 rounded-sm bg-brand-burgundy-50 align-middle" />{" "}
        Available
        <span className="ml-3 inline-block h-3 w-3 rounded-sm bg-gray-50 align-middle" />{" "}
        Closed / full
      </p>

      {available_dates.length === 0 ? (
        <p className="mt-2 text-sm text-gray-700">
          No openings in this window. Please call us at{" "}
          <a
            className="font-medium text-brand-burgundy-700 underline"
            href="tel:6102536565"
          >
            (610) 253-6565
          </a>
          .
        </p>
      ) : null}
    </div>
  );
}
