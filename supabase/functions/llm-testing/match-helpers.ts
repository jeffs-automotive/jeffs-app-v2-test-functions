// match-helpers — llm-testing module.
// Extracted from llm-testing/index.ts (file-size-refactor). Mechanical split.

import { isTestingService, isOtherSubcategory, type CatalogSubcategory, type CatalogCategory, type DiagnosticCatalog } from "./catalog.ts";

// ════════════════════════════════════════════════════════════════════
// VALIDATION HELPERS
// ════════════════════════════════════════════════════════════════════

export function findMatchedCategory(
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

export function findMatchedSubcategory(
  cat: CatalogCategory,
  slug: string | null,
): CatalogSubcategory | null {
  if (!slug) return null;
  if (isOtherSubcategory(cat)) {
    if (cat.subcategory_slug !== slug) return null;
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

export function collectAllCategoryQuestionIds(cat: CatalogCategory): number[] {
  if (isOtherSubcategory(cat)) {
    return cat.questions.map((q) => q.id).sort((a, b) => a - b);
  }
  const ids: number[] = [];
  for (const s of cat.subcategories) {
    for (const q of s.questions) ids.push(q.id);
  }
  return Array.from(new Set(ids)).sort((a, b) => a - b);
}
