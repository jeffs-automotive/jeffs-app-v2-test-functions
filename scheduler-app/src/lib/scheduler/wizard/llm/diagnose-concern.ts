/**
 * diagnoseConcern — Three-stage diagnostic classifier (Path C: Anthropic SDK
 * + Vercel AI Gateway + native structured outputs).
 *
 * Refactored 2026-05-21 from a two-stage (category + subcategory-with-gap-
 * detect) flow to a three-stage flow:
 *
 *   Stage 1 — Match category (UNCHANGED)
 *     Brief catalog (~5-8 KB) → matched_category_key + reasoning +
 *     stage1_confidence. Same prompt + JSON Schema + Zod schema as the
 *     two-stage flow; only its place in the pipeline changed.
 *
 *   Stage 2 — Pick subcategory (NEW SHAPE — split out from old Stage 2)
 *     Single category's subtree (~3-15 KB) WITH enriched subcategory
 *     descriptions + positive/negative examples + synonyms (NEW
 *     2026-05-21 columns) → matched_subcategory_slug + reasoning +
 *     stage2_confidence. NO question text. NO gap-detect. Subcategory
 *     pick ONLY.
 *
 *   Stage 3 — Extract facts (NEW)
 *     Customer description + EXTRACTED_FACTS_JSON_SCHEMA → flat
 *     ExtractedFacts object of ~29 nullable slots + stage3_confidence.
 *     Does NOT see the question text. Extracts ONLY what the customer
 *     literally stated.
 *
 *   Deterministic mapper (pure TS, no LLM — see ./question-fact-mapper.ts)
 *     After Stage 3, matchQuestionsToFacts() takes the extracted facts
 *     + the matched subcategory's questions and partitions them into
 *     answered / ambiguous / unanswered buckets via the
 *     required_facts[] tag on each question.
 *
 * Why three stages instead of two:
 *   - Old Stage 2 was carrying TWO responsibilities (subcategory pick +
 *     question gap-detect). Stage 2's confidence enum was muddled because
 *     "low" could mean "I'm unsure about the subcategory" OR "I'm unsure
 *     which questions the customer answered." Splitting separates the
 *     two signals.
 *   - Fact extraction is now a self-contained, evaluatable surface (the
 *     LLM extracts FACTS the customer literally stated, with zero
 *     dependency on the question catalog's wording). Once fact extraction
 *     is right, the deterministic mapper handles gap-detect with 100%
 *     reproducibility — no LLM in the gap-detect critical path.
 *   - Enables future per-question fallback (when ambiguous_ids is
 *     non-empty, we could route to a per-question LLM check). v1 of
 *     this three-stage refactor treats ambiguous as unanswered (safe
 *     over-ask).
 *
 * Why this architecture (unchanged from prior refactor):
 *   - @ai-sdk/gateway's generateObject path has documented bugs with
 *     Anthropic structured outputs (#13460, #13355, #14342). The
 *     Anthropic SDK direct path is clean.
 *   - Anthropic's native Structured Outputs API (output_format +
 *     structured-outputs-2025-11-13 beta) uses constrained decoding for
 *     guaranteed schema compliance, similar to OpenAI's strict mode.
 *     Documented <0.1% failure rate.
 *   - We still benefit from the Vercel AI Gateway: prompt caching,
 *     multi-model fallback chains, observability, single credential,
 *     unified billing.
 *
 * Zod retained for:
 *   1. TypeScript type inference (z.infer<typeof Schema>)
 *   2. Post-LLM defense-in-depth validation
 * Zod is NOT in the LLM-call path. JSON Schema (raw object literals)
 * is the source of truth for the API.
 *
 * Model: anthropic/claude-haiku-4-5 default. Per-stage env overrides
 * via DIAGNOSE_CONCERN_STAGE1_MODEL / DIAGNOSE_CONCERN_STAGE2_MODEL /
 * DIAGNOSE_CONCERN_STAGE3_MODEL. Combined legacy override:
 * DIAGNOSE_CONCERN_MODEL.
 *
 * Gateway extensions enabled:
 *   - providerOptions.gateway.caching = 'auto'
 *     Auto-inserts Anthropic cache_control markers on the system prompt.
 *   - providerOptions.gateway.models = ['<primary>', '<fallback>']
 *     If primary model fails (incl. schema failures), gateway cascades.
 *
 * Reliability features:
 *   - Retry once on transient failure (covers occasional gateway 5xx +
 *     non-deterministic schema-compliance edge cases) per stage.
 *   - Per-stage error semantics preserved:
 *       - Stage 1 failure → safe-null result.
 *       - Stage 2 failure → testing service still recommended, no
 *         subcategory, no questions asked.
 *       - Stage 3 failure → safe over-ask (every catalog question
 *         marked unanswered).
 *
 * Public API contract:
 *   - diagnoseConcern() signature UNCHANGED.
 *   - DiagnoseConcernResult shape ADDITIVE: new fields
 *       extracted_facts (ExtractedFacts | null)
 *       stage3_confidence ("high" | "medium" | "low")
 *     Callers that don't read these fields are unaffected. The wizard's
 *     downstream code reads recommended_testing_service +
 *     unanswered_question_ids — both still populated.
 *
 * Legacy buildSystemPrompt / buildUserPrompt exports retained as
 * aliases pointing at the Stage 1 prompt — for the eval harness that
 * captures prompt-inspection reports.
 */
