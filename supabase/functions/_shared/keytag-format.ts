// Color-coded keytag string format for the Tekmetric `keyTag` field.
//
// Convention (locked 2026-05-09):
//   "R<n>"  for red   (e.g. "R1", "R45", "R90")
//   "Y<n>"  for yellow (e.g. "Y1", "Y45", "Y90")
//
// User-facing rendering uses the long form ("Red 1", "Yellow 45") — the orchestrator
// is responsible for that conversion when speaking to humans. The wire format
// (Tekmetric + DB) stays compact.
//
// Backwards compatibility: bare numeric strings ("5", "23") from the pre-color
// deployment are interpreted as RED. This lets us co-exist with legacy data in
// Tekmetric without a manual cleanup pass. New writes always use the new format.

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
  const newMatch = s.match(/^([RYry])\s*(\d+)$/);
  if (newMatch) {
    const c = newMatch[1].toLowerCase();
    const n = parseInt(newMatch[2], 10);
    if (!Number.isFinite(n)) return null;
    if (n < 1 || n > 90) return null;
    return {
      color: c === "r" ? "red" : "yellow",
      number: n,
      legacy: false,
    };
  }

  // Legacy bare-number format: "5", "23"
  const legacyMatch = s.match(/^\s*(\d+)\s*$/);
  if (legacyMatch) {
    const n = parseInt(legacyMatch[1], 10);
    if (!Number.isFinite(n)) return null;
    if (n < 1 || n > 90) return null;
    return { color: "red", number: n, legacy: true };
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
