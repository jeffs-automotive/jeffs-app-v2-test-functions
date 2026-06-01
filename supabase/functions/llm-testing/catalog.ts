// catalog — llm-testing module.
// Extracted from llm-testing/index.ts (file-size-refactor). Mechanical split.

import { SHOP_ID, OTHER_CONCERN_CATEGORY, sb } from "./config.ts";

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

export interface CatalogSubcategory {
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

export type CatalogCategory = TestingServiceCategory | OtherSubcategoryCategory;

export interface DiagnosticCatalog {
  categories: CatalogCategory[];
}

export function isTestingService(c: CatalogCategory): c is TestingServiceCategory {
  return c.kind === "testing_service";
}
export function isOtherSubcategory(c: CatalogCategory): c is OtherSubcategoryCategory {
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
export async function getCatalog(): Promise<DiagnosticCatalog> {
  if (catalogCache && Date.now() - catalogCache.loadedAt < CACHE_TTL_MS) {
    return catalogCache.catalog;
  }
  const catalog = await loadCatalog();
  catalogCache = { catalog, loadedAt: Date.now() };
  return catalog;
}
