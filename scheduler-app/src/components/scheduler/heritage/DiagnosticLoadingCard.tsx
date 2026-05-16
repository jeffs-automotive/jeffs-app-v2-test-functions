"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { Card } from "@/components/ui";

/**
 * Step 7.3 — Diagnostic loading card (Phase 9c, 2026-05-15).
 *
 * Per chat-design.md "Architecture amendment — 2026-05-14" §Step 7
 * redesign: after the customer fills in all `explanation_required_items`
 * descriptions, the wizard lands on this card. On mount, the card kicks
 * off `runDiagnosticsV2` (Phase 9a) which:
 *
 *   1. Resolves each item's concern category from the service's
 *      concern_categories[].
 *   2. Loads the per-category guideline prose + active questions.
 *   3. Calls the diagnostic LLM (Haiku 4.5) once per item in parallel
 *      to gap-detect which questions the descriptions didn't answer.
 *   4. Aggregates the unanswered questions into clarification_questions_pending.
 *   5. Writes back to the row + advances to either `clarification_question`
 *      (queue non-empty) or `second_routine_pass` (queue empty).
 *
 * Because applyWizardTransition revalidates the page, the customer is
 * automatically navigated to the next card once the action returns. This
 * card is intentionally just a loading state — no submit button.
 *
 * Slowness messaging mirrors chat-design.md §A "Error states":
 *   - 0-15s: "One moment while I think through what testing might be needed."
 *   - 15-45s: "Still working — this is taking a little longer than usual."
 *   - 45s+: "Hmm, this is slow. Please hang on or feel free to call us."
 *
 * If the action returns ok:false (real failure, not just slow), the card
 * shows an error nudge with a retry; phase 14 unifies the error UX.
 */

export interface DiagnosticLoadingCardProps {
  /** Action passed in by WizardSurface — calls runDiagnosticsV2 with the chatId. */
  onMount: () => Promise<{ ok: boolean; error?: string }>;
}

export function DiagnosticLoadingCard({ onMount }: DiagnosticLoadingCardProps) {
  const [, startTransition] = useTransition();
  const startedRef = useRef(false);
  const [stage, setStage] = useState<"running" | "slow" | "very_slow">(
    "running",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const slowTimer = setTimeout(() => setStage("slow"), 15_000);
    const verySlowTimer = setTimeout(() => setStage("very_slow"), 45_000);

    startTransition(() => {
      void (async () => {
        try {
          const result = await onMount();
          if (!result.ok) {
            setError(result.error || "Something went wrong on our side.");
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          clearTimeout(slowTimer);
          clearTimeout(verySlowTimer);
        }
      })();
    });

    return () => {
      clearTimeout(slowTimer);
      clearTimeout(verySlowTimer);
    };
  }, [onMount]);

  const headline =
    stage === "very_slow"
      ? "Still working on this..."
      : stage === "slow"
        ? "Still thinking..."
        : "One moment...";

  const body =
    error !== null
      ? "Something went wrong on our side. Hang tight — if this sticks, please call us at (610) 253-6565."
      : stage === "very_slow"
        ? "This is taking a little longer than usual. Feel free to call us at (610) 253-6565 if you'd rather skip ahead."
        : stage === "slow"
          ? "Almost there — pulling together the right questions for you."
          : "I'm thinking through what testing might be needed based on what you described.";

  return (
    <Card aria-labelledby="diagnostic-loading-title" aria-live="polite">
      <Card.Eyebrow>Step 7.3 · Thinking through your concerns</Card.Eyebrow>
      <Card.Title id="diagnostic-loading-title">{headline} 🤔</Card.Title>
      <Card.Description>{body}</Card.Description>

      <Card.Body>
        <div className="flex items-center justify-center py-6">
          <span
            className="inline-block h-3 w-3 animate-pulse rounded-full bg-brand-burgundy-700"
            aria-hidden="true"
          />
          <span
            className="ml-2 inline-block h-3 w-3 animate-pulse rounded-full bg-brand-burgundy-700"
            style={{ animationDelay: "150ms" }}
            aria-hidden="true"
          />
          <span
            className="ml-2 inline-block h-3 w-3 animate-pulse rounded-full bg-brand-burgundy-700"
            style={{ animationDelay: "300ms" }}
            aria-hidden="true"
          />
          <span className="sr-only">Loading</span>
        </div>
      </Card.Body>

      {error !== null && (
        <Card.Footnote>
          Error detail (for your service writer): {error}
        </Card.Footnote>
      )}
    </Card>
  );
}
