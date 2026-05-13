"use client";

import { useState, type FormEvent } from "react";

import { Button, Card, Chip, Field, Textarea } from "@/components/ui";

/**
 * ServiceAndConcernPicker rendering tool component (Heritage Editorial refactor 2026-05-13).
 *
 * Per appointments_design.md §7.5 + scheduler_phase1_design_lock.md §7:
 * - Input: { common_services: ServiceChip[] }
 * - Output: { services: string[], concern_text?: string }
 *
 * The customer can pick service chips, type a concern, both, or neither
 * (must do at least one to submit). Chips come from routine_services.
 */

export interface ServiceChip {
  service_key: string;
  display_name: string;
}

export interface ServiceAndConcernPickerProps {
  common_services: ServiceChip[];
  onSubmit: (output: {
    services: string[];
    concern_text?: string;
  }) => void | Promise<void>;
  disabled?: boolean;
}

export function ServiceAndConcernPicker({
  common_services,
  onSubmit,
  disabled = false,
}: ServiceAndConcernPickerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [concern, setConcern] = useState("");
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
    const trimmedConcern = concern.trim();
    const services = common_services
      .map((s) => s.service_key)
      .filter((k) => selected.has(k));

    if (services.length === 0 && !trimmedConcern) {
      setError(
        "Pick at least one service or tell me a bit about what's going on.",
      );
      return;
    }
    setError(null);
    setPending(true);
    try {
      await onSubmit({
        services,
        concern_text: trimmedConcern || undefined,
      });
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
        Pick any routine services that apply, OR tell me what you&apos;re
        noticing in your own words. Both is fine too.
      </Card.Description>

      <form onSubmit={(e) => void handleSubmit(e)} noValidate className="contents">
        <Card.Body className="space-y-5">
          <fieldset>
            <legend className="label-eyebrow mb-2 block">Routine services</legend>
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

          <Field
            label="Or describe a concern"
            help="Examples: grinding when I brake · AC isn't blowing cold · check engine light came on"
            error={error ?? undefined}
            inputId="concern-textarea"
          >
            {({ id, ariaDescribedBy, ariaInvalid }) => (
              <Textarea
                id={id}
                rows={3}
                value={concern}
                onChange={(e) => {
                  setConcern(e.target.value);
                  setError(null);
                }}
                disabled={disabled || pending}
                placeholder="Tell me what you're noticing — even rough details help."
                aria-describedby={ariaDescribedBy}
                aria-invalid={ariaInvalid}
              />
            )}
          </Field>
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
