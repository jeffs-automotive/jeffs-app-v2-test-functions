/**
 * Confidence gate for diagnoseConcern results — REVAMP-PLAN §11 P0,
 * wired 2026-07-02.
 *
 * diagnoseConcern self-reports per-stage confidence ("high" | "medium" |
 * "low") but the wizard previously discarded all three values — a
 * low-confidence-but-valid pick silently became a fee-bearing testing-
 * service recommendation. Small models are OVERconfident, so "low" is a
 * strong escalate signal; "high" never suppresses the human net (every
 * recommendation is still advisor-reviewed downstream).
 *
 * Gate rules (testing-service matches only — 'other' + null matches are
 * already the advisor-handoff path and carry no autonomous consequence):
 *
 *   - Stage 1 OR Stage 2 reports "low" → ADVISOR HANDOFF. The match is
 *     stripped so the concern takes the exact null-match path: no
 *     recommendation, no clarification questions. The raw concern text
 *     still reaches the advisor via the deterministic concern summary in
 *     the Tekmetric appointment description.
 *   - Stage 3 reports "low" (fact extraction suspect) → OVER-ASK. The
 *     match is kept but the answered-question mapping is distrusted: the
 *     caller re-queues EVERY question for the matched subcategory. A
 *     wrongly asserted fact SKIPS a question (the expensive error);
 *     re-asking is cheap.
 *
 * Placeholder semantics: stages that never ran also report "low"
 * (diagnoseConcern's defaults), so:
 *   - The Stage-2 gate applies only when Stage 2 actually produced a pick
 *     (matched_subcategory_slug non-null). A Stage-2 FAILURE already
 *     degrades inside diagnoseConcern to recommend-without-questions —
 *     that sanctioned path stays.
 *   - The Stage-3 gate applies only when Stage 3 actually ran
 *     (extracted_facts non-null). A Stage-3 FAILURE already degrades
 *     inside diagnoseConcern to over-ask.
 */
import type { DiagnoseConcernResult } from "@/lib/scheduler/wizard/llm/diagnose-concern";
import {
  isTestingService,
  type CatalogCategory,
} from "@/lib/scheduler/wizard/llm/load-diagnostic-catalog";

export type ConfidenceGateOutcome = "pass" | "advisor_handoff" | "over_ask";

export interface ConfidenceGateResult {
  result: DiagnoseConcernResult;
  gate: ConfidenceGateOutcome;
}

export function applyConfidenceGate(
  result: DiagnoseConcernResult,
): ConfidenceGateResult {
  if (result.matched_kind !== "testing_service") {
    return { result, gate: "pass" };
  }

  const stage1Low = result.stage1_confidence === "low";
  const stage2Low =
    result.stage2_confidence === "low" &&
    result.matched_subcategory_slug !== null;
  if (stage1Low || stage2Low) {
    return {
      gate: "advisor_handoff",
      result: {
        ...result,
        matched_category_key: null,
        matched_kind: null,
        matched_subcategory_slug: null,
        recommended_testing_service: null,
        unanswered_question_ids: [],
        // extracted_facts intentionally kept — debugging/audit value.
      },
    };
  }

  const stage3Low =
    result.stage3_confidence === "low" && result.extracted_facts !== null;
  if (stage3Low) {
    // The caller expands unanswered_question_ids to the full subcategory
    // question list via overAskQuestionIds() once it has resolved the
    // catalog record (the gate itself has no catalog access).
    return { result, gate: "over_ask" };
  }

  return { result, gate: "pass" };
}

/**
 * Full question-id list for the matched subcategory — the over-ask set.
 * Returns null when the subcategory can't be resolved (caller keeps the
 * LLM-provided unanswered ids in that case).
 */
export function overAskQuestionIds(
  matchedCat: CatalogCategory | null,
  subcategorySlug: string | null,
): number[] | null {
  if (!matchedCat || !subcategorySlug || !isTestingService(matchedCat)) {
    return null;
  }
  const sub = matchedCat.subcategories.find((s) => s.slug === subcategorySlug);
  if (!sub) return null;
  return sub.questions.map((q) => q.id);
}
