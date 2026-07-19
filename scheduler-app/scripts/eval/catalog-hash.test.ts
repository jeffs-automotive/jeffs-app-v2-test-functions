import { describe, expect, it } from "vitest";

import { catalogContentHash } from "./catalog-hash";
import type {
  CatalogSubcategory,
  DiagnosticCatalog,
} from "../../src/lib/scheduler/wizard/llm/load-diagnostic-catalog";

function sub(overrides: Partial<CatalogSubcategory> = {}): CatalogSubcategory {
  return {
    slug: "brake_grind",
    display_label: "Grinding when braking",
    concern_category: "brakes",
    eligible_testing_service_keys: [],
    description: "metal on metal",
    positive_examples: ["grinding when I brake"],
    negative_examples: ["grinding when I turn"],
    synonyms: ["grind", "scrape"],
    questions: [{ id: 1, question_text: "q", options: [], display_order: 1, multi_select: false, required_facts: ["pedal_feel"] }],
    ...overrides,
  };
}

function catalog(subs: CatalogSubcategory[]): DiagnosticCatalog {
  return {
    categories: [
      {
        kind: "testing_service",
        service_key: "brake_inspection",
        display_name: "Brake inspection",
        description: "check brakes",
        starting_price_cents: 9999,
        concern_categories: ["brakes", "noise"],
        example_keywords: ["squeal", "grind"],
        subcategories: subs,
      },
    ],
  };
}

describe("catalogContentHash", () => {
  it("is deterministic — same content → same hash", () => {
    expect(catalogContentHash(catalog([sub()]))).toBe(
      catalogContentHash(catalog([sub()])),
    );
  });

  it("is order-independent (subcategory order does not change the hash)", () => {
    const a = catalog([sub({ slug: "a" }), sub({ slug: "b" })]);
    const b = catalog([sub({ slug: "b" }), sub({ slug: "a" })]);
    expect(catalogContentHash(a)).toBe(catalogContentHash(b));
  });

  it("changes when classification-relevant content changes", () => {
    const base = catalogContentHash(catalog([sub()]));
    expect(catalogContentHash(catalog([sub({ synonyms: ["grind", "new-word"] })]))).not.toBe(base);
    expect(catalogContentHash(catalog([sub({ description: "changed" })]))).not.toBe(base);
    expect(
      catalogContentHash(
        catalog([sub({ questions: [{ id: 1, question_text: "q", options: [], display_order: 1, multi_select: false, required_facts: ["onset_timing"] }] })]),
      ),
    ).not.toBe(base);
  });

  it("ignores price + display fields (not classification-relevant)", () => {
    const c1 = catalog([sub()]);
    const c2 = catalog([sub()]);
    (c2.categories[0] as { starting_price_cents: number }).starting_price_cents = 1;
    expect(catalogContentHash(c1)).toBe(catalogContentHash(c2));
  });
});
