"use client";

import { useState } from "react";

import { Button, Card, Field, Textarea } from "@/components/ui";

/**
 * Step 10.4 — Customer question (optional).
 *
 * Optional free-form question the customer wants the service team to follow
 * up on. It is never answered in-app — it's logged and the advisor
 * follows up by phone or text per chat-design.md.
 */

export interface CustomerQuestionCardProps {
  disabled?: boolean;
  onSubmit: (output: { question: string | null }) => void | Promise<void>;
}

const MAX_LENGTH = 280;

export function CustomerQuestionCard({
  disabled = false,
  onSubmit,
}: CustomerQuestionCardProps) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(value: string | null) {
    if (pending || disabled) return;
    setPending(true);
    try {
      const trimmed = value?.trim() ?? null;
      await onSubmit({ question: !trimmed ? null : trimmed.slice(0, MAX_LENGTH) });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card aria-labelledby="customer-question-title">
      <Card.Eyebrow>Last bit (optional)</Card.Eyebrow>
      <Card.Title id="customer-question-title">
        Got a question for our team? 🤔
      </Card.Title>
      <Card.Description>
        I&apos;ll pass it along — your advisor will text or call to follow
        up. Or skip if you&apos;re all set.
      </Card.Description>

      <Card.Body>
        <Field
          label="Question for the team"
          help={`${text.trim().length}/${MAX_LENGTH} characters · optional`}
          inputId="customer-question-textarea"
        >
          {({ id, ariaDescribedBy, ariaInvalid }) => (
            <Textarea
              id={id}
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Example: do you have loaner cars available for this kind of repair?"
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
          onClick={() => submit(null)}
          fullWidthOnMobile
        >
          No questions — all set
        </Button>
        <Button
          variant="primary"
          size="md"
          loading={pending}
          disabled={disabled || text.trim().length === 0}
          onClick={() => submit(text)}
          fullWidthOnMobile
        >
          Send question
        </Button>
      </Card.Actions>
    </Card>
  );
}
