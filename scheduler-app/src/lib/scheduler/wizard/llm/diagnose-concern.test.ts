/**
 * Unit tests for diagnoseConcern — the 3-stage LLM classifier that drives
 * the appointment-scheduler wizard's diagnostic flow.
 *
 * Coverage targets per PLAN-01 Phase 4A + act-or-ask AO2 (2026-07-03):
 *   - 3-stage happy path (testing service + 'other' subcategory shapes)
 *   - Short-circuit: empty description, empty catalog
 *   - Stage 1 (candidates contract): null/empty list, hallucinated keys
 *     dropped, de-dupe + truncation to 3, total failure, transient retry
 *   - Orchestration branching: 0 candidates → null match; 1 → direct
 *     S2→S3; 2-3 → parallel per-candidate S2+S3 (clarify path) with
 *     per-candidate degradation
 *   - Transport dispatch: anthropic/* → Anthropic SDK; other prefixes →
 *     @ai-sdk/gateway generateObject; gateway failure → anthropic
 *     DEFAULT_MODEL fallback
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
 *   - `vi.mock("ai")` + `vi.mock("@ai-sdk/gateway")` swap the gateway
 *     transport for spies. Most tests pin every stage to the Anthropic
 *     transport via the DIAGNOSE_CONCERN_MODEL env stub (see the global
 *     beforeEach); the dispatch suite overrides per-stage models to
 *     exercise the gateway path.
 *   - `vi.mock("@sentry/nextjs", ...)` swaps out `addBreadcrumb` /
 *     `captureException` with spies so tests can assert the breadcrumb chain.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

// Gateway transport spies (act-or-ask AO2b). The factories dereference the
// spies lazily (call-time arrows) so vi.mock hoisting can't hit a TDZ on
// the consts below.
const generateObjectMock = vi.fn();
const gatewayModelMock = vi.fn((modelId: string) => ({ modelId }));
vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
  jsonSchema: (schema: unknown) => schema,
}));
vi.mock("@ai-sdk/gateway", () => ({
  createGateway: () => (modelId: string) => gatewayModelMock(modelId),
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

/** Act-or-ask Stage-1 shape: 0-3 ranked candidate keys. Accepts a single
 *  key (wrapped), an array, or null (→ empty list) for call-site brevity. */