import Anthropic from "@anthropic-ai/sdk";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import {
  EXTRACTED_FACTS_JSON_SCHEMA,
  ExtractedFactsSchema,
  type ExtractedFacts,
} from "./extracted-facts";
import type {
  CatalogCategory,
  CatalogSubcategory,
  DiagnosticCatalog,
  TestingServiceCategory,
} from "./load-diagnostic-catalog";
import {
  isOtherSubcategory,
  isTestingService,
} from "./load-diagnostic-catalog";
import {
  matchQuestionsToFacts,
  type QuestionForFactMatch,
} from "./question-fact-mapper";

// ─── Model + token budgets ──────────────────────────────────────────────────

const DEFAULT_MODEL = "anthropic/claude-haiku-4-5";
const FALLBACK_MODEL = "anthropic/claude-sonnet-4-6";
const MAX_OUTPUT_TOKENS = 1024;
const STRUCTURED_OUTPUTS_BETA = "structured-outputs-2025-11-13";

function resolveStage1Model(): string {
  return (
    process.env.DIAGNOSE_CONCERN_STAGE1_MODEL ||
    process.env.DIAGNOSE_CONCERN_MODEL ||
    DEFAULT_MODEL
  );
}

function resolveStage2Model(): string {
  return (
    process.env.DIAGNOSE_CONCERN_STAGE2_MODEL ||
    process.env.DIAGNOSE_CONCERN_MODEL ||
    DEFAULT_MODEL
  );
}

function resolveStage3Model(): string {
  return (
    process.env.DIAGNOSE_CONCERN_STAGE3_MODEL ||
    process.env.DIAGNOSE_CONCERN_MODEL ||
    DEFAULT_MODEL
  );
}

// ─── Anthropic client (gateway-routed) ──────────────────────────────────────

const anthropic = new Anthropic({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN,
  baseURL: "https://ai-gateway.vercel.sh",
});

// ─── Public argument + result types ─────────────────────────────────────────

export interface DiagnoseConcernChipHint {
  chip_service_key: string;
  chip_display_name: string;
  chip_concern_categories: string[];
}

export interface DiagnoseConcernArgs {
  catalog: DiagnosticCatalog;
  customer_description: string;
  customer_chip_hint?: DiagnoseConcernChipHint | null;
  vehicle_notes?: string | null;
}

