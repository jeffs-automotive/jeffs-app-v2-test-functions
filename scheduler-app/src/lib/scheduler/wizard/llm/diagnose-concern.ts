/**
 * diagnoseConcern — Two-stage diagnostic classifier (Path C: Anthropic SDK
 * + Vercel AI Gateway + native structured outputs).
 *
 * Refactored 2026-05-20 to bypass @ai-sdk/gateway's `generateObject` path
 * entirely. Uses the @anthropic-ai/sdk directly, pointed at the Vercel
 * AI Gateway as a base URL. The gateway's `providerOptions` extension
 * remains active for caching + multi-model fallback chains.
 *
 * Why this architecture:
 *   - @ai-sdk/gateway's generateObject path has documented bugs with
 *     Anthropic structured outputs:
 *       - #13460: tool().parameters not read by prepareToolsAndToolChoice
 *       - #13355: unsupported JSON Schema keywords not stripped
 *       - #14342: Anthropic rejects keywords like exclusiveMinimum
 *     None of these affect the Anthropic SDK direct path — Anthropic's
 *     own SDK strips unsupported keywords client-side and submits clean
 *     schemas.
 *   - Anthropic's native Structured Outputs API (output_format +
 *     structured-outputs-2025-11-13 beta) uses constrained decoding for
 *     guaranteed schema compliance, similar to OpenAI's strict mode.
 *     Per Vercel docs, this is the recommended production path for
 *     reliable structured output from Anthropic models. Documented
 *     <0.1% failure rate (vs ~16% observed on our @ai-sdk/gateway path).
 *   - We still benefit from the Vercel AI Gateway: prompt caching,
 *     multi-model fallback chains, observability, single credential,
 *     unified billing. Gateway extensions are passed via providerOptions
 *     in the request body, which the gateway interprets.
 *
 * Two-stage architecture (unchanged from prior refactor):
 *   Stage 1 — Match category
 *     Brief catalog (~5-8 KB) → matched_category_key + reasoning
 *   Stage 2 — Pick subcategory + gap-detect questions
 *     Single category's subtree (~3-30 KB) → subcategory_slug +
 *     unanswered_question_ids + reasoning
 *
 * Zod retained for:
 *   1. TypeScript type inference (z.infer<typeof Schema>)
 *   2. Post-LLM defense-in-depth validation
 * Zod is NOT in the LLM-call path. JSON Schema (raw object literals)
 * is the source of truth for the API.
 *
 * Model: anthropic/claude-haiku-4-5 default. Per-stage env overrides
 * via DIAGNOSE_CONCERN_STAGE1_MODEL / DIAGNOSE_CONCERN_STAGE2_MODEL.
 * Combined legacy override: DIAGNOSE_CONCERN_MODEL.
 *
 * Gateway extensions enabled:
 *   - providerOptions.gateway.caching = 'auto'
 *     Auto-inserts Anthropic cache_control markers on the system prompt.
 *   - providerOptions.gateway.models = ['<primary>', '<fallback>']
 *     If primary model fails (incl. schema failures), gateway cascades.
 *
 * Reliability features:
 *   - Retry once on transient failure (covers occasional gateway 5xx +
 *     non-deterministic schema-compliance edge cases)
 *   - Per-stage error semantics preserved: Stage 2 failure degrades
 *     gracefully (testing service still recommended, just no
 *     clarifying questions)
 *
 * Public API contract — DiagnoseConcernResult shape UNCHANGED. The
 * wizard's downstream code doesn't care which SDK is at the bottom.
 *
 * Legacy buildSystemPrompt / buildUserPrompt exports retained as
 * aliases pointing at the Stage 1 prompt — for the eval harness that
 * captures prompt-inspection reports.
 */
import Anthropic from "@anthropic-ai/sdk";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

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
  /** Self-reported confidence from Stage 1 (category pick). 'low' on
   *  failure / null match. Added 2026-05-21 as the leading signal for
   *  routing to advisor handoff when the LLM is unsure. */
  stage1_confidence: "high" | "medium" | "low";
  /** Self-reported confidence from Stage 2 (subcategory pick + gap-detect).
   *  'low' when Stage 2 didn't run (no Stage 1 match) or failed. */
  stage2_confidence: "high" | "medium" | "low";
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
        "The subcategory slug whose questions best match the customer's " +
        "symptoms. MUST appear in the subcategory list above. null only if " +
        "you genuinely can't pick (rare).",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description:
        "Your confidence in the matched_subcategory_slug AND your " +
        "unanswered_question_ids gap-detect. Use 'high' when the description " +
        "clearly maps to one subcategory (e.g., 'check engine light is " +
        "flashing' → check_engine_light with confident gap-detect); use " +
        "'medium' when the subcategory is the best of 2-3 plausible picks; " +
        "use 'low' when the description doesn't really fit any subcategory " +
        "well OR when you're unsure which of the catalog's questions the " +
        "description actually answers. Low confidence is a signal to a " +
        "downstream advisor to verify the routing.",
    },
    unanswered_question_ids: {
      type: "array",
      items: { type: "integer" },
      description:
        "IDs from the matched subcategory's question set that the " +
        "description did NOT meaningfully answer. Empty when the description " +
        "covers all questions. All IDs must be positive integers that appear " +
        "in the catalog above.",
    },
    reasoning: {
      type: "string",
      description:
        "One sentence (keep under 280 characters) citing the chosen " +
        "subcategory and which customer words drove the gap-detect choices. " +
        "Audit-only.",
    },
  },
  required: [
    "matched_subcategory_slug",
    "confidence",
    "unanswered_question_ids",
    "reasoning",
  ],
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
  unanswered_question_ids: z.array(z.number().int().positive()),
  reasoning: z.string(),
});

