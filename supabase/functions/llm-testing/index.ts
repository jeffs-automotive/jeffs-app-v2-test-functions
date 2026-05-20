// llm-testing — diagnostic concern eval endpoint (Vercel AI Gateway).
//
// Mirrors the diagnostic prompt + schema + post-validation that the
// customer wizard's `diagnoseConcern` helper sends to Anthropic
// (scheduler-app/src/lib/scheduler/wizard/llm/diagnose-concern.ts).
// Lets us run test batches of customer concerns against the EXACT same
// prompt the prod wizard uses, without standing up the full Next.js app
// locally — useful for prompt-tuning and regression checks.
//
// Returns BOTH the raw LLM output AND the post-validated state so the
// caller can detect hallucinations (LLM returned a slug not in catalog)
// and silent filtering (question IDs dropped during validation).
//
// **MAINTENANCE WARNING:** the system prompt + schema below are a
// snapshot of scheduler-app's diagnose-concern.ts as of 2026-05-20.
// When that prompt changes, this function must be re-deployed with
// the matching prompt or the eval results stop reflecting prod.
//
// POST /llm-testing
// Body: { "concern_text": string, "chip_hint"?: { ... } }
// Returns: { catalog_size, model, raw, validated, latency_ms,
//            tokens_in, tokens_out, error_message }

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
// Models are addressed via the Vercel AI Gateway in `creator/model-name`
// form. Credential is the AI_GATEWAY_API_KEY env (must be set as a
// Supabase edge-fn secret). 2026-05-20 — swapped from
// `anthropic/claude-haiku-4-5` to `google/gemini-2.5-flash` after batch 1
// of the diagnostic LLM test surfaced 4/25 schema-validation failures
// from Haiku 4.5. Gemini 2.5 Flash has VALIDATED mode for strict
// constrained decoding — better fit for the long-context Zod schema.
const MODEL = Deno.env.get("DIAGNOSE_CONCERN_MODEL") ?? "google/gemini-2.5-flash";
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

// Module-scope cache (1-min TTL). Warm invocations skip the catalog
// load — 25 sequential test calls reuse the same snapshot.
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
// PROMPT BUILDER + SCHEMA (ported verbatim from diagnose-concern.ts)
// ════════════════════════════════════════════════════════════════════

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

interface ChipHint {
  chip_service_key: string;
  chip_display_name: string;
  chip_concern_categories: string[];
}

