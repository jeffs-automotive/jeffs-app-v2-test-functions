/**
 * diagnoseConcern — Two-stage diagnostic classifier (refactored 2026-05-20).
 *
 * Architecture (per design doc dated 2026-05-20, lockd before implementation):
 *
 *   Stage 1 — Match category
 *     Input:  customer concern + chip hint + brief catalog
 *             (testing-service names + descriptions + concern_categories;
 *              'other' subcategory slugs only — NO subcategory tree, NO
 *              questions, NO option lists)
 *     Output: { matched_category_key, reasoning }
 *     Prompt: ~5-8 KB (down from ~130 KB in the legacy single-stage path)
 *
 *   Stage 2 — Pick subcategory + gap-detect questions
 *     Skipped when Stage 1 returned null (LLM declined) OR when post-
 *     validation found matched_category_key is not in the catalog.
 *     Input:  customer concern + the matched category's eligible
 *             subcategories with their questions ONLY
 *     Output: { matched_subcategory_slug, unanswered_question_ids, reasoning }
 *     Prompt: ~2-5 KB
 *
 * Why two stages
 *   - The legacy single-pass path embedded the entire 729-question catalog
 *     into every call (~130 KB / ~38 K tokens). Both Haiku 4.5 and Gemini
 *     2.5 Flash hit 16-28% schema-validation failure rates with that
 *     prompt size; investigation surfaced prompt-size-driven CFG breakage
 *     as the likely root cause. Smaller per-stage prompts hold structured
 *     output more reliably.
 *   - Catalog can grow without proportionally bloating every call. Stage 2
 *     only loads the matched category's tree — a 10x catalog growth
 *     barely affects Stage 2's prompt size.
 *   - Per-stage caching is cheap to enable via the Vercel AI Gateway
 *     (`providerOptions.gateway.caching = 'auto'`).
 *
 * Error semantics (per design table)
 *   Stage 1 throws / schema fail   → forward-to-advisor, parsed_ok=false
 *   Stage 1 returns null            → forward-to-advisor, parsed_ok=true
 *   Stage 1 hallucinated category   → forward-to-advisor, parsed_ok=true,
 *                                     error_message=invalid_category_key:...
 *   Stage 2 throws / schema fail   → testing-service match preserved,
 *                                     subcategory=null, ids=[], parsed_ok=true
 *                                     (partial), error_message=stage2_failed:...
 *   Stage 2 hallucinated subcategory → testing-service match preserved,
 *                                     subcategory=null, ids=[]
 *   Stage 2 hallucinated IDs        → silently filtered (same as legacy)
 *
 * Caching
 *   Both stages set providerOptions.gateway.caching='auto' so the Vercel
 *   AI Gateway adds provider-native cache markers when supported (per
 *   vercel.com/docs/ai-gateway/models-and-providers/automatic-caching).
 *   For Anthropic-routed models this yields ~10% billing on cached
 *   input tokens. For Gemini-routed models the gateway docs are
 *   ambiguous; we send the directive anyway (harmless no-op if unsupported).
 *
 * Model
 *   Both stages route through the gateway with the same model id (default
 *   `google/gemini-2.5-flash`). Per-stage override via env var
 *   DIAGNOSE_CONCERN_STAGE1_MODEL / DIAGNOSE_CONCERN_STAGE2_MODEL; combined
 *   override via DIAGNOSE_CONCERN_MODEL (legacy compat).
 *
 * Public API contract — DiagnoseConcernResult shape is UNCHANGED. The
 * wizard's downstream code (run-diagnostics action) doesn't know there
 * are two stages.
 *
 * Fail-safe: any LLM/Zod error returns
 *   { matched_category_key: null, matched_subcategory_slug: null,
 *     recommended_testing_service: null, unanswered_question_ids: [] }
 * which routes to forward-to-advisor.
 *
 * Legacy `buildSystemPrompt` / `buildUserPrompt` exports are kept as
 * aliases for the Stage 1 prompts (the legacy eval harness uses them
 * for prompt-inspection reporting; the harness sees only Stage 1 since
 * Stage 2's prompt depends on Stage 1's output).
 */
