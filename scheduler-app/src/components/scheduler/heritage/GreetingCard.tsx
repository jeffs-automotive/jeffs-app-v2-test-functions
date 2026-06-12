"use client";

import { useState } from "react";

import { Button, Card } from "@/components/ui";

/**
 * Step 1 — Greeting card (wizard-first; replaces the textual disclosure +
 * opening-question turn).
 *
 * Per chat-design.md 2026-05-13: Phase 1 is a WIZARD augmented by chat —
 * Step 1 is a CARD with explicit choices, NOT a free-form text prompt.
 * The customer taps one of three buttons; we send back the bucketed answer
 * (`returning` | `new` | `unsure`) to the chat agent.
 *
 * Disclosure (conversation-is-recorded) is rendered inside the card so the
 * customer sees it before submitting their first choice.
 */

export interface GreetingCardProps {
  /** Optional override of the shop display name. */
  shop_name?: string;
  /** Optional override of the assistant name. */
  agent_name?: string;
  disabled?: boolean;
  onSubmit: (output: {
    is_returning: "returning" | "new" | "unsure";
  }) => void | Promise<void>;
}

export function GreetingCard({
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
      <Card.Eyebrow>Welcome</Card.Eyebrow>
      <Card.Title id="greeting-title">
        Hi, I&apos;m {agent_name} 👋
      </Card.Title>
      <Card.Description>
        I&apos;m the AI scheduling assistant for {shop_name}. I&apos;ll walk
        you through booking an appointment in just a few steps.
      </Card.Description>

      <Card.Body className="space-y-4">
        <div
          role="note"
          className="rounded-[var(--radius-input)] border-l-2 border-brand-gold-400 bg-paper-200 px-3 py-2 text-[13px] leading-relaxed text-ink-secondary"
        >
          Heads up — this conversation is recorded and reviewed by our team
          to make sure we&apos;re taking good care of you.
        </div>

        <div>
          <p className="font-display text-[17px] leading-snug text-ink">
            Have you been to our shop before?
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

      <Card.Footnote>
        Need a human instead? Tap &quot;Talk to a person&quot; below — no
        problem. 📞
      </Card.Footnote>
    </Card>
  );
}
