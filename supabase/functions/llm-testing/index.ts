// llm-testing — Path C diagnostic concern eval (Anthropic SDK + AI Gateway).
//
// Three-stage classifier (refactored 2026-05-21 from two-stage). Mirrors
// scheduler-app/src/lib/scheduler/wizard/llm/diagnose-concern.ts:
//
//   Stage 1 — Match category
//     Brief catalog → matched_category_key + confidence + reasoning.
//
//   Stage 2 — Pick subcategory
//     Single category's subtree WITH enriched description + positive/negative
//     examples + synonyms (added 2026-05-21). NO question text in the prompt.
//     NO gap-detect (now lives in Stage 3 + deterministic mapper).
//     Returns matched_subcategory_slug + confidence + reasoning.
//
//   Stage 3 — Extract facts
//     EXTRACTED_FACTS_JSON_SCHEMA (~29 nullable slots) + confidence + reasoning.
//     LLM extracts ONLY what the customer literally stated; no gap-detect.
//
//   Deterministic mapper (pure TS, post-LLM)
//     Takes Stage 3's extracted_facts + matched subcategory's questions
//     (each question carrying required_facts: string[]) and partitions IDs
//     into answered / ambiguous / unanswered buckets via the required_facts
//     mapping. v1 behavior: ambiguous ∪ unanswered surfaced as unanswered
//     (safe over-ask).
//
// Why Path C: bypasses the @ai-sdk/gateway generateObject path's documented
// Anthropic-compat bugs (#12020, #13355, #13460, #14342). Anthropic's
// native structured outputs (output_format + structured-outputs-2025-11-13
// beta) use constrained decoding; documented <0.1% schema-failure rate.
//
// The Supabase edge function CANNOT import scheduler-app source (Deno can't
// reach across packages), so ExtractedFacts + the mapper are INLINED below
// from extracted-facts.ts + question-fact-mapper.ts. When those files
// change, mirror here in the same commit and redeploy.
//
// Response shape: stage1 + stage2 + stage3 + mapper blocks (each per-stage)
// plus a `validated` block carrying the final wizard-facing state. Same
// stage1 shape as the prior two-stage version; stage2 shape adjusted
// (no unanswered_question_ids); stage3 + mapper are new.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@^0.97";
import { z } from "npm:zod@^4";
import { withSentryScope } from "../_shared/sentry-edge.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SECRET_KEY")!;
const AI_GATEWAY_API_KEY = Deno.env.get("AI_GATEWAY_API_KEY")!;
const SHOP_ID = parseInt(Deno.env.get("TEKMETRIC_SHOP_ID") ?? "7476", 10);

const DEFAULT_MODEL = "anthropic/claude-haiku-4-5";
const FALLBACK_MODEL = "anthropic/claude-sonnet-4-6";
const MAX_OUTPUT_TOKENS = 1024;
const STRUCTURED_OUTPUTS_BETA = "structured-outputs-2025-11-13";

const STAGE1_MODEL =
  Deno.env.get("DIAGNOSE_CONCERN_STAGE1_MODEL") ??
  Deno.env.get("DIAGNOSE_CONCERN_MODEL") ??
  DEFAULT_MODEL;
const STAGE2_MODEL =
  Deno.env.get("DIAGNOSE_CONCERN_STAGE2_MODEL") ??
  Deno.env.get("DIAGNOSE_CONCERN_MODEL") ??
  DEFAULT_MODEL;
const STAGE3_MODEL =
  Deno.env.get("DIAGNOSE_CONCERN_STAGE3_MODEL") ??
  Deno.env.get("DIAGNOSE_CONCERN_MODEL") ??
  DEFAULT_MODEL;

const OTHER_CONCERN_CATEGORY = "other";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const anthropic = new Anthropic({
  apiKey: AI_GATEWAY_API_KEY,
  baseURL: "https://ai-gateway.vercel.sh",
});

// ════════════════════════════════════════════════════════════════════
// CATALOG TYPES + LOADER (unchanged from previous version)
// ════════════════════════════════════════════════════════════════════

interface CatalogQuestion {
  id: number;
  question_text: string;
  options: Array<{ label: string; value: string }>;
  display_order: number;
  multi_select: boolean;
  /** Canonical facts this question elicits from the customer. Used by
   *  the Stage 3 mapper for required-fact gap-detect. Added 2026-05-21
   *  with the three-stage classifier migration. Defaults to `[]` when
   *  not seeded. */
  required_facts: string[];
}

interface CatalogSubcategory {
  slug: string;
  display_label: string;
  concern_category: string;
  /** Explicit subcategory → testing_service mapping (1:N). When this
   *  array is non-empty, the catalog loader uses it as the ONLY
   *  eligibility signal — testing_services.concern_categories[] is
   *  ignored for this subcategory. When empty (the default), the
   *  loader falls back to concern_categories[] resolution. Mirrors
   *  the scheduler-app definition in load-diagnostic-catalog.ts. */
  eligible_testing_service_keys: string[];
  /** Three-stage classifier enrichment (added 2026-05-21):
   *  - description: short prose for Stage 2 LLM disambiguation
   *  - positive_examples: customer phrases that SHOULD match
   *  - negative_examples: customer phrases that should NOT match
   *  - synonyms: alternate words customers use
   *  Defaults to `''` / `[]` when not seeded. */
  description: string;
  positive_examples: string[];
  negative_examples: string[];
  synonyms: string[];
  questions: CatalogQuestion[];
}

interface TestingServiceCategory {
  kind: "testing_service";
  service_key: string;
  display_name: string;
  description: string | null;
  starting_price_cents: number;
  concern_categories: string[];
  subcategories: CatalogSubcategory[];
}

interface OtherSubcategoryCategory {
  kind: "other_subcategory";
  subcategory_slug: string;
  display_label: string;
  questions: CatalogQuestion[];
}

type CatalogCategory = TestingServiceCategory | OtherSubcategoryCategory;

interface DiagnosticCatalog {
  categories: CatalogCategory[];
}

function isTestingService(c: CatalogCategory): c is TestingServiceCategory {
  return c.kind === "testing_service";
}
function isOtherSubcategory(c: CatalogCategory): c is OtherSubcategoryCategory {
  return c.kind === "other_subcategory";
}

function normalizeOptions(
  raw: unknown,
): Array<{ label: string; value: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const obj = entry as Record<string, unknown>;
      const label = typeof obj.label === "string" ? obj.label : null;
      const value = typeof obj.value === "string" ? obj.value : null;
      if (!label || !value) return null;
      return { label, value };
    })
    .filter((x): x is { label: string; value: string } => x !== null);
}

async function loadCatalog(): Promise<DiagnosticCatalog> {
  const [testingRes, subRes, questionRes] = await Promise.all([
    sb
      .from("testing_services")
      .select(
        "service_key, display_name, description, starting_price_cents, concern_categories",
      )
      .eq("shop_id", SHOP_ID)
      .eq("active", true)
      .order("display_name", { ascending: true }),
    sb
      .from("concern_subcategories")
      .select(
        "id, slug, category, display_label, display_order, active, eligible_testing_service_keys, description, positive_examples, negative_examples, synonyms",
      )
      .eq("shop_id", SHOP_ID)
      .eq("active", true)
      .order("display_order", { ascending: true }),
    sb
      .from("concern_questions")
      .select(
        "id, question_text, options, display_order, subcategory_id, active, multi_select, required_facts",
      )
      .eq("shop_id", SHOP_ID)
      .eq("active", true)
      .order("display_order", { ascending: true }),
  ]);
  if (testingRes.error) throw new Error(`testing_services: ${testingRes.error.message}`);
  if (subRes.error) throw new Error(`concern_subcategories: ${subRes.error.message}`);
  if (questionRes.error) throw new Error(`concern_questions: ${questionRes.error.message}`);

  const testingRows = (testingRes.data ?? []) as Array<{
    service_key: string;
    display_name: string;
    description: string | null;
    starting_price_cents: number;
    concern_categories: string[] | null;
  }>;
  const subRows = (subRes.data ?? []) as Array<{
    id: number;
    slug: string;
    category: string;
    display_label: string;
    display_order: number;
    active: boolean;
    eligible_testing_service_keys: string[] | null;
    description: string | null;
    positive_examples: string[] | null;
    negative_examples: string[] | null;
    synonyms: string[] | null;
  }>;
  const questionRows = (questionRes.data ?? []) as Array<{
    id: number;
    question_text: string;
    options: unknown;
    display_order: number;
    subcategory_id: number;
    active: boolean;
    multi_select: boolean;
    required_facts: string[] | null;
  }>;

  const questionsBySub = new Map<number, CatalogQuestion[]>();
  for (const q of questionRows) {
    const arr = questionsBySub.get(q.subcategory_id) ?? [];
    arr.push({
      id: q.id,
      question_text: q.question_text,
      options: normalizeOptions(q.options),
      display_order: q.display_order,
      multi_select: q.multi_select === true,
      required_facts: Array.isArray(q.required_facts) ? q.required_facts : [],
    });
    questionsBySub.set(q.subcategory_id, arr);
  }

  // Mirror of scheduler-app/src/lib/scheduler/wizard/llm/load-diagnostic-catalog.ts
  // Two indexes: explicit mapping wins; concern_categories[] is the fallback.
  const subsByCategory = new Map<string, CatalogSubcategory[]>();
  const subsByExplicitMap = new Map<string, CatalogSubcategory[]>();
  const otherSubcategories: CatalogSubcategory[] = [];
  for (const row of subRows) {
    const eligible = Array.isArray(row.eligible_testing_service_keys)
      ? row.eligible_testing_service_keys
      : [];
    const sub: CatalogSubcategory = {
      slug: row.slug,
      display_label: row.display_label,
      concern_category: row.category,
      eligible_testing_service_keys: eligible,
      description: row.description ?? "",
      positive_examples: Array.isArray(row.positive_examples)
        ? row.positive_examples
        : [],
      negative_examples: Array.isArray(row.negative_examples)
        ? row.negative_examples
        : [],
      synonyms: Array.isArray(row.synonyms) ? row.synonyms : [],
      questions: (questionsBySub.get(row.id) ?? []).sort(
        (a, b) => a.display_order - b.display_order,
      ),
    };
    if (row.category === OTHER_CONCERN_CATEGORY) {
      otherSubcategories.push(sub);
      continue;
    }
    if (eligible.length > 0) {
      for (const serviceKey of eligible) {
        const arr = subsByExplicitMap.get(serviceKey) ?? [];
        arr.push(sub);
        subsByExplicitMap.set(serviceKey, arr);
      }
    } else {
      const arr = subsByCategory.get(row.category) ?? [];
      arr.push(sub);
      subsByCategory.set(row.category, arr);
    }
  }

  const testingCategories: TestingServiceCategory[] = testingRows.map((row) => {
    const cats = row.concern_categories ?? [];
    const subs: CatalogSubcategory[] = [];
    const seen = new Set<string>();
    // (a) Explicit mappings first.
    for (const s of subsByExplicitMap.get(row.service_key) ?? []) {
      if (seen.has(s.slug)) continue;
      seen.add(s.slug);
      subs.push(s);
    }
    // (b) Fallback fan-out for unmapped subcategories.
    for (const c of cats) {
      for (const s of subsByCategory.get(c) ?? []) {
        if (seen.has(s.slug)) continue;
        seen.add(s.slug);
        subs.push(s);
      }
    }
    return {
      kind: "testing_service",
      service_key: row.service_key,
      display_name: row.display_name,
      description: row.description,
      starting_price_cents: row.starting_price_cents,
      concern_categories: cats,
      subcategories: subs,
    };
  });

  const otherCategories: OtherSubcategoryCategory[] = otherSubcategories.map(
    (s) => ({
      kind: "other_subcategory",
      subcategory_slug: s.slug,
      display_label: s.display_label,
      questions: s.questions,
    }),
  );

  return { categories: [...testingCategories, ...otherCategories] };
}

