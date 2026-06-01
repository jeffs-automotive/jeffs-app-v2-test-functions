/**
 * Canonical answer-option catalog for the customer-facing diagnostic wizard.
 *
 * Each question has a hand-tuned `multi_select` flag and `options` array that
 * matches the natural answer space of the question's text — Yes/No for
 * propositions, location chips for "front or rear / left or right",
 * speed-band chips for "at what speed", etc. The mapping was derived from
 * the source-of-truth markdown files at docs/chat-instructions/scheduler/templates/concerns/* (moved 2026-05-19 from docs/scheduler/concerns/).
 *
 * Used by the migration seeder to overwrite the legacy yes/no/sometimes
 * defaults written by earlier migrations.
 */

// ─── file-size-refactor (batch 1) ──────────────────────────────────────
// The 6,082-line catalog was split into ./catalog/* (types + option-presets
// + one file per category). This shim preserves the public import path.
export { CANONICAL_CATALOG } from "./catalog/index.ts";
export type {
  CanonicalQuestion,
  CanonicalSubcategory,
  CanonicalCategory,
} from "./catalog/types.ts";
