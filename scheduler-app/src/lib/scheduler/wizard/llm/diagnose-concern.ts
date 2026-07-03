/**
 * diagnoseConcern — Three-stage diagnostic classifier (Path C: Anthropic SDK
 * + Vercel AI Gateway + native structured outputs).
 *
 * Refactored 2026-05-21 from a two-stage (category + subcategory-with-gap-
 * detect) flow to a three-stage flow:
 *
 *   Stage 1 — Rank candidate categories (act-or-ask contract, 2026-07-03)
 *     Brief catalog (~5-8 KB) → { candidates: string[] (0-3 RANKED
 *     category keys, best first), reasoning }. Exactly ONE key when the
 *     text clearly points to a single category (same flow as before);
 *     TWO-THREE when genuinely ambiguous (the wizard shows a one-tap
 *     clarify chip card; Stages 2+3 are precomputed for EVERY candidate
 *     in parallel here); EMPTY when nothing fits (advisor handoff). The
 *     structural signal (candidate count) REPLACES the old
 *     stage1_confidence self-report.
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
 * Why this architecture (UPDATED 2026-07-03 — act-or-ask AO2b hybrid transport):
 *   - Transport is HYBRID, dispatched on the model-id prefix (callModelStage):
 *       'anthropic/*'  → Anthropic SDK pointed at the Vercel AI Gateway
 *                        baseURL — native structured outputs
 *                        (output_config.format, constrained decoding,
 *                        documented <0.1% failure rate; migrated 2026-07-02
 *                        from the deprecated output_format beta) + explicit
 *                        cache_control markers. UNCHANGED.
 *       anything else  → @ai-sdk/gateway createGateway + `generateObject`
 *                        with a plain jsonSchema (non-streaming). On a
 *                        both-attempts failure this path degrades to the
 *                        Anthropic path on DEFAULT_MODEL before failing
 *                        the stage.
 *   - PRE-FLIGHT VERDICT (2026-07-03): this header previously cited
 *     vercel/ai #13460 #13355 #14342 as the reason to avoid the @ai-sdk
 *     path entirely. Re-checked against the issues:
 *       #13460 — AI SDK v6 `tool()` stores Zod schemas on `.parameters`
 *         while internals read `.inputSchema` (tool-calling only). We're
 *         pinned ai@^5 and use generateObject with no tools. NOT APPLICABLE.
 *       #13355 / #14342 — @ai-sdk/anthropic passes unsupported JSON Schema
 *         keywords (minLength/maxItems/minimum/…) to Anthropic's strictly
 *         validated output_config.format → 400s. Fixed upstream (PR #14790)
 *         and, decisively, ANTHROPIC-TARGETED only: our prefix dispatch
 *         never sends an anthropic/* model down the gateway path, and our
 *         JSON schemas are constraint-light by design (see the schema
 *         comment below). NOT APPLICABLE to non-streaming generateObject
 *         via gateway with plain JSON schemas.
 *     Empirical corroboration: the act-or-ask eval ran ~2,200 non-streaming
 *     generateObject calls through this exact gateway path (eval harness
 *     scripts/eval/run-eval-x.ts + run-act-or-ask.ts) with ZERO parse
 *     failures.
 *   - We still benefit from the Vercel AI Gateway on both paths:
 *     multi-model routing, observability, single credential, unified
 *     billing (+ prompt caching on the Anthropic path).
 *
 * Zod retained for:
 *   1. TypeScript type inference (z.infer<typeof Schema>)
 *   2. Post-LLM defense-in-depth validation
 * Zod is NOT in the LLM-call path. JSON Schema (raw object literals)
 * is the source of truth for the API.
 *
 * Models (act-or-ask defaults, 2026-07-03): Stage 1 + Stage 2 default
 * 'google/gemini-3.1-flash-lite' (gateway transport — the real-data eval
 * winner at 1-in-112 hard misroutes). Stage 3 default stays
 * 'anthropic/claude-haiku-4-5' (AO5 re-baseline decides its final home).
 * Per-stage env overrides via DIAGNOSE_CONCERN_STAGE1_MODEL /
 * DIAGNOSE_CONCERN_STAGE2_MODEL / DIAGNOSE_CONCERN_STAGE3_MODEL stay
 * authoritative. Combined legacy override: DIAGNOSE_CONCERN_MODEL.
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
 * Public API contract (act-or-ask BREAKING change, 2026-07-03):
 *   - diagnoseConcern() signature UNCHANGED.
 *   - DiagnoseConcernResult: stage1_confidence REMOVED (the structural
 *     candidate-count signal replaces it). New fields:
 *       stage1_candidates (string[], always present — post catalog
 *         validation + truncation to 3)
 *       requires_clarification (boolean — true iff 2-3 candidates)
 *       candidate_results (CandidateDiagnosis[] | null — per-candidate
 *         precomputed S2+S3 chains, populated ONLY on the clarify path)
 *     On the clarify path matched_category_key / matched_kind /
 *     recommended_testing_service are null and unanswered_question_ids
 *     is [] — the wizard resolves the tap from candidate_results.
 *
 * Legacy buildSystemPrompt / buildUserPrompt exports retained as
 * aliases pointing at the Stage 1 prompt — for the eval harness that
 * captures prompt-inspection reports.
 */