let catalogCache: { catalog: DiagnosticCatalog; loadedAt: number } | null =
  null;
const CACHE_TTL_MS = 60_000;
async function getCatalog(): Promise<DiagnosticCatalog> {
  if (catalogCache && Date.now() - catalogCache.loadedAt < CACHE_TTL_MS) {
    return catalogCache.catalog;
  }
  const catalog = await loadCatalog();
  catalogCache = { catalog, loadedAt: Date.now() };
  return catalog;
}

// ════════════════════════════════════════════════════════════════════
// EXTRACTED-FACTS — Zod + JSON Schema + key registry
// ════════════════════════════════════════════════════════════════════
//
// Inlined verbatim from scheduler-app/src/lib/scheduler/wizard/llm/
// extracted-facts.ts. Deno cannot import that file; both files must
// describe an identical contract for the eval harness and the production
// scheduler to produce comparable results. Mirror any change there
// in the SAME commit.

const ExtractedFactsSchema = z.object({
  location_side: z
    .enum(["left", "right", "both", "varies", "unsure"])
    .nullable(),
  location_axle: z.enum(["front", "rear", "all", "unsure"]).nullable(),
  speed_band: z
    .enum([
      "stopped",
      "idle",
      "low_speed",
      "mid_speed",
      "highway",
      "specific_mph",
      "all_speeds",
    ])
    .nullable(),
  speed_specific_mph: z.number().int().nullable(),
  onset_timing: z
    .enum([
      "cold_start",
      "after_warming_up",
      "at_startup",
      "at_first_turn_on",
      "during_driving",
      "at_stop",
      "over_bumps",
      "when_braking",
      "when_accelerating",
      "when_turning",
      "when_idling",
      "always",
      "intermittent",
    ])
    .nullable(),
  started_when: z
    .enum([
      "just_now",
      "today",
      "days_ago",
      "weeks_ago",
      "months_ago",
      "a_year_plus",
      "since_purchase",
      "sudden_onset",
      "gradually",
    ])
    .nullable(),
  hvac_mode: z
    .enum(["ac", "heat", "defrost", "fan_only", "both_ac_and_heat", "none"])
    .nullable(),
  airflow_state: z
    .enum([
      "strong_normal",
      "weak_overall",
      "only_on_highest_setting",
      "only_one_zone_blows",
      "no_airflow",
      "uneven_temperature_between_zones",
    ])
    .nullable(),
  pedal_feel: z
    .enum([
      "normal",
      "soft_spongy",
      "hard_unresponsive",
      "sinks_to_floor",
      "pulsating",
      "grabby",
    ])
    .nullable(),
  smell_descriptor: z
    .enum([
      "sweet_or_maple_syrup",
      "burnt_oil",
      "gasoline_or_fuel",
      "rotten_egg_or_sulfur",
      "burning_electrical_or_plastic",
      "burning_rubber_or_hot_brakes",
      "musty_or_mildew",
      "exhaust_inside_cabin",
      "other_burning",
    ])
    .nullable(),
  noise_descriptor: z
    .enum([
      "squealing_high_pitched",
      "grinding_metallic",
      "knocking_deep",
      "ticking_or_tapping",
      "clunking",
      "rattling",
      "hissing",
      "humming_or_whirring",
      "whining",
      "popping_or_clicking",
      "buzzing",
      "creaking_or_squeaking",
      "roaring",
      "scraping",
    ])
    .nullable(),
  smoke_color: z
    .enum([
      "white",
      "blue_or_gray",
      "black",
      "steam_thin_wispy",
      "visible_but_color_unclear",
    ])
    .nullable(),
  fluid_color: z
    .enum([
      "brown_or_black",
      "green_or_orange_or_yellow_or_pink",
      "red_or_pink",
      "clear_yellow_or_light_brown",
      "clear_no_color",
      "blue_or_light_blue",
      "thick_dark_brown",
    ])
    .nullable(),
  fluid_under_car_location: z
    .enum([
      "under_engine_front",
      "under_middle",
      "under_rear",
      "under_a_wheel",
      "under_passenger_side",
      "under_driver_side",
      "unsure",
    ])
    .nullable(),
  warning_light_named: z.string().nullable(),
  warning_light_behavior: z
    .enum([
      "steady_on",
      "flashing_or_blinking",
      "comes_and_goes",
      "came_on_then_off",
      "multiple_lights_at_once",
    ])
    .nullable(),
  engine_running: z
    .enum([
      "normal",
      "rough_idle",
      "misfiring",
      "surging",
      "stalls",
      "wont_start",
      "slow_crank",
      "wont_crank_just_clicks",
      "died_while_driving",
      "no_sound_at_all",
    ])
    .nullable(),
  recent_action: z
    .enum([
      "brake_work",
      "tire_rotation_or_replacement",
      "tire_air_added",
      "oil_change",
      "battery_or_alternator_work",
      "alignment",
      "general_service",
      "jump_started",
      "ac_recharge_or_service",
      "accident_or_impact",
      "hit_pothole_or_curb",
      "car_wash_or_driven_through_water",
      "car_sat_unused",
      "fuel_fill_up",
      "none_mentioned",
    ])
    .nullable(),
  parking_brake_state: z
    .enum(["released", "engaged_or_partially_engaged", "customer_unsure"])
    .nullable(),
  tire_state: z
    .enum([
      "low_pressure",
      "flat",
      "visible_damage",
      "sidewall_cracking",
      "uneven_wear",
      "normal_or_unknown",
    ])
    .nullable(),
  steering_feel: z
    .enum([
      "normal",
      "heavy_or_hard_to_turn",
      "loose_or_sloppy",
      "wheel_off_center_while_straight",
      "stiff_one_direction_only",
    ])
    .nullable(),
  pull_direction: z
    .enum(["left", "right", "varies_or_wanders", "no_pull"])
    .nullable(),
  lights_state: z
    .enum([
      "dim_or_flickering",
      "dim_at_idle_brighten_when_revving",
      "normal",
      "completely_dead",
    ])
    .nullable(),
  accessory_affected: z.string().nullable(),
  weather_condition: z
    .enum([
      "cold_weather",
      "hot_weather",
      "rainy_or_wet",
      "humid",
      "after_snow_or_ice",
      "any_weather",
    ])
    .nullable(),
  sound_or_smoke_location_zone: z
    .enum([
      "under_hood",
      "under_car",
      "from_a_wheel",
      "behind_dashboard",
      "from_vents",
      "from_tailpipe",
      "passenger_footwell",
      "inside_cabin_general",
      "unsure",
    ])
    .nullable(),
  vehicle_powertrain: z
    .enum([
      "gasoline",
      "diesel",
      "hybrid",
      "electric",
      "turbocharged",
      "not_stated",
    ])
    .nullable(),
  drivable_state: z
    .enum([
      "drivable_normally",
      "drivable_but_concerned",
      "not_drivable_needs_tow",
      "stranded_now",
    ])
    .nullable(),
  customer_request_type: z
    .enum([
      "diagnose_problem",
      "fix_a_known_problem",
      "replace_specific_part",
      "routine_maintenance",
      "pre_trip_inspection",
      "second_opinion",
      "just_get_new_tires",
    ])
    .nullable(),
});

