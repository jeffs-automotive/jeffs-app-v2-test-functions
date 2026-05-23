/**
 * Unit tests for diagnoseConcern — the 3-stage Anthropic LLM classifier that
 * drives the appointment-scheduler wizard's diagnostic flow.
 *
 * Coverage targets per PLAN-01 Phase 4A:
 *   - 3-stage happy path (testing service + 'other' subcategory shapes)
 *   - Short-circuit: empty description, empty catalog
 *   - Stage 1: null match, hallucinated key, total failure, transient retry
 *   - Stage 2: null subcategory (Stage 3 still runs), hallucinated slug, total failure
 *   - Stage 3: total failure → safe over-ask
 *   - Confidence + token accumulation across stages
 *   - Chip hint propagation into Stage 1 prompt
 *   - Sentry breadcrumb emission on happy path
 *
 * Mocking strategy:
 *   - `vi.mock("@anthropic-ai/sdk", ...)` HOISTS above all imports; the factory
 *     returns a default export that closes over `sharedMockAnthropic` from
 *     `tests/fixtures/mock-anthropic.ts`. Every `new Anthropic({...})` then
 *     yields the same fake `messages.create` mock so tests can queue per-stage
 *     responses + errors.
 *   - `vi.mock("@sentry/nextjs", ...)` swaps out `addBreadcrumb` /
 *     `captureException` with spies so tests can assert the breadcrumb chain.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  sharedMockAnthropic,
  MockAnthropicConstructor,
} from "../../../../../tests/fixtures/mock-anthropic";

// vi.mock() calls are HOISTED to the top of the file by Vitest, BEFORE any
// imports. Anything referenced inside must itself be hoist-safe — we import
// the singleton + constructor above; Vitest hoists those import statements
// too, so the factory below sees them already initialized. The default
// export must be a constructor because the module-under-test does
// `new Anthropic(...)`.
vi.mock("@anthropic-ai/sdk", () => ({
  default: MockAnthropicConstructor,
}));

const sentryAddBreadcrumb = vi.fn();
const sentryCaptureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: (...args: unknown[]) => sentryAddBreadcrumb(...args),
  captureException: (...args: unknown[]) => sentryCaptureException(...args),
}));

import {
  diagnoseConcern,
  buildStage1SystemPrompt,
  type DiagnoseConcernArgs,
  type DiagnoseConcernChipHint,
} from "./diagnose-concern";
import type {
  CatalogCategory,
  CatalogQuestion,
  CatalogSubcategory,
  DiagnosticCatalog,
  OtherSubcategoryCategory,
  TestingServiceCategory,
} from "./load-diagnostic-catalog";
import type { ExtractedFacts } from "./extracted-facts";

// ---------------------------------------------------------------------------
// Catalog fixture builders
// ---------------------------------------------------------------------------

function makeQuestion(
  id: number,
  required_facts: string[],
  display_order = id,
): CatalogQuestion {
  return {
    id,
    question_text: `Test question ${id}`,
    options: [
      { label: "Yes", value: "yes" },
      { label: "No", value: "no" },
    ],
    display_order,
    multi_select: false,
    required_facts,
  };
}

function makeSubcategory(
  slug: string,
  questions: CatalogQuestion[],
  overrides: Partial<CatalogSubcategory> = {},
): CatalogSubcategory {
  return {
    slug,
    display_label: `Subcategory ${slug}`,
    concern_category: "brakes",
    eligible_testing_service_keys: [],
    description: `Description for ${slug}`,
    positive_examples: [`positive example for ${slug}`],
    negative_examples: [`negative example for ${slug}`],
    synonyms: [`synonym_${slug}`],
    questions,
    ...overrides,
  };
}

function makeTestingService(
  service_key: string,
  subcategories: CatalogSubcategory[],
  overrides: Partial<TestingServiceCategory> = {},
): TestingServiceCategory {
  return {
    kind: "testing_service",
    service_key,
    display_name: `Service ${service_key}`,
    description: `Description for ${service_key}`,
    starting_price_cents: 4995,
    concern_categories: ["brakes"],
    subcategories,
    ...overrides,
  };
}

function makeOtherSubcategory(
  subcategory_slug: string,
  questions: CatalogQuestion[],
  overrides: Partial<OtherSubcategoryCategory> = {},
): OtherSubcategoryCategory {
  return {
    kind: "other_subcategory",
    subcategory_slug,
    display_label: `Other ${subcategory_slug}`,
    questions,
    ...overrides,
  };
}

/**
 * Build a minimal but realistic catalog:
 *   - 1 testing_service ("brake_inspection") with 2 subcategories,
 *     each carrying 2-3 questions
 *   - 1 'other' subcategory ("recent_accident") with 2 questions
 */
