"use client";

import { useState } from "react";

import { Button, Card, Field, Textarea } from "@/components/ui";

/**
 * Step 10.2 — Customer notes (optional).
 *
 * After appointment confirmation, the customer can optionally leave a note
 * for the service team. Examples per chat-design.md:
 *   - "Please don't move the seats — I have them set just right"
 *   - "Front passenger door handle is loose, FYI"
 *
 * Behaviors per design lock 2026-05-13:
 *   - SKIP is the friction-free default; we never push.
 *   - Trim to first 500 chars if longer; orchestrator handles the trim
 *     confirmation flow (we just send what the customer typed).
 *   - 2-edit cap before escalation (enforced by the machine + orchestrator).
 */

export interface CustomerNotesCardProps {
  /** Pre-filled text when the customer is editing a prior note. */
  initial_text?: string;
  disabled?: boolean;
  onSubmit: (output: {
    text: string | null;
    approved: boolean;
  }) => void | Promise<void>;
}

const MAX_LENGTH = 500;

export function CustomerNotesCard({
  initial_text = "",
  disabled = false,
  onSubmit,
}: CustomerNotesCardProps) {
  const [text, setText] = useState(initial_text);
  const [pending, setPending] = useState(false);

  async function submit(approved: boolean) {
    if (pending || disabled) return;
    setPending(true);
    try {
      const value = text.trim();
      await onSubmit({
        text: value.length === 0 ? null : value.slice(0, MAX_LENGTH),
        approved,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card aria-labelledby="customer-notes-title">
      <Card.Eyebrow>Step 10.2 · One more thing (optional)</Card.Eyebrow>
      <Card.Title id="customer-notes-title">
        Anything else our team should know? 🛠️
      </Card.Title>
      <Card.Description>
        Quirks, preferences, that one weird thing — whatever helps us take
        good care of your car. Or skip — it&apos;s up to you.
      </Card.Description>

      <Card.Body>
        <Field
          label="Notes for the team"
          help={`${text.trim().length}/${MAX_LENGTH} characters · optional`}
          inputId="customer-notes-textarea"
        >
          {({ id, ariaDescribedBy, ariaInvalid }) => (
            <Textarea
              id={id}
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Example: please don't move the driver seat — I have it set just right."
              disabled={pending || disabled}
              maxLength={MAX_LENGTH}
              aria-describedby={ariaDescribedBy}
              aria-invalid={ariaInvalid}
            />
          )}
        </Field>
      </Card.Body>

      <Card.Actions align="between">
        <Button
          variant="ghost"
          size="md"
          disabled={pending || disabled}
          onClick={() => submit(false)}
          fullWidthOnMobile
        >
          Skip
        </Button>
        <Button
          variant="primary"
          size="md"
          loading={pending}
          disabled={disabled || text.trim().length === 0}
          onClick={() => submit(true)}
          fullWidthOnMobile
        >
          Send note
        </Button>
      </Card.Actions>
    </Card>
  );
}