import { createGateway } from "@ai-sdk/gateway";
import Anthropic from "@anthropic-ai/sdk";
import * as Sentry from "@sentry/nextjs";
import { generateObject, jsonSchema, type JSONSchema7 } from "ai";
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
/** Act-or-ask (2026-07-03): Stage 1 + Stage 2 default to the gateway-
 *  transported flash-lite (real-data eval winner). Stage 3 stays on the
 *  Anthropic default pending the AO5 re-baseline. */
const DEFAULT_GATEWAY_MODEL = "google/gemini-3.1-flash-lite";
const MAX_OUTPUT_TOKENS = 1024;

function resolveStage1Model(): string {
  return (
    process.env.DIAGNOSE_CONCERN_STAGE1_MODEL ||
    process.env.DIAGNOSE_CONCERN_MODEL ||
    DEFAULT_GATEWAY_MODEL
  );
}

function resolveStage2Model(): string {
  return (
    process.env.DIAGNOSE_CONCERN_STAGE2_MODEL ||
    process.env.DIAGNOSE_CONCERN_MODEL ||
    DEFAULT_GATEWAY_MODEL
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

// ─── AI SDK gateway provider (non-anthropic/* models) ───────────────────────
//
// Same credential resolution as the Anthropic client above (and as the
// eval harness scripts/eval/run-eval-x.ts + run-act-or-ask.ts, which
// validated this path with ~2,200 zero-parse-failure generateObject
// calls). Used by callGatewayStage for every model whose id does NOT
// start with 'anthropic/'.

const gatewayProvider = createGateway({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN,
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

/**
 * Full precomputed Stage-2 + Stage-3 chain for ONE Stage-1 candidate.
 * Populated on DiagnoseConcernResult.candidate_results ONLY when Stage 1
 * returned 2-3 ranked candidates (the clarify path) — the wizard's chip
 * tap then resolves DETERMINISTICALLY from these persisted results with
 * no second spinner (act-or-ask locked decision #2, 2026-07-03).
 */
export interface CandidateDiagnosis {
  category_key: string;
  matched_kind: "testing_service" | "other_subcategory";
  matched_subcategory_slug: string | null;
  recommended_testing_service: {
    service_key: string;
    display_name: string;
    description: string | null;
    starting_price_cents: number;
  } | null;
  unanswered_question_ids: number[];
  extracted_facts: ExtractedFacts | null;
  stage2_confidence: "high" | "medium" | "low";
  stage3_confidence: "high" | "medium" | "low";
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
  /** RANKED Stage-1 candidate category keys (best first), post catalog
   *  validation (invalid keys dropped) + truncation to 3. Always present:
   *  [] on null-match / failure / short-circuit; exactly one entry on the
   *  direct path; 2-3 entries on the clarify path. The STRUCTURAL signal
   *  that replaced stage1_confidence (act-or-ask, 2026-07-03). */
  stage1_candidates: string[];
  /** True iff Stage 1 returned 2-3 valid candidates. matched_category_key
   *  is null in that case and candidate_results carries the per-candidate
   *  precomputed chains — the caller routes to the concern_clarify chip
   *  card instead of gating/aggregating this result. */
  requires_clarification: boolean;
  /** Per-candidate precomputed S2+S3 results (parallel), populated ONLY
   *  when requires_clarification is true; null otherwise. Order mirrors
   *  stage1_candidates. */
  candidate_results: CandidateDiagnosis[] | null;
  /** Self-reported confidence from Stage 2 (subcategory pick — NO
   *  gap-detect now lives here as of 2026-05-21). 'low' when Stage 2
   *  didn't run (no Stage 1 match) or failed. On the clarify path this is
   *  a 'low' placeholder — per-candidate values live in candidate_results. */
  stage2_confidence: "high" | "medium" | "low";
  /** Self-reported confidence from Stage 3 (fact extraction). 'low' when
   *  Stage 3 didn't run (Stage 1 or 2 failed, or no matched subcategory)
   *  OR when Stage 3 ran but the LLM self-rated the extraction as low
   *  confidence. On the clarify path this is a 'low' placeholder —
   *  per-candidate values live in candidate_results. */
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

// Act-or-ask contract (2026-07-03): 0-3 RANKED candidate keys replace the
// single matched_category_key + confidence pair. NO minItems/maxItems —
// Anthropic's constrained-decoding schema validator rejects unsupported
// keywords (see the constraint-light note above); the 0-3 bound lives in
// the description text + code-side truncation in diagnoseConcern.
export const STAGE1_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    candidates: {
      type: "array",
      items: { type: "string" },
      description:
        "RANKED candidate category keys, best first — 0 to 3 entries " +
        "(anything past the third is dropped in code). Each entry MUST be " +
        "a testing_services.service_key OR an 'other' subcategory slug " +
        "from the catalog above, VERBATIM. Exactly ONE entry when the " +
        "description clearly points to a single category; TWO or THREE " +
        "when it is genuinely consistent with more than one; EMPTY when " +
        "the text is not a vehicle concern, too vague, or fits nothing.",
    },
    reasoning: {
      type: "string",
      description:
        "One sentence (keep under 280 characters) citing the customer " +
        "words that drove the candidate set (and why more than one, if " +
        "so). Audit-only.",
    },
  },
  required: ["candidates", "reasoning"],
} as const;

export const STAGE2_JSON_SCHEMA = {
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
export const STAGE3_JSON_SCHEMA = {
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

export const Stage1ResponseSchema = z.object({
  candidates: z.array(z.string()),
  reasoning: z.string(),
});

export const Stage2ResponseSchema = z.object({
  matched_subcategory_slug: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  reasoning: z.string(),
});

export const Stage3ResponseSchema = z.object({
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
//
// Returned as an Anthropic content-block array with cache_control on the
// STATIC portion so Anthropic's prompt caching can fire (5-min ephemeral
// TTL). String-form system prompts silently disable caching per
// https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching.
//
// Cacheable static portion: the entire catalog (testing services +
// 'other' subcategories) plus the JSON-shape / decision-rule preamble.
// Identical across calls for a given catalog snapshot; varies only when
// the underlying DB rows change.
//
// Dynamic portion (NOT cached): the customer-chip-hint context block.
// chipHintLine interpolates the customer's pre-selection, which varies
// per call. Keeping this outside the cache_control marker ensures cache
// hits aren't lost when only the chip changes.
//
// Cache-write threshold (5-min ephemeral) — corrected 2026-07-02
// (REVAMP-PLAN §11 P0): Haiku 4.5's minimum cacheable prefix is 4,096
// tokens (Sonnet 4.6: 2,048; Sonnet 4.5: 1,024) — NOT the 2,048 this
// comment previously claimed. The Stage 1 static portion (~5-8 KB ≈
// 1,500-2,400 tokens) is BELOW the Haiku minimum, so on the default
// Haiku model this marker is currently a harmless no-op (no error;
// usage.cache_creation_input_tokens stays 0). It starts firing
// automatically once the catalog grows past ~4,096 tokens, or if the
// stage is pointed at a Sonnet model via DIAGNOSE_CONCERN_STAGE1_MODEL.
// We keep the marker + the static/dynamic split rather than padding the
// prompt to reach the threshold. Verify with cache_read_input_tokens > 0.

export function buildStage1SystemPrompt(
  args: DiagnoseConcernArgs,
): Anthropic.TextBlockParam[] {
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

  const staticText = `You are the diagnostic categorisation helper for Jeff's Automotive
(Stage 1: candidate categories). A customer typed a description of what's
wrong with their car. Your job: return 0-3 RANKED candidate categories from
the catalog below, best first, under the act-or-ask contract in the
decision rules.

You will NOT be asked to pick a subcategory or generate clarification
questions in this stage — that happens downstream, per candidate. Just
produce the candidate set.

# Category catalog

## Testing services — these drive a recommendation + fee

${testingServicesBlock}

## 'Other' situations — these route to a service advisor (no testing service, no fee)

These elevated subcategories cover concerns that don't map to a specific test:
multiple symptoms at once, recent accidents, work just done elsewhere, safety
worries, general inspections, cars that have been sitting.

${otherSubcategoriesBlock}

# Decision rules (act-or-ask)

1. **Exactly ONE candidate when the text clearly points to a single
   category** — this is most cases. When the description clearly names the
   system or symptom that maps to one category (e.g., "ABS light is on" →
   warning_light_general; "sweet smell under hood" → coolant_leak_testing;
   "brake pedal sinks to the floor" → brake_inspection), return that ONE
   key and stop. Hedging has a REAL COST: every extra candidate forces the
   customer to answer an extra question before booking. Do not add a
   second candidate "just in case" on a clear match.

2. **TWO or THREE ranked candidates ONLY when the text is GENUINELY
   consistent with more than one category** and picking a single one would
   be a guess (e.g., a vague "shake at speed" that could be brakes or
   suspension; a "whining noise" that could be power steering or
   transmission). The customer will be shown your candidates as one-tap
   options and asked which fits — rank them best first.

3. **An EMPTY list when nothing fits.** When the text is not a vehicle
   concern, is too vague to produce candidates ("car feels weird",
   "something's off", < ~5 useful words), or fits no catalog entry, return
   candidates: []. The system forwards the customer to a service advisor.

4. **Match candidates to the customer's actual symptoms.** Read the
   description carefully; a candidate qualifies when its name + "What we'd
   do" + tags fit the described issue. The chip hint is a prior, not a
   constraint.

5. **'Other' subcategory matches are valid AND useful candidates.** If the
   customer's description is about a situation (recent accident, car has
   been sitting, pre-trip check, multiple symptoms at once with no
   primary), use the appropriate 'other' subcategory_slug. Don't force a
   testing service when the situation truly doesn't fit one.

6. **Never invent IDs or slugs.** Only return keys that appear above,
   VERBATIM. Never more than three.

7. **Reasoning is for the audit log.** One sentence under 280 characters
   citing the customer words that drove the candidate set.`;

  const dynamicText = `# Customer's pre-selection (context)

${chipHintLine}`;

  return [
    { type: "text", text: staticText, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamicText },
  ];
}

// ─── Stage 2 system prompt (ONE category's subcategories — NO question text) ─
//
// Returned as an Anthropic content-block array with cache_control on the
// STATIC portion. Anthropic caches per exact-content match; a repeat of
// "category=brakes" within the 5-min ephemeral window hits the cache.
// Different categories get their own cache entries (still beneficial when
// catalog calls cluster).
//
// Cacheable static portion: the header + matched-category banner + the
// matched-category's subcategory subtree (description + positive/negative
// examples + synonyms) + decision rules. The subtree IS per-category but
// STABLE across calls for the same category — that's still cacheable.
//
// Dynamic portion (NOT cached): the customer-chip-hint context block,
// which varies per call.

export function buildStage2SystemPrompt(
  matchedCategory: CatalogCategory,
  customerChipHint: DiagnoseConcernChipHint | null | undefined,
): Anthropic.TextBlockParam[] {
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

  const staticText = `You are the diagnostic categorisation helper for Jeff's Automotive
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

${chipHintLine}`;

  return [
    { type: "text", text: staticText, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamicText },
  ];
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

// ─── Stage 3 cache_control note ────────────────────────────────────────────
//
// Returned as an Anthropic content-block array with cache_control on the
// STATIC portion. The fact-extraction prompt is THE most cache-effective
// of the three stages because its bulk is the 29-slot ExtractedFacts slot
// reference + 5 worked examples — fully static across every call.
//
// Cacheable static portion: header + CRITICAL RULE + slot reference (29
// slots) + 5 positive + 3 negative worked examples + output instructions.
// This is ~8-12 KB and well above the Haiku 2048-token threshold.
//
// Dynamic portion (NOT cached): the Stage 1/2 result context line that
// names the matched category + subcategory for this specific call.

export function buildStage3SystemPrompt(
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

THE TEST FOR EVERY NON-NULL SLOT: can you QUOTE the customer's exact words
that state that value? If you cannot point to a verbatim, explicit
statement of the value, the slot is null. "It's implied," "it's obvious
from context," and "any customer in this situation would mean X" are all
FORBIDDEN inferences — set null. A slot value derived from a mechanical
interpretation of what the customer described (rather than from words that
state the value) is an over-assertion, the expensive error class.

In particular (the three most common real-world over-assertions, from
adjudicated production transcripts):
  - BOOKING LANGUAGE IS NOT A FACT. "can I bring it in?", "do we need an
    appointment?", "can you check it out / figure out what's wrong?" is
    how customers contact the shop — it does NOT set customer_request_type,
    drivable_state, or any other slot. Only set customer_request_type when
    the customer explicitly names what they want done ("just diagnose it",
    "I want a new battery", "it needs an oil change").
  - HOW A PROBLEM STARTED IS NOT WHEN IT OCCURS. "it suddenly quit",
    "started acting up last week" describe onset HISTORY (started_when at
    most, when explicit) — they do NOT set onset_timing, which is only for
    explicit statements about WHEN during operation the symptom happens
    ("when I brake", "at cold start").
  - STILL DRIVING THE CAR IS NOT A DRIVABILITY STATEMENT. Unless the
    customer explicitly says whether the car can/can't be driven ("we
    can't drive it", "it needs a tow", "I'm still driving it but it feels
    unsafe"), drivable_state is null — do NOT infer it from "brakes seem
    fine tho" or from the fact that they plan to drive it to the shop.

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

# NEGATIVE worked examples (real adjudicated over-assertions — do NOT repeat these)

6. Customer: "AC just suddenly quit cooling — one day it was fine, next day
   straight hot air. We did have it recharged a couple months ago."
   - recent_action: "ac_recharge_or_service"   (they literally said it
     was recharged)
   - DO NOT set onset_timing. "suddenly quit" is onset HISTORY, not a
     statement of when during operation the symptom occurs — no
     onset_timing enum value ("cold_start", "when_idling", …) was stated.
   - DO NOT set customer_request_type. Contacting the shop about a broken
     AC is not a literal statement of the request type.

7. Customer: "AC is fine on the highway but useless sitting at a stoplight."
   - DO NOT set onset_timing="when_idling". "sitting at a stoplight" is
     where the car was; treating that as "idling" is YOUR mechanical
     inference, not the customer's words. Leave onset_timing null — the
     clarification question will pin it down.

8. Customer: "abs light came on in my wife's car, brakes seem fine tho. do
   we need an appointment right away?"
   - warning_light_named: "abs"   (literal)
   - DO NOT set warning_light_behavior — "came on" doesn't state whether
     it stays on, flashes, or comes and goes.
   - DO NOT set drivable_state. The customer never stated whether the car
     can be driven; "brakes seem fine tho" + asking for an appointment is
     not a drivability statement.
   - DO NOT set customer_request_type. "do we need an appointment?" is
     booking language, not a stated request type.

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

/**
 * Concatenate a content-block array into the equivalent string form. Used
 * by the legacy `buildSystemPrompt` eval alias (which dumps prompts into
 * the eval Markdown report) and by edge-side instrumentation that records
 * `system_prompt_chars`. NOT used in the LLM call path — the array shape
 * is required there for prompt caching to fire.
 */
function flattenSystemPrompt(blocks: Anthropic.TextBlockParam[]): string {
  return blocks.map((b) => b.text).join("\n\n");
}

// Legacy alias for eval harness back-compat. Returns the concatenated
// string form (static + dynamic joined) because the eval Markdown report
// pastes prompts verbatim and assumes a single string.
export function buildSystemPrompt(args: DiagnoseConcernArgs): string {
  return flattenSystemPrompt(buildStage1SystemPrompt(args));
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

export function categoryHeaderForStage3(cat: CatalogCategory): string {
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
  systemPrompt: Anthropic.TextBlockParam[];
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
        // Anthropic native Structured Outputs — GA surface (2026-07-02
        // migration): `output_config.format` on plain messages.create, no
        // beta header. Replaces the deprecated top-level `output_format` +
        // `betas: ["structured-outputs-2025-11-13"]` pair. Constrained
        // decoding for guaranteed schema compliance; typed in SDK ≥0.97.
        output_config: {
          format: {
            type: "json_schema",
            schema: args.jsonSchema,
          },
        },
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

// ─── AI SDK gateway call wrapper (non-anthropic/* models) ──────────────────
//
// Mirrors callAnthropicStage's contract: temperature 0, two attempts,
// same Sentry captureException pattern/tags (+ transport:'gateway'), Zod
// post-parse defense-in-depth. Differences:
//   - System prompt: the Anthropic content-block array is FLATTENED to a
//     plain string (cache_control is an Anthropic-only concept; other
//     providers take a single system string).
//   - Structured output: `generateObject` + `jsonSchema` from 'ai' — the
//     exact path the act-or-ask eval validated with ~2,200 zero-parse-
//     failure calls (see the pre-flight verdict in the file header).
//   - Final degradation: when BOTH gateway attempts fail, fall back to
//     callAnthropicStage on DEFAULT_MODEL (haiku) before failing the
//     stage — the per-stage failure semantics (safe-null / recommend-
//     without-questions / over-ask) only engage after that too fails.

async function callGatewayStage<T>(args: {
  model: string;
  systemPrompt: Anthropic.TextBlockParam[];
  userPrompt: string;
  jsonSchema: Record<string, unknown>;
  zodSchema: z.ZodType<T>;
  stage: 1 | 2 | 3;
}): Promise<CallResult<T>> {
  let lastError: Error | null = null;
  const system = flattenSystemPrompt(args.systemPrompt);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await generateObject({
        model: gatewayProvider(args.model),
        system,
        prompt: args.userPrompt,
        temperature: 0,
        schema: jsonSchema<T>(args.jsonSchema as JSONSchema7),
      });
      const validated = args.zodSchema.parse(result.object);
      return {
        data: validated,
        tokensIn: result.usage?.inputTokens ?? 0,
        tokensOut: result.usage?.outputTokens ?? 0,
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
            transport: "gateway",
            model: args.model,
          },
          level: "warning",
        });
      } catch {
        // Sentry unavailable — proceed.
      }
    }
  }

  // Both gateway attempts failed → final degradation to the known-good
  // Anthropic transport on the default model before failing the stage.
  const anthropicFallback = await callAnthropicStage<T>({
    ...args,
    model: DEFAULT_MODEL,
  });
  if (anthropicFallback.data) {
    return anthropicFallback;
  }
  return {
    data: null,
    tokensIn: anthropicFallback.tokensIn,
    tokensOut: anthropicFallback.tokensOut,
    errorMessage:
      `gateway_failed: ${lastError?.message ?? "unknown_error"}; ` +
      `anthropic_fallback_failed: ${anthropicFallback.errorMessage ?? "unknown_error"}`,
  };
}

// ─── Transport dispatch (act-or-ask AO2b, 2026-07-03) ──────────────────────
//
// The single switch point between the two transports. 'anthropic/*' model
// ids keep the existing Anthropic-SDK-at-gateway-baseURL path (native
// structured outputs + cache_control); every other prefix (google/*,
// openai/*, …) goes through @ai-sdk/gateway generateObject.

async function callModelStage<T>(args: {
  model: string;
  systemPrompt: Anthropic.TextBlockParam[];
  userPrompt: string;
  jsonSchema: Record<string, unknown>;
  zodSchema: z.ZodType<T>;
  stage: 1 | 2 | 3;
}): Promise<CallResult<T>> {
  if (args.model.startsWith("anthropic/")) {
    return callAnthropicStage(args);
  }
  return callGatewayStage(args);
}

// ─── Main three-stage entry point ───────────────────────────────────────────

// ─── Per-candidate Stage 2 + Stage 3 chain ──────────────────────────────────

/**
 * Internal outcome of one Stage-2 → Stage-3 chain for a single matched
 * category. Failure degradation preserves the original single-path
 * semantics per stage:
 *   - Stage-2 failure → no subcategory + NO questions (the caller still
 *     recommends the testing service so the customer gets a price).
 *   - Stage-3 failure → safe over-ask (every question for the matched
 *     subcategory, or the whole category when no subcategory resolved).
 */
interface StagesTwoThreeOutcome {
  matched_subcategory_slug: string | null;
  unanswered_question_ids: number[];
  extracted_facts: ExtractedFacts | null;
  stage2_confidence: "high" | "medium" | "low";
  stage3_confidence: "high" | "medium" | "low";
  tokens_in: number;
  tokens_out: number;
  /** "" on a clean run; "stage2_failed: …" / "stage3_failed: …" on the
   *  degraded paths (mirrors the pre-act-or-ask error_message contract). */
  error_message: string;
}

/**
 * Run Stage 2 (subcategory pick) + Stage 3 (fact extraction) + the
 * deterministic mapper for ONE matched category. Never throws — every
 * failure degrades to the documented fallback shape, which is what makes
 * the multi-candidate Promise.all in diagnoseConcern safe (per-candidate
 * failures degrade per-candidate).
 */
async function runStagesTwoAndThree(params: {
  matchedCat: CatalogCategory;
  args: DiagnoseConcernArgs;
  stage2Model: string;
  stage3Model: string;
}): Promise<StagesTwoThreeOutcome> {
  const { matchedCat, args, stage2Model, stage3Model } = params;
  let tokensIn = 0;
  let tokensOut = 0;

  const categoryKey = isTestingService(matchedCat)
    ? matchedCat.service_key
    : matchedCat.subcategory_slug;

  Sentry.addBreadcrumb({
    category: "scheduler.diagnose.stage2",
    type: "info",
    level: "info",
    message: "Stage 2 dispatch",
    data: {
      stage2_model: stage2Model,
      matched_category_key: categoryKey,
    },
  });

  const stage2Result = await callModelStage<Stage2Response>({
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
    // Stage 2 failure: no subcategory selected, no questions asked. The
    // caller still surfaces the category (recommend-without-questions).
    return {
      matched_subcategory_slug: null,
      unanswered_question_ids: [],
      extracted_facts: null,
      stage2_confidence: "low",
      stage3_confidence: "low",
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      error_message: `stage2_failed: ${stage2Result.errorMessage}`,
    };
  }

  // Validate Stage 2 output against the eligible subcategory slugs.
  const matchedSub = findMatchedSubcategory(
    matchedCat,
    stage2Result.data.matched_subcategory_slug,
  );
  const subSlug = matchedSub?.slug ?? null;

  Sentry.addBreadcrumb({
    category: "scheduler.diagnose.stage3",
    type: "info",
    level: "info",
    message: "Stage 3 dispatch",
    data: {
      stage3_model: stage3Model,
      matched_category_key: categoryKey,
      matched_subcategory_slug: subSlug,
      stage2_confidence: stage2Result.data.confidence,
    },
  });

  const stage3Result = await callModelStage<Stage3Response>({
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
    // Stage 3 failure: extracted_facts null, treat ALL questions as
    // unanswered (safe over-ask).
    const unansweredIds = matchedSub
      ? matchedSub.questions.map((q) => q.id).sort((a, b) => a - b)
      : collectAllCategoryQuestionIds(matchedCat);
    return {
      matched_subcategory_slug: subSlug,
      unanswered_question_ids: unansweredIds,
      extracted_facts: null,
      stage2_confidence: stage2Result.data.confidence,
      stage3_confidence: "low",
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      error_message: `stage3_failed: ${stage3Result.errorMessage}`,
    };
  }

  const extractedFacts = stage3Result.data.extracted_facts;

  // DETERMINISTIC MAPPER — facts × questions → unanswered_ids.
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

  return {
    matched_subcategory_slug: subSlug,
    unanswered_question_ids: unansweredIds,
    extracted_facts: extractedFacts,
    stage2_confidence: stage2Result.data.confidence,
    stage3_confidence: stage3Result.data.confidence,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    error_message: "",
  };
}

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
    stage1_candidates: [],
    requires_clarification: false,
    candidate_results: null,
    stage2_confidence: "low",
    stage3_confidence: "low",
    parsed_ok: false,
    model: stage1Model,
    latency_ms: Date.now() - startedAt,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    error_message: errorMessage,
  });

  /** Null-match shape — parsed_ok TRUE: the LLM ran and said "nothing
   *  fits" (empty candidate list), or every returned key was invalid.
   *  The advisor-handoff path. */
  const nullMatch = (errorMessage: string): DiagnoseConcernResult => ({
    matched_category_key: null,
    matched_kind: null,
    matched_subcategory_slug: null,
    recommended_testing_service: null,
    unanswered_question_ids: [],
    extracted_facts: null,
    stage1_candidates: [],
    requires_clarification: false,
    candidate_results: null,
    stage2_confidence: "low",
    stage3_confidence: "low",
    parsed_ok: true,
    model: stage1Model,
    latency_ms: Date.now() - startedAt,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    error_message: errorMessage,
  });

  const desc = (args.customer_description ?? "").trim();
  if (desc.length < 3) {
    return { ...nullMatch(""), latency_ms: 0 };
  }
  if (args.catalog.categories.length === 0) {
    return failSafe("empty_catalog");
  }

  // ════════════════════════════════════════════════════════════════════
  // STAGE 1 — Rank candidate categories (act-or-ask)
  // ════════════════════════════════════════════════════════════════════

  Sentry.addBreadcrumb({
    category: "scheduler.diagnose.stage1",
    type: "info",
    level: "info",
    message: "Stage 1 dispatch",
    data: { stage1_model: stage1Model, description_chars: desc.length },
  });

  const stage1Result = await callModelStage<Stage1Response>({
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

  // Validate the returned candidate keys against the catalog: de-dupe,
  // drop keys that don't resolve (hallucinations), truncate to 3. The
  // schema can't carry minItems/maxItems (constraint-light — see the
  // schema comment block), so the 0-3 bound is enforced HERE.
  const seen = new Set<string>();
  const invalidKeys: string[] = [];
  const validCandidates: Array<{ key: string; cat: CatalogCategory }> = [];
  for (const key of stage1Result.data.candidates) {
    if (seen.has(key)) continue;
    seen.add(key);
    const cat = findMatchedCategory(args.catalog, key);
    if (cat) {
      validCandidates.push({ key, cat });
    } else {
      invalidKeys.push(key);
    }
  }
  const candidates = validCandidates.slice(0, 3);

  // ── 0 candidates → advisor handoff (today's null-match shape) ────────
  if (candidates.length === 0) {
    return nullMatch(
      invalidKeys.length > 0
        ? `invalid_category_key:${invalidKeys[0]!.slice(0, 50)}`
        : "",
    );
  }

  // ── 1 candidate → the direct path (exactly today's S2 → S3 flow) ─────
  if (candidates.length === 1) {
    const { key, cat } = candidates[0]!;
    const outcome = await runStagesTwoAndThree({
      matchedCat: cat,
      args,
      stage2Model,
      stage3Model,
    });
    tokensIn += outcome.tokens_in;
    tokensOut += outcome.tokens_out;

    Sentry.addBreadcrumb({
      category: "scheduler.diagnose.complete",
      type: "info",
      level: "info",
      message: "diagnoseConcern complete",
      data: {
        matched_category_key: key,
        matched_subcategory_slug: outcome.matched_subcategory_slug,
        stage1_candidate_count: 1,
        stage2_confidence: outcome.stage2_confidence,
        stage3_confidence: outcome.stage3_confidence,
        unanswered_count: outcome.unanswered_question_ids.length,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        latency_ms: Date.now() - startedAt,
      },
    });

    const common = {
      matched_subcategory_slug: outcome.matched_subcategory_slug,
      unanswered_question_ids: outcome.unanswered_question_ids,
      extracted_facts: outcome.extracted_facts,
      stage1_candidates: [key],
      requires_clarification: false,
      candidate_results: null,
      stage2_confidence: outcome.stage2_confidence,
      stage3_confidence: outcome.stage3_confidence,
      parsed_ok: true,
      model: stage1Model,
      latency_ms: Date.now() - startedAt,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      error_message: outcome.error_message,
    };
    if (isTestingService(cat)) {
      return {
        matched_category_key: cat.service_key,
        matched_kind: "testing_service",
        recommended_testing_service: buildTestingServicePayload(cat),
        ...common,
      };
    }
    return {
      matched_category_key: cat.subcategory_slug,
      matched_kind: "other_subcategory",
      recommended_testing_service: null,
      ...common,
    };
  }

  // ── 2-3 candidates → the clarify path ────────────────────────────────
  //
  // Precompute the FULL Stage-2 + Stage-3 chain for EVERY candidate in
  // parallel during diagnostic_loading, so the customer's chip tap
  // resolves deterministically from persisted results with no second
  // spinner (act-or-ask locked decision #2). runStagesTwoAndThree never
  // throws — per-candidate failures degrade per-candidate — so this
  // Promise.all cannot reject.
  const perCandidate = await Promise.all(
    candidates.map(async ({ key, cat }) => ({
      key,
      cat,
      outcome: await runStagesTwoAndThree({
        matchedCat: cat,
        args,
        stage2Model,
        stage3Model,
      }),
    })),
  );
  for (const c of perCandidate) {
    tokensIn += c.outcome.tokens_in;
    tokensOut += c.outcome.tokens_out;
  }

  const candidateResults: CandidateDiagnosis[] = perCandidate.map(
    ({ key, cat, outcome }) => ({
      category_key: key,
      matched_kind: isTestingService(cat)
        ? ("testing_service" as const)
        : ("other_subcategory" as const),
      matched_subcategory_slug: outcome.matched_subcategory_slug,
      recommended_testing_service: isTestingService(cat)
        ? buildTestingServicePayload(cat)
        : null,
      unanswered_question_ids: outcome.unanswered_question_ids,
      extracted_facts: outcome.extracted_facts,
      stage2_confidence: outcome.stage2_confidence,
      stage3_confidence: outcome.stage3_confidence,
    }),
  );

  Sentry.addBreadcrumb({
    category: "scheduler.diagnose.complete",
    type: "info",
    level: "info",
    message: "diagnoseConcern complete (clarify)",
    data: {
      matched_category_key: null,
      requires_clarification: true,
      stage1_candidate_count: candidates.length,
      stage1_candidates: candidates.map((c) => c.key).join(","),
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      latency_ms: Date.now() - startedAt,
    },
  });

  return {
    matched_category_key: null,
    matched_kind: null,
    matched_subcategory_slug: null,
    recommended_testing_service: null,
    unanswered_question_ids: [],
    extracted_facts: null,
    stage1_candidates: candidates.map((c) => c.key),
    requires_clarification: true,
    candidate_results: candidateResults,
    stage2_confidence: "low",
    stage3_confidence: "low",
    parsed_ok: true,
    model: stage1Model,
    latency_ms: Date.now() - startedAt,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    error_message: "",
  };
}
