"use client";

import { useState } from "react";

import { Button, Card } from "@/components/ui";
import type { SummaryEditHubPayload } from "@/lib/scheduler/wizard/card-payloads";
import type { EditHubSection } from "@/lib/scheduler/wizard/actions/submit-edit-hub";

/**
 * Step 10.2 — Summary edit hub card (task EH2, 2026-07-04).
 *
 * The "Edit something" landing reached from the SummaryCard. Renders one
 * Heritage `Card` holding four sectioned bands (Card.Divider-separated) —
 * Contact / Vehicle / Services & concerns / Appointment time — each showing
 * the customer's current values plus a quiet right-aligned ghost "Edit"
 * affordance, and a single primary "Looks good — back to summary" CTA.
 *
 * This is the checkout-review "edit line-item" idiom (design spec:
 * .claude/work/design/summary-edit-hub-spec.md). Nothing here changes
 * behavior: every Edit affordance is a submit that routes to an existing
 * edit step via `submitEditHubV2`; the card is presentational + wiring.
 *
 * `pending` guards ALL affordances while a section submit is in flight;
 * `busySection` tracks which control the spinner sits on so only the
 * pressed button shows loading.
 *
 * Consumes the EH1-landed `SummaryEditHubPayload` verbatim (contact /
 * vehicle_label / services {routine, concerns, testing} / appointment
 * {type, date, time} / hold_active). Degrades gracefully on empty-ish
 * fields with italic ink-tertiary fallbacks — these are legitimate
 * mid-edit states, not errors.
 */

/** Truncation cap for concern + testing rows (routine is a wrapped join). */
const SERVICE_ROW_CAP = 4;

export interface SummaryEditHubCardProps {
  payload: SummaryEditHubPayload;
  disabled?: boolean;
  /**
   * "done" clears edit_return_step + returns to summary; a section value
   * routes to that edit step. Mirrors submit-edit-hub's discriminator.
   */
  onSelect: (section: EditHubSection) => void | Promise<void>;
}

function fmtPrice(cents: number): string {
  if (cents === 0) return "Included";
  return `$${(cents / 100).toFixed(2)}+`;
}

/**
 * Format the appointment band's primary line from the payload's date/time.
 * The hub payload carries a YYYY-MM-DD `date` (+ HH:MM `time` for waiter),
 * not a full ISO timestamp, so we format the calendar date in shop-local
 * terms and append the waiter time when present.
 */
function fmtAppointment(date: string, time: string, type: "waiter" | "dropoff"): string {
  if (!date) return "";
  let datePart = date;
  try {
    // Parse as a shop-local calendar date (noon avoids any TZ date-rollover).
    const d = new Date(`${date}T12:00:00`);
    if (!Number.isNaN(d.getTime())) {
      datePart = d.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    }
  } catch {
    datePart = date;
  }
  if (type === "waiter" && time) {
    let timePart = time;
    try {
      const t = new Date(`${date}T${time}:00`);
      if (!Number.isNaN(t.getTime())) {
        timePart = t.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        });
      }
    } catch {
      timePart = time;
    }
    return `${datePart} at ${timePart}`;
  }
  return datePart;
}