type ExtractedFacts = z.infer<typeof ExtractedFactsSchema>;

const EXTRACTED_FACTS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "location_side",
    "location_axle",
    "speed_band",
    "speed_specific_mph",
    "onset_timing",
    "started_when",
    "hvac_mode",
    "airflow_state",
    "pedal_feel",
    "smell_descriptor",
    "noise_descriptor",
    "smoke_color",
    "fluid_color",
    "fluid_under_car_location",
    "warning_light_named",
    "warning_light_behavior",
    "engine_running",
    "recent_action",
    "parking_brake_state",
    "tire_state",
    "steering_feel",
    "pull_direction",
    "lights_state",
    "accessory_affected",
    "weather_condition",
    "sound_or_smoke_location_zone",
    "vehicle_powertrain",
    "drivable_state",
    "customer_request_type",
  ],
  properties: {
    location_side: {
      enum: ["left", "right", "both", "varies", "unsure", null],
      description:
        "Which side of the vehicle the symptom is on. Customer phrasings: 'driver side' → left; 'passenger side' → right; 'both sides' → both; 'sometimes one side then the other' → varies; 'not sure which side' → unsure. DO NOT confuse with steering pull direction (use pull_direction). DO NOT infer from 'driver complains' — that's the human, not the car side.",
    },
    location_axle: {
      enum: ["front", "rear", "all", "unsure", null],
      description:
        "Front or rear of the vehicle. Customer phrasings: 'front wheels', 'up front', 'engine area' → front; 'rear wheels', 'back of the car' → rear; 'all four corners' → all. DO NOT confuse with under-the-hood location (use sound_or_smoke_location_zone).",
    },
    speed_band: {
      enum: [
        "stopped",
        "idle",
        "low_speed",
        "mid_speed",
        "highway",
        "specific_mph",
        "all_speeds",
        null,
      ],
      description:
        "Speed range when the symptom occurs. stopped = parked or at a red light; idle = engine running but not moving; low_speed = parking lots, under ~25 mph; mid_speed = city driving 25-50; highway = 50+; specific_mph = customer named an exact number (set speed_specific_mph too); all_speeds = customer said 'at any speed' or 'all the time when driving'. Customer phrasings: 'at 65', 'around 50', 'on the highway', 'in parking lots', 'when I'm stopped at a light'.",
    },
    speed_specific_mph: {
      type: ["integer", "null"],
      description:
        "Exact mph the customer named (e.g., 'shakes at 65 mph' → 65). Only set if customer explicitly stated a number. Range expressions like 'between 50 and 60' → use the lower bound (50). DO NOT estimate or infer from 'highway speed' alone.",
    },
    onset_timing: {
      enum: [
        "cold_start",
        "after_warming_up",
        "at_startup",
        "at_first_turn_on",
        "during_driving",
        "at_stop",
        "over_bumps",
        "when_braking",
        "when_accelerating",
        "when_turning",
        "when_idling",
        "always",
        "intermittent",
        null,
      ],
      description:
        "WHEN the symptom occurs relative to vehicle operation. cold_start = only first thing in the morning / after sitting overnight; after_warming_up = only once the engine is warm; at_startup = the moment the key is turned (any temp); at_first_turn_on = first seconds after AC/heater turned on (HVAC-specific); during_driving = while in motion (no other specific trigger); at_stop = while stopped / coming to a stop; over_bumps = triggered by bumps / potholes / rough road; when_braking = only while pressing the brake pedal; when_accelerating = only when pressing the gas; when_turning = only when turning the steering wheel; when_idling = while idling at a stop (engine-specific); always = continuous; intermittent = random, no pattern.",
    },
    started_when: {
      enum: [
        "just_now",
        "today",
        "days_ago",
        "weeks_ago",
        "months_ago",
        "a_year_plus",
        "since_purchase",
        "sudden_onset",
        "gradually",
        null,
      ],
      description:
        "How long the customer has been experiencing the symptom OR how it began. Customer phrasings: 'started today' → today; 'a few days' → days_ago; 'a couple weeks' → weeks_ago; 'has been doing this for months' → months_ago; 'over a year' → a_year_plus; 'always done this since I bought it' → since_purchase; 'suddenly started' → sudden_onset; 'got worse little by little' → gradually.",
    },
    hvac_mode: {
      enum: ["ac", "heat", "defrost", "fan_only", "both_ac_and_heat", "none", null],
      description:
        "Which HVAC mode the symptom occurs in. ac = only air conditioning; heat = only heater; defrost = only defrost; fan_only = fan running with no temperature mode active; both_ac_and_heat = symptom occurs with either heat or AC; none = HVAC is off when symptom occurs. Customer phrasings: 'when I run the AC', 'when the heater is on', 'on defrost', 'whether AC or heat'.",
    },
    airflow_state: {
      enum: [
        "strong_normal",
        "weak_overall",
        "only_on_highest_setting",
        "only_one_zone_blows",
        "no_airflow",
        "uneven_temperature_between_zones",
        null,
      ],
      description:
        "Description of vent airflow. strong_normal = airflow feels normal; weak_overall = weak on every fan speed; only_on_highest_setting = works only on max fan (resistor issue cue); only_one_zone_blows = e.g., only dash, not floor; no_airflow = fan doesn't blow at all; uneven_temperature_between_zones = driver side warm but passenger side cold, or similar. DO NOT use for vent-NOISE complaints (use noise_descriptor).",
    },
    pedal_feel: {
      enum: [
        "normal",
        "soft_spongy",
        "hard_unresponsive",
        "sinks_to_floor",
        "pulsating",
        "grabby",
        null,
      ],
      description:
        "How the brake pedal feels to the customer. Customer phrasings: 'spongy' / 'mushy' / 'goes too far' → soft_spongy; 'rock hard' / 'won't push down' / 'stiff' → hard_unresponsive; 'goes to the floor' / 'sinks to the carpet' → sinks_to_floor; 'shakes the pedal' / 'pulses' / 'shudders' → pulsating; 'grabs hard' / 'jumpy' → grabby.",
    },
    smell_descriptor: {
      enum: [
        "sweet_or_maple_syrup",
        "burnt_oil",
        "gasoline_or_fuel",
        "rotten_egg_or_sulfur",
        "burning_electrical_or_plastic",
        "burning_rubber_or_hot_brakes",
        "musty_or_mildew",
        "exhaust_inside_cabin",
        "other_burning",
        null,
      ],
      description:
        "Type of smell the customer described. sweet_or_maple_syrup = coolant; burnt_oil = oil burning; gasoline_or_fuel = raw fuel; rotten_egg_or_sulfur = exhaust/cat converter cue; burning_electrical_or_plastic = wire / circuit cue; burning_rubber_or_hot_brakes = brake / belt / dragging tire; musty_or_mildew = AC mold / 'dirty socks' / 'wet basement'; exhaust_inside_cabin = exhaust fumes the customer is breathing; other_burning = burning smell that doesn't fit the above. DO NOT use for visible smoke without smell (use smoke_color).",
    },
    noise_descriptor: {
      enum: [
        "squealing_high_pitched",
        "grinding_metallic",
        "knocking_deep",
        "ticking_or_tapping",
        "clunking",
        "rattling",
        "hissing",
        "humming_or_whirring",
        "whining",
        "popping_or_clicking",
        "buzzing",
        "creaking_or_squeaking",
        "roaring",
        "scraping",
        null,
      ],
      description:
        "Type of noise the customer described. squealing_high_pitched = brake squeal / belt squeal; grinding_metallic = metal-on-metal; knocking_deep = heavy engine knock; ticking_or_tapping = lighter, faster tap from valvetrain area; clunking = single hard thump (suspension cue); rattling = tinny / loose parts; hissing = vacuum / coolant escape; humming_or_whirring = bearing / tire cue; whining = power-steering / accessory belt / alternator; popping_or_clicking = CV joint cue when turning; buzzing = electrical buzz / relay; creaking_or_squeaking = suspension over bumps; roaring = exhaust leak / wheel bearing at speed; scraping = brake-pad-on-rotor / heat shield rub.",
    },
    smoke_color: {
      enum: [
        "white",
        "blue_or_gray",
        "black",
        "steam_thin_wispy",
        "visible_but_color_unclear",
        null,
      ],
      description:
        "Color of visible smoke or vapor. white = thick white (coolant cue); blue_or_gray = oil burning cue; black = unburned fuel / soot; steam_thin_wispy = thin white that disappears (often just condensation on cold mornings); visible_but_color_unclear = customer saw smoke but didn't say what color.",
    },
    fluid_color: {
      enum: [
        "brown_or_black",
        "green_or_orange_or_yellow_or_pink",
        "red_or_pink",
        "clear_yellow_or_light_brown",
        "clear_no_color",
        "blue_or_light_blue",
        "thick_dark_brown",
        null,
      ],
      description:
        "Color of fluid the customer saw under the vehicle. brown_or_black = engine oil; green_or_orange_or_yellow_or_pink = coolant/antifreeze (bright/neon); red_or_pink = transmission or power steering; clear_yellow_or_light_brown = brake fluid (SAFETY); clear_no_color = water / AC condensation; blue_or_light_blue = washer fluid; thick_dark_brown = gear / differential oil. DO NOT confuse with smoke_color.",
    },
    fluid_under_car_location: {
      enum: [
        "under_engine_front",
        "under_middle",
        "under_rear",
        "under_a_wheel",
        "under_passenger_side",
        "under_driver_side",
        "unsure",
        null,
      ],
      description:
        "Where under the vehicle the customer sees the puddle/drip. under_engine_front = front of the car, engine area; under_middle = mid-floor / transmission area; under_rear = back of the car; under_a_wheel = at one wheel (brake / hub cue); under_passenger_side / under_driver_side = lateral but not specified front or rear; unsure = customer saw fluid but didn't say where.",
    },
    warning_light_named: {
      type: ["string", "null"],
      description:
        "Verbatim name(s) of dashboard warning light(s) the customer named. Free text because there are too many vendor-specific labels to enumerate. Example values: 'check engine', 'TPMS', 'ABS', 'battery', 'oil pressure', 'temp', 'service engine soon', 'maintenance required', 'airbag', 'traction control', 'power steering', 'brake'. Lowercase, comma-separated if multiple. Leave null if customer did not name a specific dashboard light.",
    },
    warning_light_behavior: {
      enum: [
        "steady_on",
        "flashing_or_blinking",
        "comes_and_goes",
        "came_on_then_off",
        "multiple_lights_at_once",
        null,
      ],
      description:
        "How the warning light is behaving. steady_on = on continuously; flashing_or_blinking = blinking (more serious for check-engine); comes_and_goes = appears and disappears intermittently; came_on_then_off = appeared once and is now off; multiple_lights_at_once = customer reported several lights together. Set only if customer described the behavior, not just the light's existence.",
    },
    engine_running: {
      enum: [
        "normal",
        "rough_idle",
        "misfiring",
        "surging",
        "stalls",
        "wont_start",
        "slow_crank",
        "wont_crank_just_clicks",
        "died_while_driving",
        "no_sound_at_all",
        null,
      ],
      description:
        "How the engine is running / cranking. normal = runs fine; rough_idle = shakes / sputters at idle; misfiring = bucking / skipping / jerking under load; surging = RPMs go up and down on their own; stalls = dies after running; wont_start = cranks but doesn't fire; slow_crank = cranks slowly before catching; wont_crank_just_clicks = no crank, just clicking; died_while_driving = shut off mid-drive; no_sound_at_all = key turn produces no sound at all.",
    },
    recent_action: {
      enum: [
        "brake_work",
        "tire_rotation_or_replacement",
        "tire_air_added",
        "oil_change",
        "battery_or_alternator_work",
        "alignment",
        "general_service",
        "jump_started",
        "ac_recharge_or_service",
        "accident_or_impact",
        "hit_pothole_or_curb",
        "car_wash_or_driven_through_water",
        "car_sat_unused",
        "fuel_fill_up",
        "none_mentioned",
        null,
      ],
      description:
        "A recent action / event the customer mentioned that might be relevant. Customer phrasings: 'just had new brakes' → brake_work; 'recently got new tires' → tire_rotation_or_replacement; 'I added air last week' → tire_air_added; 'after my last oil change' → oil_change; 'new battery' → battery_or_alternator_work; 'after alignment' → alignment; 'had it serviced' → general_service; 'had to jump it' → jump_started; 'after AC recharge' → ac_recharge_or_service; 'hit a curb' / 'fender bender' → accident_or_impact / hit_pothole_or_curb; 'after going through a car wash' / 'drove through deep water' → car_wash_or_driven_through_water; 'sat for a while' → car_sat_unused; 'right after I filled up' → fuel_fill_up. Pick the SINGLE most-emphasized recent event.",
    },
    parking_brake_state: {
      enum: ["released", "engaged_or_partially_engaged", "customer_unsure", null],
      description:
        "Whether the parking / emergency brake is engaged. Relevant when the customer reports burning brake smell / dragging / one wheel hot. Customer phrasings: 'parking brake is off' → released; 'I might have left it on' → engaged_or_partially_engaged; 'not sure' → customer_unsure. Leave null if not mentioned.",
    },
    tire_state: {
      enum: [
        "low_pressure",
        "flat",
        "visible_damage",
        "sidewall_cracking",
        "uneven_wear",
        "normal_or_unknown",
        null,
      ],
      description:
        "State of a tire if the customer described one. low_pressure = customer said a tire is low; flat = completely flat; visible_damage = nail, screw, bulge, cut, gash visible; sidewall_cracking = dry rot / cracks in rubber; uneven_wear = bald spots / scalloped tread / one edge worn; normal_or_unknown = customer didn't describe a tire issue. Only set when the customer DIRECTLY described tire condition.",
    },
    steering_feel: {
      enum: [
        "normal",
        "heavy_or_hard_to_turn",
        "loose_or_sloppy",
        "wheel_off_center_while_straight",
        "stiff_one_direction_only",
        null,
      ],
      description:
        "How the steering feels to the customer. heavy_or_hard_to_turn = wheel resists / hard to park; loose_or_sloppy = play / wandery / disconnected feel; wheel_off_center_while_straight = steering wheel cocked when driving straight; stiff_one_direction_only = harder turning one way than the other.",
    },
    pull_direction: {
      enum: ["left", "right", "varies_or_wanders", "no_pull", null],
      description:
        "Direction the vehicle pulls or drifts. varies_or_wanders = wanders side-to-side / changes direction; no_pull = customer explicitly said it goes straight. Leave null if the customer did not mention pulling at all. DO NOT confuse with location_side.",
    },
    lights_state: {
      enum: [
        "dim_or_flickering",
        "dim_at_idle_brighten_when_revving",
        "normal",
        "completely_dead",
        null,
      ],
      description:
        "State of headlights / dashboard lights as reported by the customer. dim_or_flickering = visibly dim or flickering brightness; dim_at_idle_brighten_when_revving = brightness varies with engine RPM (alternator cue); completely_dead = no lights at all. Leave null if not mentioned.",
    },
    accessory_affected: {
      type: ["string", "null"],
      description:
        "Free-text name of a specific electrical accessory the customer said stopped working. Examples: 'driver window', 'radio', 'dome light', 'wipers', 'power locks', 'rear defroster', 'heated seat'. Lowercase, comma-separated if multiple. Leave null if the issue isn't accessory-specific.",
    },
    weather_condition: {
      enum: [
        "cold_weather",
        "hot_weather",
        "rainy_or_wet",
        "humid",
        "after_snow_or_ice",
        "any_weather",
        null,
      ],
      description:
        "Environmental condition the customer associated with the symptom. Customer phrasings: 'first cold morning' / 'when it's cold out' → cold_weather; 'on hot days' → hot_weather; 'in the rain' / 'after a car wash' → rainy_or_wet; 'humid days' → humid; 'after a snowstorm' → after_snow_or_ice; 'doesn't matter what weather' → any_weather.",
    },
    sound_or_smoke_location_zone: {
      enum: [
        "under_hood",
        "under_car",
        "from_a_wheel",
        "behind_dashboard",
        "from_vents",
        "from_tailpipe",
        "passenger_footwell",
        "inside_cabin_general",
        "unsure",
        null,
      ],
      description:
        "Where the customer perceives a noise OR smoke is coming from. Customer phrasings: 'from under the hood' → under_hood; 'under the car' / 'underneath' → under_car; 'from the front-right wheel' → from_a_wheel; 'behind the dash' → behind_dashboard; 'out of the vents' → from_vents; 'tailpipe' / 'exhaust' → from_tailpipe; 'passenger floor' → passenger_footwell; 'inside the cabin' → inside_cabin_general.",
    },
    vehicle_powertrain: {
      enum: [
        "gasoline",
        "diesel",
        "hybrid",
        "electric",
        "turbocharged",
        "not_stated",
        null,
      ],
      description:
        "Powertrain type if the customer stated it. Relevant for black-smoke questions (diesel vs gasoline) and start questions (hybrid/EV vs ICE). Only set if the customer explicitly stated it. DO NOT infer from year/make/model.",
    },
    drivable_state: {
      enum: [
        "drivable_normally",
        "drivable_but_concerned",
        "not_drivable_needs_tow",
        "stranded_now",
        null,
      ],
      description:
        "Whether the customer can drive the vehicle. drivable_normally = no concerns about driving it; drivable_but_concerned = driving it but doesn't feel safe; not_drivable_needs_tow = vehicle physically can't be driven (e.g., flat tire, won't start, severe damage); stranded_now = customer is currently stuck on the side of the road. Most descriptions don't mention this — leave null.",
    },
    customer_request_type: {
      enum: [
        "diagnose_problem",
        "fix_a_known_problem",
        "replace_specific_part",
        "routine_maintenance",
        "pre_trip_inspection",
        "second_opinion",
        "just_get_new_tires",
        null,
      ],
      description:
        "What the customer is asking the shop to do. diagnose_problem = they don't know the cause; fix_a_known_problem = they (or a prior shop) identified the issue; replace_specific_part = they named a part to swap (e.g., 'I want a new battery'); routine_maintenance = oil change / service interval; pre_trip_inspection = checking before a road trip; second_opinion = they want us to verify another shop's diagnosis; just_get_new_tires = explicit tire-replacement request. If the customer's description is purely symptom-only, leave null.",
    },
  },
} as const;

