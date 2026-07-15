"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import { Card } from "@/components/ui";
import { interpolate } from "@/lib/scheduler/wizard/card-copy";
import type { CardCopy } from "@/lib/scheduler/card-text";

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

const SHOP_PHONE_DISPLAY = "(610) 253-6565";

export interface DiagnosticLoadingCardProps {
  /** Editable card copy (card-text-editor) — resolved slot strings.
   *  The error-state body + the role=alert failure block stay hardcoded
   *  (error messaging is out of the editable "main copy" scope). */
  copy: CardCopy<"diagnostic_loading">;
  /** Action passed in by WizardSurface — calls runDiagnosticsV2 with the chatId. */
  onMount: () => Promise<{ ok: boolean; error?: string }>;
}

export function DiagnosticLoadingCard({
  copy,
  onMount,
}: DiagnosticLoadingCardProps) {
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
      ? copy.title_very_slow
      : stage === "slow"
        ? copy.title_slow
        : copy.title_running;

  const body: ReactNode =
    error !== null
      ? "Something went wrong on our side. Hang tight — if this sticks, please call us at (610) 253-6565."
      : stage === "very_slow"
        ? interpolate(copy.body_very_slow, { shop_phone: SHOP_PHONE_DISPLAY })
        : stage === "slow"
          ? copy.body_slow
          : copy.body_running;

  // R6-D-3 a11y fix 2026-05-16: previously the Card wrapper carried
  // aria-live="polite" which scoped the live region to the entire card
  // (every static surface change re-announced). Tightened: live region
  // is now scoped to the changing Title + Description only via a
  // dedicated <div aria-live="polite">; the error branch escalates to
  // role="alert" so screen readers announce failure immediately.
  return (
    <Card aria-labelledby="diagnostic-loading-title">
      <Card.Eyebrow>{copy.eyebrow}</Card.Eyebrow>
      <div aria-live={error !== null ? undefined : "polite"} aria-atomic="true">
        <Card.Title id="diagnostic-loading-title">{headline} 🤔</Card.Title>
        <Card.Description>{body}</Card.Description>
      </div>

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
        <div
          role="alert"
          className={
            "mt-5 rounded-[var(--radius-input)] border " +
            "border-status-error-fg bg-status-error-bg px-4 py-3 " +
            "text-[14px] leading-snug text-status-error-fg"
          }
        >
          <p>
            Something went wrong on our side. If this sticks, please call us at{" "}
            <a
              href="tel:6102536565"
              className="font-medium text-brand-burgundy-700 underline underline-offset-2 hover:no-underline"
            >
              (610) 253-6565
            </a>
            .
          </p>
          <p className="mt-2 text-[12px] text-ink-tertiary">
            Detail for your service writer: {error}
          </p>
        </div>
      )}
    </Card>
  );
}