export function SummaryEditHubCard({
  payload,
  disabled = false,
  onSelect,
}: SummaryEditHubCardProps) {
  const [pending, setPending] = useState(false);
  const [busySection, setBusySection] = useState<string | null>(null);

  const { contact, vehicle_label, services, appointment, hold_active } = payload;

  async function run(section: EditHubSection) {
    if (pending || disabled) return;
    setPending(true);
    setBusySection(section);
    try {
      await onSelect(section);
    } finally {
      setPending(false);
      setBusySection(null);
    }
  }

  // Every affordance is guarded while a submit is in flight OR the card is
  // externally disabled.
  const controlsDisabled = pending || disabled;

  const routine = services.routine;
  const concerns = services.concerns;
  const testing = services.testing;
  const hasAnyService =
    routine.length > 0 || concerns.length > 0 || testing.length > 0;

  const appointmentLine = fmtAppointment(
    appointment.date,
    appointment.time,
    appointment.type,
  );

  return (
    <Card aria-labelledby="edit-hub-title">
      <Card.Eyebrow>Edit your appointment</Card.Eyebrow>
      <Card.Title id="edit-hub-title">What would you like to change?</Card.Title>
      <Card.Description>
        Tap Edit on any section. Everything else stays exactly as you left it —
        nothing is lost.
      </Card.Description>

      <Card.Body className="space-y-0">
        {/* 1 — Contact */}
        <SectionRow
          id="contact"
          eyebrowId="edit-hub-contact-label"
          sectionLabel="Contact"
          accessibleName="contact info"
          controlsDisabled={controlsDisabled}
          busySection={busySection}
          onEdit={run}
        >
          {contact.name ? (
            <p className="text-[15px] text-ink">{contact.name}</p>
          ) : null}
          {contact.phone_last_four ? (
            <p className="mt-0.5 text-[14px] text-ink-secondary">
              Phone ending in {contact.phone_last_four}
            </p>
          ) : null}
          {contact.email ? (
            <p className="text-[14px] break-words text-ink-secondary">
              {contact.email}
            </p>
          ) : null}
          {!contact.name && !contact.phone_last_four && !contact.email ? (
            <p className="text-[14px] italic text-ink-tertiary">
              Tap Edit to add your contact info.
            </p>
          ) : null}
        </SectionRow>

        <Card.Divider />

        {/* 2 — Vehicle */}
        <SectionRow
          id="vehicle"
          eyebrowId="edit-hub-vehicle-label"
          sectionLabel="Vehicle"
          accessibleName="vehicle"
          controlsDisabled={controlsDisabled}
          busySection={busySection}
          onEdit={run}
        >
          {vehicle_label ? (
            <p className="text-[15px] text-ink">{vehicle_label}</p>
          ) : (
            <p className="text-[14px] italic text-ink-tertiary">
              No vehicle selected yet.
            </p>
          )}
        </SectionRow>

        <Card.Divider />

        {/* 3 — Services & concerns */}
        <SectionRow
          id="services"
          eyebrowId="edit-hub-services-label"
          sectionLabel="Services & concerns"
          accessibleName="services and concerns"
          controlsDisabled={controlsDisabled}
          busySection={busySection}
          onEdit={run}
        >
          {hasAnyService ? (
            <div className="space-y-0">
              {routine.length > 0 ? (
                <div>
                  <p className="text-[13px] font-medium text-ink">Routine</p>
                  <p className="text-[14px] text-ink-secondary">
                    {routine.join(", ")}
                  </p>
                </div>
              ) : null}
              {concerns.length > 0 ? (
                <div className={routine.length > 0 ? "mt-2" : undefined}>
                  <p className="text-[13px] font-medium text-ink">
                    Concerns to investigate
                  </p>
                  <div className="mt-1 space-y-1">
                    {concerns.slice(0, SERVICE_ROW_CAP).map((c, i) => (
                      <p key={`c-${c.display_name}-${i}`} className="text-[14px]">
                        <span className="font-medium text-ink">
                          {c.display_name}
                        </span>
                        {c.one_liner ? (
                          <span className="line-clamp-1 text-ink-secondary">
                            {" "}
                            — {c.one_liner}
                          </span>
                        ) : null}
                      </p>
                    ))}
                    {concerns.length > SERVICE_ROW_CAP ? (
                      <p className="text-[13px] text-ink-tertiary">
                        +{concerns.length - SERVICE_ROW_CAP} more
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {testing.length > 0 ? (
                <div
                  className={
                    routine.length > 0 || concerns.length > 0
                      ? "mt-2"
                      : undefined
                  }
                >
                  <p className="text-[13px] font-medium text-ink">Testing</p>
                  <div className="mt-1 space-y-1">
                    {testing.slice(0, SERVICE_ROW_CAP).map((t, i) => (
                      <div
                        key={`t-${t.display_name}-${i}`}
                        className="flex items-baseline justify-between gap-3 text-[14px]"
                      >
                        <span className="text-ink-secondary">
                          {t.display_name}
                        </span>
                        <span className="shrink-0 font-display text-[14px] text-brand-burgundy-700">
                          {fmtPrice(t.starting_price_cents)}
                        </span>
                      </div>
                    ))}
                    {testing.length > SERVICE_ROW_CAP ? (
                      <p className="text-[13px] text-ink-tertiary">
                        +{testing.length - SERVICE_ROW_CAP} more
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-[14px] italic text-ink-tertiary">
              No services picked yet — tap Edit to add one.
            </p>
          )}
        </SectionRow>

        <Card.Divider />

        {/* 4 — Appointment time */}
        <SectionRow
          id="time"
          eyebrowId="edit-hub-time-label"
          sectionLabel="Appointment time"
          accessibleName="appointment time"
          controlsDisabled={controlsDisabled}
          busySection={busySection}
          onEdit={run}
        >
          {appointmentLine ? (
            <>
              <p className="text-[15px] text-ink">{appointmentLine}</p>
              <p className="mt-0.5 text-[14px] text-ink-secondary">
                {appointment.type === "waiter"
                  ? "Waiter ☕"
                  : "Dropoff 🚗 — before 10 AM"}
              </p>
            </>
          ) : (
            <p className="text-[14px] italic text-ink-tertiary">
              No time held yet.
            </p>
          )}
          {/* Slot-release caution — only meaningful while a live hold exists. */}
          {hold_active ? (
            <p className="mt-2 flex items-start gap-1.5 rounded-[var(--radius-input)] bg-status-warn-bg px-2.5 py-1.5 text-[12px] leading-snug text-status-warn-fg">
              <span aria-hidden>⏳</span>
              <span>
                Editing your time releases the slot we&apos;re holding.
                You&apos;ll pick a fresh time and we&apos;ll hold that one.
              </span>
            </p>
          ) : null}
        </SectionRow>
      </Card.Body>

      <Card.Actions align="right">
        <Button
          variant="primary"
          size="md"
          loading={busySection === "done"}
          disabled={pending || disabled}
          onClick={() => void run("done")}
          fullWidthOnMobile
        >
          Looks good — back to summary
        </Button>
      </Card.Actions>

      <Card.Footnote>
        Changes you don&apos;t touch stay saved. Nothing here is submitted until
        you confirm on the summary.
      </Card.Footnote>
    </Card>
  );
}

/**
 * SectionRow — the per-section band. A two-column flex row: label + values
 * on the left, a right-aligned ghost Edit affordance top-right (Polaris's
 * persistent upper-right edit placement). The section is wrapped in a
 * `<section aria-labelledby>` pointing at its eyebrow for landmark context;
 * the Edit button carries a distinct aria-label ("Edit contact info" etc.)
 * since the visible word "Edit" is ambiguous alone.
 */
function SectionRow({
  id,
  eyebrowId,
  sectionLabel,
  accessibleName,
  controlsDisabled,
  busySection,
  onEdit,
  children,
}: {
  id: EditHubSection;
  eyebrowId: string;
  sectionLabel: string;
  accessibleName: string;
  controlsDisabled: boolean;
  busySection: string | null;
  onEdit: (section: EditHubSection) => void | Promise<void>;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={eyebrowId}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p id={eyebrowId} className="label-eyebrow mb-1.5">
            {sectionLabel}
          </p>
          {children}
        </div>
        <Button
          variant="ghost"
          size="sm"
          leadingIcon="✏️"
          disabled={controlsDisabled}
          loading={busySection === id}
          fullWidthOnMobile={false}
          onClick={() => void onEdit(id)}
          aria-label={`Edit ${accessibleName}`}
          className="-mr-1 shrink-0"
        >
          Edit
        </Button>
      </div>
    </section>
  );
}
