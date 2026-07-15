"use client";

import { useState } from "react";

import { Button, Card } from "@/components/ui";
import { interpolate } from "@/lib/scheduler/wizard/card-copy";
import type { CardCopy } from "@/lib/scheduler/card-text";

/**
 * Step 1 — Greeting card (wizard-first; replaces the textual disclosure +
 * opening-question turn).
 *
 * Per chat-design.md 2026-05-13: Phase 1 is a WIZARD augmented by chat —
 * Step 1 is a CARD with explicit choices, NOT a free-form text prompt.
 * The customer taps one of three buttons; we send the bucketed answer
 * (`returning` | `new` | `unsure`) to the submitGreetingV2 action.
 *
 * Disclosure (conversation-is-recorded) is rendered inside the card so the
 * customer sees it before submitting their first choice.
 */

export interface GreetingCardProps {
  /** Editable card copy (card-text-editor) — resolved slot strings. */
  copy: CardCopy<"greeting">;
  /** Merge value for {{shop_name}} in the description. */
  shop_name?: string;
  /** Merge value for {{agent_name}} in the title. */
  agent_name?: string;
  disabled?: boolean;
  onSubmit: (output: {
    is_returning: "returning" | "new" | "unsure";
  }) => void | Promise<void>;
}

export function GreetingCard({
  copy,
  shop_name = "Jeff's Automotive",
  agent_name = "Jeff",
  disabled = false,
  onSubmit,
}: GreetingCardProps) {
  const [pending, setPending] = useState(false);
  const [picked, setPicked] = useState<"returning" | "new" | "unsure" | null>(
    null,
  );

  async function pick(value: "returning" | "new" | "unsure") {
    if (pending || disabled) return;
    setPicked(value);
    setPending(true);
    try {
      await onSubmit({ is_returning: value });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card aria-labelledby="greeting-title">
      <Card.Eyebrow>{copy.eyebrow}</Card.Eyebrow>
      <Card.Title id="greeting-title">
        {interpolate(copy.title, { agent_name })}
      </Card.Title>
      <Card.Description>
        {interpolate(copy.description, { shop_name })}
      </Card.Description>

      <Card.Body className="space-y-4">
        <div
          role="note"
          className="rounded-[var(--radius-input)] border-l-2 border-brand-gold-400 bg-paper-200 px-3 py-2 text-[13px] leading-relaxed text-ink-secondary"
        >
          {copy.body_disclosure}
        </div>

        <div>
          <p className="font-display text-[17px] leading-snug text-ink">
            {copy.body_question}
          </p>
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
          <Button
            variant="primary"
            size="md"
            disabled={pending || disabled}
            loading={pending && picked === "returning"}
            onClick={() => void pick("returning")}
            fullWidthOnMobile
          >
            Yes — I&apos;m a returning customer
          </Button>
          <Button
            variant="secondary"
            size="md"
            disabled={pending || disabled}
            loading={pending && picked === "new"}
            onClick={() => void pick("new")}
            fullWidthOnMobile
          >
            No — first time
          </Button>
          <Button
            variant="ghost"
            size="md"
            disabled={pending || disabled}
            loading={pending && picked === "unsure"}
            onClick={() => void pick("unsure")}
            fullWidthOnMobile
          >
            I&apos;m not sure
          </Button>
        </div>

        {/* Trust row — mirrors the page header's trust line so the very first
            card reinforces it. Decorative gold dot separators; AA-safe
            tertiary text. */}
        <ul className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {["Family-owned since 1976", "AAA-approved", "3yr/36k warranty"].map(
            (badge, i) => (
              <li key={badge} className="flex items-center gap-2">
                {i > 0 ? (
                  <span
                    aria-hidden
                    className="inline-block h-1 w-1 rounded-full bg-brand-gold-400"
                  />
                ) : null}
                <span className="label-eyebrow">{badge}</span>
              </li>
            ),
          )}
        </ul>
      </Card.Body>

      <Card.Footnote>{copy.footnote}</Card.Footnote>
    </Card>
  );
}
