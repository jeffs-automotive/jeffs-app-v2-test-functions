"use client";

import { useState } from "react";

import { Button, Card } from "@/components/ui";

/**
 * Step 7.4b — Concern clarify card (act-or-ask AO4, 2026-07-03).
 *
 * Stage-1 of the concern-diagnosis pipeline sometimes can't safely pick
 * between 2-3 service categories for the customer's typed concern (the
 * "act-or-ask" decision). When it asks, this card:
 *
 *   1. Frames the customer's OWN concern text back to them (editorial
 *      pull-quote, 3-line clamp).
 *   2. Asks "Which of these sounds closest?".
 *   3. Presents the 2-3 RANKED candidates as tappable rows (name +
 *      "From $X" / "We'll take a look" pill + one-line description).
 *   4. Offers a "None of these / not sure" ghost escape below a hairline
 *      divider that forwards the concern to a human advisor.
 *
 * Interaction model (per design spec §0, §7): single tap on a candidate =
 * immediate submit (no Continue button) — matches ClarificationQuestionCard's
 * single-select idiom + MultiAccountDisambiguationCard's pick-a-row-and-go.
 * These are ACTION buttons, NOT a radiogroup / aria-pressed toggles: a tap
 * immediately submits and unmounts the card, so there's no persistent
 * "one-of-many checked" state for AT to convey.
 *
 * Design-and-wiring only — this is a presentational leaf that renders props
 * and calls onSubmit. It touches no Server Action / DAL / state machine.
 * See .claude/work/design/act-or-ask-stage1-spec.md.
 */

export interface ConcernClarifyCandidate {
  /** Stable key the action echoes back (category key or subcategory slug). */
  candidate_key: string;
  /** Friendly service/category name, e.g. "Brake inspection". */
  display_name: string;
  /** Starting price in cents. NULL for advisor-handoff-kind candidates
   *  (no autonomous price to quote) — renders "We'll take a look" instead. */
  starting_price_cents: number | null;
  /** One-line, customer-friendly description of what this covers. */
  description: string | null;
}

export interface ConcernClarifyCardProps {
  /** The customer's own typed concern text, echoed back verbatim. */
  concern_text: string;
  /** 2-3 candidates, ALREADY RANKED best-first by the caller. Rendered in
   *  array order — never re-sorted in the component. */
  candidates: ConcernClarifyCandidate[];
  disabled?: boolean;
  onSubmit: (
    output:
      | { action: "select"; candidate_key: string }
      | { action: "none_of_these" },
  ) => void | Promise<void>;
}

/**
 * Presentational price formatting (mirrors TestingServiceApprovalCard.fmtPrice
 * but uses "From $X" whole-dollars for the narrow row). NULL price →
 * "We'll take a look" (rendered as a bronze pill, not this text) for the
 * advisor-handoff candidate.
 */
function priceLabel(cents: number | null): string {
  if (cents === null) return "We'll take a look"; // advisor-handoff kind
  if (cents === 0) return "Included";
  return `From $${(cents / 100).toFixed(0)}`; // whole dollars; "From" caveat
}

