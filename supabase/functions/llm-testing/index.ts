// llm-testing — Path C diagnostic concern eval (Anthropic SDK + AI Gateway).
//
// Mirrors scheduler-app/src/lib/scheduler/wizard/llm/diagnose-concern.ts
// (Path C refactor 2026-05-20): native @anthropic-ai/sdk pointed at the
// Vercel AI Gateway as base URL, using Anthropic's native structured
// outputs API (output_format + structured-outputs-2025-11-13 beta) with
// gateway.caching + gateway.models fallback chain via providerOptions.
//
// Why Path C: bypasses the @ai-sdk/gateway generateObject path's
// documented Anthropic-compat bugs (#12020, #13355, #13460, #14342) by
// using Anthropic's own SDK with Anthropic's own structured outputs API.
// Anthropic SDK auto-strips unsupported JSON Schema keywords; the
// Vercel AI SDK does not. Documented <0.1% schema-failure rate
// (vs ~16% on the previous generateObject path).
//
// Response shape: stage1 + stage2 blocks with raw + validated state per
// stage. Lets the harness detect hallucinations / silent filtering at
// each stage independently. Same shape as the AI-SDK version this
// replaces, so run-llm-test-batch.mjs needs no changes.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@^0.97";
import { z } from "npm:zod@^4";

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
        "id, slug, category, display_label, display_order, active, eligible_testing_service_keys",
      )
      .eq("shop_id", SHOP_ID)
      .eq("active", true)
      .order("display_order", { ascending: true }),
    sb
      .from("concern_questions")
      .select(
        "id, question_text, options, display_order, subcategory_id, active, multi_select",
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
  }>;
  const questionRows = (questionRes.data ?? []) as Array<{
    id: number;
    question_text: string;
    options: unknown;
    display_order: number;
    subcategory_id: number;
    active: boolean;
    multi_select: boolean;
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
// JSON SCHEMAS + ZOD SCHEMAS (mirror diagnose-concern.ts)
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
        "Self-reported confidence in matched_category_key. 'high' = " +
        "description clearly names the system/symptom that maps to ONE " +
        "category (e.g., 'ABS light is on' → warning_light_general). " +
        "'medium' = best of 2-3 plausible picks. 'low' = description too " +
        "vague to be confident (prefer null + 'low' in this case). When " +
        "matched_category_key is null, confidence MUST be 'low'.",
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
        "The subcategory slug whose questions best match the customer's " +
        "symptoms. MUST appear in the subcategory list above. null only if " +
        "you genuinely can't pick (rare).",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description:
        "Self-reported confidence in matched_subcategory_slug AND the " +
        "unanswered_question_ids gap-detect. 'high' = description clearly " +
        "maps to ONE subcategory and you're sure about which questions are " +
        "answered. 'medium' = best of 2-3 plausible subcategory picks OR " +
        "you're unsure about some of the gap-detect calls. 'low' = the " +
        "description doesn't really fit any subcategory in the list above, " +
        "or you're forcing a match. Low is a signal to downstream advisor " +
        "review.",
    },
    unanswered_question_ids: {
      type: "array",
      items: { type: "integer" },
      description:
        "IDs from the matched subcategory's question set that the description " +
        "did NOT meaningfully answer. Empty when the description covers all " +
        "questions. All IDs must be positive integers that appear in the " +
        "catalog above.",
    },
    reasoning: {
      type: "string",
      description:
        "One sentence (keep under 280 characters). Audit-only.",
    },
  },
  required: [
    "matched_subcategory_slug",
    "confidence",
    "unanswered_question_ids",
    "reasoning",
  ],
};

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
    return `The customer picked the "💬 Other Issue" pseudo-chip — no pre-classification; classify from description alone.`;
  }
  return `The customer picked the "${chipHint.chip_display_name}" chip (related concern_categories: ${chipHint.chip_concern_categories.join(", ") || "none"}). Use this as a soft prior.`;
}

