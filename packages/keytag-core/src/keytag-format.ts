// Color-coded keytag string format — PURE (no Deno).
//
// COPY for the @jeffs/keytag-core read package (Phase 0 build-seam spike,
// 2026-06-26). Source of truth: `supabase/functions/_shared/keytag-format.ts`.
// The read closure only needs `TagColor`, but the small pure helpers are
// carried verbatim so the copy is a drop-in match.
//
//   "R<n>"  for red   (e.g. "R1", "R45", "R90")
//   "Y<n>"  for yellow (e.g. "Y1", "Y45", "Y90")

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
 */
export function parseKeytag(
  raw: string | number | null | undefined,
): ParsedKeytag | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s.length === 0) return null;

  // New format: "R5", "Y45"
  const newMatch = s.match(/^([RYry])\s*(\d+)$/);
  if (newMatch) {
    // Capture groups 1 + 2 are guaranteed present when the regex matches.
    const c = newMatch[1]!.toLowerCase();
    const n = parseInt(newMatch[2]!, 10);
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
    // Capture group 1 is guaranteed present when the regex matches.
    const n = parseInt(legacyMatch[1]!, 10);
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
