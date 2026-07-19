/**
 * question-fact-mapper — deterministic, pure-TypeScript mapper that decides
 * which diagnostic questions the customer ALREADY answered (via the LLM's
 * Stage 1 fact extraction) and which we still need to ask.
 *
 * Why it exists
 * -------------
 * Stage 1 of the 3-stage diagnostic LLM workflow extracts ~29 atomic facts
 * from the customer's verbatim description (see ./extracted-facts.ts). Each
 * subcategory's diagnostic questions are tagged with the slot names they
 * need (`required_facts: string[]`). This mapper compares the two
 * deterministically so we never re-ask a question the customer already
 * answered, and never SKIP a question that hasn't been covered.
 *
 * Contract
 * --------
 * Input:
 *   - extracted_facts — Stage 1 output (flat object of ~29 nullable slots)
 *   - questions       — the matched subcategory's questions, each with an
 *                       `id` (positive integer) and a `required_facts: string[]`
 *
 * Output (every question is placed in exactly ONE bucket):
 *   - answered_ids    — EVERY required_fact has a non-null value
 *   - ambiguous_ids   — SOME but NOT ALL required_facts have non-null values
 *   - unanswered_ids  — ZERO required_facts have non-null values, OR the
 *                       question has an empty `required_facts: []` array
 *
 * Three-bucket semantics
 * ----------------------
 * - answered:   all gating facts present → SKIP the question, the customer
 *               already told us.
 * - ambiguous:  partial coverage → the diagnostic routing decides whether to
 *               ask a clarifying follow-up or treat the partial as enough.
 * - unanswered: no coverage → ASK it. This is also where questions with NO
 *               fact-gating configured (empty `required_facts: []`) land,
 *               because absence of a fact-mapping means we have no basis
 *               to skip — safe-by-default is to ask.
 *
 * Presence rule for a single slot
 * -------------------------------
 * A slot counts as "present" when extracted_facts[slot] is NOT null AND not
 * an empty string. Empty string is treated as null because the only two
 * free-text slots in ExtractedFacts (`warning_light_named`,
 * `accessory_affected`) document "Leave null if customer did not name…" —
 * an empty string would be a marshaling artifact, not a customer signal.
 * Explicit `false` (boolean) and `0` (integer) are PRESENT — they are
 * valid extracted values; only null/undefined/"" mean "not stated."
 *
 * Unknown slot names
 * ------------------
 * If a question's `required_facts` references a slot name that is NOT a
 * key on ExtractedFacts (advisor authoring bug), we treat that slot as
 * always-null, which usually pushes the question to unanswered_ids. We
 * also `console.warn` once per unknown slot name (deduped) so the bug
 * surfaces during dev/CI without spamming production logs.
 *
 * Determinism
 * -----------
 * All three output arrays are sorted ascending. Same input → same output,
 * always. No I/O, no LLM, no Date.now, no random.
 *
 * Parallel mirror
 * ---------------
 * The Supabase edge function `supabase/functions/llm-testing/index.ts`
 * inlines a functionally-identical mapper (Deno cannot import scheduler-app
 * source). When this file changes, mirror the change there in the same
 * commit, then redeploy the edge function. Both implementations must
 * produce identical buckets for identical inputs so the eval harness and
 * the production scheduler stay comparable.
 */
import {
  EXTRACTED_FACTS_ALL_KEYS,
  EXTRACTED_FACTS_JSON_SCHEMA,
  type ExtractedFacts,
} from "./extracted-facts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface QuestionForFactMatch {
  id: number;
  required_facts: string[];
}

export interface QuestionFactMatcherInput {
  extracted_facts: ExtractedFacts;
  questions: QuestionForFactMatch[];
}

export interface QuestionFactMatcherOutput {
  answered_ids: number[];
  unanswered_ids: number[];
  ambiguous_ids: number[];
}

// ---------------------------------------------------------------------------
// Internal: known-slot set + deduped unknown-slot warner
// ---------------------------------------------------------------------------

