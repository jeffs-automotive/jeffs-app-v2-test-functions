"use client";

import { useState, type FormEvent } from "react";

import { Button, Card, Field, Textarea } from "@/components/ui";

/**
 * Step 7.2 — Concern explanation card (Phase 9c, 2026-05-15).
 *
 * Per chat-design.md "Architecture amendment — 2026-05-14" §Step 7
 * redesign: one card per service in `explanation_required_items` whose
 * `explanation_text` is still empty. The customer describes what
 * they're noticing in their own words; submit fills the queue entry +
 * advances to the next un-explained item OR to `diagnostic_loading`
 * when the queue drains.
 *
 * The card carries:
 *   - `service_key` — the queue head's identifier (passed back on submit
 *     so the server can defensively match against the FIRST empty entry
 *     with this service_key, even if the customer back-buttoned)
 *   - `display_name` — friendly label for the eyebrow + heading
 *   - `lead_in_bubble` — pre-rendered Jeff-voice prompt that frames the
 *     ask. Built by get-current-card.ts:buildConcernExplanationLeadIn().
 */

export interface ConcernExplanationCardProps {
  service_key: string;
  display_name: string;
  lead_in_bubble: string;
  disabled?: boolean;
  onSubmit: (output: {
    service_key: string;
    explanation_text: string;
  }) => void | Promise<void>;
}

export function ConcernExplanationCard({
  service_key,
  display_name,
  lead_in_bubble,
  disabled = false,
  onSubmit,
}: ConcernExplanationCardProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending || disabled) return;
    const explanation_text = text.trim();
    if (explanation_text.length < 3) {
      setError("A few words help us narrow it down.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      await onSubmit({ service_key, explanation_text });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card aria-labelledby={`concern-${service_key}-title`}>
      <Card.Eyebrow>About {display_name}</Card.Eyebrow>
      <Card.Title id={`concern-${service_key}-title`}>
        {lead_in_bubble}
      </Card.Title>
      <Card.Description>
        Even rough details help — when it started, what it sounds or feels
        like, where in the car you notice it. You don&apos;t need to know
        the cause.
      </Card.Description>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        noValidate
        className="contents"
      >
        <Card.Body>
          <Field
            label="In your own words"
            help={`Examples for ${display_name.toLowerCase()}: when it happens, any noises, anything recent like new tires or a pothole.`}
            error={error ?? undefined}
            inputId={`concern-${service_key}-textarea`}
          >
            {({ id, ariaDescribedBy, ariaInvalid }) => (
              <Textarea
                id={id}
                rows={4}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setError(null);
                }}
                disabled={disabled || pending}
                placeholder="Tell me what you're noticing — even rough details help."
                aria-describedby={ariaDescribedBy}
                aria-invalid={ariaInvalid}
                maxLength={2000}
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
