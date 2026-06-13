"use client";

import { useEffect, useState } from "react";

import { Button, Card } from "@/components/ui";

/**
 * Step 10.1 — Pre-confirmation Summary card.
 *
 * Replaces the legacy ConfirmationCard with a richer Heritage-style review
 * surface per chat-design.md §10.1. Shows:
 *   - Date + time + appointment type
 *   - Customer name (post-verification)
 *   - Vehicle (year/make/model)
 *   - Services breakdown — routine + concerns + testing
 *   - Pre-appointment reminders (state inspection paperwork etc.)
 *   - Hold countdown (10-min TTL per design lock 2026-05-13)
 *
 * Edit-from-summary: 2-edit cap enforced by the submit-summary action.
 * This card just exposes [Edit something], which submits a non-confirm.
 *
 * Confirmation button is disabled when the hold has expired; if a confirm
 * slips through, the submit-summary action detects the expired hold and
 * bounces the customer back to pick a new date.
 */

interface SummaryService {
  display_name: string;
  /** Routine | concern | testing — drives the section grouping. */
  kind: "routine" | "concern" | "testing";
  /** Optional starting price for testing services. */
  starting_price_cents?: number;
  /** Optional notes (concern explanation, testing description). */
  notes?: string;
}

export interface SummaryCardProps {
  hold_id?: string;
  /** ISO timestamp when the hold expires. Drives the countdown timer. */
  hold_expires_at?: string;
  /** ISO timestamp of the appointment (or just the date for dropoff). */
  starts_at: string;
  /** Customer name display (e.g. "Sarah Johnson"). */
  customer: string;
  /** Vehicle display (e.g. "2018 Toyota Camry"). */
  vehicle: string;
  /** Appointment type — drives reminder logic. */
  type: "waiter" | "dropoff";
  /** Combined services list (routine + concern + testing). */
  services: SummaryService[];
  /** Pre-appointment reminders. */
  reminders: string[];
  /** TRUE when the appointment is for today in shop-local time. Drives
   *  copy: "Dropoff 🚗 — drop off as soon as you can today" instead of
   *  the standard "Dropoff 🚗 — please drop off before 10 AM" since the
   *  10 AM guidance may already be past. Optional; defaults to false.
   *  Added 2026-05-18. */
  is_same_day?: boolean;
  disabled?: boolean;
  onSubmit: (output: {
    confirmed: boolean;
    /** When confirmed=false + edit_target set, the submit-summary action routes to the matching edit step. */
    edit_target?: "date" | "vehicle" | "services" | "other";
  }) => void | Promise<void>;
}

function fmtPrice(cents: number): string {
  if (cents === 0) return "Included";
  return `$${(cents / 100).toFixed(2)}+`;
}

function fmtStarts(iso: string, type: "waiter" | "dropoff"): string {
  try {
    const d = new Date(iso);
    const datePart = d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "America/New_York",
    });
    if (type === "dropoff") return datePart;
    const timePart = d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });
    return `${datePart} at ${timePart}`;
  } catch {
    return iso;
  }
}

