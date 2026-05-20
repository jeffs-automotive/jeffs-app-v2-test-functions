/**
 * diagnoseConcern — Phase 1 restoration (2026-05-17).
 *
 * Per chat-design.md §7 (and Chris's 2026-05-17 design clarification):
 * the LLM picks ONE of 20 categories from the customer's free-text
 * description, picks the relevant subcategory, and identifies which of
 * that subcategory's questions the description did NOT answer.
 *
 * The 20 categories are:
 *   - 14 testing_services (each is its own category for LLM purposes;
 *     matching this category drives a testing-service recommendation
 *     surfaced on the Step 7.5 testing_service_approval card)
 *   - 6 'other'-concern-category subcategories elevated to peer status
 *     (matching one of these drives the "forward-to-advisor" outcome —
 *     no testing service, no fee, advisor follows up)
 *
 * If no category fits confidently the LLM returns `matched_category_key
 * = null` and we route to the forward-to-advisor outcome as well.
 *
 * The catalog argument is the snapshot produced by loadDiagnosticCatalog.
 * Building the catalog is a per-run-diagnostics concern (one load shared
 * across all explanation_required_items); this LLM helper is per-concern.
 *
 * The 2026-05-14 amendment had narrowed this helper to gap-detection
 * only (no classification, no recommendation) on the assumption that
 * customers explicitly picked testing services from a chip section.
 * That assumption never matched the canonical spec; this version
 * restores the original classify + recommend + gap-detect behavior.
 *
 * Model: gemini-2.5-flash via Vercel AI Gateway (`google/gemini-2.5-flash`).
 * Override via DIAGNOSE_CONCERN_MODEL env var with any AI-Gateway model id
 * in `creator/model-name` form (e.g. `anthropic/claude-haiku-4-5`,
 * `google/gemini-2.5-pro`). Swapped from `anthropic/claude-haiku-4-5`
 * 2026-05-20 — see DEFAULT_MODEL comment block below.
 *
 * Fail-safe: any LLM/Zod error returns
 *   { matched_category_key: null, matched_subcategory_slug: null,
 *     recommended_testing_service: null, unanswered_question_ids: [] }
 * which routes to forward-to-advisor. The customer's free-text is still
 * persisted in explanation_text and forwarded in the transcript email.
 */
import { gateway } from "@ai-sdk/gateway";
import * as Sentry from "@sentry/nextjs";
import { generateObject } from "ai";
import { z } from "zod";

import type {
  CatalogCategory,
  DiagnosticCatalog,
  TestingServiceCategory,
} from "./load-diagnostic-catalog";
import {
  isOtherSubcategory,
  isTestingService,
} from "./load-diagnostic-catalog";

// Models are addressed via the Vercel AI Gateway in `creator/model-name`
// form. ONE credential (AI_GATEWAY_API_KEY, auto-injected by Vercel on
// deploys; manual env elsewhere) proxies all providers — no per-provider
// API key in this codebase. To swap models, change the string OR set
// DIAGNOSE_CONCERN_MODEL env var.
//
// 2026-05-20 — switched from `anthropic/claude-haiku-4-5` to
// `google/gemini-2.5-flash` to address the 16% schema-validation failure
// rate Haiku 4.5 showed in batch 1 of the diagnostic LLM test (4/25
// "No object generated: response did not match schema"). Gemini 2.5
// Flash has VALIDATED mode for strict constrained decoding which should
// be more reliable on long-context Zod schemas. Apples-to-apples
// flash-tier swap; escalation path is `google/gemini-2.5-pro` if Flash
// also struggles.
const DEFAULT_MODEL = "google/gemini-2.5-flash";
const MAX_OUTPUT_TOKENS = 1024;

