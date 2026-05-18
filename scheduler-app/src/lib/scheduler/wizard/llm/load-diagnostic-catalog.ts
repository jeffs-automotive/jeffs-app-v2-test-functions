/**
 * loadDiagnosticCatalog — Phase 1 (2026-05-17 restoration).
 *
 * Builds the 20-option catalog the diagnostic LLM picks from when
 * categorising a customer's free-text concern:
 *
 *   - 14 "diagnostics" — each active testing_services row, with its
 *     description + starting price + the set of concern_subcategories
 *     reachable through testing_services.concern_categories[].
 *   - 6 "other" — the 'other'-concern-category subcategories elevated
 *     to peer status; they carry their own question set but no
 *     recommended testing service (these route to the "we'll forward
 *     to a service advisor" outcome).
 *
 * One DB round-trip per source table (3 total: testing_services,
 * concern_subcategories, concern_questions). Returns a snapshot the
 * caller can pass into diagnoseConcern() per explanation_required_item.
 *
 * Performance: this is called once per run-diagnostics invocation (not
 * once per concern). N concerns in the queue → 1 catalog load + N LLM
 * calls. The catalog itself is small (≤14 + 6 = 20 categories, ~50
 * subcategories, ~350 questions total) so we don't cache it in-process
 * yet — fetching live keeps concern_subcategories edits visible without
 * an app restart.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const SHOP_ID = 7476;

/** Concern category that "elevates" its subcategories to the LLM's
 *  top-level pick set (no testing-service recommendation when one of
 *  these subcategories is matched). */
const OTHER_CONCERN_CATEGORY = "other";

export interface CatalogQuestion {
  id: number;
  question_text: string;
  options: Array<{ label: string; value: string }>;
  display_order: number;
  /** TRUE when the customer can naturally pick multiple options
   *  simultaneously (e.g., location questions: "front + left").
   *  Drives single-tap vs multi-chip + Continue rendering in
   *  `ClarificationQuestionCard`. Added 2026-05-18 with the CAT-2
   *  catalog rebuild. */
  multi_select: boolean;
}

export interface CatalogSubcategory {
  slug: string;
  display_label: string;
  /** Parent concern_category (e.g., "brakes", "noise", "other"). Used
   *  to bridge from a testing_service's concern_categories[] to the
   *  eligible subcategory set. */
  concern_category: string;
  questions: CatalogQuestion[];
}

export interface TestingServiceCategory {
  kind: "testing_service";
  service_key: string;
  display_name: string;
  description: string | null;
  starting_price_cents: number;
  /** The concern_categories[] tag column verbatim — drives which
   *  subcategories the LLM can pick when matching to this service. */
  concern_categories: string[];
  /** Subcategories reachable from any concern_category in the
   *  concern_categories[] above. Filtered to active rows. */
  subcategories: CatalogSubcategory[];
}

export interface OtherSubcategoryCategory {
  kind: "other_subcategory";
  /** The subcategory slug doubles as the "category key" since elevated
   *  'other' subcategories ARE their own top-level entries. */
  subcategory_slug: string;
  display_label: string;
  /** The single subcategory's questions; no nesting. */
  questions: CatalogQuestion[];
}

export type CatalogCategory = TestingServiceCategory | OtherSubcategoryCategory;

export interface DiagnosticCatalog {
  /** All 20 categories the LLM picks from — 14 testing services + 6
   *  'other' subcategories. Order: testing services first (sorted by
   *  display_name), then 'other' subcategories by display_order. */
  categories: CatalogCategory[];
}

interface TestingServiceRow {
  service_key: string;
  display_name: string;
  description: string | null;
  starting_price_cents: number;
  concern_categories: string[] | null;
}

interface SubcategoryRow {
  id: number;
  slug: string;
  category: string;
  display_label: string;
  display_order: number;
  active: boolean;
}

interface QuestionRow {
  id: number;
  question_text: string;
  options: unknown;
  display_order: number;
  subcategory_id: number;
  active: boolean;
  multi_select: boolean;
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

export async function loadDiagnosticCatalog(
  supabase: SupabaseClient,
): Promise<DiagnosticCatalog> {
  const [testingRes, subRes, questionRes] = await Promise.all([
    supabase
      .from("testing_services")
      .select(
        "service_key, display_name, description, starting_price_cents, concern_categories",
      )
      .eq("shop_id", SHOP_ID)
      .eq("active", true)
      .order("display_name", { ascending: true }),
    supabase
      .from("concern_subcategories")
      .select("id, slug, category, display_label, display_order, active")
      .eq("shop_id", SHOP_ID)
      .eq("active", true)
      .order("display_order", { ascending: true }),
    supabase
      .from("concern_questions")
      .select(
        "id, question_text, options, display_order, subcategory_id, active, multi_select",
      )
      .eq("shop_id", SHOP_ID)
      .eq("active", true)
      .order("display_order", { ascending: true }),
  ]);

  if (testingRes.error) {
    throw new Error(`testing_services lookup: ${testingRes.error.message}`);
  }
  if (subRes.error) {
    throw new Error(`concern_subcategories lookup: ${subRes.error.message}`);
  }
  if (questionRes.error) {
    throw new Error(`concern_questions lookup: ${questionRes.error.message}`);
  }

  const testingRows = (testingRes.data ?? []) as TestingServiceRow[];
  const subRows = (subRes.data ?? []) as SubcategoryRow[];
  const questionRows = (questionRes.data ?? []) as QuestionRow[];

  // Bucket questions by subcategory_id so we can attach them to the
  // right subcategory record in O(N).
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

  // Build subcategory records keyed by their parent concern_category so
  // each testing_service's concern_categories[] can fan-out to the right
  // subcategory set without an O(N²) scan per service.
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

  // 14 testing services with their reachable subcategories.
  const testingCategories: TestingServiceCategory[] = testingRows.map((row) => {
    const cats = row.concern_categories ?? [];
    const subs: CatalogSubcategory[] = [];
    const seen = new Set<string>();
    for (const c of cats) {
      for (const s of subsByCategory.get(c) ?? []) {
        // De-dup across concern_categories (e.g., brake_inspection has
        // ['brakes','noise','pulling']; a 'noise' subcategory should appear
        // once even if another testing_service also tags 'noise').
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

  // 6 'other' subcategories elevated to top-level categories.
  const otherCategories: OtherSubcategoryCategory[] = otherSubcategories.map(
    (s) => ({
      kind: "other_subcategory",
      subcategory_slug: s.slug,
      display_label: s.display_label,
      questions: s.questions,
    }),
  );

  return {
    categories: [...testingCategories, ...otherCategories],
  };
}

/**
 * Return type narrow helpers for callers that need to discriminate.
 */
export function isTestingService(
  cat: CatalogCategory,
): cat is TestingServiceCategory {
  return cat.kind === "testing_service";
}

export function isOtherSubcategory(
  cat: CatalogCategory,
): cat is OtherSubcategoryCategory {
  return cat.kind === "other_subcategory";
}
