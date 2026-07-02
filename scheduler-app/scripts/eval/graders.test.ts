import { describe, expect, it } from "vitest";

import {
  classifySafetyLanding,
  computeAskDelta,
  computeStage1Metrics,
  computeStage2Metrics,
  gradeStage3Case,
  isStage1Correct,
  percentile,
  stage3Micro,
  type EvalCaseExpected,
  type GradableResult,
} from "./graders";

function expected(
  overrides: Partial<EvalCaseExpected> = {},
): EvalCaseExpected {
  return {
    stage1_category_key: "brake_inspection",
    stage2_subcategory_slug: "grinding-noise",
    stage3_facts: {},
    route: "testing_service",
    ...overrides,
  };
}

function result(overrides: Partial<GradableResult> = {}): GradableResult {
  return {
    matched_category_key: "brake_inspection",
    matched_kind: "testing_service",
    matched_subcategory_slug: "grinding-noise",
    recommended_testing_service: { service_key: "brake_inspection" },
    unanswered_question_ids: [1, 2],
    extracted_facts: {},
    stage1_confidence: "high",
    stage2_confidence: "high",
    stage3_confidence: "high",
    parsed_ok: true,
    error_message: "",
    ...overrides,
  };
}

describe("isStage1Correct", () => {
  it("exact match", () => {
    expect(isStage1Correct(expected(), "brake_inspection")).toBe(true);
    expect(isStage1Correct(expected(), "engine_noise")).toBe(false);
  });
  it("null expected matches null actual", () => {
    expect(
      isStage1Correct(expected({ stage1_category_key: null }), null),
    ).toBe(true);
  });
  it("acceptable alternates count as correct", () => {
    const e = expected({ stage1_acceptable: ["engine_noise"] });
    expect(isStage1Correct(e, "engine_noise")).toBe(true);
    expect(isStage1Correct(e, "hvac")).toBe(false);
  });
});

describe("computeStage1Metrics", () => {
  it("computes accuracy + per-class F1 + macro-F1", () => {
    const rows = [
      { expected: expected(), actualKey: "brake_inspection" }, // TP brakes
      { expected: expected(), actualKey: "engine_noise" }, // FN brakes, FP engine
      {
        expected: expected({
          stage1_category_key: "engine_noise",
          stage2_subcategory_slug: null,
        }),
        actualKey: "engine_noise",
      }, // TP engine
      {
        expected: expected({ stage1_category_key: null, route: "null_match" }),
        actualKey: null,
      }, // TP (null)
    ];
    const m = computeStage1Metrics(rows);
    expect(m.total).toBe(4);
    expect(m.correct).toBe(3);
    expect(m.accuracy).toBeCloseTo(0.75);
    const brakes = m.perClass.find((c) => c.cls === "brake_inspection")!;
    expect(brakes.tp).toBe(1);
    expect(brakes.fn).toBe(1);
    expect(brakes.precision).toBe(1); // no FP against brakes
    expect(brakes.recall).toBeCloseTo(0.5);
    const engine = m.perClass.find((c) => c.cls === "engine_noise")!;
    expect(engine.fp).toBe(1);
    expect(engine.tp).toBe(1);
    // macro over expected classes only: brakes, engine, (null)
    expect(m.macroF1).toBeGreaterThan(0);
    expect(m.macroF1).toBeLessThanOrEqual(1);
  });
});

describe("computeStage2Metrics", () => {
  it("grades only stage1-correct testing-service cases", () => {
    const rows = [
      {
        expected: expected(),
        actualKey: "brake_inspection",
        actualSlug: "grinding-noise",
      }, // graded, correct
      {
        expected: expected(),
        actualKey: "brake_inspection",
        actualSlug: "squealing",
      }, // graded, wrong
      { expected: expected(), actualKey: "engine_noise", actualSlug: null }, // stage1 wrong → skipped
      {
        expected: expected({
          stage1_category_key: "multiple-symptoms",
          stage2_subcategory_slug: null,
          route: "advisor_handoff",
        }),
        actualKey: "multiple-symptoms",
        actualSlug: null,
      }, // non-testing route → skipped
    ];
    const m = computeStage2Metrics(rows);
    expect(m.graded).toBe(2);
    expect(m.correct).toBe(1);
    expect(m.accuracy).toBeCloseTo(0.5);
  });
});

