"use client";

import { useState, type FormEvent } from "react";

import { Button, Card, Chip } from "@/components/ui";

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
 * Per Chris's UX review:
 *
 *   "The diagnostic services should not be shown. It is up to the
 *    diagnostic LLM to choose which diagnostic service to recommend.
 *    The customer may not know which one to choose…"
 *
 * Each routine chip surfaces:
 *   - Display name
 *   - Starting price ($XX.XX, "Free", or omitted for null)
 *   - Optional waived-fee caveat below the price line
 *
 * The Other Issue chip is rendered below the grid, separated by a gold
 * rule per the spec mockup. No price (free-form entry; the LLM picks
 * whether a testing service applies).
 *
 * Customer picks any subset across both sections and submits. The
 * submit action splits picks into: routine non-explanation chips →
 * row.selected_simple_services[]; routine-with-explanation chips +
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
                className="grid gap-3 sm:grid-cols-2"
                role="group"
                aria-label="Routine services"
              >
                {routine_services.map((s) => {
                  const price = formatPrice(s.starting_price_cents);
                  const isSelected = selected.has(s.service_key);
                  return (
                    <li key={s.service_key}>
                      <Chip
                        selected={isSelected}
                        disabled={disabled || pending}
                        onClick={() => toggle(s.service_key)}
                        // `min-h-20` (80px) is the height of the waived-note
                        // variant (2-line caveat below the price). Forcing it
                        // on every chip means single-line chips get blank
                        // space below the price but match the tallest chip's
                        // height — the grid reads as a uniform tile set
                        // instead of jagged rows.
                        className="flex h-full min-h-20 w-full flex-col items-start gap-1 py-3 text-left"
                      >
                        <span className="flex w-full items-center justify-between gap-2">
                          <span className="font-medium">{s.display_name}</span>
                          {price && (
                            <span className="shrink-0 text-[13px] font-semibold text-brand-burgundy-800">
                              {price}
                            </span>
                          )}
                        </span>
                        {s.price_waived_note ? (
                          <span className="block text-[12px] italic leading-snug text-ink-tertiary">
                            {s.price_waived_note}
                          </span>
                        ) : null}
                      </Chip>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}

          {/* Other Issue pseudo-chip — chat-design.md §7.1 lays this out
              below the routine grid, separated by a gold rule, as the
              "I have a concern that doesn't fit the chips above" escape
              hatch. When picked, the concern_explanation card prompts
              for a free-text description and the diagnostic LLM
              classifies + (optionally) recommends a testing service. */}
          <div className="mt-5 border-t border-rule pt-4">
            <Chip
              selected={selected.has(OTHER_ISSUE_SERVICE_KEY)}
              disabled={disabled || pending}
              onClick={() => toggle(OTHER_ISSUE_SERVICE_KEY)}
              className="flex h-full min-h-20 w-full flex-col items-start gap-1 py-3 text-left"
              aria-describedby="other-issue-help"
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="font-medium">💬 Other issue</span>
              </span>
              <span
                id="other-issue-help"
                className="block text-[12px] italic leading-snug text-ink-tertiary"
              >
                Describe what&apos;s going on and we&apos;ll figure out the
                right next step.
              </span>
            </Chip>
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
