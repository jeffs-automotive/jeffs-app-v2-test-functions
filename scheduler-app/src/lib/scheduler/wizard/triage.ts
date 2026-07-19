/**
 * concern-triage — pure decision logic for the "we can't classify → ask a broad
 * category question" flow (feature `concern-triage`, 2026-07-19).
 *
 * This module is intentionally PURE (no I/O, no LLM, no Date.now/random) so the
 * T1 trigger matrix, the server-side constraint derivation (INV-14), and the
 * post-LLM allowlist filter are unit-testable in isolation — NOT buried in the
 * 990-line run-diagnostics action (INV-10). run-diagnostics + submit-concern-triage
 * import these; they never re-implement the predicate.
 *
 * Plan: docs/scheduler/concern-triage-and-unsure-path-plan.md (INV-5, INV-10,
 * INV-12, INV-13, INV-14, INV-18).
 *
 * WHAT TRIAGE IS: when Stage 1 returns 0 candidates for a GENUINELY-VAGUE concern
 * (not a work-order line), instead of silently forwarding to an advisor we show
 * the customer broad category chips ("What kind of trouble is it?"). Their tap
 * constrains a re-diagnosis to that category's audited service subset. There is
 * NO Tier-B subcategory step — Stage-2 uncertainty routes to the advisor (Chris's
 * decision 2026-07-19).
 */

// ─── no_match_reason (INV-6) — why Stage 1 returned an empty candidate list ──
//
// Encoded on the wire as a constraint-light nullable STRING (not a strict enum)
// so it round-trips on BOTH the Anthropic-native and the gemini/gateway
// transports; Zod (below) enforces the value set as defense-in-depth.
export type NoMatchReason =
  | "non_concern_request" // work-order line ("oil change") — advisor, never triage
  | "too_vague" // real symptom, no system named ("car feels weird") — triage-eligible
  | "no_catalog_fit"; // clear concern, no catalog home — triage-eligible

export const NO_MATCH_REASONS: readonly NoMatchReason[] = [
  "non_concern_request",
  "too_vague",
  "no_catalog_fit",
];

/** The two reasons that make a 0-candidate result eligible for triage. A
 *  `non_concern_request` (and any null/unknown reason) keeps today's advisor
 *  handoff. */
export const TRIAGE_ELIGIBLE_REASONS: readonly NoMatchReason[] = [
  "too_vague",
  "no_catalog_fit",
];

/** The fixed, non-DB escape affordance on the triage card. Its tap routes to
 *  the advisor — it is NOT a `concern_triage_chips` row (INV-14 §10.4). */
export const TRIAGE_ESCAPE_CHIP_KEY = "not_sure";

// ─── DB row + persisted-state shapes ────────────────────────────────────────

/** A `concern_triage_chips` row (shop-scoped, hand-audited seed). */
export interface TriageChipRow {
  chip_key: string;
  display_label: string;
  maps_to_categories: string[];
  /** Hand-audited testing_services.service_key subset (P6 confusable-matrix
   *  additions included). Validated against the shop's ACTIVE services at load. */
  allowed_service_keys: string[];
  sort: number;
  active: boolean;
}

/** A rendered chip in a persisted triage entry (card + tap agree even if the
 *  seed is edited between render and tap). */
export interface TriageChipOption {
  chip_key: string;
  display_label: string;
}

/** One `concern_triage_state` queue entry (INV-12). One per triaged concern. */
export interface TriageEntry {
  concern_id: string; // INV-13 stable identity (NOT array index / service_key)
  concern_index: number; // display order only
  service_key: string; // source picker chip
  concern_text: string; // echoed to the customer
  chips: TriageChipOption[]; // rendered snapshot
  /** SERVER-resolved audited subset snapshot, keyed by chip_key (INV-14): the
   *  tap resolves the constraint from THIS, never from a client payload. */
  allowed_by_chip: Record<string, string[]>;
  triage_round: 0 | 1;
  created_version: string; // chip-seed version (observability + snapshot integrity)
}

/** The triage-relevant fields carried on an `explanation_required_items` entry.
 *  Preserved through every parser/write-back (INV-3). */
export interface TriageItemFields {
  concern_id?: string;
  triage_round?: number;
  triage_answers?: { chip_key: string; label: string } | null;
  handoff_reason?: string | null;
}

/** The minimal diagnosis-outcome shape the T1 predicate needs — a subset of
 *  DiagnoseConcernResult, so triage.ts stays decoupled from the LLM module. */
