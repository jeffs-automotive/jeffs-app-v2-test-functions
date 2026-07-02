import { describe, expect, it } from "vitest";

import { buildConcernSummary } from "./concern-summary";

describe("buildConcernSummary (deterministic, replaces the summarize-concern LLM)", () => {
  it("wraps a plain description", () => {
    expect(
      buildConcernSummary({ explanation_text: "brakes are grinding", qa_pairs: [] }),
    ).toBe("Customer states: brakes are grinding.");
  });

  it("keeps an already-prefixed description as-is (adds terminal period)", () => {
    expect(
      buildConcernSummary({ explanation_text: "Customer states the car pulls left", qa_pairs: [] }),
    ).toBe("Customer states the car pulls left.");
  });

  it("empty description falls back to the chip name", () => {
    expect(
      buildConcernSummary({ explanation_text: "", qa_pairs: [], chip_display_name: "Brake Inspection" }),
    ).toBe("Customer reported a concern related to Brake Inspection.");
  });

  it("PRESERVES answered Q&A as follow-up clauses (info the old LLM folded in)", () => {
    const s = buildConcernSummary({
      explanation_text: "grinding when stopping",
      qa_pairs: [
        { question_text: "Does the sound come from the front or rear?", answer: "Front" },
        { question_text: "Did it start suddenly, or build up over weeks?", answer: "Built up gradually" },
      ],
    });
    expect(s).toBe(
      "Customer states: grinding when stopping. Follow-ups — Does the sound come from the front or rear? Front. Did it start suddenly, or build up over weeks? Built up gradually.",
    );
  });

  it("no double periods on pre-terminated inputs", () => {
    expect(
      buildConcernSummary({ explanation_text: "squeal at low speed.", qa_pairs: [] }),
    ).toBe("Customer states: squeal at low speed.");
  });
});