export interface DiagnoseConcernChipHint {
  /** service_key of the picker chip that fired this concern_explanation
   *  (e.g., 'brake_inspection', 'check_battery', 'other_issue'). The LLM
   *  uses this as a soft prior — for non-other chips it biases toward
   *  testing services tagged with the chip's concern_categories; for
   *  'other_issue' the LLM picks freely from the full catalog. */
  chip_service_key: string;
  chip_display_name: string;
  /** From routine_services.concern_categories[] (or testing_services if
   *  the chip happens to live there). Empty for 'other_issue' — no
   *  prior. */
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
  /** The matched category key — a testing_services.service_key OR an
   *  'other' subcategory slug. null when the LLM couldn't categorize. */
  matched_category_key: string | null;
  matched_kind: "testing_service" | "other_subcategory" | null;
  /** The matched subcategory slug. For testing-service matches: one of
   *  the testing service's eligible concern_subcategories. For
   *  'other_subcategory' matches: same as matched_category_key (the
   *  elevated 'other' subcategory IS the subcategory). null when no
   *  match. */
  matched_subcategory_slug: string | null;
  /** Populated when matched_kind === 'testing_service'. Carries the
   *  pricing + description for downstream display on testing_service_
   *  approval. Null for 'other_subcategory' matches and null-match
   *  outcomes. */
  recommended_testing_service: {
    service_key: string;
    display_name: string;
    description: string | null;
    starting_price_cents: number;
  } | null;
  /** Question IDs (from the matched subcategory) the description did
   *  NOT meaningfully answer. Surfaced as clarification_question cards. */
  unanswered_question_ids: number[];
  /** True when LLM call + parse + catalog validation all succeeded. */
  parsed_ok: boolean;
  model: string;
  latency_ms: number;
  tokens_in: number;
  tokens_out: number;
  /** Empty on success; failure reason otherwise. */
  error_message: string;
}

const Schema = z.object({
  matched_category_key: z
    .string()
    .nullable()
    .describe(
      "Either a testing_services.service_key (one of the 14) OR an 'other' subcategory slug (one of the 6). " +
        "Return null when the description is too vague to categorize OR doesn't fit any catalog entry.",
    ),
  matched_subcategory_slug: z
    .string()
    .nullable()
    .describe(
      "The subcategory slug whose questions best match the customer's symptoms. " +
        "For testing-service matches: one of that service's eligible subcategories. " +
        "For 'other' subcategory matches: same value as matched_category_key. " +
        "null when matched_category_key is null.",
    ),
  unanswered_question_ids: z
    .array(z.number().int().positive())
    .describe(
      "IDs from the matched subcategory's question set that the description did NOT meaningfully answer. " +
        "Empty when the description covers everything OR when matched_category_key is null.",
    ),
  reasoning: z
    .string()
    .max(280)
    .describe(
      "One sentence citing (a) the chosen category + subcategory and (b) the customer words that drove the match. Audit-only.",
    ),
});