export interface TriageDecisionInput {
  stage1_candidates: string[];
  no_match_reason: NoMatchReason | null;
  parsed_ok: boolean;
}

// ─── T1 — the ONLY triage trigger (INV-5) ───────────────────────────────────

/**
 * True iff this concern should enter the broad-category (Tier-A) triage step.
 *
 * Fires ONLY when: Stage 1 produced zero candidates AND the reason is a
 * triage-eligible one (`too_vague` / `no_catalog_fit`) AND this concern has not
 * already had its one triage round AND the LLM parse succeeded.
 *
 * NEVER fires for: `non_concern_request` (work-order lines), a null/unknown
 * reason (the two non-LLM null-match producers: all-invalid-keys + desc<3
 * short-circuit both carry `null`), an LLM failure (`parsed_ok === false`), or a
 * concern already at `triage_round >= 1`.
 */
export function shouldTriage(
  result: TriageDecisionInput,
  item: TriageItemFields,
): boolean {
  if (!result.parsed_ok) return false;
  if (result.stage1_candidates.length !== 0) return false;
  const reason = result.no_match_reason;
  if (reason === null || !TRIAGE_ELIGIBLE_REASONS.includes(reason)) return false;
  if ((item.triage_round ?? 0) !== 0) return false;
  return true;
}

// ─── Chip snapshot (INV-18) — validate + hide-empty at build time ───────────

/**
 * Resolve the shop's active chip rows into the `{options, allowed_by_chip}`
 * snapshot persisted on a triage entry.
 *
 * INV-18: every seeded `allowed_service_keys` element must resolve to an ACTIVE
 * testing service for the shop; unknown/inactive keys are DROPPED (a chip can't
 * route to a service that doesn't exist). A chip whose resolved set is EMPTY is
 * HIDDEN (omitted) — so a customer can't waste their one triage round tapping a
 * chip that would immediately dead-end to the advisor.
 *
 * Returns an empty snapshot when no chip survives — the caller treats that as
 * "no usable triage config" and falls back to the advisor path (INV-18 fallback).
 */
export function buildChipSnapshot(
  chips: TriageChipRow[],
  activeServiceKeys: ReadonlySet<string>,
): { options: TriageChipOption[]; allowed_by_chip: Record<string, string[]> } {
  const options: TriageChipOption[] = [];
  const allowed_by_chip: Record<string, string[]> = {};
  const ordered = chips
    .filter((c) => c.active)
    .slice()
    .sort((a, b) => a.sort - b.sort || a.chip_key.localeCompare(b.chip_key));
  for (const c of ordered) {
    const allowed = c.allowed_service_keys.filter((k) => activeServiceKeys.has(k));
    if (allowed.length === 0) continue; // hide empty chips (INV-18)
    options.push({ chip_key: c.chip_key, display_label: c.display_label });
    allowed_by_chip[c.chip_key] = allowed;
  }
  return { options, allowed_by_chip };
}

// ─── Server-side constraint derivation (INV-14) — never trust the client ─────

export interface TriageConstraint {
  allowed_service_keys: string[];
  chip_key: string;
  label: string;
}

/**
 * Resolve a tapped `chip_key` into the category constraint, reading ONLY the
 * server-persisted `allowed_by_chip` snapshot on the entry (INV-14). A forged
 * or unknown chip_key, or the escape chip, resolves to `null` — the caller
 * routes null to the advisor path (never trust a client-supplied service list).
 */
export function deriveConstraint(
  entry: TriageEntry,
  chipKey: string,
): TriageConstraint | null {
  if (chipKey === TRIAGE_ESCAPE_CHIP_KEY) return null;
  const allowed = entry.allowed_by_chip[chipKey];
  const chip = entry.chips.find((c) => c.chip_key === chipKey);
  if (!chip || !Array.isArray(allowed) || allowed.length === 0) return null;
  return { allowed_service_keys: allowed, chip_key: chipKey, label: chip.display_label };
}

/**
 * Post-LLM allowlist filter (INV-14): keep ONLY the Stage-1 candidate keys that
 * are in the constraint's allowed set — a defense against the model returning an
 * out-of-constraint service despite the constrained prompt. An empty result is
 * the caller's signal to route to the advisor (never loop).
 */
export function filterCandidatesToAllowed(
  candidateKeys: string[],
  allowedServiceKeys: string[],
): string[] {
  const set = new Set(allowedServiceKeys);
  return candidateKeys.filter((k) => set.has(k));
}
