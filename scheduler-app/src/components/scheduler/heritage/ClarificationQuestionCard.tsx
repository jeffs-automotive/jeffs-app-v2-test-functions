"use client";

import { useState } from "react";

import { Button, Card, Chip } from "@/components/ui";

/**
 * Step 7.4 — Clarification question card.
 *
 * Renders ONE clarification question from the diagnostic specialist's queue
 * (the orchestrator's `clarify_concern_question` directive). The customer
 * picks one option OR clicks "I'm not sure" to skip.
 *
 * The chat agent surfaces these one at a time per Chris's design directive
 * 2026-05-13 — never a wall of questions. After each answer, the orchestrator
 * decides whether to ask another question, propose testing services, or
 * advance to Step 8.
 *
 * Output to the AI SDK: `{ question_id, answer }` where answer is the
 * selected option's value OR the literal string "skipped".
 */

export interface ClarificationQuestionCardProps {
  /** Catalog row id (concern_questions.id). */
  question_id: number;
  /** Human-readable question text. */
  question_text: string;
  /** Multiple-choice options: { label, value } pairs from the catalog. */
  options: Array<{ label: string; value: string }>;
  /** Optional service-key context — shown as eyebrow so the customer knows
   *  which of their concerns this clarification belongs to. */
  service_key?: string;
  /** Optional category label (e.g. "Noise" / "Vibration"). */
  category?: string;
  disabled?: boolean;
  onSubmit: (output: { question_id: number; answer: string }) => void | Promise<void>;
}

export function ClarificationQuestionCard({
  question_id,
  question_text,
  options,
  service_key,
  category,
  disabled = false,
  onSubmit,
}: ClarificationQuestionCardProps) {
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  async function submit(answer: string) {
    if (pending || disabled) return;
    setPending(true);
    setSelected(answer);
    try {
      await onSubmit({ question_id, answer });
    } finally {
      // Card unmounts on directive change; if it sticks (e.g. error), restore.
      setPending(false);
    }
  }

  const eyebrowText = category
    ? `A few details · ${category}`
    : service_key
      ? `A few details · ${service_key}`
      : "A few details";

  return (
    <Card aria-labelledby={`clarify-${question_id}-title`}>
      <Card.Eyebrow>{eyebrowText}</Card.Eyebrow>
      <Card.Title id={`clarify-${question_id}-title`}>{question_text}</Card.Title>
      <Card.Description>
        Tap whichever feels closest. If you&apos;re unsure, that&apos;s OK — skip it. 🤔
      </Card.Description>

      <Card.Body>
        <div className="flex flex-wrap gap-2">
          {options.map((opt) => (
            <Chip
              key={opt.value}
              selected={selected === opt.value}
              disabled={pending || disabled}
              onClick={() => submit(opt.value)}
            >
              {opt.label}
            </Chip>
          ))}
        </div>
      </Card.Body>

      <Card.Actions align="left">
        <Button
          variant="ghost"
          size="sm"
          disabled={pending || disabled}
          onClick={() => submit("skipped")}
          fullWidthOnMobile={false}
        >
          I&apos;m not sure
        </Button>
      </Card.Actions>

      <Card.Footnote>
        Your service advisor will see your answers — these help us spot the
        right thing faster.
      </Card.Footnote>
    </Card>
  );
}