export interface DiagnoseConcernResult {
  matched_category_key: string | null;
  matched_kind: "testing_service" | "other_subcategory" | null;
  matched_subcategory_slug: string | null;
  recommended_testing_service: {
    service_key: string;
    display_name: string;
    description: string | null;
    starting_price_cents: number;
  } | null;
  unanswered_question_ids: number[];
  /** Facts the LLM extracted from the description in Stage 3. Available
   *  for debugging + admin audit. `null` when Stage 3 didn't run (no
   *  matched subcategory, short-circuit on empty description, or
   *  Stage 1/2 failure). Added 2026-05-21 with the three-stage refactor. */
  extracted_facts: ExtractedFacts | null;
  /** Self-reported confidence from Stage 1 (category pick). 'low' on
   *  failure / null match. Leading signal for routing to advisor handoff
   *  when the LLM is unsure. */
  stage1_confidence: "high" | "medium" | "low";
  /** Self-reported confidence from Stage 2 (subcategory pick — NO
   *  gap-detect now lives here as of 2026-05-21). 'low' when Stage 2
   *  didn't run (no Stage 1 match) or failed. */
  stage2_confidence: "high" | "medium" | "low";
  /** Self-reported confidence from Stage 3 (fact extraction). 'low' when
   *  Stage 3 didn't run (Stage 1 or 2 failed, or no matched subcategory)
   *  OR when Stage 3 ran but the LLM self-rated the extraction as low
   *  confidence. Added 2026-05-21 with the three-stage refactor. */
  stage3_confidence: "high" | "medium" | "low";
  parsed_ok: boolean;
  model: string;
  latency_ms: number;
  tokens_in: number;
  tokens_out: number;
  error_message: string;
}

// ─── JSON Schemas (LLM source of truth — no Zod here) ──────────────────────
//
// These are intentionally CONSTRAINT-LIGHT. We avoid:
//   - minimum / maximum / exclusiveMinimum / exclusiveMaximum on numbers
//   - maxLength / minLength on strings
//   - not / if / then / else
// Per vercel/ai #14342 and Anthropic API behavior, these keywords are
// either rejected by the API or unsupported in constrained-decoding mode.
// We push length / range constraints into description text (the model
// honors them) and into post-LLM Zod validation (belt-and-suspenders).
//
// Nullable fields use the JSON Schema standard `type: ['string', 'null']`
// — Anthropic supports this directly.

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
} as const;

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
} as const;

// Stage 3 wraps the canonical EXTRACTED_FACTS_JSON_SCHEMA from
// extracted-facts.ts. The wrapper adds confidence + reasoning. The
// `extracted_facts` property's schema IS the EXTRACTED_FACTS_JSON_SCHEMA
// verbatim — same shape both files agree on as the source of truth for
// the 29 fact slots.
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
} as const;

// ─── Zod schemas (client-side validation + TS type inference only) ────────
//
// These are NOT sent to the LLM. They mirror the JSON Schemas above and
// serve two purposes:
//   1. TypeScript type inference via z.infer<typeof Schema>
//   2. Post-LLM runtime validation (defense in depth — catches any
//      drift between Anthropic's constrained-decoding output and our
//      expected shape)

/** Confidence buckets the LLM self-reports per stage. Discrete enum rather
 *  than a 0-1 number because (a) Anthropic constrained-decoding handles
 *  enums cleanly, (b) discrete buckets avoid false-precision in self-report,
 *  (c) downstream branching becomes a clean switch on three values. */
export type DiagnoseConcernConfidence = "high" | "medium" | "low";

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

type Stage1Response = z.infer<typeof Stage1ResponseSchema>;
type Stage2Response = z.infer<typeof Stage2ResponseSchema>;
type Stage3Response = z.infer<typeof Stage3ResponseSchema>;

// ─── Formatting helpers ─────────────────────────────────────────────────────

function fmtPriceForLLM(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
}