describe("gradeStage3Case + stage3Micro", () => {
  it("TP on exact match, wildcard accepts any non-null", () => {
    const c = gradeStage3Case(
      { noise_descriptor: "grinding", location_axle: "*" },
      { noise_descriptor: "grinding", location_axle: "front" },
    );
    expect(c).toEqual({ tp: 2, fp: 0, fn: 0, valueMismatch: 0 });
  });
  it("FP on wrong assertion, FN on missed fact, mismatch counts both", () => {
    const c = gradeStage3Case(
      { noise_descriptor: "grinding", speed_band: "highway" },
      { noise_descriptor: "squealing", pedal_feel: "soft" },
    );
    // noise_descriptor: mismatch (fp+fn), speed_band: fn, pedal_feel: fp
    expect(c.valueMismatch).toBe(1);
    expect(c.fp).toBe(2);
    expect(c.fn).toBe(2);
    expect(c.tp).toBe(0);
  });
  it("null actual facts → all expected are FN", () => {
    const c = gradeStage3Case({ smell_descriptor: "burning" }, null);
    expect(c).toEqual({ tp: 0, fp: 0, fn: 1, valueMismatch: 0 });
  });
  it("case-insensitive string compare", () => {
    const c = gradeStage3Case(
      { smoke_color: "White" },
      { smoke_color: "white " },
    );
    expect(c.tp).toBe(1);
  });
  it("micro-aggregates", () => {
    const m = stage3Micro([
      { tp: 2, fp: 0, fn: 0, valueMismatch: 0 },
      { tp: 0, fp: 2, fn: 2, valueMismatch: 1 },
    ]);
    expect(m.precision).toBeCloseTo(2 / 4);
    expect(m.recall).toBeCloseTo(2 / 4);
  });
  it("empty everything → perfect precision/recall (vacuous)", () => {
    const m = stage3Micro([gradeStage3Case({}, {})]);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
  });
});

describe("classifySafetyLanding", () => {
  it("correct when stage1+stage2 match", () => {
    expect(classifySafetyLanding(expected(), result())).toBe("correct");
  });
  it("handoff when gated/null/other", () => {
    expect(
      classifySafetyLanding(
        expected(),
        result({
          matched_category_key: null,
          matched_kind: null,
          matched_subcategory_slug: null,
          recommended_testing_service: null,
          unanswered_question_ids: [],
        }),
      ),
    ).toBe("handoff");
  });
  it("over_ask when wrong subcategory but questions queued", () => {
    expect(
      classifySafetyLanding(
        expected(),
        result({ matched_subcategory_slug: "squealing" }),
      ),
    ).toBe("over_ask");
  });
  it("flags the dangerous bucket: wrong rec, zero questions", () => {
    expect(
      classifySafetyLanding(
        expected({ stage1_category_key: "engine_noise" }),
        result({ unanswered_question_ids: [] }),
      ),
    ).toBe("confident_misroute_no_questions");
  });
});

describe("computeAskDelta", () => {
  it("computes over/under ask", () => {
    const d = computeAskDelta([1, 2, 3], [2, 3, 4, 5]);
    expect(d.overAsked).toBe(2); // 4,5
    expect(d.underAsked).toBe(1); // 1
    expect(d.perfectAskCount).toBe(3);
    expect(d.actualAskCount).toBe(4);
  });
});

describe("percentile", () => {
  it("p50/p95", () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(v, 50)).toBe(5);
    expect(percentile(v, 95)).toBe(10);
    expect(percentile([], 95)).toBe(0);
  });
});