const EXTRACTED_FACTS_ALL_KEYS = [
  "location_side",
  "location_axle",
  "speed_band",
  "speed_specific_mph",
  "onset_timing",
  "started_when",
  "hvac_mode",
  "airflow_state",
  "pedal_feel",
  "smell_descriptor",
  "noise_descriptor",
  "smoke_color",
  "fluid_color",
  "fluid_under_car_location",
  "warning_light_named",
  "warning_light_behavior",
  "engine_running",
  "recent_action",
  "parking_brake_state",
  "tire_state",
  "steering_feel",
  "pull_direction",
  "lights_state",
  "accessory_affected",
  "weather_condition",
  "sound_or_smoke_location_zone",
  "vehicle_powertrain",
  "drivable_state",
  "customer_request_type",
] as const;

// ════════════════════════════════════════════════════════════════════
// QUESTION-FACT MAPPER (inlined from question-fact-mapper.ts)
// ════════════════════════════════════════════════════════════════════
//
// Pure-TypeScript deterministic mapper. Sub-agent of Stage 3: takes
// extracted_facts + a question list (each carrying required_facts[]) and
// partitions question IDs into answered / ambiguous / unanswered.

interface QuestionForFactMatch {
  id: number;
  required_facts: string[];
}

interface QuestionFactMatcherOutput {
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

function matchQuestionsToFacts(input: {
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

// ════════════════════════════════════════════════════════════════════
// JSON SCHEMAS + ZOD SCHEMAS (mirror diagnose-concern.ts 3-stage)
// ════════════════════════════════════════════════════════════════════

const STAGE1_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    matched_category_key: {
      type: ["string", "null"],
      description:
        "Either a testing_services.service_key from the catalog above OR an " +
        "'other' subcategory slug. Return null when the description is too " +
        "vague to categorize OR doesn't fit any catalog entry.",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description:
        "Your confidence in the matched_category_key. Use 'high' when the " +
        "description clearly names the system or symptom that maps to one " +
        "category (e.g., 'ABS light is on' → warning_light_general; " +
        "'sweet smell under hood' → coolant_leak_testing); use 'medium' " +
        "when 2-3 categories are plausible and you picked the best of them " +
        "(e.g., a vague 'shake' that could be brakes or suspension); use " +
        "'low' when the description is vague enough that the customer might " +
        "be better served by an advisor handoff (and you'd return null in " +
        "most such cases). When matched_category_key is null, confidence " +
        "should be 'low'.",
    },
    reasoning: {
      type: "string",
      description:
        "One sentence (keep under 280 characters) citing the chosen category " +
        "and the customer words that drove the match. Audit-only.",
    },
  },
  required: ["matched_category_key", "confidence", "reasoning"],
};

const STAGE2_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    matched_subcategory_slug: {
      type: ["string", "null"],
      description:
        "The subcategory slug whose meaning best matches the customer's " +
        "symptoms. MUST appear in the subcategory list above. null only if " +
        "you genuinely can't pick (rare).",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description:
        "Your confidence in the matched_subcategory_slug. Use 'high' when " +
        "the description clearly maps to ONE subcategory (a clear positive " +
        "example match, or a synonym match, with no negative example " +
        "ambiguity). Use 'medium' when the subcategory is the best of 2-3 " +
        "plausible picks. Use 'low' when the description doesn't really fit " +
        "any subcategory well OR when negative examples warn against the " +
        "near-miss pick you made. Low confidence is a signal to a " +
        "downstream advisor to verify the routing.",
    },
    reasoning: {
      type: "string",
      description:
        "One sentence (keep under 280 characters) citing the chosen " +
        "subcategory and which customer words drove the pick (positive " +
        "example match, synonym, etc.). Audit-only.",
    },
  },
  required: ["matched_subcategory_slug", "confidence", "reasoning"],
};