/** Format remaining milliseconds as "9:42" / "0:38". */
function fmtCountdown(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export function SummaryCard({
  hold_id,
  hold_expires_at,
  starts_at,
  customer,
  vehicle,
  type,
  services,
  reminders,
  is_same_day = false,
  disabled = false,
  onSubmit,
}: SummaryCardProps) {
  const [pending, setPending] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(() => {
    if (!hold_expires_at) return null;
    return new Date(hold_expires_at).getTime() - Date.now();
  });

  // 10-min hold countdown — tick every second
  useEffect(() => {
    if (!hold_expires_at) {
      setRemaining(null);
      return;
    }
    const target = new Date(hold_expires_at).getTime();
    const tick = () => setRemaining(target - Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [hold_expires_at]);

  const holdExpired = remaining !== null && remaining <= 0;

  async function confirm() {
    if (pending || disabled || holdExpired) return;
    setPending(true);
    try {
      await onSubmit({ confirmed: true });
    } finally {
      setPending(false);
    }
  }

  async function requestEdit() {
    if (pending || disabled) return;
    setPending(true);
    try {
      await onSubmit({ confirmed: false, edit_target: "other" });
    } finally {
      setPending(false);
    }
  }

  // Group services for sectioning
  const routine = services.filter((s) => s.kind === "routine");
  const concerns = services.filter((s) => s.kind === "concern");
  const testing = services.filter((s) => s.kind === "testing");

  return (
    <Card aria-labelledby="summary-title">
      <Card.Eyebrow>Review before confirming</Card.Eyebrow>
      <Card.Title id="summary-title">
        Quick look — does this all look right? ✅
      </Card.Title>

      <Card.Body className="space-y-5">
        {/* Time + type */}
        <section>
          <p className="label-eyebrow mb-1">Appointment</p>
          <p className="font-display text-lg text-ink">{fmtStarts(starts_at, type)}</p>
          <p className="mt-0.5 text-[14px] text-ink-secondary">
            {type === "waiter"
              ? "Waiter ☕"
              : is_same_day
                ? "Dropoff 🚗 — drop off as soon as you can today"
                : "Dropoff 🚗 — please drop off before 10 AM"}
          </p>
        </section>

        <Card.Divider />

        {/* Customer + vehicle */}
        <section>
          <p className="label-eyebrow mb-1">For</p>
          <p className="text-[15px] text-ink">{customer}</p>
          <p className="mt-0.5 text-[14px] text-ink-secondary">{vehicle}</p>
        </section>

        <Card.Divider />

        {/* Services */}
        <section>
          <p className="label-eyebrow mb-2">Services</p>
          <div className="space-y-3">
            {routine.length > 0 ? (
              <div>
                <p className="text-[13px] font-medium text-ink">Routine</p>
                <ul className="mt-1 list-inside list-disc pl-1 text-[14px] text-ink-secondary">
                  {routine.map((s) => (
                    <li key={`r-${s.display_name}`}>{s.display_name}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {concerns.length > 0 ? (
              <div>
                <p className="text-[13px] font-medium text-ink">Concerns to investigate</p>
                <ul className="mt-1 space-y-1.5 text-[14px] text-ink-secondary">
                  {concerns.map((s) => (
                    <li key={`c-${s.display_name}`}>
                      <span className="font-medium text-ink">{s.display_name}</span>
                      {s.notes ? (
                        <span className="ml-1 text-ink-secondary">
                          — {s.notes}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {testing.length > 0 ? (
              <div>
                <p className="text-[13px] font-medium text-ink">Testing</p>
                <ul className="mt-1 space-y-1 text-[14px] text-ink-secondary">
                  {testing.map((s) => (
                    <li
                      key={`t-${s.display_name}`}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <span>{s.display_name}</span>
                      {typeof s.starting_price_cents === "number" ? (
                        <span className="font-display text-[14px] text-brand-burgundy-700">
                          {fmtPrice(s.starting_price_cents)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>

        {/* Reminders */}
        {reminders.length > 0 ? (
          <>
            <Card.Divider />
            <section>
              <p className="label-eyebrow mb-2">Please bring</p>
              <ul className="space-y-1 text-[14px] text-ink-secondary">
                {reminders.map((r, i) => (
                   
                  <li key={i}>• {r}</li>
                ))}
              </ul>
            </section>
          </>
        ) : null}

        {/* Hold countdown */}
        {remaining !== null ? (
          <div
            role="status"
            aria-live="polite"
            className={
              "rounded-[var(--radius-input)] border px-3 py-2 text-[13px] " +
              (holdExpired
                ? "border-status-error-fg bg-status-error-bg text-status-error-fg"
                : "border-rule bg-paper-200 text-ink-secondary")
            }
          >
            {holdExpired ? (
              "This slot timed out. Tap edit to pick a fresh one."
            ) : (
              <>
                <span aria-hidden className="mr-1">
                  ⏳
                </span>
                Holding this slot for{" "}
                <span className="font-medium text-ink">
                  {fmtCountdown(remaining)}
                </span>{" "}
                more
              </>
            )}
          </div>
        ) : null}
      </Card.Body>

      <Card.Actions align="between">
        <Button
          variant="secondary"
          size="md"
          disabled={pending || disabled}
          onClick={requestEdit}
          fullWidthOnMobile
        >
          Edit something
        </Button>
        <Button
          variant="primary"
          size="md"
          loading={pending}
          disabled={disabled || holdExpired}
          onClick={confirm}
          fullWidthOnMobile
        >
          Confirm appointment 🔑
        </Button>
      </Card.Actions>

      {hold_id ? (
        <Card.Footnote>
          Hold ID: {hold_id.slice(0, 8)}… · Confirm by the countdown above
          and we&apos;ll book it in Tekmetric instantly.
        </Card.Footnote>
      ) : null}

      <Card.Footnote>
        We&apos;ll only use your info to schedule and remind you about this
        visit.
      </Card.Footnote>
    </Card>
  );
}