function buildSystemPrompt(
  catalog: DiagnosticCatalog,
  chipHint: ChipHint | null,
): string {
  const testingServices = catalog.categories.filter(isTestingService);
  const otherSubcategories = catalog.categories.filter(isOtherSubcategory);

  const testingServicesBlock = testingServices
    .map((t, i) => {
      const subList =
        t.subcategories.map((s) => s.slug).join(", ") ||
        "(no subcategories seeded)";
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

  const subcategoriesById = new Map<
    string,
    {
      display_label: string;
      questions: typeof testingServices[number]["subcategories"][number]["questions"];
    }
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

  const chipHintLine = chipHint
    ? chipHint.chip_service_key === "other_issue"
      ? `The customer picked the "💬 Other Issue" pseudo-chip — no pre-classification; classify from description alone, considering all 20 categories.`
      : `The customer picked the "${chipHint.chip_display_name}" chip (related concern_categories: ${chipHint.chip_concern_categories.join(", ") || "none"}). Use this as a soft prior — prefer testing services tagged with one of those concern_categories unless the description clearly says otherwise.`
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

function buildUserPrompt(
  customer_description: string,
  vehicle_notes: string | null,
): string {
  const parts: string[] = [
    `# Customer's description\n${customer_description.trim()}`,
  ];
  if (vehicle_notes && vehicle_notes.trim().length > 0) {
    parts.push(
      `# Vehicle notes (from Step 6, may not be relevant)\n${vehicle_notes.trim()}`,
    );
  }
  return parts.join("\n\n");
}

// ════════════════════════════════════════════════════════════════════
// POST-VALIDATION (ported from diagnose-concern.ts:506-543)
// ════════════════════════════════════════════════════════════════════

interface ValidatedResult {
  matched_category_key: string | null;
  matched_kind: "testing_service" | "other_subcategory" | null;
  matched_subcategory_slug: string | null;
  unanswered_question_ids: number[];
  recommended_testing_service: {
    service_key: string;
    display_name: string;
    starting_price_cents: number;
  } | null;
}

function validate(
  catalog: DiagnosticCatalog,
  raw: z.infer<typeof Schema>,
): ValidatedResult {
  const empty: ValidatedResult = {
    matched_category_key: null,
    matched_kind: null,
    matched_subcategory_slug: null,
    unanswered_question_ids: [],
    recommended_testing_service: null,
  };

  if (!raw.matched_category_key) return empty;

  // Find matched category
  let matchedCat: CatalogCategory | null = null;
  for (const c of catalog.categories) {
    if (isTestingService(c) && c.service_key === raw.matched_category_key) {
      matchedCat = c;
      break;
    }
    if (
      isOtherSubcategory(c) &&
      c.subcategory_slug === raw.matched_category_key
    ) {
      matchedCat = c;
      break;
    }
  }
  if (!matchedCat) return empty;

  // Validate subcategory slug
  const eligibleSubSlugs = new Set<string>();
  if (isOtherSubcategory(matchedCat)) {
    eligibleSubSlugs.add(matchedCat.subcategory_slug);
  } else {
    for (const s of matchedCat.subcategories) eligibleSubSlugs.add(s.slug);
  }
  const subSlug =
    raw.matched_subcategory_slug &&
    eligibleSubSlugs.has(raw.matched_subcategory_slug)
      ? raw.matched_subcategory_slug
      : null;

  // Filter question IDs to those in the matched subcategory
  let validIds: number[] = [];
  if (subSlug) {
    const eligibleQIds = new Set<number>();
    if (isOtherSubcategory(matchedCat)) {
      for (const q of matchedCat.questions) eligibleQIds.add(q.id);
    } else {
      const sub = matchedCat.subcategories.find((s) => s.slug === subSlug);
      if (sub) for (const q of sub.questions) eligibleQIds.add(q.id);
    }
    const dedup = Array.from(new Set(raw.unanswered_question_ids));
    validIds = dedup.filter((id) => eligibleQIds.has(id));
  }

  if (isTestingService(matchedCat)) {
    return {
      matched_category_key: matchedCat.service_key,
      matched_kind: "testing_service",
      matched_subcategory_slug: subSlug,
      unanswered_question_ids: validIds,
      recommended_testing_service: {
        service_key: matchedCat.service_key,
        display_name: matchedCat.display_name,
        starting_price_cents: matchedCat.starting_price_cents,
      },
    };
  }
  return {
    matched_category_key: matchedCat.subcategory_slug,
    matched_kind: "other_subcategory",
    matched_subcategory_slug: matchedCat.subcategory_slug,
    unanswered_question_ids: validIds,
    recommended_testing_service: null,
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
      version: "0.1.0",
      model: MODEL,
      hint: "POST { concern_text, chip_hint? } to run one concern through the diagnostic LLM.",
    });
  }

  if (req.method !== "POST") {
    return corsResp({ ok: false, error: "method_not_allowed" }, 405);
  }

  // Parse body
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

  // Catalog (cached for warm invocations)
  const catalog = await getCatalog();
  const testingCount = catalog.categories.filter(isTestingService).length;
  const otherCount = catalog.categories.filter(isOtherSubcategory).length;

  // Short-circuit on near-empty (mirrors diagnose-concern.ts:436)
  const t0 = Date.now();
  if (concernText.length < 3) {
    return corsResp({
      ok: true,
      catalog_size: catalog.categories.length,
      testing_service_count: testingCount,
      other_subcategory_count: otherCount,
      model: MODEL,
      raw: null,
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
      system_prompt_chars: 0,
    });
  }

  // LLM call
  const systemPrompt = buildSystemPrompt(catalog, chipHint);
  const userPrompt = buildUserPrompt(concernText, vehicleNotes);

  let raw: z.infer<typeof Schema> | null = null;
  let errorMessage: string | null = null;
  let tokensIn = 0;
  let tokensOut = 0;

  try {
    const result = await generateObject({
      model: gateway(MODEL),
      system: systemPrompt,
      prompt: userPrompt,
      schema: Schema,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    raw = result.object;
    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    tokensIn = Number(usage.inputTokens ?? 0);
    tokensOut = Number(usage.outputTokens ?? 0);
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  const validated = raw
    ? validate(catalog, raw)
    : {
        matched_category_key: null,
        matched_kind: null as const,
        matched_subcategory_slug: null,
        unanswered_question_ids: [],
        recommended_testing_service: null,
      };

  return corsResp({
    ok: true,
    catalog_size: catalog.categories.length,
    testing_service_count: testingCount,
    other_subcategory_count: otherCount,
    model: MODEL,
    raw,
    validated,
    latency_ms: Date.now() - t0,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    error_message: errorMessage,
    system_prompt_chars: systemPrompt.length,
  });
});
