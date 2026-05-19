"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import { Button, Card } from "@/components/ui";

/**
 * ServiceAndConcernPicker — Step 7.1 service + concern picker.
 *
 * 2026-05-17 single-section reshape from the Phase 9c two-section design.
 * 2026-05-17 (later) — restored the "💬 Other Issue" fixed pseudo-chip
 * per chat-design.md §7.1 ("'Other Issue' is a fixed pseudo-chip that
 * always requires explanation"). The customer can pick this when none
 * of the 10 routine services fits — the diagnostic LLM then classifies
 * their free-text description across the full 20-category catalog
 * (14 testing services + 6 'other' subcategories) and recommends
 * a testing service OR forwards to an advisor.
 *
 * 2026-05-19 layout shift (Chris's directive):
 *   - One service per line (was 2-column grid)
 *   - Rectangular tiles with marketing-style 6px corner radius
 *     (matches --radius-card; was pill-shaped chips)
 *   - Description renders under the title at the full tile width
 *     with normal padding before wrap (was no description at all)
 *
 * Per Chris's prior UX review (2026-05-17):
 *
 *   "The diagnostic services should not be shown. It is up to the
 *    diagnostic LLM to choose which diagnostic service to recommend.
 *    The customer may not know which one to choose…"
 *
 * Each routine tile surfaces:
 *   - Display name (left of header row)
 *   - Starting price right-aligned in the header row
 *     ($XX.XX, "Free", or omitted for null)
 *   - Description (full-width, wraps naturally) — optional
 *   - Waived-fee caveat (italic, below description) — optional
 *
 * The Other Issue tile is rendered below the list, separated by a gold
 * rule per the spec mockup. No price.
 *
 * Customer picks any subset across both sections and submits. The
 * submit action splits picks into: routine non-explanation tiles →
 * row.selected_simple_services[]; routine-with-explanation tiles +
 * Other Issue → row.explanation_required_items[] (the concern_explanation
 * queue).
 */
const OTHER_ISSUE_SERVICE_KEY = "other_issue";

export interface RoutineServiceChip {
  service_key: string;
  display_name: string;
  /** Integer cents. 0 → "Free". null → no price shown. */
  starting_price_cents: number | null;
  /** Optional small caveat shown under the price (e.g. "Fee waived if…"). */
  price_waived_note: string | null;
  /** Customer-facing 1-2 sentence description shown under the title.
   *  null → no description rendered (tile collapses to title + price). */
  description: string | null;
}

export interface ServiceAndConcernPickerProps {
  routine_services: RoutineServiceChip[];
  onSubmit: (output: { picks: string[] }) => void | Promise<void>;
  disabled?: boolean;
}

function formatPrice(cents: number | null): string | null {
  if (cents === null) return null;
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Rectangular tile button used by the picker. Slightly-rounded
 * corners (6px / --radius-card) — the "marketing button" feel Chris
 * specified. Full-width within its container. Selected state inverts
 * to burgundy; deselected shows a neutral paper-200 fill with a thin
 * rule border that strengthens on hover. Mirrors the keyboard +
 * focus-ring behavior of the prior Chip primitive.
 */
function ServiceTile({
  selected,
  disabled,
  onClick,
  ariaDescribedBy,
  children,
}: {
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  ariaDescribedBy?: string;
  children: ReactNode;
}) {
  const base =
    "block w-full px-4 py-3 text-left " +
    "rounded-[var(--radius-card)] " +
    "transition-colors duration-150 ease-out " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 " +
    "focus-visible:outline-brand-burgundy-500 " +
    "disabled:opacity-50 disabled:cursor-not-allowed";
  const state = selected
    ? "bg-brand-burgundy-700 text-paper-100 hover:bg-brand-burgundy-800 " +
      "border border-brand-burgundy-700"
    : "bg-paper-200 text-ink hover:bg-paper-300 " +
      "border border-rule hover:border-rule-strong";
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
      onClick={onClick}
      className={`${base} ${state}`}
    >
      {children}
    </button>
  );
}