// Stage 3 wraps EXTRACTED_FACTS_JSON_SCHEMA with confidence + reasoning.
const STAGE3_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    extracted_facts: EXTRACTED_FACTS_JSON_SCHEMA,
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description:
        "Your confidence in the FACT EXTRACTION quality. Use 'high' when " +
        "the customer's description was clear enough that every fact you " +
        "set was a literal, unambiguous statement (e.g., 'shakes at exactly " +
        "65 mph' → speed_specific_mph=65 is unambiguous). Use 'medium' when " +
        "the description was clear but some slots involved a judgment call " +
        "between adjacent enum values (e.g., 'kind of slow to start' — " +
        "slow_crank vs intermittent). Use 'low' when the description was " +
        "vague and you set most slots to null because the customer didn't " +
        "literally state much.",
    },
    reasoning: {
      type: "string",
      description:
        "One sentence (keep under 280 characters) summarizing what was and " +
        "wasn't extractable. Audit-only.",
    },
  },
  required: ["extracted_facts", "confidence", "reasoning"],
};

const Stage1ResponseSchema = z.object({
  matched_category_key: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  reasoning: z.string(),
});

const Stage2ResponseSchema = z.object({
  matched_subcategory_slug: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  reasoning: z.string(),
});

const Stage3ResponseSchema = z.object({
  extracted_facts: ExtractedFactsSchema,
  confidence: z.enum(["high", "medium", "low"]),
  reasoning: z.string(),
});

// ════════════════════════════════════════════════════════════════════
// PROMPT BUILDERS (mirror diagnose-concern.ts)
// ════════════════════════════════════════════════════════════════════

interface ChipHint {
  chip_service_key: string;
  chip_display_name: string;
  chip_concern_categories: string[];
}

function fmtPriceForLLM(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
}

function buildChipHintLine(chipHint: ChipHint | null): string {
  if (!chipHint) return "No chip hint — classify from description alone.";
  if (chipHint.chip_service_key === "other_issue") {
    return `The customer picked the "💬 Other Issue" pseudo-chip — no pre-classification; classify from description alone, considering all categories.`;
  }
  return `The customer picked the "${chipHint.chip_display_name}" chip (related concern_categories: ${chipHint.chip_concern_categories.join(", ") || "none"}). Use this as a soft prior — prefer categories tagged with one of those concern_categories unless the description clearly says otherwise.`;
}

// Stage 1 system prompt returned as an Anthropic content-block array with
// cache_control on the STATIC portion. Mirrors scheduler-app's
// buildStage1SystemPrompt — see diagnose-concern.ts for the full
// cache_control rationale (5-min ephemeral TTL, Haiku 2048-token write
// threshold, fact that string-form silently disables caching).
function buildStage1SystemPrompt(
  catalog: DiagnosticCatalog,
  chipHint: ChipHint | null,
): Anthropic.TextBlockParam[] {
  const testingServices = catalog.categories.filter(isTestingService);
  const otherSubcategories = catalog.categories.filter(isOtherSubcategory);

  const testingServicesBlock = testingServices
    .map((t, i) => {
      return [
        `${i + 1}. service_key="${t.service_key}" — ${t.display_name} (${fmtPriceForLLM(t.starting_price_cents)})`,
        `   What we'd do: ${t.description ?? "—"}`,
        `   Concern categories tagged: ${t.concern_categories.join(", ") || "(none)"}`,
      ].join("\n");
    })
    .join("\n\n");

  const otherSubcategoriesBlock = otherSubcategories
    .map(
      (o, i) =>
        `${testingServices.length + i + 1}. subcategory_slug="${o.subcategory_slug}" — ${o.display_label}`,
    )
    .join("\n");

  const staticText = `You are the diagnostic categorisation helper for Jeff's Automotive
(Stage 1: category match). A customer typed a description of what's wrong
with their car. Your job: pick ONE category from the catalog below.

If the description is too vague or doesn't fit any category clearly, return
matched_category_key=null. Empty/very-short descriptions count as "doesn't fit."

You will NOT be asked to pick a subcategory or generate clarification
questions in this stage — that's Stage 2's job, which only runs if you pick
a testing service. Just classify the description into a single category.

# Category catalog

## Testing services — these drive a recommendation + fee

${testingServicesBlock}

## 'Other' situations — these route to a service advisor (no testing service, no fee)

These elevated subcategories cover concerns that don't map to a specific test:
multiple symptoms at once, recent accidents, work just done elsewhere, safety
worries, general inspections, cars that have been sitting.

${otherSubcategoriesBlock}

# Decision rules

1. **Match category to the customer's actual symptoms.** Read the description
   carefully and pick the category whose name + "What we'd do" + tags best fit
   the described issue. The chip hint is a prior, not a constraint.

2. **'Other' subcategory matches are valid AND useful.** If the customer's
   description is about a situation (recent accident, car has been sitting,
   pre-trip check, multiple symptoms at once with no primary), match the
   appropriate 'other' subcategory_slug. Don't try to force a testing service
   when the situation truly doesn't fit one.

3. **Couldn't categorize is a valid answer.** When the description is too
   vague ("car feels weird", "something's off", < ~5 useful words), return
   matched_category_key=null. The system will forward to a service advisor.

4. **Never invent IDs or slugs.** Only return values that appear above.

5. **Reasoning is for the audit log.** One sentence under 280 characters.

6. **Confidence is self-reported.** Pick one of high/medium/low:
   - **high** — the description clearly names the system or symptom that
     maps to ONE category (e.g., "ABS light is on" → warning_light_general;
     "sweet smell under hood" → coolant_leak_testing; "brake pedal sinks to
     the floor" → brake_inspection). No realistic alternative reading.
   - **medium** — the matched category is the best of 2-3 plausible picks
     (e.g., a vague "shake" that could be brakes or suspension; a generic
     "noise from the engine" that could be performance or noise).
   - **low** — the description is vague enough that you're not really
     sure (e.g., "the car feels weird", "something's off"). If you're
     this unsure, prefer matched_category_key=null. When you DO return
     null, confidence MUST be 'low'.`;

  const dynamicText = `# Customer's pre-selection (context)

${buildChipHintLine(chipHint)}`;

  return [
    { type: "text", text: staticText, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamicText },
  ];
}

