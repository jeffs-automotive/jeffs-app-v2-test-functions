"use client";

import { useState } from "react";

import { Button, Card, Chip } from "@/components/ui";

/**
 * Step 7.4 — Clarification question card.
 *
 * Renders ONE clarification question from the diagnostic specialist's queue.
 * Two modes:
 *
 *   - **single-select** (default — most questions): the customer taps one
 *     chip and that submits immediately. Or "I'm not sure" to skip.
 *   - **multi-select** (when `multi_select` is true — e.g. location
 *     questions where "Rear" + "Left side" both apply): chips toggle on/off
 *     when tapped. A Continue button submits the selected set. Or "I'm not
 *     sure" to skip.
 *
 * The wizard surfaces these one at a time per Chris's design directive
 * 2026-05-13 — never a wall of questions. After each answer, the diagnostic
 * routing decides whether to ask another question, propose testing
 * services, or advance to Step 8.
 *
 * Emits to the submit-clarification-answer action:
 *   - Single-select: `{ question_id, answer: "<option_value>" | "skipped" }`
 *   - Multi-select:  `{ question_id, answer: ["<v1>", "<v2>"] | "skipped" }`
 *
 * Multi-select shape added 2026-05-18 with the CAT-2 catalog rebuild —
 * before then every question was single-select and many "front or rear"
 * style questions had wrong [Yes/No/Sometimes] options. The DB now stores
 * arrays for multi-select questions; the submit-clarification action
 * validates each value against the option set.
 */

export interface ClarificationQuestionCardProps {
  /** Catalog row id (concern_questions.id). */
  question_id: number;
  /** Human-readable question text. */
  question_text: string;
  /** Multiple-choice options: { label, value } pairs from the catalog. */
  options: Array<{ label: string; value: string }>;
  /** TRUE → multi-select mode (chips toggle + Continue button). FALSE →
   *  single-tap submit. Defaults to FALSE for back-compat (pre-2026-05-18
   *  payloads always single-select). */
  multi_select?: boolean;
  /** Optional service-key context — shown as eyebrow so the customer knows
   *  which of their concerns this clarification belongs to. */
  service_key?: string;
  /** Optional category label (e.g. "Noise" / "Vibration"). */
  category?: string;
  disabled?: boolean;
  onSubmit: (output: {
    question_id: number;
    answer: string | string[];
  }) => void | Promise<void>;
}

export function ClarificationQuestionCard({
  question_id,
  question_text,
  options,
  multi_select = false,
  service_key,
  category,
  disabled = false,
  onSubmit,
}: ClarificationQuestionCardProps) {
  const [pending, setPending] = useState(false);
  // Single-select: at most one entry. Multi-select: any number.
  const [selected, setSelected] = useState<string[]>([]);

  async function submit(answer: string | string[]) {
    if (pending || disabled) return;
    setPending(true);
    try {
      await onSubmit({ question_id, answer });
    } finally {
      // Card unmounts on directive change; if it sticks (e.g. error), restore.
      setPending(false);
    }
  }

  function toggleChip(value: string) {
    if (pending || disabled) return;
    if (!multi_select) {
      // Single-select: tap submits immediately.
      setSelected([value]);
      void submit(value);
      return;
    }
    // Multi-select: toggle without submitting.
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

  function submitMulti() {
    if (selected.length === 0 || pending || disabled) return;
    void submit([...selected]);
  }

  const eyebrowText = category
    ? `A few details · ${category}`
    : service_key
      ? `A few details · ${service_key}`
      : "A few details";

  const helperText = multi_select
    ? "Tap all that apply, then Continue. If you're unsure, that's OK — skip it. 🤔"
    : "Tap whichever feels closest. If you're unsure, that's OK — skip it. 🤔";

  return (
    <Card aria-labelledby={`clarify-${question_id}-title`}>
      <Card.Eyebrow>{eyebrowText}</Card.Eyebrow>
      <Card.Title id={`clarify-${question_id}-title`}>{question_text}</Card.Title>
      <Card.Description>{helperText}</Card.Description>

      <Card.Body>
        <div className="flex flex-wrap gap-2">
          {options.map((opt) => (
            <Chip
              key={opt.value}
              selected={selected.includes(opt.value)}
              disabled={pending || disabled}
              onClick={() => toggleChip(opt.value)}
            >
              {opt.label}
            </Chip>
          ))}
        </div>
      </Card.Body>

      <Card.Actions align={multi_select ? "between" : "left"}>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending || disabled}
          onClick={() => submit("skipped")}
          fullWidthOnMobile={false}
        >
          I&apos;m not sure
        </Button>
        {multi_select ? (
          <Button
            variant="primary"
            size="sm"
            disabled={selected.length === 0 || pending || disabled}
            onClick={submitMulti}
            fullWidthOnMobile={false}
          >
            Continue
          </Button>
        ) : null}
      </Card.Actions>

      <Card.Footnote>
        Your service advisor will see your answers — these help us spot the
        right thing faster.
      </Card.Footnote>
    </Card>
  );
}