type Stage1Response = z.infer<typeof Stage1ResponseSchema>;
type Stage2Response = z.infer<typeof Stage2ResponseSchema>;

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

// ─── Stage 2 system prompt (ONE category's subcategories + questions) ───────

export function buildStage2SystemPrompt(
  matchedCategory: CatalogCategory,
  customerChipHint: DiagnoseConcernChipHint | null | undefined,
): string {
  const subcategories: CatalogSubcategory[] = isOtherSubcategory(matchedCategory)
    ? [
        {
          slug: matchedCategory.subcategory_slug,
          display_label: matchedCategory.display_label,
          concern_category: "other",
          eligible_testing_service_keys: [],
          questions: matchedCategory.questions,
        },
      ]
    : matchedCategory.subcategories;

  const matchedCategoryHeader = isTestingService(matchedCategory)
    ? `service_key="${matchedCategory.service_key}" — ${matchedCategory.display_name}`
    : `subcategory_slug="${matchedCategory.subcategory_slug}" — ${matchedCategory.display_label}`;

  const subcategoryBlock = subcategories
    .map((s) => {
      const lines = s.questions
        .map((q) => {
          const optionLabels = q.options.map((o) => o.label).join(" / ");
          return `    - id=${q.id}: "${q.question_text}" (options: ${optionLabels})`;
        })
        .join("\n");
      return `  ## subcategory_slug="${s.slug}" — ${s.display_label}\n${lines || "    (no questions seeded yet)"}`;
    })
    .join("\n\n");

  const chipHintLine = buildChipHintLine(customerChipHint);

  return `You are the diagnostic categorisation helper for Jeff's Automotive
(Stage 2: subcategory pick + question gap-detect). Stage 1 already matched
the customer's description to a category:

  ${matchedCategoryHeader}

Your job has two parts:

  1. **Pick the subcategory** whose questions best match the customer's
     symptoms. The subcategory MUST be one of the slugs listed below.
     ${subcategories.length === 1 ? "(For 'other' matches there is only ONE choice — pick it.)" : ""}
  2. **Gap-detect questions** — return the IDs of subcategory questions
     the description did NOT meaningfully answer.

# Subcategory + question catalog (this category only)

${subcategoryBlock}

# Customer's pre-selection (context from Stage 1)

${chipHintLine}

# Decision rules

1. **Subcategory must appear in the list above.** Don't invent slugs.

2. **Gap-detect questions from the matched subcategory only.** A question is
   "answered" when the customer's description states the FACT the question
   asks about — even if they used different words. A question is "unanswered"
   only when the description doesn't speak to it OR mentions it ambiguously.

   **ANSWERED (drop the ID):**

   - Location/side: "front right" / "rear left" / "all four wheels" / "front"
     alone / "rear" alone → drop location IDs.
   - Onset: "started suddenly" / "appeared overnight" → ANSWERED suddenly.
     "gradually" / "getting worse over weeks" → ANSWERED gradually.
   - Trigger: "only when braking" → ANSWERED for brake-trigger questions.
     "over bumps" → ANSWERED for bump-trigger. "at highway speed" → ANSWERED
     for speed-band.
   - Speed-specific: "at exactly 65 mph" / "at highway speed" /
     "at 40 mph and up" → ANSWERED for "at what speed?" questions.
   - System scoped to exactly the question's body-part: customer says
     "steering wheel shakes" → "whole car or just the steering wheel?"
     is ANSWERED (steering wheel). Customer says "the car shakes" →
     ANSWERED (whole car). Customer says "brakes squeal" → "regular
     brakes still working normally?" is ANSWERED (yes — they're
     squealing but still working).
   - Trigger-system named: customer says "when I run the heat" → "AC or
     heat or both?" is ANSWERED (heat). Customer says "AC works but
     smells when I turn it on" → ANSWERED (AC).
   - Light-name explicit: customer named the warning light verbatim
     ("maintenance light", "service engine soon", "ABS light",
     "TPMS light") → drop "which message does the dash say?" IDs.
   - Recent service: "just replaced X" → ANSWERED yes-recently. "no recent
     work" → ANSWERED no. Silence → UNANSWERED.
   - Action-already-taken: customer says "I checked the tire pressures
     and the light still won't go off" → drop "have you added air and
     the light still won't turn off?" (semantically identical).
   - Slow-vs-sudden via duration cue: customer says "just filled it last
     week and it's low again" → ANSWERED slow.

   **UNANSWERED (keep the ID):**

   - Topic not mentioned at all.
   - "I think maybe" / "kind of" / "sort of" about that specific fact.

   **Example.** Customer: "I hear a grinding noise from the front right when
   braking." For 'metallic_grinding':
   - "Every time you brake?" → UNANSWERED
   - "Scraping with foot off pedal?" → UNANSWERED
   - "Front or rear? Left or right?" → **ANSWERED** (DROP)
   - "Grinding through floor or pedal?" → UNANSWERED
   - "Suddenly or gradually?" → UNANSWERED
   - "Feel safe driving?" → UNANSWERED
   - "Recent brake work?" → UNANSWERED
   Return: drop only the location ID, keep the other 6.

3. **Never invent IDs or slugs.** Only return values that appear above.

4. **Reasoning is for the audit log.** One sentence under 280 characters.

5. **Confidence is self-reported.** Pick one of high/medium/low:
   - **high** — the description clearly maps to ONE subcategory in the
     list above (e.g., "check engine light is flashing" → check_engine_light;
     "musty smell when I run the heat" → bad_smell_from_vents). You're
     also confident in your gap-detect choices (which questions the
     customer answered vs left open).
   - **medium** — the subcategory is the best of 2-3 plausible picks
     (e.g., "loud thump from the rear when I brake" — could be brake
     subcategory or suspension noise) OR you're unsure about which
     questions the description answered.
   - **low** — the description doesn't really fit any subcategory in
     the list above, OR you're forcing a match because Stage 1 picked
     a category but the symptom feels off. Low is a signal to a
     downstream advisor to verify the routing.`;
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

function collectEligibleSubcategorySlugs(cat: CatalogCategory): Set<string> {
  if (isOtherSubcategory(cat)) {
    return new Set([cat.subcategory_slug]);
  }
  return new Set(cat.subcategories.map((s) => s.slug));
}

function collectEligibleQuestionIds(
  cat: CatalogCategory,
  subcategorySlug: string,
): Set<number> {
  if (isOtherSubcategory(cat)) {
    if (cat.subcategory_slug !== subcategorySlug) return new Set();
    return new Set(cat.questions.map((q) => q.id));
  }
  const sub = cat.subcategories.find((s) => s.slug === subcategorySlug);
  if (!sub) return new Set();
  return new Set(sub.questions.map((q) => q.id));
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
  stage: 1 | 2;
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

// ─── Main two-stage entry point ────────────────────────────────────────────

export async function diagnoseConcern(
  args: DiagnoseConcernArgs,
): Promise<DiagnoseConcernResult> {
  const stage1Model = resolveStage1Model();
  const stage2Model = resolveStage2Model();
  const startedAt = Date.now();

  let tokensIn = 0;
  let tokensOut = 0;

  const failSafe = (errorMessage: string): DiagnoseConcernResult => ({
    matched_category_key: null,
    matched_kind: null,
    matched_subcategory_slug: null,
    recommended_testing_service: null,
    unanswered_question_ids: [],
    stage1_confidence: "low",
    stage2_confidence: "low",
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
      stage1_confidence: "low",
      stage2_confidence: "low",
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
      stage1_confidence: stage1Result.data.confidence,
      stage2_confidence: "low",
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
  // STAGE 2 — Pick subcategory + gap-detect questions
  // ════════════════════════════════════════════════════════════════════

  const stage2Fallback = (errorMessage: string): DiagnoseConcernResult => {
    if (isTestingService(matchedCat)) {
      return {
        matched_category_key: matchedCat.service_key,
        matched_kind: "testing_service",
        matched_subcategory_slug: null,
        recommended_testing_service: buildTestingServicePayload(matchedCat),
        unanswered_question_ids: [],
        stage1_confidence: stage1Result.data!.confidence,
        stage2_confidence: "low",
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
      stage1_confidence: stage1Result.data!.confidence,
      stage2_confidence: "low",
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

  const eligibleSubSlugs = collectEligibleSubcategorySlugs(matchedCat);
  const subSlug =
    stage2Result.data.matched_subcategory_slug &&
    eligibleSubSlugs.has(stage2Result.data.matched_subcategory_slug)
      ? stage2Result.data.matched_subcategory_slug
      : null;

  let unansweredIds: number[] = [];
  if (subSlug) {
    const eligibleQIds = collectEligibleQuestionIds(matchedCat, subSlug);
    const dedup = Array.from(new Set(stage2Result.data.unanswered_question_ids));
    unansweredIds = dedup.filter((id) => eligibleQIds.has(id));
  }

  if (isTestingService(matchedCat)) {
    return {
      matched_category_key: matchedCat.service_key,
      matched_kind: "testing_service",
      matched_subcategory_slug: subSlug,
      recommended_testing_service: buildTestingServicePayload(matchedCat),
      unanswered_question_ids: unansweredIds,
      stage1_confidence: stage1Result.data.confidence,
      stage2_confidence: stage2Result.data.confidence,
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
    stage1_confidence: stage1Result.data.confidence,
    stage2_confidence: stage2Result.data.confidence,
    parsed_ok: true,
    model: stage1Model,
    latency_ms: Date.now() - startedAt,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    error_message: "",
  };
}