export function ServiceAndConcernPicker({
  routine_services,
  onSubmit,
  disabled = false,
}: ServiceAndConcernPickerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function toggle(service_key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(service_key)) next.delete(service_key);
      else next.add(service_key);
      return next;
    });
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending || disabled) return;
    const picks = Array.from(selected);
    if (picks.length === 0) {
      setError("Pick at least one service to continue.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      await onSubmit({ picks });
    } finally {
      setPending(false);
    }
  }

  const otherIssueSelected = selected.has(OTHER_ISSUE_SERVICE_KEY);
  const isLocked = disabled || pending;

  return (
    <Card aria-labelledby="service-concern-heading">
      <Card.Eyebrow>What can we help with?</Card.Eyebrow>
      <Card.Title id="service-concern-heading">
        What&apos;s the visit for? 🛠️
      </Card.Title>
      <Card.Description>
        Pick anything you&apos;d like us to do. If you&apos;re not sure what
        the issue is, pick the service that&apos;s closest — we&apos;ll
        ask you a few questions next to figure out exactly what&apos;s
        going on.
      </Card.Description>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        noValidate
        className="contents"
      >
        <Card.Body>
          {routine_services.length > 0 && (
            <fieldset>
              <legend className="sr-only">Routine services</legend>
              <ul
                className="flex flex-col gap-3"
                role="group"
                aria-label="Routine services"
              >
                {routine_services.map((s) => {
                  const price = formatPrice(s.starting_price_cents);
                  const isSelected = selected.has(s.service_key);
                  return (
                    <li key={s.service_key}>
                      <ServiceTile
                        selected={isSelected}
                        disabled={isLocked}
                        onClick={() => toggle(s.service_key)}
                      >
                        <div className="flex w-full items-baseline justify-between gap-3">
                          <span className="text-[15px] font-medium leading-tight">
                            {s.display_name}
                          </span>
                          {price && (
                            <span
                              className={
                                "shrink-0 text-[13px] font-semibold " +
                                (isSelected
                                  ? "text-paper-100"
                                  : "text-brand-burgundy-800")
                              }
                            >
                              {price}
                            </span>
                          )}
                        </div>
                        {s.description ? (
                          <p
                            className={
                              "mt-1 text-[13px] leading-snug " +
                              (isSelected
                                ? "text-paper-200"
                                : "text-ink-secondary")
                            }
                          >
                            {s.description}
                          </p>
                        ) : null}
                        {s.price_waived_note ? (
                          <p
                            className={
                              "mt-1 text-[12px] italic leading-snug " +
                              (isSelected
                                ? "text-paper-200"
                                : "text-ink-tertiary")
                            }
                          >
                            {s.price_waived_note}
                          </p>
                        ) : null}
                      </ServiceTile>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}

          {/* Other Issue pseudo-tile — chat-design.md §7.1 lays this out
              below the routine list, separated by a gold rule, as the
              "I have a concern that doesn't fit the chips above" escape
              hatch. When picked, the concern_explanation card prompts
              for a free-text description and the diagnostic LLM
              classifies + (optionally) recommends a testing service. */}
          <div className="mt-5 border-t border-rule pt-4">
            <ServiceTile
              selected={otherIssueSelected}
              disabled={isLocked}
              onClick={() => toggle(OTHER_ISSUE_SERVICE_KEY)}
              ariaDescribedBy="other-issue-help"
            >
              <div className="flex w-full items-baseline justify-between gap-3">
                <span className="text-[15px] font-medium leading-tight">
                  💬 Other issue
                </span>
              </div>
              <p
                id="other-issue-help"
                className={
                  "mt-1 text-[13px] leading-snug " +
                  (otherIssueSelected
                    ? "text-paper-200"
                    : "text-ink-secondary")
                }
              >
                Describe what&apos;s going on and we&apos;ll figure out the
                right next step.
              </p>
            </ServiceTile>
          </div>

          {error && (
            <p
              className="mt-4 text-[14px] text-status-error"
              role="alert"
              aria-live="polite"
            >
              {error}
            </p>
          )}
        </Card.Body>

        <Card.Actions>
          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={pending}
            disabled={disabled}
            fullWidthOnMobile
          >
            Continue
          </Button>
        </Card.Actions>
      </form>
    </Card>
  );
}