import { gateway } from "@ai-sdk/gateway";
import * as Sentry from "@sentry/nextjs";
import { generateObject } from "ai";
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

// 2026-05-20 — defaulted to anthropic/claude-haiku-4-5 for BOTH stages after
// batch 2 (Gemini 2-stage) showed Gemini struggling on Stage 2's int-array
// schema (10/25 "No object generated" failures, consistent across prompt
// sizes 4-36 KB). Anthropic + AI-Gateway caching is the actual realized
// cost-win path (vercel.com/docs/ai-gateway/models-and-providers/
// automatic-caching documents auto-cache markers for Anthropic; Gemini
// support is ambiguous). Per-stage env overrides still work — set
// DIAGNOSE_CONCERN_STAGE1_MODEL or DIAGNOSE_CONCERN_STAGE2_MODEL to any
// AI-Gateway model id in `creator/model-name` form to swap individual
// stages without redeploying.
const DEFAULT_MODEL = "anthropic/claude-haiku-4-5";
const MAX_OUTPUT_TOKENS = 1024;

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

// ─── Public argument + result types ─────────────────────────────────────────

export interface DiagnoseConcernChipHint {
  /** service_key of the picker chip that fired this concern_explanation
   *  (e.g., 'brake_inspection', 'check_battery', 'other_issue'). */
  chip_service_key: string;
  chip_display_name: string;
  /** From routine_services.concern_categories[] (or testing_services if
   *  the chip happens to live there). Empty for 'other_issue'. */
  chip_concern_categories: string[];
}

export interface DiagnoseConcernArgs {
  catalog: DiagnosticCatalog;
  /** What the customer typed in the Step 7.2 concern_explanation card. */
  customer_description: string;
  /** Optional pre-selection hint from the picker chip. null for the
   *  'other_issue' pseudo-chip. */
  customer_chip_hint?: DiagnoseConcernChipHint | null;
  /** Optional new-vehicle notes from Step 6 (vehicle.notes field). */
  vehicle_notes?: string | null;
}

export interface DiagnoseConcernResult {
  /** A testing_services.service_key OR an 'other' subcategory slug. null
   *  when the LLM couldn't categorize. */
  matched_category_key: string | null;
  matched_kind: "testing_service" | "other_subcategory" | null;
  /** Subcategory slug. For testing-service matches: one of that service's
   *  eligible subcategories. For 'other' matches: same as
   *  matched_category_key. null when no match OR when Stage 2 failed. */
  matched_subcategory_slug: string | null;
  recommended_testing_service: {
    service_key: string;
    display_name: string;
    description: string | null;
    starting_price_cents: number;
  } | null;
  /** Question IDs (from the matched subcategory) the description did
   *  NOT meaningfully answer. */
  unanswered_question_ids: number[];
  /** True when at least Stage 1 succeeded. Stage 2 partial-failures still
   *  return parsed_ok=true (the wizard can still recommend the service,
   *  it just won't ask clarifying questions). */
  parsed_ok: boolean;
  /** Reflects the Stage 1 model (since that's the primary classifier).
   *  Stage 2 may use a different model — captured in error_message if so. */
  model: string;
  /** Sum across both stages. */
  latency_ms: number;
  /** Sum across both stages. */
  tokens_in: number;
  /** Sum across both stages. */
  tokens_out: number;
  /** Empty on full success. Otherwise: short token-prefixed reason
   *  (`invalid_category_key:`, `stage1_failed:`, `stage2_failed:`,
   *  `empty_catalog`, etc.). */
  error_message: string;
}

// ─── Zod schemas (one per stage) ────────────────────────────────────────────

const Stage1Schema = z.object({
  matched_category_key: z
    .string()
    .nullable()
    .describe(
      "Either a testing_services.service_key from the catalog above OR an " +
        "'other' subcategory slug. Return null when the description is too " +
        "vague to categorize OR doesn't fit any catalog entry.",
    ),
  reasoning: z
    .string()
    .max(280)
    .describe(
      "One sentence citing the chosen category and the customer words that " +
        "drove the match. Audit-only.",
    ),
});

