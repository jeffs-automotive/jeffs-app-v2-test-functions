"use client";

import { useMemo, useState } from "react";

import { Card } from "@/components/ui";

/**
 * CalendarDatePicker rendering tool component (Heritage Editorial refactor 2026-05-13).
 *
 * Per appointments_design.md §7.5:
 * - Input: { available_dates, type, initial_focus_date?, range_end? }
 * - Output: { selected_date: string }
 *
 * Phase 1 calendar UI: simple month grid (current + nav). 365-day booking
 * horizon per design lock. Heritage-styled month nav + gold-rule grid
 * separators + burgundy "available" cells.
 */

export interface CalendarDatePickerProps {
  available_dates: string[];
  type: "waiter" | "dropoff";
  initial_focus_date?: string;
  /** Inclusive end-of-range. Default = today + 365 days per design lock. */
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

function buildMonthGrid(year: number, month: number): Array<Date | null> {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
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
        : new Date(today.getFullYear(), today.getMonth(), today.getDate() + 365),
    [range_end, today],
  );

  const initialFocus = initial_focus_date ? parseIso(initial_focus_date) : today;
  const [viewYear, setViewYear] = useState(initialFocus.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialFocus.getMonth());
  const [submitting, setSubmitting] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const availableSet = useMemo(
    () => new Set(available_dates),
    [available_dates],
  );

  const grid = useMemo(
    () => buildMonthGrid(viewYear, viewMonth),
    [viewYear, viewMonth],
  );

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString(
    undefined,
    { month: "long", year: "numeric" },
  );

  function isInRange(d: Date): boolean {
    return d >= today && d <= rangeEndDate;
  }

  async function pick(iso: string) {
    if (disabled || submitting) return;
    setSubmitting(true);
    setPicked(iso);
    try {
      await onSubmit({ selected_date: iso });
      // 2026-05-17 fix: keep `submitting=true` after a successful submit.
      // The parent re-renders (via router.refresh()) and unmounts this
      // component, so the lingering disabled state is gone the moment the
      // next card renders. Resetting it in a `finally` previously created
      // a window where the buttons re-enabled BEFORE the new RSC arrived —
      // the customer would tap another date thinking "nothing happened",
      // and the second submit would win, leaving them feeling like the
      // calendar advanced on a timer with whichever date they tapped last.
    } catch (e) {
      // Only reset on a hard throw (rare — server actions return
      // discriminated results, they don't normally reject). Lets the
      // customer retry without a full reload.
      setSubmitting(false);
      throw e;
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

  const minViewMonth = today.getMonth();
  const minViewYear = today.getFullYear();
  const canNavBack =
    viewYear > minViewYear ||
    (viewYear === minViewYear && viewMonth > minViewMonth);

  return (
    <Card aria-labelledby="calendar-heading">
      <Card.Eyebrow>
        {type === "waiter" ? "Wait while we work" : "Drop off"}
      </Card.Eyebrow>
      <Card.Title id="calendar-heading">
        Pick a date that works 📅
      </Card.Title>
      <Card.Description>
        Tap an available day below. Greyed-out days are closed or full —
        you can scroll forward up to a year.
      </Card.Description>

      <Card.Body>
        <div className="flex items-center justify-between border-b border-rule pb-2">
          <button
            type="button"
            onClick={() => nav(-1)}
            disabled={!canNavBack || disabled || submitting}
            aria-label="Previous month"
            className={
              "rounded-[var(--radius-input)] px-2 py-1 text-ink-secondary " +
              "hover:bg-paper-200 disabled:opacity-30 disabled:cursor-not-allowed " +
              "focus-visible:outline-2 focus-visible:outline-offset-2 " +
              "focus-visible:outline-brand-burgundy-500"
            }
          >
            ←
          </button>
          <span className="font-display text-[18px] font-medium text-ink">
            {monthLabel}
          </span>
          <button
            type="button"
            onClick={() => nav(1)}
            disabled={disabled || submitting}
            aria-label="Next month"
            className={
              "rounded-[var(--radius-input)] px-2 py-1 text-ink-secondary " +
              "hover:bg-paper-200 disabled:opacity-30 disabled:cursor-not-allowed " +
              "focus-visible:outline-2 focus-visible:outline-offset-2 " +
              "focus-visible:outline-brand-burgundy-500"
            }
          >
            →
          </button>
        </div>

        <div
          role="grid"
          aria-label="Calendar dates"
          className="mt-3 grid grid-cols-7 gap-1"
        >
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              role="columnheader"
              className="py-1 text-center text-[11px] font-medium uppercase tracking-wider text-ink-tertiary"
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
            const isPicked = picked === iso;

            return (
              <button
                key={iso}
                type="button"
                role="gridcell"
                onClick={() => isAvailable && void pick(iso)}
                disabled={disabled || submitting || !isAvailable}
                aria-disabled={!isAvailable}
                aria-label={`${d.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}${isAvailable ? "" : " (unavailable)"}`}
                className={
                  "aspect-square rounded-[var(--radius-input)] text-[14px] " +
                  "transition-colors duration-150 ease-out " +
                  "focus-visible:outline-2 focus-visible:outline-offset-2 " +
                  "focus-visible:outline-brand-burgundy-500 " +
                  (isPicked
                    ? "bg-brand-burgundy-700 text-paper-100 font-semibold"
                    : isAvailable
                      ? "bg-brand-burgundy-50 text-brand-burgundy-800 hover:bg-brand-burgundy-700 hover:text-paper-100"
                      : isPast || !inRange
                        ? "text-ink-tertiary opacity-40"
                        : "text-ink-tertiary line-through")
                }
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>

        <p className="mt-3 flex items-center gap-4 text-[12px] text-ink-tertiary">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded-sm bg-brand-burgundy-50"
            />
            Available
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded-sm bg-paper-200 line-through"
            />
            Closed or full
          </span>
        </p>

        {available_dates.length === 0 ? (
          <p className="mt-3 text-[14px] leading-relaxed text-ink-secondary">
            No openings in this window. Please call us at{" "}
            <a
              className="font-medium text-brand-burgundy-700 hover:underline"
              href="tel:6102536565"
            >
              (610) 253-6565
            </a>
            .
          </p>
        ) : null}

        {submitting ? (
          <p
            role="status"
            aria-live="polite"
            className="mt-3 flex items-center gap-2 text-[14px] font-medium text-brand-burgundy-700"
          >
            <span
              aria-hidden
              className="inline-block h-3 w-3 animate-pulse rounded-full bg-brand-burgundy-700"
            />
            Reserving your date — one moment…
          </p>
        ) : null}
      </Card.Body>
    </Card>
  );
}
