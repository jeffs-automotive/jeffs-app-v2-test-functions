/**
 * catalog-hash — a deterministic content hash of the live diagnostic catalog
 * (eval-hardening, 2026-07-19; GPT/Gemini cross-verify: "a model name + a
 * catalog aren't a reproducible experiment definition").
 *
 * The catalog is loaded LIVE from the DB at eval time, so two runs tagged the
 * same can silently disagree if a subcategory description / keyword / example /
 * required_facts changed between them. Stamping this 16-hex digest on every
 * report makes each result pinned to the EXACT classification surface that
 * produced it — so a before/after diff is only valid when the hashes match
 * (or the change is the deliberate variable).
 *
 * Hashes ONLY the classification-relevant content (keys, categories, keywords,
 * subcategory meaning/examples/synonyms, question required_facts) — NOT prices,
 * display order, or ids that don't steer the LLM. Fully deterministic: every
 * collection is sorted before hashing.
 */
import { createHash } from "node:crypto";

import type {
  CatalogCategory,
  CatalogSubcategory,
  DiagnosticCatalog,
} from "../../src/lib/scheduler/wizard/llm/load-diagnostic-catalog.ts";
import { isTestingService } from "../../src/lib/scheduler/wizard/llm/load-diagnostic-catalog.ts";

const j = (xs: string[]): string => [...xs].sort().join(",");

function subLine(s: CatalogSubcategory): string {
  const qs = [...s.questions]
    .map((q) => `${q.id}:${[...q.required_facts].sort().join("+")}`)
    .sort()
    .join(";");
  return [
    `sub=${s.slug}`,
    `desc=${(s.description ?? "").trim()}`,
    `pos=${j(s.positive_examples)}`,
    `neg=${j(s.negative_examples)}`,
    `syn=${j(s.synonyms)}`,
    `q=${qs}`,
  ].join("|");
}

function catLine(c: CatalogCategory): string {
  if (isTestingService(c)) {
    const subs = [...c.subcategories].map(subLine).sort().join("\n  ");
    return [
      `SVC=${c.service_key}`,
      `kw=${j(c.example_keywords ?? [])}`,
      `cats=${j(c.concern_categories)}`,
    ].join("|") + `\n  ${subs}`;
  }
  const qs = [...c.questions]
    .map((q) => `${q.id}:${[...q.required_facts].sort().join("+")}`)
    .sort()
    .join(";");
  return `OTHER=${c.subcategory_slug}|q=${qs}`;
}

/** 16-hex-char sha256 digest of the catalog's classification-relevant content. */
export function catalogContentHash(catalog: DiagnosticCatalog): string {
  const canonical = [...catalog.categories]
    .map(catLine)
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}