function buildStage1SystemPrompt(
  catalog: DiagnosticCatalog,
  chipHint: ChipHint | null,
): string {
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

${buildChipHintLine(chipHint)}

# Decision rules

1. **Match category to the customer's actual symptoms.** The chip hint is a
   prior, not a constraint.

2. **'Other' subcategory matches are valid AND useful** for situations that
   don't map to a specific test.

3. **Couldn't categorize is a valid answer** — return null when too vague.

4. **Never invent IDs or slugs.** Only return values that appear above.

5. **Reasoning is for the audit log.** One sentence under 280 characters.

6. **Confidence is self-reported.** Pick one of high/medium/low:
   - **high** — the description clearly names the system or symptom that
     maps to ONE category (e.g., "ABS light is on" → warning_light_general;
     "sweet smell under hood" → coolant_leak_testing). No realistic
     alternative reading.
   - **medium** — the matched category is the best of 2-3 plausible picks
     (e.g., a vague "shake" that could be brakes or suspension).
   - **low** — the description is vague enough that you're not really
     sure. If this unsure, prefer matched_category_key=null. When null,
     confidence MUST be 'low'.`;
}

function buildStage2SystemPrompt(
  matchedCategory: CatalogCategory,
  chipHint: ChipHint | null,
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

  const matchedHeader = isTestingService(matchedCategory)
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

  return `You are the diagnostic categorisation helper for Jeff's Automotive
(Stage 2: subcategory pick + question gap-detect). Stage 1 already matched
the customer's description to a category:

  ${matchedHeader}

Your job:
  1. **Pick the subcategory** whose questions best match the customer's
     symptoms. The subcategory MUST be one of the slugs listed below.
     ${subcategories.length === 1 ? "(For 'other' matches there is only ONE choice — pick it.)" : ""}
  2. **Gap-detect questions** — return the IDs of subcategory questions
     the description did NOT meaningfully answer.

# Subcategory + question catalog (this category only)

${subcategoryBlock}

# Customer's pre-selection (context from Stage 1)

${buildChipHintLine(chipHint)}

# Decision rules

1. **Subcategory must appear in the list above.** Don't invent slugs.

2. **Gap-detect questions from the matched subcategory only.** A question is
   "answered" when the customer's description states the FACT it asks about —
   even using different words. "Unanswered" only when the description doesn't
   speak to it OR is genuinely ambiguous.

   ANSWERED (drop the ID):
   - Location/side: "front right" / "rear left" / "all four wheels" / "front"
     / "rear" alone → drop location IDs.
   - Onset: "started suddenly" / "appeared overnight" → ANSWERED suddenly.
     "gradually" / "over weeks" → ANSWERED gradually.
   - Trigger: "only when braking" → drop brake-trigger Qs. "over bumps" →
     drop bump-trigger Qs. "at highway speed" → drop speed-band Qs.
   - Speed-specific: "at exactly 65 mph" / "at highway speed" / "at 40
     mph and up" → drop "at what speed?" Qs.
   - System scoped to exactly the question's body-part: "steering wheel
     shakes" → "whole car or just steering wheel?" is ANSWERED (steering
     wheel). "Car shakes" → ANSWERED (whole car). "Brakes squeal" →
     "are regular brakes still working normally?" is ANSWERED (yes).
   - Trigger-system named: "when I run the heat" → "AC or heat or both?"
     ANSWERED (heat). "AC works but smells when I turn it on" → ANSWERED
     (AC).
   - Light-name explicit: customer named the warning light verbatim
     ("maintenance light", "service engine soon", "ABS light", "TPMS
     light") → drop "which message does the dash say?" IDs.
   - Recent service: "just replaced X" / "no recent work" → ANSWERED.
     Silence on history → UNANSWERED.
   - Action-already-taken: "I checked the tire pressures and the light
     still won't go off" → drop "have you added air and the light still
     won't turn off?" (semantically identical).
   - Slow-vs-sudden via duration cue: "just filled it last week and it's
     low again" → ANSWERED slow.

   UNANSWERED (keep the ID):
   - Topic not mentioned at all.
   - "I think maybe" / "kind of" / "sort of" about that specific fact.

3. **Never invent IDs or slugs.** Only return values that appear above.

4. **Reasoning is for the audit log.** One sentence under 280 characters.

5. **Confidence is self-reported.** Pick one of high/medium/low:
   - **high** — description clearly maps to ONE subcategory AND you're
     confident in the gap-detect choices.
   - **medium** — subcategory is the best of 2-3 plausible picks OR
     you're unsure about some of the gap-detect calls.
   - **low** — the description doesn't really fit any subcategory above,
     OR you're forcing a match because Stage 1 picked a category but the
     symptom feels off. Low is a signal to downstream advisor review.`;
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
  systemPrompt: string;
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
        system: args.systemPrompt,
        messages: [{ role: "user", content: args.userPrompt }],
        // @ts-expect-error - gateway extensions not in Anthropic SDK types
        providerOptions: {
          gateway: {
            caching: "auto",
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
// HTTP HANDLER
// ════════════════════════════════════════════════════════════════════

function corsResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method === "GET") {
    return corsResp({
      ok: true,
      function: "llm-testing",
      version: "0.4.0",
      arch: "two-stage-anthropic-sdk-native-structured-outputs",
      stage1_model: STAGE1_MODEL,
      stage2_model: STAGE2_MODEL,
      structured_outputs_beta: STRUCTURED_OUTPUTS_BETA,
      hint: "POST { concern_text, chip_hint? } to run one concern through the two-stage diagnostic LLM.",
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
      arch: "two-stage-anthropic-sdk",
      catalog_size: catalog.categories.length,
      testing_service_count: testingCount,
      other_subcategory_count: otherCount,
      stage1: null,
      stage2: null,
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
    system_prompt_chars: stage1SystemPrompt.length,
    latency_ms: Date.now() - s1Start,
    tokens_in: stage1Result.tokensIn,
    tokens_out: stage1Result.tokensOut,
    error_message: stage1Result.errorMessage,
    attempts: stage1Result.attempts,
  };

  // Validate Stage 1 against catalog
  let matchedCat: CatalogCategory | null = null;
  if (stage1Result.raw && stage1Result.raw.matched_category_key) {
    for (const c of catalog.categories) {
      if (
        isTestingService(c) &&
        c.service_key === stage1Result.raw.matched_category_key
      ) {
        matchedCat = c;
        break;
      }
      if (
        isOtherSubcategory(c) &&
        c.subcategory_slug === stage1Result.raw.matched_category_key
      ) {
        matchedCat = c;
        break;
      }
    }
  }
  stage1Block.validated_category_key = matchedCat
    ? (isTestingService(matchedCat)
        ? matchedCat.service_key
        : matchedCat.subcategory_slug)
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
      arch: "two-stage-anthropic-sdk",
      catalog_size: catalog.categories.length,
      testing_service_count: testingCount,
      other_subcategory_count: otherCount,
      stage1: stage1Block,
      stage2: null,
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
  const eligibleSubSlugs = new Set<string>();
  if (isOtherSubcategory(matchedCat)) {
    eligibleSubSlugs.add(matchedCat.subcategory_slug);
  } else {
    for (const s of matchedCat.subcategories) eligibleSubSlugs.add(s.slug);
  }
  const subSlug =
    stage2Result.raw?.matched_subcategory_slug &&
    eligibleSubSlugs.has(stage2Result.raw.matched_subcategory_slug)
      ? stage2Result.raw.matched_subcategory_slug
      : null;

  let validatedUnansweredIds: number[] = [];
  if (subSlug && stage2Result.raw) {
    const eligibleQIds = new Set<number>();
    if (isOtherSubcategory(matchedCat)) {
      for (const q of matchedCat.questions) eligibleQIds.add(q.id);
    } else {
      const sub = matchedCat.subcategories.find((s) => s.slug === subSlug);
      if (sub) for (const q of sub.questions) eligibleQIds.add(q.id);
    }
    const dedup = Array.from(new Set(stage2Result.raw.unanswered_question_ids));
    validatedUnansweredIds = dedup.filter((id) => eligibleQIds.has(id));
  }

  const stage2Block = {
    model: STAGE2_MODEL,
    raw: stage2Result.raw,
    validated_subcategory_slug: subSlug,
    validated_unanswered_question_ids: validatedUnansweredIds,
    system_prompt_chars: stage2SystemPrompt.length,
    latency_ms: Date.now() - s2Start,
    tokens_in: stage2Result.tokensIn,
    tokens_out: stage2Result.tokensOut,
    error_message: stage2Result.errorMessage,
    attempts: stage2Result.attempts,
  };

  const validated = {
    matched_category_key: isTestingService(matchedCat)
      ? matchedCat.service_key
      : matchedCat.subcategory_slug,
    matched_kind: isTestingService(matchedCat)
      ? ("testing_service" as const)
      : ("other_subcategory" as const),
    matched_subcategory_slug: subSlug,
    unanswered_question_ids: stage2Block.validated_unanswered_question_ids,
    recommended_testing_service: isTestingService(matchedCat)
      ? {
          service_key: matchedCat.service_key,
          display_name: matchedCat.display_name,
          starting_price_cents: matchedCat.starting_price_cents,
        }
      : null,
  };

  let topErr: string | null = null;
  if (stage2Block.error_message) {
    topErr = `stage2_failed: ${stage2Block.error_message.slice(0, 200)}`;
  }

  return corsResp({
    ok: true,
    arch: "two-stage-anthropic-sdk",
    catalog_size: catalog.categories.length,
    testing_service_count: testingCount,
    other_subcategory_count: otherCount,
    stage1: stage1Block,
    stage2: stage2Block,
    validated,
    latency_ms: Date.now() - t0,
    tokens_in: stage1Block.tokens_in + stage2Block.tokens_in,
    tokens_out: stage1Block.tokens_out + stage2Block.tokens_out,
    error_message: topErr,
  });
});