function fmtPriceForLLM(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Exported for the diagnose-concern eval harness (scripts/eval-diagnose-
 * concern.ts) so it can capture the verbatim system prompt sent to the
 * LLM. Not used in the wizard hot path; the action calls diagnoseConcern
 * directly which builds the prompt internally.
 */
export function buildSystemPrompt(args: DiagnoseConcernArgs): string {
  const testingServices = args.catalog.categories.filter(isTestingService);
  const otherSubcategories = args.catalog.categories.filter(isOtherSubcategory);

  const testingServicesBlock = testingServices
    .map((t, i) => {
      const subList = t.subcategories
        .map((s) => s.slug)
        .join(", ") || "(no subcategories seeded)";
      return [
        `${i + 1}. service_key="${t.service_key}" — ${t.display_name} (${fmtPriceForLLM(t.starting_price_cents)})`,
        `   What we'd do: ${t.description ?? "—"}`,
        `   Concern categories tagged: ${t.concern_categories.join(", ") || "(none)"}`,
        `   Eligible subcategories: ${subList}`,
      ].join("\n");
    })
    .join("\n\n");

  const otherSubcategoriesBlock = otherSubcategories
    .map(
      (o, i) =>
        `${testingServices.length + i + 1}. subcategory_slug="${o.subcategory_slug}" — ${o.display_label}`,
    )
    .join("\n");

  // Build the question catalog grouped by subcategory_slug. Each entry
  // shows id + question text + the option labels (joined as a hint to the
  // LLM about answer shape — keeps the schema's int-IDs payload tight).
  const subcategoriesById = new Map<
    string,
    { display_label: string; questions: typeof testingServices[number]["subcategories"][number]["questions"] }
  >();
  for (const t of testingServices) {
    for (const s of t.subcategories) {
      if (!subcategoriesById.has(s.slug)) {
        subcategoriesById.set(s.slug, {
          display_label: s.display_label,
          questions: s.questions,
        });
      }
    }
  }
  for (const o of otherSubcategories) {
    if (!subcategoriesById.has(o.subcategory_slug)) {
      subcategoriesById.set(o.subcategory_slug, {
        display_label: o.display_label,
        questions: o.questions,
      });
    }
  }

  const questionsBlock = Array.from(subcategoriesById.entries())
    .map(([slug, group]) => {
      const lines = group.questions
        .map((q) => {
          const optionLabels = q.options.map((o) => o.label).join(" / ");
          return `    - id=${q.id}: "${q.question_text}" (options: ${optionLabels})`;
        })
        .join("\n");
      return `  ## subcategory_slug="${slug}" — ${group.display_label}\n${lines || "    (no questions seeded yet)"}`;
    })
    .join("\n\n");

  const chipHintLine = args.customer_chip_hint
    ? args.customer_chip_hint.chip_service_key === "other_issue"
      ? `The customer picked the "💬 Other Issue" pseudo-chip — no pre-classification; classify from description alone, considering all 20 categories.`
      : `The customer picked the "${args.customer_chip_hint.chip_display_name}" chip (related concern_categories: ${args.customer_chip_hint.chip_concern_categories.join(", ") || "none"}). Use this as a soft prior — prefer testing services tagged with one of those concern_categories unless the description clearly says otherwise.`
    : "No chip hint — classify from description alone.";

  return `You are the diagnostic categorisation helper for Jeff's Automotive. A customer
typed a description of what's wrong with their car. Your job:

  1. Pick ONE category from the 20 below — either a testing_service or an
     'other' subcategory.
  2. Pick the subcategory whose questions best match the customer's symptoms.
  3. Return the IDs of subcategory questions the description did NOT answer.

If the description is too vague or doesn't fit any category clearly, return
matched_category_key=null. Empty/very-short descriptions count as "doesn't fit."

# Category catalog (20 items)

## Testing services (14) — these drive a recommendation + fee

${testingServicesBlock}

## 'Other' situations (6) — these route to a service advisor (no testing service, no fee)

These elevated subcategories cover concerns that don't map to a specific test:
multiple symptoms at once, recent accidents, work just done elsewhere, safety
worries, general inspections, cars that have been sitting.

${otherSubcategoriesBlock}

# Question catalog (grouped by subcategory)

${questionsBlock}

# Customer's pre-selection (context)

${chipHintLine}

# Decision rules

1. **Match category to the customer's actual symptoms.** Read the description
   carefully and pick the category whose subcategories cover the described
   issue. The chip hint is a prior, not a constraint — if the customer picked
   Brake Inspection but described an A/C problem, match the A/C-relevant
   testing service (or the relevant 'other' subcategory if no test fits).

2. **'Other' subcategory matches are valid AND useful.** If the customer's
   description is about a situation (recent accident, car has been sitting,
   pre-trip check, multiple symptoms at once with no primary), match the
   appropriate 'other' subcategory_slug. Don't try to force a testing service
   when the situation truly doesn't fit one.

3. **Couldn't categorize is a valid answer.** When the description is too
   vague ("car feels weird", "something's off", < ~5 useful words), return
   matched_category_key=null. The system will forward to a service advisor.

4. **Subcategory must belong to the matched category.** For testing-service
   matches, the subcategory must appear in that service's "Eligible
   subcategories" list above. For 'other' matches, matched_subcategory_slug
   equals matched_category_key.

5. **Gap-detect questions from the matched subcategory only.** Don't return
   IDs from other subcategories. A question is "answered" when the customer's
   description states the FACT the question asks about — even if they used
   different words. A question is "unanswered" only when the description
   doesn't speak to it at all OR mentions it ambiguously without committing
   to a value.

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
   - The description mentions the topic but in a way that doesn't pin
     down which option the customer would pick (e.g., "the noise comes
     from somewhere up front" → answers front-vs-rear but NOT
     left-vs-right; this still counts as ANSWERED because "front" alone
     is a valid chip and we don't ask twice).

   **Worked example.** Customer says: "I hear a grinding noise coming from
   the front right when braking."

   For the 'metallic_grinding' subcategory's question set:
   - 630 ("Every single time you brake?") → UNANSWERED (description didn't say "every time")
   - 631 ("Scraping with foot off the pedal?") → UNANSWERED (not mentioned)
   - 632 ("Front or rear? Left or right side?") → **ANSWERED** ("front right" is in the description) — DROP this ID.
   - 633 ("Grinding through floor or pedal?") → UNANSWERED (not mentioned)
   - 634 ("Suddenly or gradually?") → UNANSWERED (not mentioned)
   - 635 ("Feel safe driving?") → UNANSWERED (not mentioned)
   - 636 ("Recent brake work?") → UNANSWERED (not mentioned)

   Correct return: unanswered_question_ids: [630, 631, 633, 634, 635, 636].

   The location question (632) is DROPPED because "front right" is a complete
   answer. Asking the customer "where is the noise coming from?" when they
   just told you would feel robotic.

6. **Never invent IDs or slugs.** Only return values that appear in the
   catalog above.

7. **Reasoning is for the audit log.** One sentence citing the matched
   subcategory + the customer's actual words. No formatting.`;
}

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
 * Validate the LLM's output against the catalog. Returns null when the
 * matched key/subcategory aren't in the catalog (treat as fail-safe).
 */
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

function collectEligibleSubcategorySlugs(
  cat: CatalogCategory,
): Set<string> {
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

export async function diagnoseConcern(
  args: DiagnoseConcernArgs,
): Promise<DiagnoseConcernResult> {
  const model = process.env.DIAGNOSE_CONCERN_MODEL || DEFAULT_MODEL;
  const startedAt = Date.now();

  const failSafe = (errorMessage: string): DiagnoseConcernResult => ({
    matched_category_key: null,
    matched_kind: null,
    matched_subcategory_slug: null,
    recommended_testing_service: null,
    unanswered_question_ids: [],
    parsed_ok: false,
    model,
    latency_ms: Date.now() - startedAt,
    tokens_in: 0,
    tokens_out: 0,
    error_message: errorMessage,
  });

  // Short-circuit on near-empty descriptions — let the system forward to
  // an advisor rather than ask the LLM to invent an answer from 2 words.
  const desc = (args.customer_description ?? "").trim();
  if (desc.length < 3) {
    return {
      matched_category_key: null,
      matched_kind: null,
      matched_subcategory_slug: null,
      recommended_testing_service: null,
      unanswered_question_ids: [],
      parsed_ok: true,
      model,
      latency_ms: 0,
      tokens_in: 0,
      tokens_out: 0,
      error_message: "",
    };
  }

  if (args.catalog.categories.length === 0) {
    return failSafe("empty_catalog");
  }

  let parsed: z.infer<typeof Schema>;
  let tokensIn = 0;
  let tokensOut = 0;
  try {
    const result = await generateObject({
      model: gateway(model),
      system: buildSystemPrompt(args),
      prompt: buildUserPrompt(args),
      schema: Schema,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // OBS-5: emit Vercel AI SDK telemetry so Sentry can capture gen_ai.*
      // spans (model, tokens, latency). Pairs with vercelAIIntegration in
      // sentry.server.config.ts. recordInputs/recordOutputs DELIBERATELY
      // false — customer concern text is PII (vehicle complaints can include
      // phone-like patterns, plate numbers, free-form descriptions).
      experimental_telemetry: {
        isEnabled: true,
        functionId: "diagnose-concern",
        recordInputs: false,
        recordOutputs: false,
      },
    });
    parsed = result.object;
    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    tokensIn = Number(usage.inputTokens ?? 0);
    tokensOut = Number(usage.outputTokens ?? 0);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Defensive: Sentry may not be initialised in non-Next.js contexts
    // (e.g., the scripts/eval-diagnose-concern.ts CLI harness). The
    // module namespace is frozen so we can't monkey-patch; instead wrap
    // the call so failSafe still runs with the real LLM error message.
    // In production this try/catch never triggers — Sentry is alive.
    try {
      Sentry.captureException(e, {
        tags: { surface: "diagnose_concern_llm" },
        level: "warning",
        extra: { description_len: desc.length },
      });
    } catch {
      // Sentry unavailable — proceed with the fail-safe; the real error
      // still makes it back to the caller via error_message.
    }
    return failSafe(`llm_call_failed: ${msg.slice(0, 200)}`);
  }

  // Validate matched_category_key against catalog. If invalid, fall back
  // to the no-match outcome — better to forward to advisor than to act
  // on a hallucinated key.
  const matchedCat = findMatchedCategory(
    args.catalog,
    parsed.matched_category_key,
  );
  if (!matchedCat) {
    return {
      matched_category_key: null,
      matched_kind: null,
      matched_subcategory_slug: null,
      recommended_testing_service: null,
      unanswered_question_ids: [],
      parsed_ok: true,
      model,
      latency_ms: Date.now() - startedAt,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      error_message: parsed.matched_category_key
        ? `invalid_category_key:${parsed.matched_category_key.slice(0, 50)}`
        : "",
    };
  }

  // Validate matched_subcategory_slug is one of the matched category's
  // eligible subcategories. If invalid, drop to the no-question
  // outcome (we'll recommend the service but skip clarification).
  const eligibleSubSlugs = collectEligibleSubcategorySlugs(matchedCat);
  const subSlug =
    parsed.matched_subcategory_slug &&
    eligibleSubSlugs.has(parsed.matched_subcategory_slug)
      ? parsed.matched_subcategory_slug
      : null;

  let unansweredIds: number[] = [];
  if (subSlug) {
    const eligibleQIds = collectEligibleQuestionIds(matchedCat, subSlug);
    const dedup = Array.from(new Set(parsed.unanswered_question_ids));
    unansweredIds = dedup.filter((id) => eligibleQIds.has(id));
  }

  if (isTestingService(matchedCat)) {
    return {
      matched_category_key: matchedCat.service_key,
      matched_kind: "testing_service",
      matched_subcategory_slug: subSlug,
      recommended_testing_service: buildTestingServicePayload(matchedCat),
      unanswered_question_ids: unansweredIds,
      parsed_ok: true,
      model,
      latency_ms: Date.now() - startedAt,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      error_message: "",
    };
  }

  // 'other' subcategory match — no testing service recommendation.
  return {
    matched_category_key: matchedCat.subcategory_slug,
    matched_kind: "other_subcategory",
    matched_subcategory_slug: matchedCat.subcategory_slug,
    recommended_testing_service: null,
    unanswered_question_ids: unansweredIds,
    parsed_ok: true,
    model,
    latency_ms: Date.now() - startedAt,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    error_message: "",
  };
}
