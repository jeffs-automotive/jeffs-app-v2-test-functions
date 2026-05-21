/**
 * Unit tests for question-fact-mapper.
 *
 * Each test below is anchored to a real customer description that surfaced
 * in diagnostic eval batches 7/8/9 (May 2026). The mapper's job is to take
 * the Stage 1 ExtractedFacts and a subcategory's questions (with their
 * required_facts tags) and split them into answered / ambiguous / unanswered.
 *
 * IMPORTANT: these tests use synthetic question IDs only (any positive
 * integer); the mapper does not care about question_text, only the
 * required_facts shape. Numbers like Q688, Q691, Q725 etc. mirror the
 * real catalog IDs to make failure messages debuggable against the docs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { type ExtractedFacts } from "./extracted-facts";
import {
  isFactPresent,
  matchQuestionsToFacts,
  __resetUnknownSlotWarningsForTests,
  type QuestionForFactMatch,
} from "./question-fact-mapper";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Build an ExtractedFacts with every slot null by default; tests override
 * just the slots they care about. Mirrors the LLM contract: every key is
 * required, null means "not stated."
 */
function makeFacts(overrides: Partial<ExtractedFacts> = {}): ExtractedFacts {
  const base: ExtractedFacts = {
    location_side: null,
    location_axle: null,
    speed_band: null,
    speed_specific_mph: null,
    onset_timing: null,
    started_when: null,
    hvac_mode: null,
    airflow_state: null,
    pedal_feel: null,
    smell_descriptor: null,
    noise_descriptor: null,
    smoke_color: null,
    fluid_color: null,
    fluid_under_car_location: null,
    warning_light_named: null,
    warning_light_behavior: null,
    engine_running: null,
    recent_action: null,
    parking_brake_state: null,
    tire_state: null,
    steering_feel: null,
    pull_direction: null,
    lights_state: null,
    accessory_affected: null,
    weather_condition: null,
    sound_or_smoke_location_zone: null,
    vehicle_powertrain: null,
    drivable_state: null,
    customer_request_type: null,
  };
  return { ...base, ...overrides };
}