function makeCatalog(): DiagnosticCatalog {
  const subA = makeSubcategory("metallic_grinding", [
    makeQuestion(101, ["noise_descriptor"]),
    makeQuestion(102, ["location_axle", "location_side"]),
    makeQuestion(103, ["onset_timing"]),
  ]);
  const subB = makeSubcategory("brake_squeal", [
    makeQuestion(201, ["noise_descriptor"]),
    makeQuestion(202, ["onset_timing"]),
  ]);
  const testingService = makeTestingService("brake_inspection", [subA, subB]);

  const otherCat = makeOtherSubcategory("recent_accident", [
    makeQuestion(301, ["recent_action"]),
    makeQuestion(302, ["drivable_state"]),
  ]);

  return {
    categories: [testingService as CatalogCategory, otherCat as CatalogCategory],
  };
}

// ---------------------------------------------------------------------------
// ExtractedFacts builder (all-null defaults)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Canned response builders matching each stage's JSON Schema
// ---------------------------------------------------------------------------

function stage1Response(
  matched_category_key: string | null,
  confidence: "high" | "medium" | "low" = "high",
) {
  return {
    matched_category_key,
    confidence,
    reasoning: "stage 1 mock reasoning",
  };
}

function stage2Response(
  matched_subcategory_slug: string | null,
  confidence: "high" | "medium" | "low" = "high",
) {
  return {
    matched_subcategory_slug,
    confidence,
    reasoning: "stage 2 mock reasoning",
  };
}

function stage3Response(
  facts: Partial<ExtractedFacts> = {},
  confidence: "high" | "medium" | "low" = "high",
) {
  return {
    extracted_facts: makeFacts(facts),
    confidence,
    reasoning: "stage 3 mock reasoning",
  };
}

// ---------------------------------------------------------------------------
// Argument builder
// ---------------------------------------------------------------------------

