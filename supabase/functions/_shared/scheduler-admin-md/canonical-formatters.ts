// canonical-formatters — scheduler admin MD module.
// Extracted from scheduler-admin-md.ts (file-size-refactor). Mechanical split
// — no logic changes. Public API preserved via ./index.ts + the re-export shim.



// ─── Canonical-state value formatters (shared across handlers) ─────────────

/** Mirror plpgsql `COALESCE(<col>, '<null>')` for nullable TEXT columns. */
export function nullStr(v: unknown): string {
  if (v === null || v === undefined) return "<null>";
  return String(v);
}

/** Mirror plpgsql `COALESCE(<col>::TEXT, '<null>')` for nullable scalars. */
export function nullScalar(v: unknown): string {
  if (v === null || v === undefined) return "<null>";
  return String(v);
}

/** Mirror plpgsql `CASE WHEN <col> THEN 'true' ELSE 'false' END`. */
export function boolStr(v: unknown): string {
  return v ? "true" : "false";
}

/**
 * Mirror plpgsql:
 *   COALESCE((SELECT jsonb_agg(elem ORDER BY elem)::TEXT
 *             FROM jsonb_array_elements_text(to_jsonb(COALESCE(col, '{}'::TEXT[])))
 *             AS elem), '[]')
 *
 * Empty/null array → `'[]'`. Non-empty → JSON array with elements sorted
 * lexicographically. Matches Postgres `jsonb_agg(elem ORDER BY elem)::TEXT`
 * canonical form: `["a", "b", "c"]` with SPACE AFTER COMMA. Verified
 * against test DB 2026-05-26 via `SELECT jsonb_agg(...)::TEXT` MCP query —
 * Postgres canonical jsonb-text uses space-after-comma + space-after-colon
 * (NOT what JS's `JSON.stringify` emits, which has no spaces). Closing this
 * gap keeps byte-parity with the 6 columns × 4 kinds that use sorted-text
 * arrays (example_keywords, concern_categories, positive_examples,
 * negative_examples, synonyms, eligible_testing_service_keys).
 * Strings only — pgcrypto array elements are TEXT in every canonical_state_<kind>
 * call site (verified migration lines 545-547, 603-605, 660-670, 718-720).
 */
export function sortedTextArray(v: unknown): string {
  if (v === null || v === undefined) return "[]";
  if (!Array.isArray(v) || v.length === 0) return "[]";
  const strings = v.map((x) => String(x));
  strings.sort(); // lexicographic ascending — same as Postgres `ORDER BY elem`
  // Manual format: JSON.stringify on each element (proper escaping),
  // join with ", " (space-after-comma matches Postgres jsonb-text).
  return "[" + strings.map((s) => JSON.stringify(s)).join(", ") + "]";
}

/**
 * Mirror plpgsql for ORDERED text arrays (per migration line 774-775):
 *   (SELECT jsonb_agg(elem ORDER BY ord)
 *    FROM unnest(COALESCE(col, '{}'::TEXT[])) WITH ORDINALITY AS s(elem, ord))
 *
 * Empty/null array → `'[]'`. Non-empty → JSON array preserving incoming
 * order (NOT sorted). Used for `required_facts` only.
 *
 * Same space-after-comma rule as sortedTextArray — Postgres jsonb-text
 * canonical form is `["a", "b"]` not `["a","b"]`. Verified 2026-05-26.
 */
export function orderedTextArray(v: unknown): string {
  if (v === null || v === undefined) return "[]";
  if (!Array.isArray(v) || v.length === 0) return "[]";
  return "[" + v.map((x) => JSON.stringify(String(x))).join(", ") + "]";
}

/**
 * Mirror plpgsql `COALESCE(options::TEXT, '<null>')` for the JSONB `options`
 * column on concern_questions. `options` is a JSONB array of {label,value}
 * objects in DB; pg's `::TEXT` cast emits the canonical JSONB text form
 * (object keys sorted, no whitespace).
 *
 * Postgres `jsonb::text` produces the canonical compact form with:
 *   - keys sorted alphabetically within objects
 *   - no whitespace
 *   - string values JSON-escaped
 *
 * We mirror that via a custom canonical-stringify so values match
 * byte-for-byte.
 */
export function jsonbColumnText(v: unknown): string {
  if (v === null || v === undefined) return "<null>";
  return canonicalJsonbText(v);
}

/**
 * Stringify a value matching Postgres's `jsonb::text` canonical form:
 *   - object keys sorted alphabetically
 *   - arrays preserve element order
 *   - no whitespace
 *   - strings double-quoted + JSON-escaped
 *   - numbers as-is
 *   - null → "null", true/false → "true"/"false"
 */
function canonicalJsonbText(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((x) => canonicalJsonbText(x)).join(", ") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map(
      (k) => `${JSON.stringify(k)}: ${canonicalJsonbText(obj[k])}`,
    );
    return "{" + parts.join(", ") + "}";
  }
  return "null";
}
