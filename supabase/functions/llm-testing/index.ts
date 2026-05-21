// llm-testing — two-stage diagnostic concern eval endpoint (Vercel AI Gateway).
//
// Mirrors the two-stage diagnostic prompt + schema + post-validation that
// scheduler-app/src/lib/scheduler/wizard/llm/diagnose-concern.ts uses in prod
// (refactored 2026-05-20). Lets us run test batches against the EXACT same
// pipeline the prod wizard uses, without standing up the full Next.js app.
//
// Two stages:
//   Stage 1 — match category (brief catalog, ~5-8 KB prompt)
//   Stage 2 — pick subcategory + gap-detect questions (single category, ~2-5 KB)
//
// Returns BOTH the raw LLM output AND the post-validated state PER STAGE so
// the test harness can detect hallucinations (LLM returned a slug not in
// catalog) and silent filtering (question IDs that got dropped) at each
// stage independently.
//
// MAINTENANCE WARNING: the prompt + schema are a snapshot of
// diagnose-concern.ts as of 2026-05-20 (two-stage refactor). When that
// file's prompt changes, this function must be re-deployed with the
// matching prompt or eval results stop reflecting prod.
//
// POST /llm-testing
// Body: { "concern_text": string, "chip_hint"?: { ... } }
// Response: see ResponseShape below.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { generateObject } from "npm:ai@^5";
import { gateway } from "npm:@ai-sdk/gateway@^2";
import { z } from "npm:zod@^4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SECRET_KEY")!;
const SHOP_ID = parseInt(Deno.env.get("TEKMETRIC_SHOP_ID") ?? "7476", 10);

// Per-stage model envs (single-env fallback for legacy compat).
const STAGE1_MODEL =
  Deno.env.get("DIAGNOSE_CONCERN_STAGE1_MODEL") ??
  Deno.env.get("DIAGNOSE_CONCERN_MODEL") ??
  "anthropic/claude-haiku-4-5";
const STAGE2_MODEL =
  Deno.env.get("DIAGNOSE_CONCERN_STAGE2_MODEL") ??
  Deno.env.get("DIAGNOSE_CONCERN_MODEL") ??
  "anthropic/claude-haiku-4-5";

