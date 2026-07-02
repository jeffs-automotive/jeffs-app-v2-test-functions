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
// native structured outputs (GA `output_config.format` — synced 2026-07-02
// with production diagnose-concern.ts, off the deprecated output_format
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
import { withSentryScope } from "../_shared/sentry-edge.ts";
import { STAGE1_MODEL, STAGE2_MODEL, STAGE3_MODEL, CORS_HEADERS, anthropic } from "./config.ts";
import { isTestingService, isOtherSubcategory, getCatalog } from "./catalog.ts";
import { matchQuestionsToFacts, type QuestionForFactMatch, type QuestionFactMatcherOutput } from "./fact-matcher.ts";
import { STAGE1_JSON_SCHEMA, STAGE2_JSON_SCHEMA, STAGE3_JSON_SCHEMA, Stage1ResponseSchema, Stage2ResponseSchema, Stage3ResponseSchema } from "./stage-schemas.ts";
import { buildStage1SystemPrompt, buildStage2SystemPrompt, categoryHeaderForStage3, buildStage3SystemPrompt, buildUserPrompt, totalPromptChars, type ChipHint } from "./prompts.ts";
import { callAnthropicStage } from "./anthropic-stage.ts";
import { findMatchedCategory, findMatchedSubcategory, collectAllCategoryQuestionIds } from "./match-helpers.ts";

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
      structured_outputs: "ga-output_config.format",
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