// Stage 2 system prompt returned as a content-block array with cache_control
// on the static portion. Anthropic caches per exact-content match, so a
// repeat of the same matched-category subtree within the 5-min ephemeral
// window hits the cache.
function buildStage2SystemPrompt(
  matchedCategory: CatalogCategory,
  chipHint: ChipHint | null,
): Anthropic.TextBlockParam[] {
  // For 'other' matches, synthesize a singleton list so the LLM still
  // picks-from-N (N=1 here). No enrichment metadata on 'other' since the
  // path doesn't go through concern_subcategories.
  const subcategories: CatalogSubcategory[] = isOtherSubcategory(matchedCategory)
    ? [
        {
          slug: matchedCategory.subcategory_slug,
          display_label: matchedCategory.display_label,
          concern_category: "other",
          eligible_testing_service_keys: [],
          description: "",
          positive_examples: [],
          negative_examples: [],
          synonyms: [],
          questions: matchedCategory.questions,
        },
      ]
    : matchedCategory.subcategories;

  const matchedHeader = isTestingService(matchedCategory)
    ? `service_key="${matchedCategory.service_key}" — ${matchedCategory.display_name}`
    : `subcategory_slug="${matchedCategory.subcategory_slug}" — ${matchedCategory.display_label}`;

  const subcategoryBlock = subcategories
    .map((s) => {
      const lines: string[] = [
        `## subcategory_slug="${s.slug}" — ${s.display_label}`,
        `Description: ${s.description?.trim() ? s.description.trim() : "(none yet — falls back to slug)"}`,
      ];
      if (s.positive_examples.length > 0) {
        lines.push("Positive examples:");
        for (const ex of s.positive_examples) {
          lines.push(`  - "${ex}"`);
        }
      }
      if (s.negative_examples.length > 0) {
        lines.push("Negative examples (do NOT match):");
        for (const ex of s.negative_examples) {
          lines.push(`  - "${ex}"`);
        }
      }
      if (s.synonyms.length > 0) {
        lines.push(`Synonyms: ${s.synonyms.join(", ")}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");

  const staticText = `You are the diagnostic categorisation helper for Jeff's Automotive
(Stage 2: subcategory pick). Stage 1 already matched the customer's
description to a category:

  ${matchedHeader}

Your job: pick the ONE subcategory below whose meaning best matches the
customer's symptoms. The subcategory MUST be one of the slugs listed below.
${subcategories.length === 1 ? "(For 'other' matches there is only ONE choice — pick it.)" : ""}

NOTE: You do NOT see the per-question text here, and you are NOT being asked
to figure out which questions the customer already answered. That's
Stage 3's job (deterministic mapper). All you need to do here is pick the
RIGHT subcategory for downstream Stage-3 fact extraction + mapping to use.

# Subcategory catalog (this category only)

${subcategoryBlock}

# Decision rules

1. **Subcategory must appear in the list above.** Don't invent slugs.

2. **Use the description as the primary signal.** Each subcategory has an
   authoritative description in advisor-facing language. The customer's
   wording maps to the subcategory whose description best matches what they
   said. Synonyms widen the matchable surface; positive examples are
   anchor phrases that SHOULD match; negative examples are near-miss phrases
   that should NOT match (they look similar but belong elsewhere).

3. **When in doubt between near-miss subcategories, lean on negative
   examples.** If a subcategory has a negative example that resembles the
   customer's wording, that subcategory is the WRONG pick.

4. **Never invent IDs or slugs.** Only return values that appear above.

5. **Reasoning is for the audit log.** One sentence under 280 characters,
   citing which positive example / synonym / description sentence drove
   the pick.

6. **Confidence is self-reported.** Pick one of high/medium/low:
   - **high** — the description clearly maps to ONE subcategory (e.g.,
     a clear positive example match, a verbatim synonym, or a description
     that unambiguously matches the customer's wording).
   - **medium** — the subcategory is the best of 2-3 plausible picks
     (e.g., the description partially matches two subcategories'
     positive examples, and you picked the closer one).
   - **low** — the description doesn't really fit any subcategory in
     the list above, OR you're forcing a match because Stage 1 picked
     a category but the symptom doesn't quite fit any subcategory's
     description. Low is a signal to a downstream advisor to verify the
     routing.`;

  const dynamicText = `# Customer's pre-selection (context from Stage 1)

${buildChipHintLine(chipHint)}`;

  return [
    { type: "text", text: staticText, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamicText },
  ];
}

/**
 * Render a human-readable bulleted version of the ExtractedFacts slot
 * registry for the Stage 3 system prompt. JSON Schema constrains the
 * API; this is the authoring-facing reference paraphrasing slot
 * name + type + enum + description.
 */
function renderExtractedFactsSlotList(): string {
  const properties = EXTRACTED_FACTS_JSON_SCHEMA.properties as Record<
    string,
    {
      type?: readonly string[];
      enum?: readonly (string | null)[];
      description: string;
    }
  >;
  const lines: string[] = [];
  for (const [slot, def] of Object.entries(properties)) {
    const enumValues = def.enum
      ? def.enum.filter((v): v is string => v !== null)
      : null;
    const typeLabel = enumValues
      ? `enum(${enumValues.join("|")}) | null`
      : def.type
      ? `${def.type.filter((t) => t !== "null").join("|")} | null`
      : "unknown | null";
    lines.push(`- \`${slot}\` (${typeLabel})`);
    lines.push(`  ${def.description}`);
  }
  return lines.join("\n");
}

function categoryHeaderForStage3(cat: CatalogCategory): string {
  return isTestingService(cat)
    ? `service_key="${cat.service_key}" — ${cat.display_name}`
    : `subcategory_slug="${cat.subcategory_slug}" — ${cat.display_label}`;
}

// Stage 3 system prompt returned as a content-block array with cache_control
// on the static portion. The fact-extraction prompt is the most cache-
// effective of the three stages: header + CRITICAL RULE + 29-slot reference
// + worked examples are fully static across every call. Only the Stage 1/2
// result context block varies per call.
function buildStage3SystemPrompt(
  matchedSubcategory: CatalogSubcategory | null,
  matchedCategoryHeader: string,
): Anthropic.TextBlockParam[] {
  const subcategoryContextLine = matchedSubcategory
    ? `The customer's description has been matched to category:
  ${matchedCategoryHeader}
…and within that, to subcategory:
  subcategory_slug="${matchedSubcategory.slug}" — ${matchedSubcategory.display_label}${matchedSubcategory.description?.trim() ? `\n  Description: ${matchedSubcategory.description.trim()}` : ""}

This is context only — it tells you what KIND of facts will matter
downstream, but you should still extract only what the customer literally
stated regardless.`
    : `Subcategory context: not available (Stage 2 produced no slug). Extract
facts from the description anyway; downstream may still use them.`;

  const staticText = `You are the diagnostic FACT EXTRACTION helper for Jeff's Automotive
(Stage 3: fact extraction). A customer typed a free-text description of what's
wrong with their car. Your job: extract atomic facts from that description
into a typed object with ~29 nullable slots.

# CRITICAL RULE — only extract what the customer LITERALLY stated

You MUST NEVER invent, infer, or "fill in" facts beyond what the customer
literally wrote. If a slot's value is not clearly present in the customer's
description, the slot MUST be null. The downstream deterministic mapper
treats null as "not stated; still need to ask," which is the SAFE behavior —
asking a question is cheap; assuming a fact the customer didn't state and
SKIPPING the question is expensive (we miss a diagnostic signal).

Examples of WHAT NOT TO DO:
  - Customer says "my brakes squeal." DO NOT infer location_side or
    location_axle. Set noise_descriptor="squealing_high_pitched" and leave
    location_side / location_axle null.
  - Customer says "the car runs rough." DO NOT infer engine_running=
    "rough_idle" unless they specifically said the roughness was at idle.
    Leave engine_running null or set to a more general/honest value.
  - Customer says "shakes at highway speed." DO NOT set
    speed_specific_mph to a guessed number. Set speed_band="highway"
    and leave speed_specific_mph null.

When in doubt: leave the slot null. The mapper will surface that question
to the customer.

# Slot reference

Every slot below is nullable. \`null\` = "customer did not state this."
Slot names map to the JSON Schema property names; enums are the only valid
non-null values for enum-typed slots; free-text slots accept any string
the customer named.

${renderExtractedFactsSlotList()}

# Worked examples (description → expected extraction)

1. Customer: "Steering wheel shakes at exactly 65 mph."
   - speed_band: "specific_mph"
   - speed_specific_mph: 65
   - sound_or_smoke_location_zone: "behind_dashboard"   (steering wheel area)
   - onset_timing: null  (customer didn't say WHEN — just speed)
   - All other slots: null

2. Customer: "Heater core smells musty when I run the heat."
   - hvac_mode: "heat"
   - smell_descriptor: "musty_or_mildew"
   - All other slots: null

3. Customer: "AC works but smells like dirty socks when I first turn it on."
   - hvac_mode: "ac"
   - smell_descriptor: "musty_or_mildew"   ('dirty socks' is canonical musty)
   - onset_timing: "at_first_turn_on"
   - All other slots: null

4. Customer: "Loud grinding from the front right when I brake."
   - noise_descriptor: "grinding_metallic"
   - location_side: "right"
   - location_axle: "front"
   - onset_timing: "when_braking"
   - All other slots: null

5. Customer: "Car feels weird."
   - All slots: null. Description too vague to literally extract anything.

# Output

Return ALL ~29 slots (the JSON Schema requires them). For slots not
addressed by the description, return null.

Also return:
  - confidence: high/medium/low — how confident you are in the EXTRACTION
    QUALITY:
      * high — the description was clear enough that every fact you set is
        a literal unambiguous match.
      * medium — the description was clear but a couple of slots required a
        small judgment call between adjacent enum values.
      * low — the description was vague and you set most slots to null
        because the customer didn't literally state much.
  - reasoning: one sentence (keep under 280 characters) summarizing what
    you extracted and any judgment calls. Audit-only.`;

  const dynamicText = `# Stage 1/2 result context

${subcategoryContextLine}`;

  return [
    { type: "text", text: staticText, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamicText },
  ];
}

function buildUserPrompt(
  customerDescription: string,
  vehicleNotes: string | null,
): string {
  const parts: string[] = [
    `# Customer's description\n${customerDescription.trim()}`,
  ];
  if (vehicleNotes && vehicleNotes.trim().length > 0) {
    parts.push(
      `# Vehicle notes (from Step 6, may not be relevant)\n${vehicleNotes.trim()}`,
    );
  }
  return parts.join("\n\n");
}

/**
 * Total character count across all `text` fields of a content-block array.
 * Used to populate `system_prompt_chars` on stage observability blocks
 * (which previously read `.length` off a string prompt; the array shape
 * makes `.length` the block count instead of chars).
 */
function totalPromptChars(blocks: Anthropic.TextBlockParam[]): number {
  return blocks.reduce((sum, b) => sum + b.text.length, 0);
}

// ════════════════════════════════════════════════════════════════════
// ANTHROPIC SDK STAGE CALLER (with retry + Zod validation)
// ════════════════════════════════════════════════════════════════════

interface StageCallResult<T> {
  raw: T | null;
  rawJsonText: string | null;
  tokensIn: number;
  tokensOut: number;
  errorMessage: string | null;
  attempts: number;
}

async function callAnthropicStage<T>(args: {
  model: string;
  systemPrompt: Anthropic.TextBlockParam[];
  userPrompt: string;
  jsonSchema: Record<string, unknown>;
  zodSchema: z.ZodType<T>;
}): Promise<StageCallResult<T>> {
  let lastError: Error | null = null;
  let attempts = 0;

  for (let attempt = 0; attempt < 2; attempt++) {
    attempts = attempt + 1;
    try {
      const msg = await anthropic.messages.create({
        model: args.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
        // Array-form system prompt with cache_control on the static
        // portion — see buildStage{1,2,3}SystemPrompt for the split.
        // Anthropic prompt caching docs:
        // https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
        // String-form system prompts silently disable caching. We do NOT
        // also pass providerOptions.gateway.caching='auto' — picking one
        // marker (explicit cache_control) avoids double-marking.
        system: args.systemPrompt,
        messages: [{ role: "user", content: args.userPrompt }],
        // Vercel AI Gateway model-fallback extension — gateway interprets
        // this via the proxy layer; the Anthropic SDK passes through
        // untouched. caching:'auto' deliberately omitted (see above).
        // @ts-expect-error - gateway extensions not in Anthropic SDK types
        providerOptions: {
          gateway: {
            models: [args.model, FALLBACK_MODEL],
          },
        },
        output_format: {
          type: "json_schema",
          schema: args.jsonSchema,
        },
        betas: [STRUCTURED_OUTPUTS_BETA],
      });

      const textBlock = msg.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("no_text_block_in_response");
      }
      const rawJsonText = textBlock.text;
      const parsedJson = JSON.parse(rawJsonText) as unknown;
      const validated = args.zodSchema.parse(parsedJson);
      return {
        raw: validated,
        rawJsonText,
        tokensIn: msg.usage?.input_tokens ?? 0,
        tokensOut: msg.usage?.output_tokens ?? 0,
        errorMessage: null,
        attempts,
      };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  return {
    raw: null,
    rawJsonText: null,
    tokensIn: 0,
    tokensOut: 0,
    errorMessage: lastError?.message ?? "unknown_error",
    attempts,
  };
}

// ════════════════════════════════════════════════════════════════════
// VALIDATION HELPERS
// ════════════════════════════════════════════════════════════════════

function findMatchedCategory(
  catalog: DiagnosticCatalog,
  matchedKey: string | null,
): CatalogCategory | null {
  if (!matchedKey) return null;
  for (const c of catalog.categories) {
    if (isTestingService(c) && c.service_key === matchedKey) return c;
    if (isOtherSubcategory(c) && c.subcategory_slug === matchedKey) return c;
  }
  return null;
}

function findMatchedSubcategory(
  cat: CatalogCategory,
  slug: string | null,
): CatalogSubcategory | null {
  if (!slug) return null;
  if (isOtherSubcategory(cat)) {
    if (cat.subcategory_slug !== slug) return null;
    return {
      slug: cat.subcategory_slug,
      display_label: cat.display_label,
      concern_category: "other",
      eligible_testing_service_keys: [],
      description: "",
      positive_examples: [],
      negative_examples: [],
      synonyms: [],
      questions: cat.questions,
    };
  }
  return cat.subcategories.find((s) => s.slug === slug) ?? null;
}

function collectAllCategoryQuestionIds(cat: CatalogCategory): number[] {
  if (isOtherSubcategory(cat)) {
    return cat.questions.map((q) => q.id).sort((a, b) => a - b);
  }
  const ids: number[] = [];
  for (const s of cat.subcategories) {
    for (const q of s.questions) ids.push(q.id);
  }
  return Array.from(new Set(ids)).sort((a, b) => a - b);
}

// ════════════════════════════════════════════════════════════════════
// HTTP HANDLER
// ════════════════════════════════════════════════════════════════════

function corsResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const ARCH_LABEL = "three-stage-anthropic-sdk-native-structured-outputs";

// PLAN-02 Phase 1 — per-request Sentry isolation scope + flush before response.
Deno.serve((req) => withSentryScope(req, "llm-testing", async () => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method === "GET") {
    return corsResp({
      ok: true,
      function: "llm-testing",
      version: "0.5.0",
      arch: ARCH_LABEL,
      stage1_model: STAGE1_MODEL,
      stage2_model: STAGE2_MODEL,
      stage3_model: STAGE3_MODEL,
      structured_outputs_beta: STRUCTURED_OUTPUTS_BETA,
      hint: "POST { concern_text, chip_hint? } to run one concern through the three-stage diagnostic LLM (category → subcategory → fact-extract → mapper).",
    });
  }

  if (req.method !== "POST") {
    return corsResp({ ok: false, error: "method_not_allowed" }, 405);
  }

  let body: {
    concern_text?: string;
    chip_hint?: ChipHint | null;
    vehicle_notes?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return corsResp({ ok: false, error: "invalid_json" }, 400);
  }

  const concernText = (body.concern_text ?? "").trim();
  if (concernText.length === 0) {
    return corsResp(
      { ok: false, error: "missing 'concern_text' (non-empty string required)" },
      400,
    );
  }

  const chipHint = body.chip_hint ?? {
    chip_service_key: "other_issue",
    chip_display_name: "Other issue",
    chip_concern_categories: [],
  };
  const vehicleNotes = body.vehicle_notes ?? null;

  const catalog = await getCatalog();
  const testingCount = catalog.categories.filter(isTestingService).length;
  const otherCount = catalog.categories.filter(isOtherSubcategory).length;

  const t0 = Date.now();
  if (concernText.length < 3) {
    return corsResp({
      ok: true,
      arch: ARCH_LABEL,
      catalog_size: catalog.categories.length,
      testing_service_count: testingCount,
      other_subcategory_count: otherCount,
      stage1: null,
      stage2: null,
      stage3: null,
      mapper: null,
      validated: {
        matched_category_key: null,
        matched_kind: null,
        matched_subcategory_slug: null,
        unanswered_question_ids: [],
        recommended_testing_service: null,
      },
      latency_ms: Date.now() - t0,
      tokens_in: 0,
      tokens_out: 0,
      error_message: "SHORT_CIRCUIT (desc<3 chars)",
    });
  }

  // ── Stage 1 ────────────────────────────────────────────────────────
  const stage1SystemPrompt = buildStage1SystemPrompt(catalog, chipHint);
  const userPrompt = buildUserPrompt(concernText, vehicleNotes);

  const s1Start = Date.now();
  const stage1Result = await callAnthropicStage({
    model: STAGE1_MODEL,
    systemPrompt: stage1SystemPrompt,
    userPrompt,
    jsonSchema: STAGE1_JSON_SCHEMA,
    zodSchema: Stage1ResponseSchema,
  });
  const stage1Block = {
    model: STAGE1_MODEL,
    raw: stage1Result.raw,
    validated_category_key: null as string | null,
    system_prompt_chars: totalPromptChars(stage1SystemPrompt),
    latency_ms: Date.now() - s1Start,
    tokens_in: stage1Result.tokensIn,
    tokens_out: stage1Result.tokensOut,
    error_message: stage1Result.errorMessage,
    attempts: stage1Result.attempts,
  };

  // Validate Stage 1 against catalog
  const matchedCat = findMatchedCategory(
    catalog,
    stage1Result.raw?.matched_category_key ?? null,
  );
  stage1Block.validated_category_key = matchedCat
    ? isTestingService(matchedCat)
      ? matchedCat.service_key
      : matchedCat.subcategory_slug
    : null;

  if (!matchedCat) {
    let topErr: string | null = null;
    if (stage1Block.error_message) {
      topErr = `stage1_failed: ${stage1Block.error_message.slice(0, 200)}`;
    } else if (stage1Result.raw?.matched_category_key) {
      topErr = `invalid_category_key:${stage1Result.raw.matched_category_key.slice(0, 50)}`;
    }
    return corsResp({
      ok: true,
      arch: ARCH_LABEL,
      catalog_size: catalog.categories.length,
      testing_service_count: testingCount,
      other_subcategory_count: otherCount,
      stage1: stage1Block,
      stage2: null,
      stage3: null,
      mapper: null,
      validated: {
        matched_category_key: null,
        matched_kind: null,
        matched_subcategory_slug: null,
        unanswered_question_ids: [],
        recommended_testing_service: null,
      },
      latency_ms: Date.now() - t0,
      tokens_in: stage1Block.tokens_in,
      tokens_out: stage1Block.tokens_out,
      error_message: topErr,
    });
  }

  // ── Stage 2 ────────────────────────────────────────────────────────
  const stage2SystemPrompt = buildStage2SystemPrompt(matchedCat, chipHint);
  const s2Start = Date.now();
  const stage2Result = await callAnthropicStage({
    model: STAGE2_MODEL,
    systemPrompt: stage2SystemPrompt,
    userPrompt,
    jsonSchema: STAGE2_JSON_SCHEMA,
    zodSchema: Stage2ResponseSchema,
  });

  // Validate Stage 2 subcategory against eligible set
  const matchedSub = findMatchedSubcategory(
    matchedCat,
    stage2Result.raw?.matched_subcategory_slug ?? null,
  );
  const subSlug = matchedSub?.slug ?? null;

  const stage2Block = {
    model: STAGE2_MODEL,
    raw: stage2Result.raw,
    validated_subcategory_slug: subSlug,
    system_prompt_chars: totalPromptChars(stage2SystemPrompt),
    latency_ms: Date.now() - s2Start,
    tokens_in: stage2Result.tokensIn,
    tokens_out: stage2Result.tokensOut,
    error_message: stage2Result.errorMessage,
    attempts: stage2Result.attempts,
  };

  // Stage 2 fallback paths (LLM call failed or invalid slug return):
  // recommend the testing service (if any) so the customer still gets a
  // price, but no subcategory + no Stage 3 + no mapper.
  if (!stage2Result.raw) {
    const recommended = isTestingService(matchedCat)
      ? {
          service_key: matchedCat.service_key,
          display_name: matchedCat.display_name,
          starting_price_cents: matchedCat.starting_price_cents,
        }
      : null;
    return corsResp({
      ok: true,
      arch: ARCH_LABEL,
      catalog_size: catalog.categories.length,
      testing_service_count: testingCount,
      other_subcategory_count: otherCount,
      stage1: stage1Block,
      stage2: stage2Block,
      stage3: null,
      mapper: null,
      validated: {
        matched_category_key: isTestingService(matchedCat)
          ? matchedCat.service_key
          : matchedCat.subcategory_slug,
        matched_kind: isTestingService(matchedCat)
          ? ("testing_service" as const)
          : ("other_subcategory" as const),
        matched_subcategory_slug: null,
        unanswered_question_ids: [],
        recommended_testing_service: recommended,
      },
      latency_ms: Date.now() - t0,
      tokens_in: stage1Block.tokens_in + stage2Block.tokens_in,
      tokens_out: stage1Block.tokens_out + stage2Block.tokens_out,
      error_message: stage2Block.error_message
        ? `stage2_failed: ${stage2Block.error_message.slice(0, 200)}`
        : null,
    });
  }

  // ── Stage 3 ────────────────────────────────────────────────────────
  const stage3SystemPrompt = buildStage3SystemPrompt(
    matchedSub,
    categoryHeaderForStage3(matchedCat),
  );
  const s3Start = Date.now();
  const stage3Result = await callAnthropicStage({
    model: STAGE3_MODEL,
    systemPrompt: stage3SystemPrompt,
    userPrompt,
    jsonSchema: STAGE3_JSON_SCHEMA,
    zodSchema: Stage3ResponseSchema,
  });

  const stage3Block = {
    model: STAGE3_MODEL,
    raw: stage3Result.raw,
    extracted_facts: stage3Result.raw?.extracted_facts ?? null,
    system_prompt_chars: totalPromptChars(stage3SystemPrompt),
    latency_ms: Date.now() - s3Start,
    tokens_in: stage3Result.tokensIn,
    tokens_out: stage3Result.tokensOut,
    error_message: stage3Result.errorMessage,
    attempts: stage3Result.attempts,
  };

  // Stage 3 fallback: safe over-ask — every question in the matched
  // subcategory marked unanswered (or every question in the matched
  // category if no matched subcategory). No mapper output.
  if (!stage3Result.raw) {
    let unansweredIds: number[];
    if (matchedSub) {
      unansweredIds = matchedSub.questions.map((q) => q.id).sort((a, b) => a - b);
    } else {
      unansweredIds = collectAllCategoryQuestionIds(matchedCat);
    }
    return corsResp({
      ok: true,
      arch: ARCH_LABEL,
      catalog_size: catalog.categories.length,
      testing_service_count: testingCount,
      other_subcategory_count: otherCount,
      stage1: stage1Block,
      stage2: stage2Block,
      stage3: stage3Block,
      mapper: null,
      validated: {
        matched_category_key: isTestingService(matchedCat)
          ? matchedCat.service_key
          : matchedCat.subcategory_slug,
        matched_kind: isTestingService(matchedCat)
          ? ("testing_service" as const)
          : ("other_subcategory" as const),
        matched_subcategory_slug: subSlug,
        unanswered_question_ids: unansweredIds,
        recommended_testing_service: isTestingService(matchedCat)
          ? {
              service_key: matchedCat.service_key,
              display_name: matchedCat.display_name,
              starting_price_cents: matchedCat.starting_price_cents,
            }
          : null,
      },
      latency_ms: Date.now() - t0,
      tokens_in:
        stage1Block.tokens_in + stage2Block.tokens_in + stage3Block.tokens_in,
      tokens_out:
        stage1Block.tokens_out + stage2Block.tokens_out + stage3Block.tokens_out,
      error_message: stage3Block.error_message
        ? `stage3_failed: ${stage3Block.error_message.slice(0, 200)}`
        : null,
    });
  }

  // ── Deterministic mapper ───────────────────────────────────────────
  //
  // v1 behavior: ambiguous ∪ unanswered surfaced as unanswered (safe
  // over-ask). If no matched subcategory, fall back to all-category-
  // questions as unanswered.
  let mapperBlock: QuestionFactMatcherOutput | null = null;
  let unansweredIds: number[];
  const extractedFacts = stage3Result.raw.extracted_facts;
  if (matchedSub) {
    const questionsForMapper: QuestionForFactMatch[] = matchedSub.questions.map(
      (q) => ({
        id: q.id,
        required_facts: q.required_facts,
      }),
    );
    const mapperResult = matchQuestionsToFacts({
      extracted_facts: extractedFacts,
      questions: questionsForMapper,
    });
    mapperBlock = mapperResult;
    // v1: ambiguous is treated as unanswered (over-ask).
    unansweredIds = Array.from(
      new Set([...mapperResult.unanswered_ids, ...mapperResult.ambiguous_ids]),
    ).sort((a, b) => a - b);
  } else {
    // Stage 2 returned null or invalid slug; safe over-ask.
    unansweredIds = collectAllCategoryQuestionIds(matchedCat);
  }

  const validated = {
    matched_category_key: isTestingService(matchedCat)
      ? matchedCat.service_key
      : matchedCat.subcategory_slug,
    matched_kind: isTestingService(matchedCat)
      ? ("testing_service" as const)
      : ("other_subcategory" as const),
    matched_subcategory_slug: subSlug,
    unanswered_question_ids: unansweredIds,
    recommended_testing_service: isTestingService(matchedCat)
      ? {
          service_key: matchedCat.service_key,
          display_name: matchedCat.display_name,
          starting_price_cents: matchedCat.starting_price_cents,
        }
      : null,
  };

  return corsResp({
    ok: true,
    arch: ARCH_LABEL,
    catalog_size: catalog.categories.length,
    testing_service_count: testingCount,
    other_subcategory_count: otherCount,
    stage1: stage1Block,
    stage2: stage2Block,
    stage3: stage3Block,
    mapper: mapperBlock,
    validated,
    latency_ms: Date.now() - t0,
    tokens_in:
      stage1Block.tokens_in + stage2Block.tokens_in + stage3Block.tokens_in,
    tokens_out:
      stage1Block.tokens_out + stage2Block.tokens_out + stage3Block.tokens_out,
    error_message: null,
  });
}));
