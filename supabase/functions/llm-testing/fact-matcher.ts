// fact-matcher — llm-testing module.
// Extracted from llm-testing/index.ts (file-size-refactor). Mechanical split.

import { EXTRACTED_FACTS_ALL_KEYS, type ExtractedFacts } from "./extracted-facts-schema.ts";

// ════════════════════════════════════════════════════════════════════
// QUESTION-FACT MAPPER (inlined from question-fact-mapper.ts)
// ════════════════════════════════════════════════════════════════════
//
// Pure-TypeScript deterministic mapper. Sub-agent of Stage 3: takes
// extracted_facts + a question list (each carrying required_facts[]) and
// partitions question IDs into answered / ambiguous / unanswered.

export interface QuestionForFactMatch {
  id: number;
  required_facts: string[];
}

export interface QuestionFactMatcherOutput {
  answered_ids: number[];
  unanswered_ids: number[];
  ambiguous_ids: number[];
}

const KNOWN_SLOTS: ReadonlySet<string> = new Set(EXTRACTED_FACTS_ALL_KEYS);
const warnedUnknownSlots = new Set<string>();

function warnUnknownSlotOnce(slot: string): void {
  if (warnedUnknownSlots.has(slot)) return;
  warnedUnknownSlots.add(slot);
  console.warn(
    `[question-fact-mapper] required_facts references unknown slot "${slot}" — treated as always-null. Fix the question's required_facts authoring.`,
  );
}

/**
 * Returns true iff `extracted_facts[fact_name]` represents a value the
 * customer actually stated.
 *   - Unknown slot name → false (deduped warn).
 *   - null/undefined → false.
 *   - Empty string "" → false (free-text slots use null to mean "not stated").
 *   - false (boolean), 0 (integer) → true (valid extracted value).
 */
function isFactPresent(
  extracted_facts: ExtractedFacts,
  fact_name: string,
): boolean {
  if (!KNOWN_SLOTS.has(fact_name)) {
    warnUnknownSlotOnce(fact_name);
    return false;
  }
  const value = (extracted_facts as Record<string, unknown>)[fact_name];
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && value.length === 0) return false;
  return true;
}

export function matchQuestionsToFacts(input: {
  extracted_facts: ExtractedFacts;
  questions: QuestionForFactMatch[];
}): QuestionFactMatcherOutput {
  const answered_ids: number[] = [];
  const unanswered_ids: number[] = [];
  const ambiguous_ids: number[] = [];

  for (const q of input.questions) {
    if (q.required_facts.length === 0) {
      unanswered_ids.push(q.id);
      continue;
    }

    let present = 0;
    for (const slot of q.required_facts) {
      if (isFactPresent(input.extracted_facts, slot)) present += 1;
    }

    if (present === 0) {
      unanswered_ids.push(q.id);
    } else if (present === q.required_facts.length) {
      answered_ids.push(q.id);
    } else {
      ambiguous_ids.push(q.id);
    }
  }

  answered_ids.sort((a, b) => a - b);
  unanswered_ids.sort((a, b) => a - b);
  ambiguous_ids.sort((a, b) => a - b);

  return { answered_ids, unanswered_ids, ambiguous_ids };
}
