"use client";

import { useState } from "react";

import { Button, Card } from "@/components/ui";

/**
 * Step 7.5 — Testing-service approval card.
 *
 * Renders the testing services the diagnostic specialist recommended for the
 * customer's concern category. The customer ticks the ones they want OR
 * unticks to decline. Both lists (approved + declined) get sent back so the
 * service advisor sees what was offered AND what was passed on (declined
 * services are still emailed in the transcript per the design lock).
 *
 * Pricing rule: ALWAYS surface starting prices with the "starting price"
 * caveat — never imply a final cost.
 */

interface TestingServiceOption {
  service_key: string;
  display_name: string;
  starting_price_cents: number;
  notes?: string | null;
}

export interface TestingServiceApprovalCardProps {
  services: TestingServiceOption[];
  /** Concern category for the eyebrow label (optional). */
  category?: string;
  disabled?: boolean;
  onSubmit: (output: {
    approved: string[];
    declined: string[];
  }) => void | Promise<void>;
}

function fmtPrice(cents: number): string {
  if (cents === 0) return "Included";
  return `$${(cents / 100).toFixed(2)}+`;
}

export function TestingServiceApprovalCard({
  services,
  category,
  disabled = false,
  onSubmit,
}: TestingServiceApprovalCardProps) {
  // Pre-select all by default — Chris's design lock has the chat agent
  // recommending these affirmatively, so the friction-free path is "yes."
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(services.map((s) => s.service_key)),
  );
  const [pending, setPending] = useState(false);

  function toggle(key: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function submit() {
    if (pending || disabled) return;
    setPending(true);
    const approved = services
      .filter((s) => picked.has(s.service_key))
      .map((s) => s.service_key);
    const declined = services
      .filter((s) => !picked.has(s.service_key))
      .map((s) => s.service_key);
    try {
      await onSubmit({ approved, declined });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card aria-labelledby="testing-approval-title">
      <Card.Eyebrow>
        Testing we&apos;d recommend{category ? ` · ${category}` : ""}
      </Card.Eyebrow>
      <Card.Title id="testing-approval-title">
        We&apos;d like to look at a couple of things.
      </Card.Title>
      <Card.Description>
        Based on what you described, here&apos;s what our techs would test to
        narrow it down. Starting prices below — we&apos;ll send a final estimate
        before any work begins.
      </Card.Description>

      <Card.Body>
        <ul className="divide-y divide-rule rounded-[var(--radius-input)] border border-rule">
          {services.map((s) => {
            const isPicked = picked.has(s.service_key);
            const inputId = `testing-${s.service_key}`;
            return (
              <li key={s.service_key} className="px-4 py-3">
                <label
                  htmlFor={inputId}
                  className="flex cursor-pointer items-start gap-3"
                >
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={isPicked}
                    onChange={() => toggle(s.service_key)}
                    disabled={pending || disabled}
                    className="mt-1 h-4 w-4 rounded border-rule text-brand-burgundy-700 focus:ring-brand-burgundy-200"
                  />
                  <span className="flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-[15px] font-medium text-ink">
                        {s.display_name}
                      </span>
                      <span className="font-display text-[15px] text-brand-burgundy-700">
                        {fmtPrice(s.starting_price_cents)}
                      </span>
                    </span>
                    {s.notes ? (
                      <span className="mt-1 block text-[13px] leading-relaxed text-ink-secondary">
                        {s.notes}
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        <p className="mt-3 text-[12px] leading-relaxed text-ink-tertiary">
          Starting prices — additional testing may be needed if our techs find
          something extra. We&apos;ll always send an updated estimate before
          doing any extra work.
        </p>
      </Card.Body>

      <Card.Actions>
        <Button
          variant="primary"
          loading={pending}
          disabled={disabled}
          onClick={submit}
          fullWidthOnMobile
        >
          {picked.size === services.length
            ? "Looks good — schedule these"
            : picked.size === 0
              ? "Skip testing for now"
              : `Schedule ${picked.size} of ${services.length}`}
        </Button>
      </Card.Actions>
    </Card>
  );
}