const Stage2Schema = z.object({
  matched_subcategory_slug: z
    .string()
    .nullable()
    .describe(
      "The subcategory slug whose questions best match the customer's " +
        "symptoms. MUST appear in the subcategory list above. null only if " +
        "you genuinely can't pick (rare — prefer to pick the closest match).",
    ),
  unanswered_question_ids: z
    .array(z.number().int().positive())
    .describe(
      "IDs from the matched subcategory's question set that the description " +
        "did NOT meaningfully answer. Empty when the description covers all " +
        "questions.",
    ),
  reasoning: z
    .string()
    .max(280)
    .describe(
      "One sentence citing the chosen subcategory and which customer words " +
        "drove the gap-detect decisions. Audit-only.",
    ),
});

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

/**
 * Build the Stage 1 system prompt — the COMPACT category catalog only.
 * Includes testing-service names + descriptions + concern_categories tags,
 * plus the 'other' subcategory slugs with their display labels.
 * Does NOT include subcategory tree or question lists (Stage 2's job).
 */
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
   the described issue. The chip hint is a prior, not a constraint — if the
   customer picked Brake Inspection but described an A/C problem, match the
   A/C-relevant testing service (or the relevant 'other' subcategory if no
   test fits).

2. **'Other' subcategory matches are valid AND useful.** If the customer's
   description is about a situation (recent accident, car has been sitting,
   pre-trip check, multiple symptoms at once with no primary), match the
   appropriate 'other' subcategory_slug. Don't try to force a testing service
   when the situation truly doesn't fit one.

3. **Couldn't categorize is a valid answer.** When the description is too
   vague ("car feels weird", "something's off", < ~5 useful words), return
   matched_category_key=null. The system will forward to a service advisor.

4. **Never invent IDs or slugs.** Only return values that appear in the
   catalog above.

5. **Reasoning is for the audit log.** One sentence citing the matched
   category + the customer's actual words. No formatting.`;
}

// ─── Stage 2 system prompt (ONE category's subcategories + questions) ───────

/**
 * Build the Stage 2 system prompt for the matched category. Includes
 * subcategory headers + question lists (with options) ONLY for the matched
 * category. For testing-service matches: all reachable subcategories. For
 * 'other' matches: the single elevated subcategory.
 */
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