function makeArgs(overrides: Partial<DiagnoseConcernArgs> = {}): DiagnoseConcernArgs {
  return {
    catalog: makeCatalog(),
    customer_description:
      "Loud grinding noise from the front right when I brake.",
    customer_chip_hint: null,
    vehicle_notes: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("diagnoseConcern — three-stage happy path", () => {
  beforeEach(() => {
    sharedMockAnthropic.reset();
    sentryAddBreadcrumb.mockClear();
    sentryCaptureException.mockClear();
  });

  it("3 stages return validated structured outputs → populated result with parsed_ok=true", async () => {
    sharedMockAnthropic.addStageResponse(
      stage1Response("brake_inspection", "high"),
    );
    sharedMockAnthropic.addStageResponse(
      stage2Response("metallic_grinding", "high"),
    );
    sharedMockAnthropic.addStageResponse(
      stage3Response(
        {
          noise_descriptor: "grinding_metallic",
          location_axle: "front",
          location_side: "right",
          onset_timing: "when_braking",
        },
        "high",
      ),
    );

    const result = await diagnoseConcern(makeArgs());

    expect(result).toEqual(
      expect.objectContaining({
        matched_category_key: "brake_inspection",
        matched_kind: "testing_service",
        matched_subcategory_slug: "metallic_grinding",
        stage1_confidence: "high",
        stage2_confidence: "high",
        stage3_confidence: "high",
        parsed_ok: true,
        error_message: "",
      }),
    );
    expect(result.recommended_testing_service).toEqual({
      service_key: "brake_inspection",
      display_name: "Service brake_inspection",
      description: "Description for brake_inspection",
      starting_price_cents: 4995,
    });
    expect(result.extracted_facts).not.toBeNull();
    expect(result.extracted_facts?.noise_descriptor).toBe("grinding_metallic");
    expect(result.extracted_facts?.location_axle).toBe("front");
    // All 3 required_facts for 101/102/103 are populated → answered → unanswered
    // should be empty.
    expect(result.unanswered_question_ids).toEqual([]);
    expect(sharedMockAnthropic.create).toHaveBeenCalledTimes(3);
  });

  it("matches an 'other' subcategory and skips testing-service payload", async () => {
    sharedMockAnthropic.addStageResponse(
      stage1Response("recent_accident", "high"),
    );
    sharedMockAnthropic.addStageResponse(
      stage2Response("recent_accident", "high"),
    );
    sharedMockAnthropic.addStageResponse(
      stage3Response({ recent_action: "accident_or_impact" }, "high"),
    );

    const result = await diagnoseConcern(makeArgs());

    expect(result.matched_category_key).toBe("recent_accident");
    expect(result.matched_kind).toBe("other_subcategory");
    expect(result.recommended_testing_service).toBeNull();
    expect(result.matched_subcategory_slug).toBe("recent_accident");
    expect(result.parsed_ok).toBe(true);
  });

  it("tokens_in + tokens_out accumulate across all three stages", async () => {
    sharedMockAnthropic.addStageResponse(stage1Response("brake_inspection"), {
      tokens_in: 800,
      tokens_out: 40,
    });
    sharedMockAnthropic.addStageResponse(
      stage2Response("metallic_grinding"),
      { tokens_in: 600, tokens_out: 30 },
    );
    sharedMockAnthropic.addStageResponse(stage3Response(), {
      tokens_in: 1200,
      tokens_out: 90,
    });

    const result = await diagnoseConcern(makeArgs());

    expect(result.tokens_in).toBe(800 + 600 + 1200);
    expect(result.tokens_out).toBe(40 + 30 + 90);
  });

  it("fires Sentry breadcrumbs at each stage + final completion on happy path", async () => {
    sharedMockAnthropic.addStageResponse(stage1Response("brake_inspection"));
    sharedMockAnthropic.addStageResponse(stage2Response("metallic_grinding"));
    sharedMockAnthropic.addStageResponse(stage3Response());

    await diagnoseConcern(makeArgs());

    const categories = sentryAddBreadcrumb.mock.calls.map(
      (c) => (c[0] as { category: string }).category,
    );
    expect(categories).toContain("scheduler.diagnose.stage1");
    expect(categories).toContain("scheduler.diagnose.stage2");
    expect(categories).toContain("scheduler.diagnose.stage3");
    expect(categories).toContain("scheduler.diagnose.complete");
  });
});

describe("diagnoseConcern — Stage 1 outcomes", () => {
  beforeEach(() => {
    sharedMockAnthropic.reset();
    sentryAddBreadcrumb.mockClear();
    sentryCaptureException.mockClear();
  });

  it("returns null match (LLM self-reported can't categorize) → no Stage 2/3 dispatch", async () => {
    sharedMockAnthropic.addStageResponse(stage1Response(null, "low"));

    const result = await diagnoseConcern(makeArgs());

    expect(result.matched_category_key).toBeNull();
    expect(result.matched_kind).toBeNull();
    expect(result.stage1_confidence).toBe("low");
    expect(result.parsed_ok).toBe(true);
    expect(result.error_message).toBe("");
    expect(sharedMockAnthropic.create).toHaveBeenCalledTimes(1);
  });

  it("returns a hallucinated category key (not in catalog) → null match + invalid_category_key error", async () => {
    sharedMockAnthropic.addStageResponse(
      stage1Response("ghost_service_not_in_catalog", "medium"),
    );

    const result = await diagnoseConcern(makeArgs());

    expect(result.matched_category_key).toBeNull();
    expect(result.matched_kind).toBeNull();
    expect(result.stage1_confidence).toBe("medium");
    expect(result.parsed_ok).toBe(true);
    expect(result.error_message).toMatch(
      /^invalid_category_key:ghost_service_not_in_catalog/,
    );
    expect(sharedMockAnthropic.create).toHaveBeenCalledTimes(1);
  });

  it("fails BOTH attempts → failSafe returns parsed_ok=false + stage1_failed message", async () => {
    sharedMockAnthropic.addStageError("transient_gateway_5xx");
    sharedMockAnthropic.addStageError("transient_gateway_5xx");

    const result = await diagnoseConcern(makeArgs());

    expect(result.matched_category_key).toBeNull();
    expect(result.parsed_ok).toBe(false);
    expect(result.error_message).toMatch(/^stage1_failed: /);
    expect(result.stage1_confidence).toBe("low");
    expect(result.stage2_confidence).toBe("low");
    expect(result.stage3_confidence).toBe("low");
    // Stage 1 attempted twice, no Stage 2 or 3.
    expect(sharedMockAnthropic.create).toHaveBeenCalledTimes(2);
  });

  it("succeeds on the second attempt after a transient first-attempt throw", async () => {
    sharedMockAnthropic.addStageError("transient_gateway_5xx");
    sharedMockAnthropic.addStageResponse(stage1Response("brake_inspection"));
    sharedMockAnthropic.addStageResponse(stage2Response("metallic_grinding"));
    sharedMockAnthropic.addStageResponse(stage3Response());

    const result = await diagnoseConcern(makeArgs());

    expect(result.matched_category_key).toBe("brake_inspection");
    expect(result.parsed_ok).toBe(true);
    // 1 retry + 3 happy stages = 4 calls.
    expect(sharedMockAnthropic.create).toHaveBeenCalledTimes(4);
    // Captured the transient via Sentry on attempt 0.
    expect(sentryCaptureException).toHaveBeenCalledTimes(1);
  });
});

describe("diagnoseConcern — Stage 2 outcomes", () => {
  beforeEach(() => {
    sharedMockAnthropic.reset();
    sentryAddBreadcrumb.mockClear();
    sentryCaptureException.mockClear();
  });

  it("Stage 2 fails BOTH attempts after Stage 1 picked a testing service → testing-service recommendation but no subcategory", async () => {
    sharedMockAnthropic.addStageResponse(stage1Response("brake_inspection"));
    sharedMockAnthropic.addStageError("stage2_5xx");
    sharedMockAnthropic.addStageError("stage2_5xx");

    const result = await diagnoseConcern(makeArgs());

    expect(result.matched_category_key).toBe("brake_inspection");
    expect(result.matched_kind).toBe("testing_service");
    expect(result.matched_subcategory_slug).toBeNull();
    expect(result.recommended_testing_service).toEqual(
      expect.objectContaining({ service_key: "brake_inspection" }),
    );
    expect(result.unanswered_question_ids).toEqual([]);
    expect(result.stage2_confidence).toBe("low");
    expect(result.stage3_confidence).toBe("low");
    expect(result.parsed_ok).toBe(true);
    expect(result.error_message).toMatch(/^stage2_failed: /);
  });

  it("Stage 2 returns null subcategory but Stage 3 still runs (extract facts; over-ask)", async () => {
    sharedMockAnthropic.addStageResponse(stage1Response("brake_inspection"));
    sharedMockAnthropic.addStageResponse(stage2Response(null, "low"));
    sharedMockAnthropic.addStageResponse(
      stage3Response({ noise_descriptor: "grinding_metallic" }, "medium"),
    );

    const result = await diagnoseConcern(makeArgs());

    expect(result.matched_category_key).toBe("brake_inspection");
    expect(result.matched_subcategory_slug).toBeNull();
    expect(result.stage2_confidence).toBe("low");
    expect(result.stage3_confidence).toBe("medium");
    expect(result.extracted_facts).not.toBeNull();
    // Without a matched subcategory, the mapper falls back to
    // collectAllCategoryQuestionIds → every question id from both
    // subcategories de-duped + sorted.
    expect(result.unanswered_question_ids).toEqual([101, 102, 103, 201, 202]);
    expect(sharedMockAnthropic.create).toHaveBeenCalledTimes(3);
  });

  it("Stage 2 hallucinates a subcategory slug not in the catalog → null subcategory, Stage 3 still runs", async () => {
    sharedMockAnthropic.addStageResponse(stage1Response("brake_inspection"));
    sharedMockAnthropic.addStageResponse(
      stage2Response("not_a_real_slug", "high"),
    );
    sharedMockAnthropic.addStageResponse(stage3Response());

    const result = await diagnoseConcern(makeArgs());

    expect(result.matched_category_key).toBe("brake_inspection");
    expect(result.matched_subcategory_slug).toBeNull();
    expect(result.parsed_ok).toBe(true);
    // Stage 3 ran → extracted_facts non-null AND collectAllCategoryQuestionIds
    // fallback engaged for unanswered.
    expect(result.extracted_facts).not.toBeNull();
    expect(result.unanswered_question_ids).toEqual([101, 102, 103, 201, 202]);
  });
});

describe("diagnoseConcern — Stage 3 outcomes", () => {
  beforeEach(() => {
    sharedMockAnthropic.reset();
    sentryAddBreadcrumb.mockClear();
    sentryCaptureException.mockClear();
  });

  it("Stage 3 fails BOTH attempts → safe over-ask + extracted_facts=null", async () => {
    sharedMockAnthropic.addStageResponse(stage1Response("brake_inspection"));
    sharedMockAnthropic.addStageResponse(stage2Response("metallic_grinding"));
    sharedMockAnthropic.addStageError("stage3_5xx");
    sharedMockAnthropic.addStageError("stage3_5xx");

    const result = await diagnoseConcern(makeArgs());

    expect(result.matched_category_key).toBe("brake_inspection");
    expect(result.matched_subcategory_slug).toBe("metallic_grinding");
    expect(result.recommended_testing_service).toEqual(
      expect.objectContaining({ service_key: "brake_inspection" }),
    );
    expect(result.extracted_facts).toBeNull();
    expect(result.stage3_confidence).toBe("low");
    expect(result.parsed_ok).toBe(true);
    expect(result.error_message).toMatch(/^stage3_failed: /);
    // Safe over-ask: every question in the matched subcategory.
    expect(result.unanswered_question_ids).toEqual([101, 102, 103]);
  });
});

describe("diagnoseConcern — short-circuit + edge cases", () => {
  beforeEach(() => {
    sharedMockAnthropic.reset();
    sentryAddBreadcrumb.mockClear();
    sentryCaptureException.mockClear();
  });

  it("empty description (<3 chars) short-circuits without ANY LLM call", async () => {
    const result = await diagnoseConcern(makeArgs({ customer_description: "  hi" }));

    // Re-check: 'hi' trims to 2 chars → short-circuit.
    expect(sharedMockAnthropic.create).toHaveBeenCalledTimes(0);
    expect(result.parsed_ok).toBe(true);
    expect(result.matched_category_key).toBeNull();
    expect(result.latency_ms).toBe(0);
    expect(result.tokens_in).toBe(0);
    expect(result.tokens_out).toBe(0);
    expect(result.error_message).toBe("");
    expect(result.model).toBe("anthropic/claude-haiku-4-5");
  });

  it("empty catalog → failSafe with error_message='empty_catalog'", async () => {
    const result = await diagnoseConcern(
      makeArgs({ catalog: { categories: [] } }),
    );

    expect(sharedMockAnthropic.create).toHaveBeenCalledTimes(0);
    expect(result.parsed_ok).toBe(false);
    expect(result.error_message).toBe("empty_catalog");
  });

  it("preserves Stage 1 + Stage 2 self-reported confidence end-to-end", async () => {
    sharedMockAnthropic.addStageResponse(
      stage1Response("brake_inspection", "medium"),
    );
    sharedMockAnthropic.addStageResponse(
      stage2Response("metallic_grinding", "medium"),
    );
    sharedMockAnthropic.addStageResponse(stage3Response({}, "low"));

    const result = await diagnoseConcern(makeArgs());

    expect(result.stage1_confidence).toBe("medium");
    expect(result.stage2_confidence).toBe("medium");
    expect(result.stage3_confidence).toBe("low");
  });
});

describe("buildStage1SystemPrompt — chip hint propagation", () => {
  it("includes a non-other chip's display name + concern categories", () => {
    const chip: DiagnoseConcernChipHint = {
      chip_service_key: "brake_check",
      chip_display_name: "Brakes feel off",
      chip_concern_categories: ["brakes", "noise"],
    };

    const prompt = buildStage1SystemPrompt(
      makeArgs({ customer_chip_hint: chip }),
    );

    expect(prompt).toContain('"Brakes feel off" chip');
    expect(prompt).toContain("brakes, noise");
  });

  it("renders the dedicated 'Other Issue' pseudo-chip phrasing", () => {
    const chip: DiagnoseConcernChipHint = {
      chip_service_key: "other_issue",
      chip_display_name: "Other Issue",
      chip_concern_categories: [],
    };

    const prompt = buildStage1SystemPrompt(
      makeArgs({ customer_chip_hint: chip }),
    );

    expect(prompt).toContain("Other Issue");
    expect(prompt).toContain("no pre-");
  });

  it("renders the no-chip case explicitly", () => {
    const prompt = buildStage1SystemPrompt(
      makeArgs({ customer_chip_hint: null }),
    );
    expect(prompt).toContain("No chip hint");
  });
});