const MAX_OUTPUT_TOKENS = 1024;
const OTHER_CONCERN_CATEGORY = "other";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ════════════════════════════════════════════════════════════════════
// CATALOG TYPES + LOADER (ported from load-diagnostic-catalog.ts)
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
      .select("id, slug, category, display_label, display_order, active")
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

  if (testingRes.error) {
    throw new Error(`testing_services: ${testingRes.error.message}`);
  }
  if (subRes.error) {
    throw new Error(`concern_subcategories: ${subRes.error.message}`);
  }
  if (questionRes.error) {
    throw new Error(`concern_questions: ${questionRes.error.message}`);
  }

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

  const subsByCategory = new Map<string, CatalogSubcategory[]>();
  const otherSubcategories: CatalogSubcategory[] = [];

  for (const row of subRows) {
    const sub: CatalogSubcategory = {
      slug: row.slug,
      display_label: row.display_label,
      concern_category: row.category,
      questions: (questionsBySub.get(row.id) ?? []).sort(
        (a, b) => a.display_order - b.display_order,
      ),
    };
    if (row.category === OTHER_CONCERN_CATEGORY) {
      otherSubcategories.push(sub);
      continue;
    }
    const arr = subsByCategory.get(row.category) ?? [];
    arr.push(sub);
    subsByCategory.set(row.category, arr);
  }

  const testingCategories: TestingServiceCategory[] = testingRows.map((row) => {
    const cats = row.concern_categories ?? [];
    const subs: CatalogSubcategory[] = [];
    const seen = new Set<string>();
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

// Module-scope cache (1-min TTL) — warm invocations skip the catalog load.
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
// STAGE 1 + STAGE 2 SCHEMAS + PROMPTS (snapshot of diagnose-concern.ts)
// ════════════════════════════════════════════════════════════════════

const Stage1Schema = z.object({
  matched_category_key: z
    .string()
    .nullable()
    .describe(
      "Either a testing_services.service_key from the catalog above OR an " +
        "'other' subcategory slug. Return null when the description is too " +
        "vague to categorize OR doesn't fit any catalog entry.",
    ),
  reasoning: z.string().max(280),
});

const Stage2Schema = z.object({
  matched_subcategory_slug: z
    .string()
    .nullable()
    .describe(
      "The subcategory slug whose questions best match the customer's " +
        "symptoms. MUST appear in the subcategory list above. null only if " +
        "you genuinely can't pick.",
    ),
  unanswered_question_ids: z.array(z.number().int().positive()),
  reasoning: z.string().max(280),
});

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

1. **Match category to the customer's actual symptoms.** Read the description
   carefully and pick the category whose name + "What we'd do" + tags best fit
   the described issue. The chip hint is a prior, not a constraint.

2. **'Other' subcategory matches are valid AND useful.** If the customer's
   description is about a situation (recent accident, car has been sitting,
   pre-trip check, multiple symptoms at once with no primary), match the
   appropriate 'other' subcategory_slug.

3. **Couldn't categorize is a valid answer.** When the description is too
   vague ("car feels weird", "something's off", < ~5 useful words), return
   matched_category_key=null. The system will forward to a service advisor.

4. **Never invent IDs or slugs.** Only return values that appear above.

5. **Reasoning is for the audit log.** One sentence.`;
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

Your job has two parts:

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

2. **Gap-detect questions from the matched subcategory only.** Don't return
   IDs from a different subcategory. A question is "answered" when the
   customer's description states the FACT the question asks about — even if
   they used different words. A question is "unanswered" only when the
   description doesn't speak to it at all OR mentions it ambiguously without
   committing to a value.

   **Concrete patterns that count as ANSWERED (drop the ID):**

   - Location/side question: "front right" / "rear left" / "all four wheels" /
     "passenger side" / "driver side" / "front" alone / "rear" alone → ANSWERED.
     Even a single side word ("on the right") covers the side facet — drop the
     question.

   - Onset question ("Suddenly or gradually?"):
     • "started suddenly" / "appeared overnight" → ANSWERED with "suddenly."
     • "getting worse over weeks" / "gradually" → ANSWERED with "gradually."

   - Trigger question ("When does it happen?"):
     • "only when braking" → ANSWERED for brake-trigger questions.
     • "over bumps" / "on rough roads" → ANSWERED for bump-trigger questions.
     • "at highway speed" / "above 60 mph" → ANSWERED for speed-band questions.

   - Recent-service question:
     • "just replaced the pads last month" → ANSWERED with "yes — recently."
     • "no recent work" → ANSWERED with "no."
     • Silence on history → UNANSWERED.

   **Concrete patterns that count as UNANSWERED (keep the ID):**

   - The description doesn't mention the topic AT ALL.
   - The description says "I think maybe" or "kind of" about the specific fact
     the question asks about.

   **Worked example.** Customer: "I hear a grinding noise from the front right
   when braking." For 'metallic_grinding':
   - "Every time you brake?" → UNANSWERED
   - "Scraping with foot off the pedal?" → UNANSWERED
   - "Front or rear? Left or right?" → **ANSWERED** (DROP)
   - "Grinding through floor or pedal?" → UNANSWERED
   - "Suddenly or gradually?" → UNANSWERED
   - "Feel safe driving?" → UNANSWERED
   - "Recent brake work?" → UNANSWERED
   Correct: drop only the location ID; return the other 6.

3. **Never invent IDs or slugs.** Only return values that appear above.

4. **Reasoning is for the audit log.** One sentence.`;
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
// HTTP HANDLER
// ════════════════════════════════════════════════════════════════════

function corsResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

interface Stage1Block {
  model: string;
  raw: z.infer<typeof Stage1Schema> | null;
  validated_category_key: string | null;
  system_prompt_chars: number;
  latency_ms: number;
  tokens_in: number;
  tokens_out: number;
  error_message: string | null;
}

interface Stage2Block {
  model: string;
  raw: z.infer<typeof Stage2Schema> | null;
  validated_subcategory_slug: string | null;
  validated_unanswered_question_ids: number[];
  system_prompt_chars: number;
  latency_ms: number;
  tokens_in: number;
  tokens_out: number;
  error_message: string | null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method === "GET") {
    return corsResp({
      ok: true,
      function: "llm-testing",
      version: "0.2.0",
      arch: "two-stage",
      stage1_model: STAGE1_MODEL,
      stage2_model: STAGE2_MODEL,
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

  // Short-circuit on near-empty descriptions.
  const t0 = Date.now();
  if (concernText.length < 3) {
    return corsResp({
      ok: true,
      arch: "two-stage",
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

  const stage1: Stage1Block = {
    model: STAGE1_MODEL,
    raw: null,
    validated_category_key: null,
    system_prompt_chars: stage1SystemPrompt.length,
    latency_ms: 0,
    tokens_in: 0,
    tokens_out: 0,
    error_message: null,
  };

  const s1Start = Date.now();
  try {
    const r = await generateObject({
      model: gateway(STAGE1_MODEL),
      system: stage1SystemPrompt,
      prompt: userPrompt,
      schema: Stage1Schema,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      providerOptions: { gateway: { caching: "auto" } },
    });
    stage1.raw = r.object;
    stage1.tokens_in = Number(r.usage?.inputTokens ?? 0);
    stage1.tokens_out = Number(r.usage?.outputTokens ?? 0);
  } catch (e) {
    stage1.error_message = e instanceof Error ? e.message : String(e);
  }
  stage1.latency_ms = Date.now() - s1Start;

  // Validate Stage 1 against catalog.
  let matchedCat: CatalogCategory | null = null;
  if (stage1.raw && stage1.raw.matched_category_key) {
    for (const c of catalog.categories) {
      if (
        isTestingService(c) &&
        c.service_key === stage1.raw.matched_category_key
      ) {
        matchedCat = c;
        break;
      }
      if (
        isOtherSubcategory(c) &&
        c.subcategory_slug === stage1.raw.matched_category_key
      ) {
        matchedCat = c;
        break;
      }
    }
  }
  stage1.validated_category_key = matchedCat
    ? (isTestingService(matchedCat)
        ? matchedCat.service_key
        : matchedCat.subcategory_slug)
    : null;

  // If Stage 1 didn't yield a valid match, short-circuit (no Stage 2).
  if (!matchedCat) {
    const validated = {
      matched_category_key: null as string | null,
      matched_kind: null as "testing_service" | "other_subcategory" | null,
      matched_subcategory_slug: null as string | null,
      unanswered_question_ids: [] as number[],
      recommended_testing_service: null as null | {
        service_key: string;
        display_name: string;
        starting_price_cents: number;
      },
    };
    let topErr: string | null = null;
    if (stage1.error_message) topErr = `stage1_failed: ${stage1.error_message.slice(0, 200)}`;
    else if (stage1.raw && stage1.raw.matched_category_key) {
      topErr = `invalid_category_key:${stage1.raw.matched_category_key.slice(0, 50)}`;
    }
    return corsResp({
      ok: true,
      arch: "two-stage",
      catalog_size: catalog.categories.length,
      testing_service_count: testingCount,
      other_subcategory_count: otherCount,
      stage1,
      stage2: null,
      validated,
      latency_ms: Date.now() - t0,
      tokens_in: stage1.tokens_in,
      tokens_out: stage1.tokens_out,
      error_message: topErr,
    });
  }

  // ── Stage 2 ────────────────────────────────────────────────────────
  const stage2SystemPrompt = buildStage2SystemPrompt(matchedCat, chipHint);

  const stage2: Stage2Block = {
    model: STAGE2_MODEL,
    raw: null,
    validated_subcategory_slug: null,
    validated_unanswered_question_ids: [],
    system_prompt_chars: stage2SystemPrompt.length,
    latency_ms: 0,
    tokens_in: 0,
    tokens_out: 0,
    error_message: null,
  };

  const s2Start = Date.now();
  try {
    const r = await generateObject({
      model: gateway(STAGE2_MODEL),
      system: stage2SystemPrompt,
      prompt: userPrompt,
      schema: Stage2Schema,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      providerOptions: { gateway: { caching: "auto" } },
    });
    stage2.raw = r.object;
    stage2.tokens_in = Number(r.usage?.inputTokens ?? 0);
    stage2.tokens_out = Number(r.usage?.outputTokens ?? 0);
  } catch (e) {
    stage2.error_message = e instanceof Error ? e.message : String(e);
  }
  stage2.latency_ms = Date.now() - s2Start;

  // Validate Stage 2 against the matched category's eligible subcategories.
  const eligibleSubSlugs = new Set<string>();
  if (isOtherSubcategory(matchedCat)) {
    eligibleSubSlugs.add(matchedCat.subcategory_slug);
  } else {
    for (const s of matchedCat.subcategories) eligibleSubSlugs.add(s.slug);
  }

  const subSlug =
    stage2.raw?.matched_subcategory_slug &&
    eligibleSubSlugs.has(stage2.raw.matched_subcategory_slug)
      ? stage2.raw.matched_subcategory_slug
      : null;
  stage2.validated_subcategory_slug = subSlug;

  if (subSlug && stage2.raw) {
    const eligibleQIds = new Set<number>();
    if (isOtherSubcategory(matchedCat)) {
      for (const q of matchedCat.questions) eligibleQIds.add(q.id);
    } else {
      const sub = matchedCat.subcategories.find((s) => s.slug === subSlug);
      if (sub) for (const q of sub.questions) eligibleQIds.add(q.id);
    }
    const dedup = Array.from(new Set(stage2.raw.unanswered_question_ids));
    stage2.validated_unanswered_question_ids = dedup.filter((id) =>
      eligibleQIds.has(id),
    );
  }

  // ── Compose final validated state ──────────────────────────────────
  const validated = {
    matched_category_key: isTestingService(matchedCat)
      ? matchedCat.service_key
      : matchedCat.subcategory_slug,
    matched_kind: isTestingService(matchedCat)
      ? ("testing_service" as const)
      : ("other_subcategory" as const),
    matched_subcategory_slug: subSlug,
    unanswered_question_ids: stage2.validated_unanswered_question_ids,
    recommended_testing_service: isTestingService(matchedCat)
      ? {
          service_key: matchedCat.service_key,
          display_name: matchedCat.display_name,
          starting_price_cents: matchedCat.starting_price_cents,
        }
      : null,
  };

  // Top-level error_message: Stage 2 errors degrade to a partial result.
  let topErr: string | null = null;
  if (stage2.error_message) {
    topErr = `stage2_failed: ${stage2.error_message.slice(0, 200)}`;
  }

  return corsResp({
    ok: true,
    arch: "two-stage",
    catalog_size: catalog.categories.length,
    testing_service_count: testingCount,
    other_subcategory_count: otherCount,
    stage1,
    stage2,
    validated,
    latency_ms: Date.now() - t0,
    tokens_in: stage1.tokens_in + stage2.tokens_in,
    tokens_out: stage1.tokens_out + stage2.tokens_out,
    error_message: topErr,
  });
});
