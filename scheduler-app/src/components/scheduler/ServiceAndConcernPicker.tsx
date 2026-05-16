"use client";

import { useState, type FormEvent } from "react";

import { Button, Card, Chip } from "@/components/ui";

/**
 * ServiceAndConcernPicker — Phase 9c rebuild 2026-05-15.
 *
 * Per chat-design.md "Architecture amendment — 2026-05-14" + services-
 * categories.md: TWO chip sections.
 *
 *   1. Routine services — non-explanation chips (oil change, tire rotate,
 *      state inspection, alignment, etc.). No price shown — these are
 *      flat-rate or quoted at the shop. Quick single-tap picks.
 *   2. Diagnostic services — chips that need a description from the
 *      customer (testing services + the five routine-with-explanation
 *      chips: Brake Inspection, Check Battery, Warning Lights, Check
 *      Suspension, Check A/C). Testing services show a starting price;
 *      routine-with-explanation chips don't carry a price (just the
 *      diagnostic flow trigger).
 *
 * The customer picks any subset across BOTH sections. Submit emits a
 * single { picks: string[] } — the server splits into the right buckets.
 * No concern textarea on this card; per-service descriptions happen on
 * the next card (Step 7.2 concern_explanation, one per item).
 */

export interface RoutineChip {
  service_key: string;
  display_name: string;
}

export interface DiagnosticChip {
  service_key: string;
  display_name: string;
  /** Integer cents; null for routine-with-explanation chips (no fee). */
  starting_price_cents: number | null;
  source: "testing" | "routine";
}

export interface ServiceAndConcernPickerProps {
  common_services: RoutineChip[];
  /** Optional — defaults to [] for legacy callers (Chat.tsx + pre-Phase-9c tests).
   *  The new wizard surface always passes a populated list when there are
   *  diagnostic chips to offer. Phase 16 removes the legacy Chat.tsx and we
   *  can flip this back to required. */
  diagnostic_services?: DiagnosticChip[];
  onSubmit: (output: { picks: string[] }) => void | Promise<void>;
  disabled?: boolean;
}

function formatPrice(cents: number | null): string | null {
  if (cents === null) return null;
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
}

export function ServiceAndConcernPicker({
  common_services,
  diagnostic_services = [],
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
      <Card.Eyebrow>Step 7 · What can we help with?</Card.Eyebrow>
      <Card.Title id="service-concern-heading">
        What&apos;s the visit for? 🛠️
      </Card.Title>
      <Card.Description>
        Pick anything that applies — routine services on top, diagnostic
        services below. If something&apos;s off and you&apos;re not sure
        which category it fits, the diagnostic chips are where to look.
      </Card.Description>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        noValidate
        className="contents"
      >
        <Card.Body className="space-y-6">
          {common_services.length > 0 && (
            <fieldset>
              <legend className="label-eyebrow mb-2 block">
                Routine services
              </legend>
              <div className="flex flex-wrap gap-2" role="group">
                {common_services.map((s) => (
                  <Chip
                    key={s.service_key}
                    selected={selected.has(s.service_key)}
                    disabled={disabled || pending}
                    onClick={() => toggle(s.service_key)}
                  >
                    {s.display_name}
                  </Chip>
                ))}
              </div>
            </fieldset>
          )}

          {diagnostic_services.length > 0 && (
            <fieldset>
              <legend className="label-eyebrow mb-2 block">
                Diagnostic services
              </legend>
              <p className="mb-3 text-[14px] leading-relaxed text-ink-secondary">
                Pick one of these if something&apos;s acting up. We&apos;ll
                ask you to describe what you&apos;re noticing on the next
                screen.
              </p>
              <div className="flex flex-wrap gap-2" role="group">
                {diagnostic_services.map((s) => {
                  const price = formatPrice(s.starting_price_cents);
                  return (
                    <Chip
                      key={s.service_key}
                      selected={selected.has(s.service_key)}
                      disabled={disabled || pending}
                      onClick={() => toggle(s.service_key)}
                    >
                      <span className="flex items-center gap-2">
                        <span>{s.display_name}</span>
                        {price && (
                          <span className="text-[12px] font-medium text-ink-secondary">
                            {price}
                          </span>
                        )}
                      </span>
                    </Chip>
                  );
                })}
              </div>
            </fieldset>
          )}

          {error && (
            <p
              className="text-[14px] text-status-error"
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