export function ConcernClarifyCard({
  concern_text,
  candidates,
  disabled = false,
  onSubmit,
}: ConcernClarifyCardProps) {
  // pending tracks WHICH control is submitting: `candidate-<key>` | "none"
  // | null. Same string-tracking idiom as MultiAccountDisambiguationCard.
  const [pending, setPending] = useState<string | null>(null);

  async function pickCandidate(candidate_key: string) {
    if (pending !== null || disabled) return;
    setPending(`candidate-${candidate_key}`);
    try {
      await onSubmit({ action: "select", candidate_key });
    } finally {
      // Card unmounts on step advance; if it sticks (e.g. error), re-enable.
      setPending(null);
    }
  }

  async function pickNone() {
    if (pending !== null || disabled) return;
    setPending("none");
    try {
      await onSubmit({ action: "none_of_these" });
    } finally {
      setPending(null);
    }
  }

  const displayedConcern = concern_text.trim();
  const controlsDisabled = pending !== null || disabled;

  return (
    <Card aria-labelledby="concern-clarify-title">
      <Card.Eyebrow>A quick check</Card.Eyebrow>
      <Card.Title id="concern-clarify-title">
        Which of these sounds closest?
      </Card.Title>

      {/* ── Echoed concern: editorial pull-quote (gold rule-accent) ── */}
      {displayedConcern.length > 0 ? (
        <>
          <p className="label-eyebrow mt-1">Here&apos;s what you told me</p>
          <blockquote
            className={
              "mt-1.5 border-l-2 border-brand-gold-400 pl-3.5 py-0.5 " +
              "text-[15px] leading-relaxed italic text-ink line-clamp-3"
            }
          >
            {displayedConcern}
          </blockquote>
        </>
      ) : null}

      <Card.Description>
        A couple of these could fit. Tap whichever feels closest — or if none
        quite match, that&apos;s OK, I&apos;ll pass your note to one of our
        advisors. 🙂
      </Card.Description>

      <Card.Body>
        {/* role="group" + aria-label scopes the choice set for AT without
            fieldset styling fighting the card padding (spec §7). The card's
            aria-labelledby heading already names the card. */}
        <ul
          role="group"
          aria-label="Choose the closest service"
          className="space-y-3"
        >
          {candidates.map((c) => {
            const isCommitting = pending === `candidate-${c.candidate_key}`;
            // Idle row: rule-input resting boundary (3.21:1, passes the
            // non-text UI floor — the fix over the sibling card's decorative
            // border-rule base). Committed row: burgundy border + burgundy-50
            // wash (8.53:1 border / 13.72:1 name text).
            const rowClass = isCommitting
              ? "flex w-full flex-col gap-1 rounded-[var(--radius-card)] " +
                "border border-brand-burgundy-700 bg-brand-burgundy-50 px-4 py-3.5 text-left " +
                "shadow-[var(--shadow-card)] " +
                "transition-[transform,background-color,border-color,box-shadow] duration-150 ease-out " +
                "disabled:cursor-not-allowed disabled:opacity-60"
              : "flex w-full flex-col gap-1 rounded-[var(--radius-card)] " +
                "border border-[var(--color-rule-input)] bg-paper-100 px-4 py-3.5 text-left " +
                "shadow-[var(--shadow-card)] " +
                "transition-[transform,background-color,border-color,box-shadow] duration-150 ease-out " +
                "hover:border-brand-burgundy-400 hover:bg-brand-burgundy-50 hover:shadow-[var(--shadow-card-hover)] " +
                "active:scale-[0.99] " +
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-burgundy-500 " +
                "disabled:cursor-not-allowed disabled:opacity-60";
            return (
              <li key={c.candidate_key}>
                <button
                  type="button"
                  disabled={controlsDisabled}
                  onClick={() => pickCandidate(c.candidate_key)}
                  className={rowClass}
                >
                  {/* Row 1 — name + price/pill, baseline-aligned. */}
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-[15px] font-medium text-ink">
                      {c.display_name}
                    </span>
                    {c.starting_price_cents === null ? (
                      // Advisor-handoff candidate: bronze pill reads as
                      // "no number to show yet" rather than a missing price.
                      // gold-700 bronze = 6.45:1 on paper-100 (sanctioned
                      // gold-family text escape hatch); border is decorative.
                      <span
                        className={
                          "shrink-0 inline-flex items-center rounded-[var(--radius-pill)] " +
                          "border border-brand-gold-500 px-2 py-0.5 " +
                          "text-[12px] font-medium text-brand-gold-700"
                        }
                      >
                        We&apos;ll take a look
                      </span>
                    ) : (
                      <span className="shrink-0 font-display text-[14px] text-brand-burgundy-700">
                        {priceLabel(c.starting_price_cents)}
                      </span>
                    )}
                  </span>
                  {/* Row 2 — description (muted, wraps to 2 lines max). */}
                  {c.description ? (
                    <span className="text-[13px] leading-relaxed text-ink-secondary">
                      {c.description}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </Card.Body>

      <Card.Divider tone="rule" />

      <Card.Actions align="left">
        <Button
          variant="ghost"
          size="md"
          loading={pending === "none"}
          disabled={controlsDisabled}
          onClick={pickNone}
          fullWidthOnMobile
        >
          None of these — pass it to an advisor
        </Button>
      </Card.Actions>

      <Card.Footnote>
        Not sure? No problem — pick &quot;None of these&quot; and a Jeff&apos;s
        advisor will read your note and sort it out. You can keep booking either
        way.
      </Card.Footnote>
    </Card>
  );
}
