// Pure-TS Levenshtein distance for fuzzy customer-name matching.
//
// Used by the scheduler specialist's lookupCustomerByName fuzzy mode + the
// verify_customer_identity tool's lenient name compare. Phase 1 design lock
// 2026-05-13 sets max_distance=2 as the default tolerance — catches single-
// character typos (e.g. "Jefery" → "Jeffrey", 1 substitution; "Roberto" →
// "Robert", 1 deletion) without over-matching ("Sam" → "Tim", distance 3).
//
// Implementation: classic dynamic-programming Levenshtein. O(n×m) time +
// O(min(n,m)) space (only two rows of the matrix are kept). Fast enough for
// candidate-set filtering — Tekmetric's name-search endpoint returns ≤25
// rows so the worst case is 25 × |query| × |candidate| ≈ trivial.
//
// Normalization: case-folded + diacritics-stripped + whitespace-collapsed
// before comparison. The customer's "JEFF" should match record "Jeff" with
// distance 0, and "Jose" should match "José" (diacritic strip).

/**
 * Normalize a name for fuzzy comparison.
 * - Lower-cases
 * - Strips combining-mark diacritics (José → Jose)
 * - Collapses internal whitespace runs to a single space
 * - Trims leading/trailing whitespace
 */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining marks
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classic Levenshtein edit distance with two-row optimization.
 * Returns the number of single-character edits (insertion, deletion,
 * substitution) needed to transform `a` into `b`. Symmetric.
 *
 * Examples:
 *   levenshteinDistance("kitten", "sitting") === 3
 *   levenshteinDistance("Jefery", "Jeffrey") === 1   (insert 'f')
 *   levenshteinDistance("abc",    "abc")     === 0
 *   levenshteinDistance("",       "abc")     === 3
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Make `a` the shorter string to minimize working memory.
  if (a.length > b.length) {
    const tmp = a;
    a = b;
    b = tmp;
  }

  const aLen = a.length;
  const bLen = b.length;

  // Two-row buffer: prev = row i-1, curr = row i.
  let prev = new Array<number>(aLen + 1);
  let curr = new Array<number>(aLen + 1);
  for (let j = 0; j <= aLen; j++) prev[j] = j;

  for (let i = 1; i <= bLen; i++) {
    curr[0] = i;
    const bi = b.charCodeAt(i - 1);
    for (let j = 1; j <= aLen; j++) {
      const cost = a.charCodeAt(j - 1) === bi ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      curr[j] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[aLen];
}

/**
 * Check whether two names are a fuzzy match within max_distance edits.
 * Normalizes both inputs before comparing.
 *
 * Returns:
 *   { match: true,  distance: number }
 *   { match: false, distance: number }
 */
export function isFuzzyNameMatch(
  query: string,
  candidate: string,
  maxDistance: number = 2,
): { match: boolean; distance: number } {
  const a = normalizeName(query);
  const b = normalizeName(candidate);
  if (!a || !b) return { match: false, distance: Math.max(a.length, b.length) };
  // Quick reject: length-difference upper bound exceeds maxDistance.
  if (Math.abs(a.length - b.length) > maxDistance) {
    return { match: false, distance: Math.abs(a.length - b.length) };
  }
  const d = levenshteinDistance(a, b);
  return { match: d <= maxDistance, distance: d };
}
