import { describe, it, expect } from "vitest";
import { CANONICAL_CATALOG } from "./index.ts";

/**
 * Guards the post-split assembly (file-size-refactor batch 1). If a category
 * is dropped from index.ts, a category file is corrupted, or a preset import
 * breaks, one of these fails. Counts were captured from the pre-split catalog
 * (proven byte-identical via the generate-catalog-migration SQL diff).
 */
describe("CANONICAL_CATALOG assembly", () => {
  it("has all 14 categories in canonical order", () => {
    expect(CANONICAL_CATALOG.map((c) => c.category)).toEqual([
      "brakes",
      "electrical",
      "hvac",
      "leak",
      "noise",
      "other",
      "performance",
      "pulling",
      "smell",
      "smoke",
      "steering",
      "tires",
      "vibration",
      "warning_light",
    ]);
  });

  it("preserves the full subcategory + question counts", () => {
    const subs = CANONICAL_CATALOG.reduce((s, c) => s + c.subcategories.length, 0);
    const qs = CANONICAL_CATALOG.reduce(
      (s, c) => s + c.subcategories.reduce((a, sub) => a + sub.questions.length, 0),
      0,
    );
    expect(subs).toBe(105);
    expect(qs).toBe(729);
  });

  it("every question has a multi_select flag and a non-empty options array", () => {
    for (const c of CANONICAL_CATALOG) {
      for (const sub of c.subcategories) {
        for (const q of sub.questions) {
          expect(typeof q.multi_select).toBe("boolean");
          expect(Array.isArray(q.options)).toBe(true);
          expect(q.options.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