function buildChipHintLine(
  chipHint: DiagnoseConcernChipHint | null | undefined,
): string {
  if (!chipHint) {
    return "No chip hint — classify from description alone.";
  }
  if (chipHint.chip_service_key === "other_issue") {
    return (
      `The customer picked the "💬 Other Issue" pseudo-chip — no pre-` +
      `classification; classify from description alone, considering all ` +
      `categories.`
    );
  }
  return (
    `The customer picked the "${chipHint.chip_display_name}" chip (related ` +
    `concern_categories: ${chipHint.chip_concern_categories.join(", ") || "none"}). ` +
    `Use this as a soft prior — prefer categories tagged with one of those ` +
    `concern_categories unless the description clearly says otherwise.`
  );
}

// ─── Stage 1 system prompt (brief catalog, no subcategory tree) ─────────────

export function buildStage1SystemPrompt(args: DiagnoseConcernArgs): string {
  const testingServices = args.catalog.categories.filter(isTestingService);
  const otherSubcategories = args.catalog.categories.filter(isOtherSubcategory);

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

  const chipHintLine = buildChipHintLine(args.customer_chip_hint);

  return `You are the diagnostic categorisation helper for Jeff's Automotive
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

# Customer's pre-selection (context)

${chipHintLine}

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
}

// ─── Stage 2 system prompt (ONE category's subcategories — NO question text) ─

export function buildStage2SystemPrompt(
  matchedCategory: CatalogCategory,
  customerChipHint: DiagnoseConcernChipHint | null | undefined,
): string {
  // For 'other' matches the category IS a single subcategory; synthesize a
  // singleton list so the LLM still picks-from-N (where N=1 here). The
  // synthesized subcategory carries no enrichment metadata because the
  // 'other' path doesn't go through concern_subcategories; we use the
  // display label as the only signal.
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

  const matchedCategoryHeader = isTestingService(matchedCategory)
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

  const chipHintLine = buildChipHintLine(customerChipHint);

  return `You are the diagnostic categorisation helper for Jeff's Automotive
(Stage 2: subcategory pick). Stage 1 already matched the customer's
description to a category:

  ${matchedCategoryHeader}

Your job: pick the ONE subcategory below whose meaning best matches the
customer's symptoms. The subcategory MUST be one of the slugs listed below.
${subcategories.length === 1 ? "(For 'other' matches there is only ONE choice — pick it.)" : ""}

NOTE: You do NOT see the per-question text here, and you are NOT being asked
to figure out which questions the customer already answered. That's
Stage 3's job (deterministic mapper). All you need to do here is pick the
RIGHT subcategory for downstream Stage-3 fact extraction + mapping to use.

# Subcategory catalog (this category only)

${subcategoryBlock}

# Customer's pre-selection (context from Stage 1)

${chipHintLine}

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
}

// ─── Stage 3 system prompt (fact extraction — no question text) ────────────