const KNOWN_SLOTS: ReadonlySet<string> = new Set(EXTRACTED_FACTS_ALL_KEYS);
const warnedUnknownSlots = new Set<string>();

function warnUnknownSlotOnce(slot: string): void {
  if (warnedUnknownSlots.has(slot)) return;
  warnedUnknownSlots.add(slot);
  console.warn(
    `[question-fact-mapper] required_facts references unknown slot "${slot}" — treated as always-null. Fix the question's required_facts authoring.`,
  );
}

/**
 * Reset the unknown-slot warning dedupe set. Test-only — exported so test
 * cases can isolate the "warns once per unknown slot" behavior.
 */
export function __resetUnknownSlotWarningsForTests(): void {
  warnedUnknownSlots.clear();
}

// ---------------------------------------------------------------------------
// Value-aware required_facts (KB retraining, 2026-07-19)
// ---------------------------------------------------------------------------
//
// A required_facts entry is now a compact DSL string, NOT just a slot name:
//
//   "onset_timing"                        → presence-based (LEGACY — unchanged)
//   "onset_timing=when_turning"           → value-aware: satisfied iff onset_timing ∈ {when_turning}
//   "onset_timing=when_turning|when_braking"  → value-aware, 2 allowed values
//
// Grammar: element := slot [ "=" value ( "|" value )* ]. Slot names + enum
// values are both [a-z0-9_]+, so "=" and "|" are unambiguous, non-colliding
// delimiters — no commas, so no Postgres text[] array-literal quoting hazard,
// and each requirement stays ONE text[] element (the DB column, the RPC
// signature, and the ordered-array revert handler are all untouched — no
// migration). A bare "slot" parses to any_of:null → the exact legacy
// isFactPresent path → byte-identical behavior to before this change.
//
// The identical parser is mirrored in the (stale, unused-by-prod/eval) Deno
// `supabase/functions/llm-testing/` mapper only if that batch harness is
// revived — see the file header note there.

/** A parsed required_facts requirement. `any_of === null` ≡ legacy
 *  presence-based (satisfied when the slot is present, any value). A non-null
 *  `any_of` ≡ value-gated (satisfied only when the slot's value is in the set). */
export interface FactRequirement {
  slot: string;
  any_of: string[] | null;
}

/** Parse one `required_facts` element into a {slot, any_of}. Pure. A malformed
 *  "slot=" (no values) degrades safely to presence-based (any_of:null). */
export function parseRequiredFact(raw: string): FactRequirement {
  const i = raw.indexOf("=");
  if (i === -1) return { slot: raw, any_of: null };
  const slot = raw.slice(0, i);
  const values = raw
    .slice(i + 1)
    .split("|")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return { slot, any_of: values.length > 0 ? values : null };
}

// Per-slot allowed enum value set, derived from the on-wire JSON schema, for
// the defensive authoring-bug warning below. Free-text/integer slots (no
// `enum` in the schema) are simply absent from this map → no value validation
// (any string is accepted, e.g. a value-aware tag on warning_light_named).
const SLOT_ALLOWED_VALUES: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const m = new Map<string, ReadonlySet<string>>();
  const props =
    (
      EXTRACTED_FACTS_JSON_SCHEMA as unknown as {
        properties?: Record<string, { enum?: readonly unknown[] }>;
      }
    ).properties ?? {};
  for (const [slot, def] of Object.entries(props)) {
    if (Array.isArray(def.enum)) {
      m.set(
        slot,
        new Set(def.enum.filter((v): v is string => typeof v === "string")),
      );
    }
  }
  return m;
})();

const warnedUnknownValues = new Set<string>();

function warnUnknownEnumValueOnce(slot: string, value: string): void {
  const key = `${slot}=${value}`;
  if (warnedUnknownValues.has(key)) return;
  warnedUnknownValues.add(key);
  console.warn(
    `[question-fact-mapper] required_facts value-aware tag "${key}" references a value not in slot "${slot}"'s enum — this requirement can never be satisfied. Fix the question's required_facts authoring.`,
  );
}