function stage1Response(candidates: string[] | string | null) {
  return {
    candidates:
      candidates === null
        ? []
        : Array.isArray(candidates)
          ? candidates
          : [candidates],
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
// Global transport pinning
// ---------------------------------------------------------------------------
//
// Act-or-ask AO2b: Stage 1 + 2 now DEFAULT to a gateway-transported model
// (google/gemini-3.1-flash-lite). These unit tests drive the Anthropic
// mock queue, so pin every stage to the Anthropic transport via the
// combined env override. The transport-dispatch suite below stubs
// per-stage overrides on top (they take precedence over the combined var).
beforeEach(() => {
  vi.stubEnv("DIAGNOSE_CONCERN_MODEL", "anthropic/claude-haiku-4-5");
  generateObjectMock.mockReset();
  gatewayModelMock.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

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
      stage1Response("brake_inspection"),
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
        stage1_candidates: ["brake_inspection"],
        requires_clarification: false,
        candidate_results: null,
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
      stage1Response("recent_accident"),
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

  it("returns an EMPTY candidate list (LLM self-reported nothing fits) → no Stage 2/3 dispatch", async () => {
    sharedMockAnthropic.addStageResponse(stage1Response(null));

    const result = await diagnoseConcern(makeArgs());

    expect(result.matched_category_key).toBeNull();
    expect(result.matched_kind).toBeNull();
    expect(result.stage1_candidates).toEqual([]);
    expect(result.requires_clarification).toBe(false);
    expect(result.candidate_results).toBeNull();
    expect(result.parsed_ok).toBe(true);
    expect(result.error_message).toBe("");
    expect(sharedMockAnthropic.create).toHaveBeenCalledTimes(1);
  });

  it("returns ONLY hallucinated keys (not in catalog) → null match + invalid_category_key error", async () => {
    sharedMockAnthropic.addStageResponse(
      stage1Response("ghost_service_not_in_catalog"),
    );

    const result = await diagnoseConcern(makeArgs());

    expect(result.matched_category_key).toBeNull();
    expect(result.matched_kind).toBeNull();
    expect(result.stage1_candidates).toEqual([]);
    expect(result.parsed_ok).toBe(true);
    expect(result.error_message).toMatch(
      /^invalid_category_key:ghost_service_not_in_catalog/,
    );
    expect(sharedMockAnthropic.create).toHaveBeenCalledTimes(1);
  });

  it("drops invalid keys but keeps valid ones → single survivor takes the direct path", async () => {
    sharedMockAnthropic.addStageResponse(
      stage1Response(["ghost_service_not_in_catalog", "brake_inspection"]),
    );
    sharedMockAnthropic.addStageResponse(stage2Response("metallic_grinding"));
    sharedMockAnthropic.addStageResponse(stage3Response());

    const result = await diagnoseConcern(makeArgs());

    expect(result.matched_category_key).toBe("brake_inspection");
    expect(result.stage1_candidates).toEqual(["brake_inspection"]);
    expect(result.requires_clarification).toBe(false);
    expect(result.candidate_results).toBeNull();
    expect(result.parsed_ok).toBe(true);
    // Direct path: S1 + S2 + S3.
    expect(sharedMockAnthropic.create).toHaveBeenCalledTimes(3);
  });

  it("de-dupes repeated candidate keys before branching", async () => {
    sharedMockAnthropic.addStageResponse(
      stage1Response(["brake_inspection", "brake_inspection"]),
    );
    sharedMockAnthropic.addStageResponse(stage2Response("metallic_grinding"));
    sharedMockAnthropic.addStageResponse(stage3Response());

    const result = await diagnoseConcern(makeArgs());

    // One unique candidate → direct path, NOT clarify.
    expect(result.stage1_candidates).toEqual(["brake_inspection"]);
    expect(result.requires_clarification).toBe(false);
    expect(sharedMockAnthropic.create).toHaveBeenCalledTimes(3);
  });

  it("fails BOTH attempts → failSafe returns parsed_ok=false + stage1_failed message", async () => {
    sharedMockAnthropic.addStageError("transient_gateway_5xx");
    sharedMockAnthropic.addStageError("transient_gateway_5xx");

    const result = await diagnoseConcern(makeArgs());

    expect(result.matched_category_key).toBeNull();
    expect(result.parsed_ok).toBe(false);
    expect(result.error_message).toMatch(/^stage1_failed: /);
    expect(result.stage1_candidates).toEqual([]);
    expect(result.requires_clarification).toBe(false);
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

  it("preserves Stage 2 + Stage 3 self-reported confidence end-to-end", async () => {
    sharedMockAnthropic.addStageResponse(stage1Response("brake_inspection"));
    sharedMockAnthropic.addStageResponse(
      stage2Response("metallic_grinding", "medium"),
    );
    sharedMockAnthropic.addStageResponse(stage3Response({}, "low"));

    const result = await diagnoseConcern(makeArgs());

    expect(result.stage2_confidence).toBe("medium");
    expect(result.stage3_confidence).toBe("low");
  });
});

// ---------------------------------------------------------------------------
// Act-or-ask clarify path (2-3 candidates) — content-routed mock
// ---------------------------------------------------------------------------

/**
 * Catalog wide enough for 3+ valid candidates: three testing services
 * (distinct subcategory slugs + question ids) + the 'other'
 * recent_accident category.
 */
function makeWideCatalog(): DiagnosticCatalog {
  const brake = makeTestingService("brake_inspection", [
    makeSubcategory("metallic_grinding", [
      makeQuestion(101, ["noise_descriptor"]),
      makeQuestion(102, ["location_axle", "location_side"]),
    ]),
  ]);
  const suspension = makeTestingService("suspension_check", [
    makeSubcategory("clunk_over_bumps", [makeQuestion(401, ["onset_timing"])]),
  ]);
  const tires = makeTestingService("tire_inspection", [
    makeSubcategory("vibration_at_speed", [makeQuestion(501, ["speed_band"])]),
  ]);
  const otherCat = makeOtherSubcategory("recent_accident", [
    makeQuestion(301, ["recent_action"]),
  ]);
  return {
    categories: [
      brake,
      suspension,
      tires,
      otherCat,
    ] as CatalogCategory[],
  };
}

/** Minimal Anthropic Message envelope for mockImplementation-based routing. */
function msgOf(json: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(json) }],
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
    stop_reason: "end_turn" as const,
    id: "msg_routed",
    model: "anthropic/claude-haiku-4-5",
    role: "assistant" as const,
    type: "message" as const,
    stop_sequence: null,
    container: null,
    stop_details: null,
  };
}

/**
 * Content-routing mock: inspects the system prompt to decide which stage
 * (and, for Stage 2, which candidate category) is being answered. Makes
 * the parallel per-candidate Promise.all ORDER-INSENSITIVE — no reliance
 * on FIFO interleaving across concurrently running chains. A handler may
 * return an Error to make that call throw (attempt failure).
 */
function routeAnthropicMock(handlers: {
  stage1: () => unknown;
  stage2: (systemText: string) => unknown;
  stage3: (systemText: string) => unknown;
}) {
  sharedMockAnthropic.create.mockImplementation(async (req: unknown) => {
    const sys = (req as { system: Array<{ text: string }> }).system
      .map((b) => b.text)
      .join("\n\n");
    const out = sys.includes("Stage 1: candidate categories")
      ? handlers.stage1()
      : sys.includes("Stage 2: subcategory pick")
        ? handlers.stage2(sys)
        : handlers.stage3(sys);
    if (out instanceof Error) throw out;
    return msgOf(out);
  });
}

describe("diagnoseConcern — act-or-ask clarify path (2-3 candidates)", () => {
  beforeEach(() => {
    sharedMockAnthropic.reset();
    sentryAddBreadcrumb.mockClear();
    sentryCaptureException.mockClear();
  });

  afterEach(() => {
    // routeAnthropicMock overrides the fixture's FIFO-queue implementation;
    // mockReset restores the original implementation passed to vi.fn so
    // queue-driven suites keep working after this one.
    sharedMockAnthropic.create.mockReset();
  });

  it("3 candidates → requires_clarification + per-candidate FULL S2+S3 chains; truncates past 3", async () => {
    routeAnthropicMock({
      stage1: () =>
        stage1Response([
          "brake_inspection",
          "suspension_check",
          "tire_inspection",
          "recent_accident", // 4th VALID key — must be truncated away
        ]),
      stage2: (sys) =>
        sys.includes('service_key="brake_inspection"')
          ? stage2Response("metallic_grinding")
          : sys.includes('service_key="suspension_check"')
            ? stage2Response("clunk_over_bumps")
            : stage2Response("vibration_at_speed"),
      stage3: () => stage3Response(),
    });

    const result = await diagnoseConcern(
      makeArgs({ catalog: makeWideCatalog() }),
    );

    expect(result.requires_clarification).toBe(true);
    expect(result.matched_category_key).toBeNull();
    expect(result.matched_kind).toBeNull();
    expect(result.recommended_testing_service).toBeNull();
    expect(result.unanswered_question_ids).toEqual([]);
    expect(result.parsed_ok).toBe(true);
    expect(result.error_message).toBe("");
    // Truncated to 3, ranked order preserved.
    expect(result.stage1_candidates).toEqual([
      "brake_inspection",
      "suspension_check",
      "tire_inspection",
    ]);
    const crs = result.candidate_results!;
    expect(crs).toHaveLength(3);
    expect(crs.map((c) => c.category_key)).toEqual(result.stage1_candidates);
    // Each candidate carries its own full chain.
    const brake = crs[0]!;
    expect(brake.matched_kind).toBe("testing_service");
    expect(brake.matched_subcategory_slug).toBe("metallic_grinding");
    expect(brake.recommended_testing_service).toEqual(
      expect.objectContaining({ service_key: "brake_inspection" }),
    );
    // stage3Response() sets no facts → both questions unanswered.
    expect(brake.unanswered_question_ids).toEqual([101, 102]);
    expect(crs[1]!.matched_subcategory_slug).toBe("clunk_over_bumps");
    expect(crs[1]!.unanswered_question_ids).toEqual([401]);
    expect(crs[2]!.matched_subcategory_slug).toBe("vibration_at_speed");
    // S1 + 3 × (S2 + S3) = 7 calls.
    expect(sharedMockAnthropic.create).toHaveBeenCalledTimes(7);
  });

  it("mixed kinds: an 'other' candidate precomputes with null recommended service + its own questions", async () => {
    routeAnthropicMock({
      stage1: () => stage1Response(["brake_inspection", "recent_accident"]),
      stage2: (sys) =>
        sys.includes('service_key="brake_inspection"')
          ? stage2Response("metallic_grinding")
          : stage2Response("recent_accident"),
      stage3: () => stage3Response(),
    });

    const result = await diagnoseConcern(
      makeArgs({ catalog: makeWideCatalog() }),
    );

    expect(result.requires_clarification).toBe(true);
    const other = result.candidate_results![1]!;
    expect(other.category_key).toBe("recent_accident");
    expect(other.matched_kind).toBe("other_subcategory");
    expect(other.recommended_testing_service).toBeNull();
    expect(other.matched_subcategory_slug).toBe("recent_accident");
    expect(other.unanswered_question_ids).toEqual([301]);
  });

  it("per-candidate degradation: one candidate's Stage 2 fails both attempts → that candidate degrades, the other completes", async () => {
    routeAnthropicMock({
      stage1: () => stage1Response(["brake_inspection", "suspension_check"]),
      stage2: (sys) =>
        sys.includes('service_key="suspension_check"')
          ? new Error("stage2_boom")
          : stage2Response("metallic_grinding"),
      stage3: () => stage3Response(),
    });

    const result = await diagnoseConcern(
      makeArgs({ catalog: makeWideCatalog() }),
    );

    // The clarify result itself is intact — degradation is per-candidate.
    expect(result.requires_clarification).toBe(true);
    expect(result.parsed_ok).toBe(true);
    const [brake, susp] = result.candidate_results!;
    expect(brake!.matched_subcategory_slug).toBe("metallic_grinding");
    expect(brake!.stage2_confidence).toBe("high");
    // Degraded candidate: recommend-without-questions shape (stage2
    // fallback semantics) — no subcategory, no questions, low confidence.
    expect(susp!.matched_subcategory_slug).toBeNull();
    expect(susp!.stage2_confidence).toBe("low");
    expect(susp!.stage3_confidence).toBe("low");
    expect(susp!.unanswered_question_ids).toEqual([]);
    expect(susp!.extracted_facts).toBeNull();
    expect(susp!.recommended_testing_service).toEqual(
      expect.objectContaining({ service_key: "suspension_check" }),
    );
    // S1 (1) + brake S2+S3 (2) + susp S2 two failed attempts (2) = 5.
    expect(sharedMockAnthropic.create).toHaveBeenCalledTimes(5);
  });
});

// ---------------------------------------------------------------------------
// Transport dispatch (act-or-ask AO2b)
// ---------------------------------------------------------------------------

describe("callModelStage transport dispatch (act-or-ask AO2b)", () => {
  beforeEach(() => {
    sharedMockAnthropic.reset();
    sentryAddBreadcrumb.mockClear();
    sentryCaptureException.mockClear();
  });

  it("non-anthropic/ Stage-1 model routes through @ai-sdk/gateway generateObject; anthropic stages stay on the SDK", async () => {
    vi.stubEnv("DIAGNOSE_CONCERN_STAGE1_MODEL", "google/gemini-3.1-flash-lite");
    generateObjectMock.mockResolvedValueOnce({
      object: stage1Response("brake_inspection"),
      usage: { inputTokens: 7, outputTokens: 3 },
    });
    sharedMockAnthropic.addStageResponse(stage2Response("metallic_grinding"));
    sharedMockAnthropic.addStageResponse(stage3Response());

    const result = await diagnoseConcern(makeArgs());

    expect(result.matched_category_key).toBe("brake_inspection");
    expect(result.model).toBe("google/gemini-3.1-flash-lite");
    // Gateway path used exactly once (Stage 1).
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    expect(gatewayModelMock).toHaveBeenCalledWith(
      "google/gemini-3.1-flash-lite",
    );
    const call = generateObjectMock.mock.calls[0]![0] as {
      temperature: number;
      system: string;
      prompt: string;
    };
    expect(call.temperature).toBe(0);
    // Flattened content-block system prompt (single string, both blocks).
    expect(typeof call.system).toBe("string");
    expect(call.system).toContain("Stage 1: candidate categories");
    expect(call.system).toContain("No chip hint");
    expect(call.prompt).toContain("grinding noise");
    // Anthropic SDK used for Stages 2 + 3 only.
    expect(sharedMockAnthropic.create).toHaveBeenCalledTimes(2);
    // Gateway usage tokens flow into the totals (7/3 + two anthropic
    // stages at the fixture default 100/50 each).
    expect(result.tokens_in).toBe(7 + 100 + 100);
    expect(result.tokens_out).toBe(3 + 50 + 50);
  });

  it("anthropic/-prefixed models NEVER touch the gateway path", async () => {
    sharedMockAnthropic.addStageResponse(stage1Response("brake_inspection"));
    sharedMockAnthropic.addStageResponse(stage2Response("metallic_grinding"));
    sharedMockAnthropic.addStageResponse(stage3Response());

    await diagnoseConcern(makeArgs());

    expect(generateObjectMock).not.toHaveBeenCalled();
    expect(gatewayModelMock).not.toHaveBeenCalled();
    expect(sharedMockAnthropic.create).toHaveBeenCalledTimes(3);
  });

  it("gateway both-attempts failure degrades to the Anthropic path on the default model", async () => {
    vi.stubEnv("DIAGNOSE_CONCERN_STAGE1_MODEL", "google/gemini-3.1-flash-lite");
    generateObjectMock.mockRejectedValue(new Error("gateway_5xx"));
    sharedMockAnthropic.addStageResponse(stage1Response("brake_inspection"));
    sharedMockAnthropic.addStageResponse(stage2Response("metallic_grinding"));
    sharedMockAnthropic.addStageResponse(stage3Response());

    const result = await diagnoseConcern(makeArgs());

    expect(result.matched_category_key).toBe("brake_inspection");
    expect(result.parsed_ok).toBe(true);
    // Two gateway attempts…
    expect(generateObjectMock).toHaveBeenCalledTimes(2);
    // …then the Anthropic fallback took Stage 1 on DEFAULT_MODEL, and
    // Stages 2+3 ran on the anthropic path (per the env pin) — 3 calls.
    expect(sharedMockAnthropic.create).toHaveBeenCalledTimes(3);
    const firstCreateArgs = sharedMockAnthropic.create.mock.calls[0]![0] as {
      model: string;
    };
    expect(firstCreateArgs.model).toBe("anthropic/claude-haiku-4-5");
    // Both gateway failures got the transport-tagged Sentry capture.
    const gatewayCaptures = sentryCaptureException.mock.calls.filter((c) => {
      const opts = c[1] as { tags?: { transport?: string } } | undefined;
      return opts?.tags?.transport === "gateway";
    });
    expect(gatewayCaptures).toHaveLength(2);
  });

  it("gateway failure + anthropic fallback failure fails the stage with the combined error", async () => {
    vi.stubEnv("DIAGNOSE_CONCERN_STAGE1_MODEL", "google/gemini-3.1-flash-lite");
    generateObjectMock.mockRejectedValue(new Error("gateway_down"));
    sharedMockAnthropic.addStageError("anthropic_down");
    sharedMockAnthropic.addStageError("anthropic_down");

    const result = await diagnoseConcern(makeArgs());

    expect(result.parsed_ok).toBe(false);
    expect(result.error_message).toContain("stage1_failed");
    expect(result.error_message).toContain("gateway_failed: gateway_down");
    expect(result.error_message).toContain("anthropic_fallback_failed");
  });

  it("gateway Zod post-parse rejects a malformed object → counts as an attempt failure, retried", async () => {
    vi.stubEnv("DIAGNOSE_CONCERN_STAGE1_MODEL", "google/gemini-3.1-flash-lite");
    generateObjectMock
      .mockResolvedValueOnce({
        object: { wrong_shape: true },
        usage: { inputTokens: 1, outputTokens: 1 },
      })
      .mockResolvedValueOnce({
        object: stage1Response("brake_inspection"),
        usage: { inputTokens: 7, outputTokens: 3 },
      });
    sharedMockAnthropic.addStageResponse(stage2Response("metallic_grinding"));
    sharedMockAnthropic.addStageResponse(stage3Response());

    const result = await diagnoseConcern(makeArgs());

    expect(result.matched_category_key).toBe("brake_inspection");
    expect(result.parsed_ok).toBe(true);
    expect(generateObjectMock).toHaveBeenCalledTimes(2);
  });
});

// buildStage1SystemPrompt now returns an Anthropic content-block array
// (the cache_control wrapper shape — see diagnose-concern.ts comment block).
// These tests still assert on the prompt's textual content, so flatten the
// array's `text` fields into a single string for `.toContain` matches.
function flattenPromptBlocks(
  blocks: ReturnType<typeof buildStage1SystemPrompt>,
): string {
  return blocks.map((b) => b.text).join("\n\n");
}

describe("buildStage1SystemPrompt — chip hint propagation", () => {
  it("includes a non-other chip's display name + concern categories", () => {
    const chip: DiagnoseConcernChipHint = {
      chip_service_key: "brake_check",
      chip_display_name: "Brakes feel off",
      chip_concern_categories: ["brakes", "noise"],
    };

    const prompt = flattenPromptBlocks(
      buildStage1SystemPrompt(makeArgs({ customer_chip_hint: chip })),
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

    const prompt = flattenPromptBlocks(
      buildStage1SystemPrompt(makeArgs({ customer_chip_hint: chip })),
    );

    expect(prompt).toContain("Other Issue");
    expect(prompt).toContain("no pre-");
  });

  it("renders the no-chip case explicitly", () => {
    const prompt = flattenPromptBlocks(
      buildStage1SystemPrompt(makeArgs({ customer_chip_hint: null })),
    );
    expect(prompt).toContain("No chip hint");
  });

  it("returns a 2-element content-block array with cache_control on the static portion", () => {
    const blocks = buildStage1SystemPrompt(makeArgs());

    expect(blocks).toHaveLength(2);
    const staticBlock = blocks[0]!;
    const dynamicBlock = blocks[1]!;
    expect(staticBlock).toEqual(
      expect.objectContaining({
        type: "text",
        cache_control: { type: "ephemeral" },
      }),
    );
    expect(dynamicBlock).toEqual(
      expect.objectContaining({ type: "text" }),
    );
    // The dynamic portion MUST NOT carry cache_control; that's the entire
    // point of the split.
    expect(dynamicBlock.cache_control).toBeUndefined();
  });
});
