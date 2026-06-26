// Color-coded keytag string format helpers.
//
// Ported verbatim (Node idiom) from supabase/functions/_shared/keytag-format.ts
// so the admin-app direct-read closure is self-contained — see read-dal.ts. The
// ONLY mechanical change from the edge source is dropping Deno-only specifics
// (there are none here). Keep behavior IDENTICAL to the edge source.

export type TagColor = "red" | "yellow";

export interface ParsedKeytag {
  color: TagColor;
  number: number;
  /** True when the source string used the legacy bare-number convention (interpreted as red). */
  legacy: boolean;
}

/**
 * Parses a Tekmetric keyTag field value.
 *   "R5"  → { color: 'red', number: 5, legacy: false }
 *   "Y45" → { color: 'yellow', number: 45, legacy: false }
 *   "5"   → { color: 'red', number: 5, legacy: true }     (backward compat)
 *   ""    → null
 *   null  → null
 *
 * Color prefix is case-insensitive. Whitespace is tolerated.
 */
export function parseKeytag(raw: string | number | null | undefined): ParsedKeytag | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s.length === 0) return null;

  // New format: "R5", "Y45"
  // NOTE (non-mechanical, flagged for review): admin-app's tsconfig sets
  // `noUncheckedIndexedAccess: true` (the Deno edge config does not), so the
  // regex capture groups are `string | undefined` here. The `if (newMatch)`
  // guard already proves they're present (the pattern requires both groups);
  // the local guards below just satisfy the compiler without changing behavior.
  const newMatch = s.match(/^([RYry])\s*(\d+)$/);
  if (newMatch) {
    const prefix = newMatch[1];
    const digits = newMatch[2];
    if (prefix !== undefined && digits !== undefined) {
      const c = prefix.toLowerCase();
      const n = parseInt(digits, 10);
      if (!Number.isFinite(n)) return null;
      if (n < 1 || n > 90) return null;
      return {
        color: c === "r" ? "red" : "yellow",
        number: n,
        legacy: false,
      };
    }
  }

  // Legacy bare-number format: "5", "23"
  const legacyMatch = s.match(/^\s*(\d+)\s*$/);
  if (legacyMatch) {
    const digits = legacyMatch[1];
    if (digits !== undefined) {
      const n = parseInt(digits, 10);
      if (!Number.isFinite(n)) return null;
      if (n < 1 || n > 90) return null;
      return { color: "red", number: n, legacy: true };
    }
  }

  return null;
}

/** Encodes a (color, number) pair into the Tekmetric wire format. */
export function formatKeytag(color: TagColor, number: number): string {
  return `${color === "red" ? "R" : "Y"}${number}`;
}

/** Human-readable rendering for orchestrator responses ("Red 5", "Yellow 45"). */
export function describeKeytag(color: TagColor, number: number): string {
  return `${color === "red" ? "Red" : "Yellow"} ${number}`;
}