/**
 * Render a human-readable, bulleted version of the ExtractedFacts slot
 * registry for the Stage 3 system prompt. We don't paste the full JSON
 * Schema (which is what the API constrains on); instead we paraphrase the
 * slot name + type + enum values + description text so the LLM can SCAN
 * the slot list quickly.
 *
 * The JSON Schema is still what the API enforces — this is just the
 * authoring-facing reference. Keeping the two in sync is a manual
 * concern (both come from extracted-facts.ts; if you add a slot there,
 * this prompt automatically picks it up via the iteration below).
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
    // Strip the trailing `null` from enum lists (it's there for the JSON
    // Schema validator; the LLM doesn't need to see "null" listed as a
    // valid value separately from the type union).
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

export function buildStage3SystemPrompt(
  matchedSubcategory: CatalogSubcategory | null,
  matchedCategoryHeader: string,
): string {
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

  return `You are the diagnostic FACT EXTRACTION helper for Jeff's Automotive
(Stage 3: fact extraction). A customer typed a free-text description of what's
wrong with their car. Your job: extract atomic facts from that description
into a typed object with ~29 nullable slots.

${subcategoryContextLine}

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
}

// ─── Shared user prompt ─────────────────────────────────────────────────────

export function buildUserPrompt(args: DiagnoseConcernArgs): string {
  const parts: string[] = [
    `# Customer's description\n${args.customer_description.trim()}`,
  ];
  if (args.vehicle_notes && args.vehicle_notes.trim().length > 0) {
    parts.push(
      `# Vehicle notes (from Step 6, may not be relevant)\n${args.vehicle_notes.trim()}`,
    );
  }
  return parts.join("\n\n");
}

// Legacy alias for eval harness back-compat.
export function buildSystemPrompt(args: DiagnoseConcernArgs): string {
  return buildStage1SystemPrompt(args);
}

// ─── Catalog validation helpers ─────────────────────────────────────────────

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
    // Synthesize the same singleton subcategory we feed the Stage 2 prompt.
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
    return cat.questions.map((q) => q.id);
  }
  const ids: number[] = [];
  for (const s of cat.subcategories) {
    for (const q of s.questions) ids.push(q.id);
  }
  return Array.from(new Set(ids)).sort((a, b) => a - b);
}

function buildTestingServicePayload(
  cat: TestingServiceCategory,
): NonNullable<DiagnoseConcernResult["recommended_testing_service"]> {
  return {
    service_key: cat.service_key,
    display_name: cat.display_name,
    description: cat.description,
    starting_price_cents: cat.starting_price_cents,
  };
}

function categoryHeaderForStage3(cat: CatalogCategory): string {
  return isTestingService(cat)
    ? `service_key="${cat.service_key}" — ${cat.display_name}`
    : `subcategory_slug="${cat.subcategory_slug}" — ${cat.display_label}`;
}

// ─── Anthropic SDK call wrapper (with retry + Zod validation) ──────────────

interface CallResult<T> {
  data: T | null;
  tokensIn: number;
  tokensOut: number;
  errorMessage: string | null;
}

async function callAnthropicStage<T>(args: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  jsonSchema: Record<string, unknown>;
  zodSchema: z.ZodType<T>;
  stage: 1 | 2 | 3;
}): Promise<CallResult<T>> {
  let lastError: Error | null = null;

  // Two attempts: covers occasional transient gateway 5xx + non-determi-
  // nistic structured-output edge cases. Anthropic's constrained decoding
  // is documented near-deterministic, so a second attempt with identical
  // input usually succeeds when the first didn't.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const msg = await anthropic.messages.create({
        model: args.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
        system: args.systemPrompt,
        messages: [{ role: "user", content: args.userPrompt }],
        // Vercel AI Gateway extensions — gateway interprets these via the
        // proxy layer; the Anthropic SDK passes them through untouched.
        // @ts-expect-error - gateway extensions not in Anthropic SDK types
        providerOptions: {
          gateway: {
            caching: "auto",
            models: [args.model, FALLBACK_MODEL],
          },
        },
        // Anthropic native Structured Outputs (beta as of 2025-11-13, GA
        // per Vercel AI Gateway docs). Uses constrained decoding for
        // guaranteed schema compliance. The SDK types added support
        // for `output_format` in 0.97; no @ts-expect-error needed.
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
      const parsedJson = JSON.parse(textBlock.text) as unknown;
      const validated = args.zodSchema.parse(parsedJson);
      return {
        data: validated,
        tokensIn: msg.usage?.input_tokens ?? 0,
        tokensOut: msg.usage?.output_tokens ?? 0,
        errorMessage: null,
      };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      // Defensive Sentry capture; ignored if Sentry isn't initialized.
      try {
        Sentry.captureException(lastError, {
          tags: {
            surface: "diagnose_concern_llm",
            stage: String(args.stage),
            attempt: String(attempt),
          },
          level: "warning",
        });
      } catch {
        // Sentry unavailable — proceed.
      }
    }
  }
  return {
    data: null,
    tokensIn: 0,
    tokensOut: 0,
    errorMessage: lastError?.message ?? "unknown_error",
  };
}

// ─── Main three-stage entry point ───────────────────────────────────────────

export async function diagnoseConcern(
  args: DiagnoseConcernArgs,
): Promise<DiagnoseConcernResult> {
  const stage1Model = resolveStage1Model();
  const stage2Model = resolveStage2Model();
  const stage3Model = resolveStage3Model();
  const startedAt = Date.now();

  let tokensIn = 0;
  let tokensOut = 0;

  const failSafe = (errorMessage: string): DiagnoseConcernResult => ({
    matched_category_key: null,
    matched_kind: null,
    matched_subcategory_slug: null,
    recommended_testing_service: null,
    unanswered_question_ids: [],
    extracted_facts: null,
    stage1_confidence: "low",
    stage2_confidence: "low",
    stage3_confidence: "low",
    parsed_ok: false,
    model: stage1Model,
    latency_ms: Date.now() - startedAt,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    error_message: errorMessage,
  });

  const desc = (args.customer_description ?? "").trim();
  if (desc.length < 3) {
    return {
      matched_category_key: null,
      matched_kind: null,
      matched_subcategory_slug: null,
      recommended_testing_service: null,
      unanswered_question_ids: [],
      extracted_facts: null,
      stage1_confidence: "low",
      stage2_confidence: "low",
      stage3_confidence: "low",
      parsed_ok: true,
      model: stage1Model,
      latency_ms: 0,
      tokens_in: 0,
      tokens_out: 0,
      error_message: "",
    };
  }
  if (args.catalog.categories.length === 0) {
    return failSafe("empty_catalog");
  }

  // ════════════════════════════════════════════════════════════════════
  // STAGE 1 — Match category
  // ════════════════════════════════════════════════════════════════════

  Sentry.addBreadcrumb({
    category: "scheduler.diagnose.stage1",
    type: "info",
    level: "info",
    message: "Stage 1 dispatch",
    data: { stage1_model: stage1Model, description_chars: desc.length },
  });

  const stage1Result = await callAnthropicStage<Stage1Response>({
    model: stage1Model,
    systemPrompt: buildStage1SystemPrompt(args),
    userPrompt: buildUserPrompt(args),
    jsonSchema: STAGE1_JSON_SCHEMA as unknown as Record<string, unknown>,
    zodSchema: Stage1ResponseSchema,
    stage: 1,
  });
  tokensIn += stage1Result.tokensIn;
  tokensOut += stage1Result.tokensOut;

  if (!stage1Result.data) {
    return failSafe(`stage1_failed: ${stage1Result.errorMessage}`);
  }

  // Validate Stage 1 output against the catalog.
  const matchedCat = findMatchedCategory(
    args.catalog,
    stage1Result.data.matched_category_key,
  );
  if (!matchedCat) {
    return {
      matched_category_key: null,
      matched_kind: null,
      matched_subcategory_slug: null,
      recommended_testing_service: null,
      unanswered_question_ids: [],
      extracted_facts: null,
      stage1_confidence: stage1Result.data.confidence,
      stage2_confidence: "low",
      stage3_confidence: "low",
      parsed_ok: true,
      model: stage1Model,
      latency_ms: Date.now() - startedAt,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      error_message: stage1Result.data.matched_category_key
        ? `invalid_category_key:${stage1Result.data.matched_category_key.slice(0, 50)}`
        : "",
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // STAGE 2 — Pick subcategory (NO gap-detect — that lives in Stage 3 / mapper)
  // ════════════════════════════════════════════════════════════════════

  Sentry.addBreadcrumb({
    category: "scheduler.diagnose.stage2",
    type: "info",
    level: "info",
    message: "Stage 2 dispatch",
    data: {
      stage2_model: stage2Model,
      matched_category_key: stage1Result.data.matched_category_key,
      stage1_confidence: stage1Result.data.confidence,
    },
  });

  /** Stage 2 fallback: testing service still recommended (so the customer
   *  gets a price), no subcategory selected, no questions asked. */
  const stage2Fallback = (errorMessage: string): DiagnoseConcernResult => {
    if (isTestingService(matchedCat)) {
      return {
        matched_category_key: matchedCat.service_key,
        matched_kind: "testing_service",
        matched_subcategory_slug: null,
        recommended_testing_service: buildTestingServicePayload(matchedCat),
        unanswered_question_ids: [],
        extracted_facts: null,
        stage1_confidence: stage1Result.data!.confidence,
        stage2_confidence: "low",
        stage3_confidence: "low",
        parsed_ok: true,
        model: stage1Model,
        latency_ms: Date.now() - startedAt,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        error_message: errorMessage,
      };
    }
    return {
      matched_category_key: matchedCat.subcategory_slug,
      matched_kind: "other_subcategory",
      matched_subcategory_slug: null,
      recommended_testing_service: null,
      unanswered_question_ids: [],
      extracted_facts: null,
      stage1_confidence: stage1Result.data!.confidence,
      stage2_confidence: "low",
      stage3_confidence: "low",
      parsed_ok: true,
      model: stage1Model,
      latency_ms: Date.now() - startedAt,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      error_message: errorMessage,
    };
  };

  const stage2Result = await callAnthropicStage<Stage2Response>({
    model: stage2Model,
    systemPrompt: buildStage2SystemPrompt(matchedCat, args.customer_chip_hint),
    userPrompt: buildUserPrompt(args),
    jsonSchema: STAGE2_JSON_SCHEMA as unknown as Record<string, unknown>,
    zodSchema: Stage2ResponseSchema,
    stage: 2,
  });
  tokensIn += stage2Result.tokensIn;
  tokensOut += stage2Result.tokensOut;

  if (!stage2Result.data) {
    return stage2Fallback(`stage2_failed: ${stage2Result.errorMessage}`);
  }

  // Validate Stage 2 output against the eligible subcategory slugs.
  const matchedSub = findMatchedSubcategory(
    matchedCat,
    stage2Result.data.matched_subcategory_slug,
  );
  const subSlug = matchedSub?.slug ?? null;

  // ════════════════════════════════════════════════════════════════════
  // STAGE 3 — Extract facts (NO question text — fact extraction only)
  // ════════════════════════════════════════════════════════════════════

  Sentry.addBreadcrumb({
    category: "scheduler.diagnose.stage3",
    type: "info",
    level: "info",
    message: "Stage 3 dispatch",
    data: {
      stage3_model: stage3Model,
      matched_category_key: stage1Result.data.matched_category_key,
      matched_subcategory_slug: subSlug,
      stage2_confidence: stage2Result.data.confidence,
    },
  });

  /** Stage 3 fallback: extracted_facts null, treat ALL questions as
   *  unanswered (safe over-ask). Still report Stage 1 + Stage 2 results
   *  so the customer gets a testing-service recommendation. */
  const stage3Fallback = (errorMessage: string): DiagnoseConcernResult => {
    // Safe over-ask: every question in the matched subcategory (or, if
    // no matched subcategory, every question across the matched category)
    // gets returned as unanswered.
    let unansweredIds: number[] = [];
    if (matchedSub) {
      unansweredIds = matchedSub.questions
        .map((q) => q.id)
        .sort((a, b) => a - b);
    } else {
      unansweredIds = collectAllCategoryQuestionIds(matchedCat);
    }

    if (isTestingService(matchedCat)) {
      return {
        matched_category_key: matchedCat.service_key,
        matched_kind: "testing_service",
        matched_subcategory_slug: subSlug,
        recommended_testing_service: buildTestingServicePayload(matchedCat),
        unanswered_question_ids: unansweredIds,
        extracted_facts: null,
        stage1_confidence: stage1Result.data!.confidence,
        stage2_confidence: stage2Result.data!.confidence,
        stage3_confidence: "low",
        parsed_ok: true,
        model: stage1Model,
        latency_ms: Date.now() - startedAt,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        error_message: errorMessage,
      };
    }
    return {
      matched_category_key: matchedCat.subcategory_slug,
      matched_kind: "other_subcategory",
      matched_subcategory_slug: subSlug,
      recommended_testing_service: null,
      unanswered_question_ids: unansweredIds,
      extracted_facts: null,
      stage1_confidence: stage1Result.data!.confidence,
      stage2_confidence: stage2Result.data!.confidence,
      stage3_confidence: "low",
      parsed_ok: true,
      model: stage1Model,
      latency_ms: Date.now() - startedAt,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      error_message: errorMessage,
    };
  };

  const stage3Result = await callAnthropicStage<Stage3Response>({
    model: stage3Model,
    systemPrompt: buildStage3SystemPrompt(
      matchedSub,
      categoryHeaderForStage3(matchedCat),
    ),
    userPrompt: buildUserPrompt(args),
    jsonSchema: STAGE3_JSON_SCHEMA as unknown as Record<string, unknown>,
    zodSchema: Stage3ResponseSchema,
    stage: 3,
  });
  tokensIn += stage3Result.tokensIn;
  tokensOut += stage3Result.tokensOut;

  if (!stage3Result.data) {
    return stage3Fallback(`stage3_failed: ${stage3Result.errorMessage}`);
  }

  const extractedFacts = stage3Result.data.extracted_facts;

  // ════════════════════════════════════════════════════════════════════
  // DETERMINISTIC MAPPER — facts × questions → unanswered_ids
  // ════════════════════════════════════════════════════════════════════
  //
  // v1 behavior: treat ambiguous as unanswered (safe over-ask). When a
  // question's required_facts list is partially covered by the extracted
  // facts, we still ask it — asking a clarifying question is cheap;
  // skipping based on incomplete coverage is risky.
  //
  // If matchedSub is null (Stage 2 picked an invalid slug or null), we
  // can't map deterministically. Default to treating every question in
  // the matched category as unanswered (safe over-ask).
  let unansweredIds: number[] = [];
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
    // v1: ambiguous is treated as unanswered (over-ask).
    unansweredIds = Array.from(
      new Set([...mapperResult.unanswered_ids, ...mapperResult.ambiguous_ids]),
    ).sort((a, b) => a - b);
  } else {
    unansweredIds = collectAllCategoryQuestionIds(matchedCat);
  }

  // Sentry breadcrumb for the final result — captures all three
  // confidences + the deterministic-mapper outcome.
  Sentry.addBreadcrumb({
    category: "scheduler.diagnose.complete",
    type: "info",
    level: "info",
    message: "diagnoseConcern complete",
    data: {
      matched_category_key: stage1Result.data.matched_category_key,
      matched_subcategory_slug: subSlug,
      stage1_confidence: stage1Result.data.confidence,
      stage2_confidence: stage2Result.data.confidence,
      stage3_confidence: stage3Result.data.confidence,
      unanswered_count: unansweredIds.length,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      latency_ms: Date.now() - startedAt,
    },
  });

  if (isTestingService(matchedCat)) {
    return {
      matched_category_key: matchedCat.service_key,
      matched_kind: "testing_service",
      matched_subcategory_slug: subSlug,
      recommended_testing_service: buildTestingServicePayload(matchedCat),
      unanswered_question_ids: unansweredIds,
      extracted_facts: extractedFacts,
      stage1_confidence: stage1Result.data.confidence,
      stage2_confidence: stage2Result.data.confidence,
      stage3_confidence: stage3Result.data.confidence,
      parsed_ok: true,
      model: stage1Model,
      latency_ms: Date.now() - startedAt,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      error_message: "",
    };
  }

  return {
    matched_category_key: matchedCat.subcategory_slug,
    matched_kind: "other_subcategory",
    matched_subcategory_slug: subSlug,
    recommended_testing_service: null,
    unanswered_question_ids: unansweredIds,
    extracted_facts: extractedFacts,
    stage1_confidence: stage1Result.data.confidence,
    stage2_confidence: stage2Result.data.confidence,
    stage3_confidence: stage3Result.data.confidence,
    parsed_ok: true,
    model: stage1Model,
    latency_ms: Date.now() - startedAt,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    error_message: "",
  };
}
