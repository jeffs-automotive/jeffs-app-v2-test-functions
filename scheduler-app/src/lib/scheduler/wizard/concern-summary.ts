/**
 * buildConcernSummary — deterministic "Customer states …" paragraph
 * (scheduler revamp Phase 0, 2026-07-02).
 *
 * Replaces the summarize-concern LLM (REVAMP-PLAN §2b: the LLM only reworded
 * prose and already fail-safed to this shape on every error — removal
 * degrades polish, never correctness). Unlike the old fallback, the answered
 * Q&A pairs are PRESERVED as compact follow-up clauses so the Tekmetric RO
 * description keeps the information techs act on.
 *
 * Pure + synchronous — unit-testable, no model, no network.
 */

export interface ConcernSummaryArgs {
  /** Customer's free-text concern description (may be empty). */
  explanation_text: string;
  /** Answered clarification pairs (skipped/"not sure" already filtered). */
  qa_pairs: Array<{ question_text: string; answer: string }>;
  /** The chip the customer picked — used only when there's no description. */
  chip_display_name?: string;
}

export function buildConcernSummary(args: ConcernSummaryArgs): string {
  const desc = args.explanation_text.trim();

  let base: string;
  if (desc.length === 0) {
    base = args.chip_display_name
      ? `Customer reported a concern related to ${args.chip_display_name}.`
      : `Customer reported a concern but did not describe it.`;
  } else if (/^customer\s+(states|reports|says)\b/i.test(desc)) {
    base = desc.endsWith(".") ? desc : `${desc}.`;
  } else {
    base = `Customer states: ${desc}${desc.endsWith(".") ? "" : "."}`;
  }

  if (args.qa_pairs.length === 0) return base;

  const clauses = args.qa_pairs.map((qa) => {
    const q = qa.question_text.trim().replace(/[?:]+$/, "");
    const a = qa.answer.trim().replace(/\.+$/, "");
    return `${q}? ${a}.`;
  });
  return `${base} Follow-ups — ${clauses.join(" ")}`;
}