/**
 * Reset the unknown-enum-value warning dedupe set. Test-only — mirror of
 * __resetUnknownSlotWarningsForTests for the value-aware path.
 */
export function __resetUnknownValueWarningsForTests(): void {
  warnedUnknownValues.clear();
}

/**
 * True iff a single parsed requirement is satisfied by the extracted facts.
 *   - Legacy (any_of === null): the slot is merely PRESENT (isFactPresent).
 *   - Value-aware: the slot is present AND its value is in `any_of`.
 * Preserves the unknown-slot warning (routes through isFactPresent) and adds a
 * deduped unknown-enum-value warning for authoring bugs. Pure + deterministic.
 */
export function isRequirementSatisfied(
  extracted_facts: ExtractedFacts,
  req: FactRequirement,
): boolean {
  // Legacy presence-based — unchanged (still warns on unknown slot).
  if (req.any_of === null) return isFactPresent(extracted_facts, req.slot);

  // Value-aware: defensive authoring-bug warning (does not affect the result).
  const allowed = SLOT_ALLOWED_VALUES.get(req.slot);
  if (allowed) {
    for (const v of req.any_of) {
      if (!allowed.has(v)) warnUnknownEnumValueOnce(req.slot, v);
    }
  }

  // The slot must be present AND its stated value must be in the any_of set.
  if (!isFactPresent(extracted_facts, req.slot)) return false;
  const value = (extracted_facts as Record<string, unknown>)[req.slot];
  return req.any_of.includes(String(value));
}

// ---------------------------------------------------------------------------
// Presence check for a single slot
// ---------------------------------------------------------------------------

/**
 * Returns true iff `extracted_facts[fact_name]` represents a value the
 * customer actually stated. Exported for unit-test transparency.
 *
 * Rules:
 *   - Unknown slot name → false (and emits a deduped console.warn).
 *   - null / undefined → false.
 *   - Empty string ""  → false (the two free-text slots use null to mean
 *                              "not stated"; "" is not a meaningful signal).
 *   - false (boolean)  → true  (valid extracted value).
 *   - 0 (integer)      → true  (valid extracted value).
 *   - Any other value  → true.
 */
export function isFactPresent(
  extracted_facts: ExtractedFacts,
  fact_name: string,
): boolean {
  if (!KNOWN_SLOTS.has(fact_name)) {
    warnUnknownSlotOnce(fact_name);
    return false;
  }
  // Safe cast: we just verified fact_name is a known key.
  const value = (extracted_facts as Record<string, unknown>)[fact_name];
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && value.length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Public: match questions to facts
// ---------------------------------------------------------------------------

export function matchQuestionsToFacts(
  input: QuestionFactMatcherInput,
): QuestionFactMatcherOutput {
  const answered_ids: number[] = [];
  const unanswered_ids: number[] = [];
  const ambiguous_ids: number[] = [];

  for (const q of input.questions) {
    // Empty required_facts ≡ no fact-gating configured → MUST ask.
    if (q.required_facts.length === 0) {
      unanswered_ids.push(q.id);
      continue;
    }

    // Each entry is a value-aware DSL requirement ("slot" or "slot=v1|v2").
    // A bare slot parses to presence-based (identical to the pre-2026-07-19
    // behavior); a value-aware entry is satisfied only when the slot's value
    // is in its any_of set.
    let satisfied = 0;
    for (const raw of q.required_facts) {
      if (
        isRequirementSatisfied(input.extracted_facts, parseRequiredFact(raw))
      ) {
        satisfied += 1;
      }
    }

    if (satisfied === 0) {
      unanswered_ids.push(q.id);
    } else if (satisfied === q.required_facts.length) {
      answered_ids.push(q.id);
    } else {
      ambiguous_ids.push(q.id);
    }
  }

  answered_ids.sort((a, b) => a - b);
  unanswered_ids.sort((a, b) => a - b);
  ambiguous_ids.sort((a, b) => a - b);

  return { answered_ids, unanswered_ids, ambiguous_ids };
}