2. **Gap-detect questions from the matched subcategory only.** Don't return
   IDs from a different subcategory. A question is "answered" when the
   customer's description states the FACT the question asks about — even if
   they used different words. A question is "unanswered" only when the
   description doesn't speak to it at all OR mentions it ambiguously without
   committing to a value.

   **Concrete patterns that count as ANSWERED (drop the ID):**

   - Location/side question ("Front or rear? Left or right side?"):
     • "front right" / "rear left" / "all four wheels" / "passenger side" /
       "driver side" / "front" alone / "rear" alone → ANSWERED.
     • Even a single side word ("on the right") covers the side facet —
       drop the question; we're not going to re-ask just to also pin down
       front-vs-rear when the description is already informative.

   - Onset question ("Suddenly or gradually?"):
     • "started suddenly" / "started yesterday" / "appeared overnight" /
       "out of nowhere" → ANSWERED with "suddenly."
     • "getting worse over weeks" / "slowly developed" / "gradually" /
       "for months" → ANSWERED with "gradually."

   - Trigger question ("When does it happen?"):
     • "only when braking" / "when I press the brakes" → ANSWERED for
       brake-trigger questions.
     • "over bumps" / "on rough roads" → ANSWERED for bump-trigger questions.
     • "at highway speed" / "above 60 mph" → ANSWERED for speed-band
       questions.

   - Recent-service question ("Recent brake work / battery replacement?"):
     • "just replaced the pads last month" / "new battery installed
       Tuesday" → ANSWERED with "yes — recently."
     • "no recent work" / "haven't touched it" → ANSWERED with "no."
     • Silence on history → UNANSWERED.

   **Concrete patterns that count as UNANSWERED (keep the ID):**

   - The description doesn't mention the topic AT ALL.
   - The description says "I think maybe" or "kind of" or "sort of" about
     the specific fact the question asks about (genuinely ambiguous).

   **Worked example.** Customer: "I hear a grinding noise from the front
   right when braking." For 'metallic_grinding':
   - "Every time you brake?" → UNANSWERED (description didn't say "every time")
   - "Scraping with foot off the pedal?" → UNANSWERED (not mentioned)
   - "Front or rear? Left or right?" → **ANSWERED** ("front right") — DROP.
   - "Grinding through floor or pedal?" → UNANSWERED (not mentioned)
   - "Suddenly or gradually?" → UNANSWERED (not mentioned)
   - "Feel safe driving?" → UNANSWERED (not mentioned)
   - "Recent brake work?" → UNANSWERED (not mentioned)
   Correct: drop only the location ID, return the other 6.

3. **Never invent IDs or slugs.** Only return values that appear above.

4. **Reasoning is for the audit log.** One sentence citing the matched
   subcategory + which customer words drove the gap-detect choices.`;
}

// ─── Shared user prompt (concern + vehicle notes) ───────────────────────────

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

// ─── Legacy export aliases (eval-diagnose-concern.ts back-compat) ──────────

/**
 * Legacy alias — was the OLD single-stage system prompt. After the
 * 2026-05-20 two-stage refactor this now returns the Stage 1 prompt
 * (Stage 2's prompt depends on the matched category from Stage 1 and so
 * can't be built without first running the LLM).
 */
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

// ─── Main two-stage entry point ────────────────────────────────────────────

export async function diagnoseConcern(
  args: DiagnoseConcernArgs,
): Promise<DiagnoseConcernResult> {
  const stage1Model = resolveStage1Model();
  const stage2Model = resolveStage2Model();
  const startedAt = Date.now();

  // Cumulative usage trackers. Both stages add to these so the public
  // result reflects total token spend.
  let tokensIn = 0;
  let tokensOut = 0;

  const failSafe = (errorMessage: string): DiagnoseConcernResult => ({
    matched_category_key: null,
    matched_kind: null,
    matched_subcategory_slug: null,
    recommended_testing_service: null,
    unanswered_question_ids: [],
    parsed_ok: false,
    model: stage1Model,
    latency_ms: Date.now() - startedAt,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    error_message: errorMessage,
  });

  // ── Pre-flight: short-circuit on near-empty descriptions ─────────────
  const desc = (args.customer_description ?? "").trim();
  if (desc.length < 3) {
    return {
      matched_category_key: null,
      matched_kind: null,
      matched_subcategory_slug: null,
      recommended_testing_service: null,
      unanswered_question_ids: [],
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
  let stage1Parsed: z.infer<typeof Stage1Schema>;
  try {
    const result = await generateObject({
      model: gateway(stage1Model),
      system: buildStage1SystemPrompt(args),
      prompt: buildUserPrompt(args),
      schema: Stage1Schema,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      providerOptions: {
        gateway: { caching: "auto" },
      },
      experimental_telemetry: {
        isEnabled: true,
        functionId: "diagnose-concern-stage1",
        recordInputs: false,
        recordOutputs: false,
      },
    });
    stage1Parsed = result.object;
    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    tokensIn += Number(usage.inputTokens ?? 0);
    tokensOut += Number(usage.outputTokens ?? 0);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      Sentry.captureException(e, {
        tags: { surface: "diagnose_concern_llm", stage: "1" },
        level: "warning",
        extra: { description_len: desc.length },
      });
    } catch {
      // Sentry unavailable in CLI/edge contexts — the fail-safe still runs.
    }
    return failSafe(`stage1_failed: ${msg.slice(0, 200)}`);
  }

  // Validate Stage 1 output against the catalog.
  const matchedCat = findMatchedCategory(
    args.catalog,
    stage1Parsed.matched_category_key,
  );
  if (!matchedCat) {
    // Either LLM returned null (declined) or hallucinated a slug.
    return {
      matched_category_key: null,
      matched_kind: null,
      matched_subcategory_slug: null,
      recommended_testing_service: null,
      unanswered_question_ids: [],
      parsed_ok: true,
      model: stage1Model,
      latency_ms: Date.now() - startedAt,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      error_message: stage1Parsed.matched_category_key
        ? `invalid_category_key:${stage1Parsed.matched_category_key.slice(0, 50)}`
        : "",
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // STAGE 2 — Pick subcategory + gap-detect questions
  // ════════════════════════════════════════════════════════════════════

  // Pre-build the fallback result for stage 2 failures: we still got a
  // valid stage-1 match, so the wizard can recommend the testing service
  // (if applicable) — just without clarifying questions.
  const stage2Fallback = (
    errorMessage: string,
  ): DiagnoseConcernResult => {
    if (isTestingService(matchedCat)) {
      return {
        matched_category_key: matchedCat.service_key,
        matched_kind: "testing_service",
        matched_subcategory_slug: null,
        recommended_testing_service: buildTestingServicePayload(matchedCat),
        unanswered_question_ids: [],
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
      parsed_ok: true,
      model: stage1Model,
      latency_ms: Date.now() - startedAt,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      error_message: errorMessage,
    };
  };

  let stage2Parsed: z.infer<typeof Stage2Schema>;
  try {
    const result = await generateObject({
      model: gateway(stage2Model),
      system: buildStage2SystemPrompt(matchedCat, args.customer_chip_hint),
      prompt: buildUserPrompt(args),
      schema: Stage2Schema,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      providerOptions: {
        gateway: { caching: "auto" },
      },
      experimental_telemetry: {
        isEnabled: true,
        functionId: "diagnose-concern-stage2",
        recordInputs: false,
        recordOutputs: false,
      },
    });
    stage2Parsed = result.object;
    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    tokensIn += Number(usage.inputTokens ?? 0);
    tokensOut += Number(usage.outputTokens ?? 0);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      Sentry.captureException(e, {
        tags: { surface: "diagnose_concern_llm", stage: "2" },
        level: "warning",
        extra: {
          description_len: desc.length,
          matched_category_key: matchedCat
            ? (isTestingService(matchedCat)
                ? matchedCat.service_key
                : matchedCat.subcategory_slug)
            : null,
        },
      });
    } catch {
      // Sentry unavailable.
    }
    return stage2Fallback(`stage2_failed: ${msg.slice(0, 200)}`);
  }

  // Validate Stage 2 subcategory_slug against the matched category's
  // eligible set. If invalid, drop to the no-question outcome (we still
  // recommend the service / forward to advisor without clarification).
  const eligibleSubSlugs = collectEligibleSubcategorySlugs(matchedCat);
  const subSlug =
    stage2Parsed.matched_subcategory_slug &&
    eligibleSubSlugs.has(stage2Parsed.matched_subcategory_slug)
      ? stage2Parsed.matched_subcategory_slug
      : null;

  let unansweredIds: number[] = [];
  if (subSlug) {
    const eligibleQIds = collectEligibleQuestionIds(matchedCat, subSlug);
    const dedup = Array.from(new Set(stage2Parsed.unanswered_question_ids));
    unansweredIds = dedup.filter((id) => eligibleQIds.has(id));
  }

  // Compose final result.
  if (isTestingService(matchedCat)) {
    return {
      matched_category_key: matchedCat.service_key,
      matched_kind: "testing_service",
      matched_subcategory_slug: subSlug,
      recommended_testing_service: buildTestingServicePayload(matchedCat),
      unanswered_question_ids: unansweredIds,
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
    parsed_ok: true,
    model: stage1Model,
    latency_ms: Date.now() - startedAt,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    error_message: "",
  };
}
