import { describe, expect, it } from "vitest";

import {
  applyConfidenceGate,
  overAskQuestionIds,
} from "@/lib/scheduler/wizard/confidence-gate";
import type { DiagnoseConcernResult } from "@/lib/scheduler/wizard/llm/diagnose-concern";
import type {
  ExtractedFacts,
} from "@/lib/scheduler/wizard/llm/extracted-facts";
import type {
  CatalogCategory,
  TestingServiceCategory,
} from "@/lib/scheduler/wizard/llm/load-diagnostic-catalog";

// Minimal ExtractedFacts stand-in — the gate only checks null vs
// non-null, never individual slots.
const FACTS = {} as ExtractedFacts;

function makeResult(
  overrides: Partial<DiagnoseConcernResult> = {},
): DiagnoseConcernResult {
  return {
    matched_category_key: "brake_inspection",
    matched_kind: "testing_service",
    matched_subcategory_slug: "grinding-noise",
    recommended_testing_service: {
      service_key: "brake_inspection",
      display_name: "Brake Inspection",
      description: "We inspect the brakes.",
      starting_price_cents: 8900,
    },
    unanswered_question_ids: [3],
    extracted_facts: FACTS,
    stage1_confidence: "high",
    stage2_confidence: "high",
    stage3_confidence: "high",
    parsed_ok: true,
    model: "anthropic/claude-haiku-4-5",
    latency_ms: 500,
    tokens_in: 1000,
    tokens_out: 100,
    error_message: "",
    ...overrides,
  };
}

const TESTING_SERVICE_CAT: TestingServiceCategory = {
  kind: "testing_service",
  service_key: "brake_inspection",
  display_name: "Brake Inspection",
  description: "We inspect the brakes.",
  starting_price_cents: 8900,
  concern_categories: ["brakes"],
  subcategories: [
    {
      slug: "grinding-noise",
      display_label: "Grinding noise",
      concern_category: "brakes",
      eligible_testing_service_keys: [],
      description: null,
      positive_examples: [],
      negative_examples: [],
      synonyms: [],
      questions: [
        {
          id: 1,
          question_text: "Where is the noise coming from?",
          options: [],
          display_order: 1,
          multi_select: true,
          required_facts: ["location"],
        },
        {
          id: 3,
          question_text: "When does it happen?",
          options: [],
          display_order: 2,
          multi_select: false,
          required_facts: ["timing"],
        },
      ],
    },
  ],
} as unknown as TestingServiceCategory;

describe("applyConfidenceGate", () => {
  it("passes a high-confidence testing-service match untouched", () => {
    const input = makeResult();
    const { result, gate } = applyConfidenceGate(input);
    expect(gate).toBe("pass");
    expect(result).toBe(input);
  });

  it("passes medium confidence — only 'low' escalates", () => {
    const { gate } = applyConfidenceGate(
      makeResult({
        stage1_confidence: "medium",
        stage2_confidence: "medium",
        stage3_confidence: "medium",
      }),
    );
    expect(gate).toBe("pass");
  });

  it("routes Stage-1 low to advisor handoff (strips the match)", () => {
    const { result, gate } = applyConfidenceGate(
      makeResult({ stage1_confidence: "low" }),
    );
    expect(gate).toBe("advisor_handoff");
    expect(result.matched_category_key).toBeNull();
    expect(result.matched_kind).toBeNull();
    expect(result.matched_subcategory_slug).toBeNull();
    expect(result.recommended_testing_service).toBeNull();
    expect(result.unanswered_question_ids).toEqual([]);
    // Audit fields survive the strip.
    expect(result.extracted_facts).toBe(FACTS);
    expect(result.stage1_confidence).toBe("low");
  });

  it("routes Stage-2 low WITH a subcategory pick to advisor handoff", () => {
    const { gate } = applyConfidenceGate(
      makeResult({ stage2_confidence: "low" }),
    );
    expect(gate).toBe("advisor_handoff");
  });

  it("does NOT gate the Stage-2 'low' placeholder when Stage 2 never picked (failure path keeps recommend-without-questions)", () => {
    const { result, gate } = applyConfidenceGate(
      makeResult({
        stage2_confidence: "low",
        stage3_confidence: "low",
        matched_subcategory_slug: null,
        unanswered_question_ids: [],
        extracted_facts: null,
      }),
    );
    expect(gate).toBe("pass");
    expect(result.recommended_testing_service).not.toBeNull();
  });

  it("routes Stage-3 low (extraction ran) to over-ask, keeping the match", () => {
    const { result, gate } = applyConfidenceGate(
      makeResult({ stage3_confidence: "low" }),
    );
    expect(gate).toBe("over_ask");
    expect(result.recommended_testing_service).not.toBeNull();
    expect(result.matched_subcategory_slug).toBe("grinding-noise");
  });

  it("does NOT gate the Stage-3 'low' placeholder when Stage 3 never ran", () => {
    const { gate } = applyConfidenceGate(
      makeResult({ stage3_confidence: "low", extracted_facts: null }),
    );
    expect(gate).toBe("pass");
  });

  it("never gates 'other' subcategory matches (already advisor handoff)", () => {
    const input = makeResult({
      matched_kind: "other_subcategory",
      matched_category_key: "multiple-symptoms",
      recommended_testing_service: null,
      stage1_confidence: "low",
      stage2_confidence: "low",
      stage3_confidence: "low",
    });
    const { result, gate } = applyConfidenceGate(input);
    expect(gate).toBe("pass");
    expect(result).toBe(input);
  });

  it("never gates null matches", () => {
    const { gate } = applyConfidenceGate(
      makeResult({
        matched_kind: null,
        matched_category_key: null,
        matched_subcategory_slug: null,
        recommended_testing_service: null,
        stage1_confidence: "low",
      }),
    );
    expect(gate).toBe("pass");
  });

  it("advisor handoff wins over over-ask when Stage 1 and Stage 3 are both low", () => {
    const { gate } = applyConfidenceGate(
      makeResult({ stage1_confidence: "low", stage3_confidence: "low" }),
    );
    expect(gate).toBe("advisor_handoff");
  });
});

describe("overAskQuestionIds", () => {
  it("returns the FULL subcategory question list", () => {
    expect(overAskQuestionIds(TESTING_SERVICE_CAT, "grinding-noise")).toEqual([
      1, 3,
    ]);
  });

  it("returns null when the subcategory slug doesn't resolve", () => {
    expect(overAskQuestionIds(TESTING_SERVICE_CAT, "nope")).toBeNull();
  });

  it("returns null for null category / slug / non-testing-service", () => {
    expect(overAskQuestionIds(null, "grinding-noise")).toBeNull();
    expect(overAskQuestionIds(TESTING_SERVICE_CAT, null)).toBeNull();
    const otherCat = {
      kind: "other_subcategory",
      subcategory_slug: "multiple-symptoms",
      display_label: "Multiple symptoms",
      questions: [],
    } as unknown as CatalogCategory;
    expect(overAskQuestionIds(otherCat, "multiple-symptoms")).toBeNull();
  });
});