function q(id: number, required_facts: string[]): QuestionForFactMatch {
  return { id, required_facts };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("matchQuestionsToFacts — bucket placement", () => {
  beforeEach(() => {
    __resetUnknownSlotWarningsForTests();
  });

  it("'Steering wheel shakes at exactly 65 mph' → speed + location questions ANSWERED", () => {
    const extracted_facts = makeFacts({
      speed_band: "specific_mph",
      speed_specific_mph: 65,
      sound_or_smoke_location_zone: "behind_dashboard",
    });

    // Q688: "at what speed?" needs speed_band OR speed_specific_mph
    // Q691: "whole car or steering wheel?" needs sound_or_smoke_location_zone
    // Q692: an unrelated question needing onset_timing
    const questions = [
      q(688, ["speed_band", "speed_specific_mph"]),
      q(691, ["sound_or_smoke_location_zone"]),
      q(692, ["onset_timing"]),
    ];

    const result = matchQuestionsToFacts({ extracted_facts, questions });
    expect(result.answered_ids).toEqual([688, 691]);
    expect(result.unanswered_ids).toEqual([692]);
    expect(result.ambiguous_ids).toEqual([]);
  });

  it("'Heater core smells musty when I run the heat' → smell + hvac_mode ANSWERED, fogging UNANSWERED", () => {
    const extracted_facts = makeFacts({
      smell_descriptor: "musty_or_mildew",
      hvac_mode: "heat",
    });

    const questions = [
      q(965, ["smell_descriptor"]), // smell descriptor
      q(967, ["hvac_mode"]), // AC, heat, or both?
      q(968, ["weather_condition"]), // windows fogging (no slot for it)
    ];

    const result = matchQuestionsToFacts({ extracted_facts, questions });
    expect(result.answered_ids).toEqual([965, 967]);
    expect(result.unanswered_ids).toEqual([968]);
    expect(result.ambiguous_ids).toEqual([]);
  });

  it("'AC smells like dirty socks when I first turn it on' → smell + onset + mode ANSWERED, others UNANSWERED", () => {
    const extracted_facts = makeFacts({
      smell_descriptor: "musty_or_mildew",
      onset_timing: "at_first_turn_on",
      hvac_mode: "ac",
    });

    const questions = [
      q(965, ["smell_descriptor"]),
      q(966, ["onset_timing"]),
      q(967, ["hvac_mode"]),
      q(968, ["weather_condition"]),
      q(969, ["airflow_state"]),
      q(970, ["fluid_under_car_location"]),
      q(971, ["recent_action"]),
    ];

    const result = matchQuestionsToFacts({ extracted_facts, questions });
    expect(result.answered_ids).toEqual([965, 966, 967]);
    expect(result.unanswered_ids).toEqual([968, 969, 970, 971]);
    expect(result.ambiguous_ids).toEqual([]);
  });

  it("'TPMS light came on and won't go off even after I checked tire pressures'", () => {
    const extracted_facts = makeFacts({
      warning_light_named: "tpms",
      warning_light_behavior: "steady_on",
      recent_action: "tire_air_added",
    });

    const questions = [
      q(725, ["tire_state"]), // tires look low? — no tire_state extracted, customer didn't say
      q(727, ["recent_action"]), // have you added air, light still on?
      q(728, ["warning_light_named", "warning_light_behavior"]), // both light slots
    ];

    const result = matchQuestionsToFacts({ extracted_facts, questions });
    expect(result.answered_ids).toEqual([727, 728]);
    expect(result.unanswered_ids).toEqual([725]);
    expect(result.ambiguous_ids).toEqual([]);
  });

  it("'Tire pressure low on rear driver side, filled last week' → location + timing + action ANSWERED", () => {
    const extracted_facts = makeFacts({
      location_side: "left",
      location_axle: "rear",
      tire_state: "low_pressure",
      started_when: "weeks_ago",
      recent_action: "tire_air_added",
    });

    const questions = [
      q(716, ["location_side", "location_axle"]), // which tire?
      q(717, ["started_when"]), // sudden or slow?
      q(718, ["recent_action"]), // how often add air?
      q(719, ["tire_state"]), // confirm low pressure state
    ];

    const result = matchQuestionsToFacts({ extracted_facts, questions });
    expect(result.answered_ids).toEqual([716, 717, 718, 719]);
    expect(result.unanswered_ids).toEqual([]);
    expect(result.ambiguous_ids).toEqual([]);
  });
});

describe("matchQuestionsToFacts — edge cases", () => {
  beforeEach(() => {
    __resetUnknownSlotWarningsForTests();
  });

  it("empty required_facts (legacy / no fact-gating) → always UNANSWERED (we must ask)", () => {
    const extracted_facts = makeFacts({
      // Fully populated facts — should still NOT auto-answer a question
      // with no fact-gating configured.
      speed_band: "highway",
      smell_descriptor: "burnt_oil",
      onset_timing: "always",
    });

    const questions = [
      q(101, []),
      q(102, []),
      q(103, ["speed_band"]), // sanity check: this one IS answered
    ];

    const result = matchQuestionsToFacts({ extracted_facts, questions });
    expect(result.unanswered_ids).toEqual([101, 102]);
    expect(result.answered_ids).toEqual([103]);
    expect(result.ambiguous_ids).toEqual([]);
  });

  it("required_facts references unknown slot → unanswered + console.warn fires once per slot", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const extracted_facts = makeFacts({ speed_band: "highway" });

      const questions = [
        q(201, ["not_a_real_slot"]),
        q(202, ["not_a_real_slot"]), // same unknown slot — warn should NOT fire again
        q(203, ["another_fake_slot"]), // different unknown slot — warn DOES fire again
        q(204, ["speed_band", "not_a_real_slot"]), // partial: real slot present, fake slot "missing"
      ];

      const result = matchQuestionsToFacts({ extracted_facts, questions });

      // 201/202/203 all go to unanswered (zero present)
      expect(result.unanswered_ids).toEqual([201, 202, 203]);
      // 204 has speed_band present + fake slot absent → ambiguous
      expect(result.ambiguous_ids).toEqual([204]);
      expect(result.answered_ids).toEqual([]);

      // Two warns total: one for "not_a_real_slot", one for "another_fake_slot"
      expect(warnSpy).toHaveBeenCalledTimes(2);
      const messages = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => m.includes("not_a_real_slot"))).toBe(true);
      expect(messages.some((m) => m.includes("another_fake_slot"))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("all required_facts present → ANSWERED", () => {
    const extracted_facts = makeFacts({
      pedal_feel: "soft_spongy",
      noise_descriptor: "squealing_high_pitched",
      location_axle: "front",
    });

    const questions = [
      q(301, ["pedal_feel", "noise_descriptor", "location_axle"]),
    ];

    const result = matchQuestionsToFacts({ extracted_facts, questions });
    expect(result.answered_ids).toEqual([301]);
    expect(result.unanswered_ids).toEqual([]);
    expect(result.ambiguous_ids).toEqual([]);
  });

  it("some required_facts present, others missing → AMBIGUOUS", () => {
    const extracted_facts = makeFacts({
      smoke_color: "white",
      // smell_descriptor null
      // sound_or_smoke_location_zone null
    });

    const questions = [
      q(401, ["smoke_color", "smell_descriptor", "sound_or_smoke_location_zone"]),
    ];

    const result = matchQuestionsToFacts({ extracted_facts, questions });
    expect(result.ambiguous_ids).toEqual([401]);
    expect(result.answered_ids).toEqual([]);
    expect(result.unanswered_ids).toEqual([]);
  });

  it("all required_facts null (description didn't address any) → UNANSWERED", () => {
    const extracted_facts = makeFacts(); // all null
    const questions = [
      q(501, ["smell_descriptor", "noise_descriptor", "smoke_color"]),
    ];

    const result = matchQuestionsToFacts({ extracted_facts, questions });
    expect(result.unanswered_ids).toEqual([501]);
    expect(result.answered_ids).toEqual([]);
    expect(result.ambiguous_ids).toEqual([]);
  });

  it("integer slot set to 0 → counts as PRESENT (0 is a valid extracted value)", () => {
    const extracted_facts = makeFacts({
      speed_band: "stopped",
      speed_specific_mph: 0,
    });

    const questions = [
      q(601, ["speed_specific_mph"]),
      q(602, ["speed_band", "speed_specific_mph"]),
    ];

    const result = matchQuestionsToFacts({ extracted_facts, questions });
    expect(result.answered_ids).toEqual([601, 602]);
  });

  it("string slot set to '' → counts as NULL (empty string is 'not stated' per schema docs)", () => {
    // Build via cast because the Zod runtime would refuse "" if there were
    // length constraints, but at the type level z.string().nullable()
    // accepts "" — the mapper must defensively treat it as null.
    const extracted_facts = makeFacts({
      warning_light_named: "",
      accessory_affected: "",
    });

    const questions = [
      q(701, ["warning_light_named"]),
      q(702, ["accessory_affected"]),
      q(703, ["warning_light_named", "accessory_affected"]),
    ];

    const result = matchQuestionsToFacts({ extracted_facts, questions });
    expect(result.unanswered_ids).toEqual([701, 702, 703]);
    expect(result.answered_ids).toEqual([]);
    expect(result.ambiguous_ids).toEqual([]);
  });

  it("non-empty string slot → PRESENT", () => {
    const extracted_facts = makeFacts({
      warning_light_named: "check engine",
      accessory_affected: "driver window",
    });

    const questions = [
      q(801, ["warning_light_named"]),
      q(802, ["accessory_affected"]),
    ];

    const result = matchQuestionsToFacts({ extracted_facts, questions });
    expect(result.answered_ids).toEqual([801, 802]);
  });

  it("output arrays are sorted ascending regardless of input question order", () => {
    const extracted_facts = makeFacts({
      smell_descriptor: "burnt_oil",
      noise_descriptor: "squealing_high_pitched",
    });

    // Intentionally scramble the input order.
    const questions = [
      q(909, ["smell_descriptor"]),
      q(101, ["smell_descriptor"]),
      q(505, ["noise_descriptor"]),
      q(202, ["onset_timing"]),
      q(808, ["onset_timing", "smell_descriptor"]), // ambiguous
      q(303, []),
    ];

    const result = matchQuestionsToFacts({ extracted_facts, questions });
    expect(result.answered_ids).toEqual([101, 505, 909]);
    expect(result.ambiguous_ids).toEqual([808]);
    expect(result.unanswered_ids).toEqual([202, 303]);
  });

  it("empty questions array → all three buckets empty", () => {
    const result = matchQuestionsToFacts({
      extracted_facts: makeFacts(),
      questions: [],
    });
    expect(result.answered_ids).toEqual([]);
    expect(result.unanswered_ids).toEqual([]);
    expect(result.ambiguous_ids).toEqual([]);
  });

  it("deterministic: same input twice produces identical output", () => {
    const extracted_facts = makeFacts({
      pedal_feel: "pulsating",
      onset_timing: "when_braking",
    });
    const questions = [
      q(1, ["pedal_feel"]),
      q(2, ["onset_timing", "pedal_feel"]),
      q(3, ["smell_descriptor"]),
    ];
    const a = matchQuestionsToFacts({ extracted_facts, questions });
    const b = matchQuestionsToFacts({ extracted_facts, questions });
    expect(a).toEqual(b);
  });
});

describe("isFactPresent — single-slot presence rule", () => {
  beforeEach(() => {
    __resetUnknownSlotWarningsForTests();
  });

  it("null → false", () => {
    expect(isFactPresent(makeFacts(), "speed_band")).toBe(false);
  });

  it("non-null enum → true", () => {
    expect(
      isFactPresent(makeFacts({ speed_band: "highway" }), "speed_band"),
    ).toBe(true);
  });

  it("integer 0 → true", () => {
    expect(
      isFactPresent(makeFacts({ speed_specific_mph: 0 }), "speed_specific_mph"),
    ).toBe(true);
  });

  it("integer 65 → true", () => {
    expect(
      isFactPresent(makeFacts({ speed_specific_mph: 65 }), "speed_specific_mph"),
    ).toBe(true);
  });

  it("string '' → false (semantic null for free-text slots)", () => {
    expect(
      isFactPresent(
        makeFacts({ warning_light_named: "" }),
        "warning_light_named",
      ),
    ).toBe(false);
  });

  it("string 'check engine' → true", () => {
    expect(
      isFactPresent(
        makeFacts({ warning_light_named: "check engine" }),
        "warning_light_named",
      ),
    ).toBe(true);
  });

  it("unknown slot → false + warns once", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(isFactPresent(makeFacts(), "totally_bogus_slot")).toBe(false);
      expect(isFactPresent(makeFacts(), "totally_bogus_slot")).toBe(false);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
