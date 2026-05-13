// Markdown-table parser + writer for the scheduler admin tools.
//
// Per chat-design.md "MD-upload pattern" + scheduler_phase1_design_lock.md
// 2026-05-13: service advisors edit predefined-data tables by uploading a
// markdown file. The expected format is a single GitHub-flavored markdown
// table with a header row, a separator row, and one data row per record.
//
// Format example (routine_services):
//
//   # Routine Services
//
//   | service_key | display_name | abbreviation | display_order | wait_eligible | requires_explanation | active |
//   |-------------|--------------|--------------|---------------|---------------|----------------------|--------|
//   | oil_change  | Oil Change   | OILCHG       | 1             | true          | false                | true   |
//   | tire_rotate | Tire Rotation| TIREROT      | 2             | true          | false                | true   |
//
// The parser is forgiving:
//   - Surrounding whitespace per cell is trimmed
//   - Trailing/leading | are optional
//   - Heading-only lines (# / ##) are ignored
//   - Comment lines starting with `<!--` are ignored
//   - Blank rows between header and data, or between rows, are ignored
//
// The parser is STRICT about:
//   - Exactly one header row + one separator row at the top of the table
//   - Every data row must have the same column count as the header
//   - Header column names must exactly match the expected column-name set
//     (caller decides which columns to look for; this module just hands
//     back the row objects as Record<string, string>)
//
// Writer (mdTableFromRows) produces a GitHub-flavored table from a column
// schema + array of row objects. Round-trips cleanly through the parser.

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ParsedMdTable {
  headers: string[];
  /** Each row keyed by header column name; values are the raw trimmed strings. */
  rows: Record<string, string>[];
}

export interface MdTableSpec {
  /** Title shown at the top of the file. e.g. "Routine Services Catalog". */
  title: string;
  /** Column name → human-readable description (rendered as a leading
   *  HTML comment block above the table for advisor reference). */
  columns: Array<{
    name: string;
    description: string;
  }>;
}

export interface ParseError {
  line_number: number;
  message: string;
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse a markdown table from a full document string. Returns the FIRST
 * table found (Phase 1 design: one table per MD upload).
 *
 * Throws (NEVER returns ParseError-only output) when the parse FAILS at
 * the structural level. Returns errors[] for per-row validation issues that
 * a caller might want to surface alongside the partial-success rows.
 */
export function parseMdTable(content: string): {
  table: ParsedMdTable;
  errors: ParseError[];
} {
  const lines = content.split(/\r?\n/);
  let headerLine: string | null = null;
  let headerLineNo = 0;
  let separatorLineNo = 0;

  // Walk line-by-line until we hit the header. Skip headings, comments, blanks.
  let i = 0;
  for (; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("<!--")) {
      // Block comment — skip until closing -->
      while (i < lines.length && !lines[i].includes("-->")) i++;
      continue;
    }
    if (trimmed.includes("|")) {
      headerLine = trimmed;
      headerLineNo = i + 1;
      break;
    }
  }
  if (headerLine === null) {
    throw new Error("md_parse_failed: no markdown table found");
  }

  // Next non-blank line must be the separator (---|---|---).
  let separatorLine: string | null = null;
  for (i = i + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("#") || trimmed.startsWith("<!--")) continue;
    separatorLine = trimmed;
    separatorLineNo = i + 1;
    break;
  }
  if (!separatorLine || !/^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(separatorLine)) {
    throw new Error(
      `md_parse_failed: header row at line ${headerLineNo} not followed by a valid separator (--- | --- | ...)`,
    );
  }

  const headers = splitRow(headerLine);
  if (headers.length === 0) {
    throw new Error(
      `md_parse_failed: header row at line ${headerLineNo} has zero columns`,
    );
  }
  const separatorCols = splitRow(separatorLine);
  if (separatorCols.length !== headers.length) {
    throw new Error(
      `md_parse_failed: separator at line ${separatorLineNo} has ${separatorCols.length} columns but header has ${headers.length}`,
    );
  }

  // Data rows.
  const rows: Record<string, string>[] = [];
  const errors: ParseError[] = [];
  for (i = i + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("<!--")) {
      while (i < lines.length && !lines[i].includes("-->")) i++;
      continue;
    }
    if (!trimmed.includes("|")) continue;

    const cells = splitRow(trimmed);
    if (cells.length !== headers.length) {
      errors.push({
        line_number: i + 1,
        message: `row has ${cells.length} columns, expected ${headers.length}`,
      });
      continue;
    }
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = cells[c];
    }
    rows.push(obj);
  }

  return { table: { headers, rows }, errors };
}

/** Split a pipe-delimited row into trimmed cells, handling optional outer pipes. */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((cell) => cell.trim());
}

// ─── Coercion helpers ───────────────────────────────────────────────────────

/**
 * Coerce a string cell to a boolean. Accepts: true/false, TRUE/FALSE, 1/0,
 * yes/no, Y/N (case-insensitive). Empty string → null (caller decides).
 */
export function coerceBool(s: string): boolean | null {
  const v = s.trim().toLowerCase();
  if (v === "") return null;
  if (["true", "1", "yes", "y", "t"].includes(v)) return true;
  if (["false", "0", "no", "n", "f"].includes(v)) return false;
  return null;
}

/**
 * Coerce a string cell to an integer. Empty → null. Non-numeric → null.
 */
export function coerceInt(s: string): number | null {
  const v = s.trim();
  if (v === "") return null;
  if (!/^-?\d+$/.test(v)) return null;
  return parseInt(v, 10);
}

/**
 * Coerce a JSONB cell (e.g. concern_questions.options) from its MD-friendly
 * representation. Accepts the literal JSON form like:
 *   [{"label":"Front","value":"front"},{"label":"Rear","value":"rear"}]
 * OR a semicolon-delimited shorthand:
 *   front:Front; rear:Rear; passenger:Passenger side
 * The shorthand is service-advisor friendly (no JSON brackets / quotes).
 * Returns null on parse failure (caller surfaces an error).
 */
export function coerceOptions(
  s: string,
): Array<{ label: string; value: string }> | null {
  const v = s.trim();
  if (v === "") return [];
  // JSON form
  if (v.startsWith("[")) {
    try {
      const parsed = JSON.parse(v) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.every(
          (o) =>
            o &&
            typeof o === "object" &&
            typeof (o as Record<string, unknown>).label === "string" &&
            typeof (o as Record<string, unknown>).value === "string",
        )
      ) {
        return parsed as Array<{ label: string; value: string }>;
      }
      return null;
    } catch {
      return null;
    }
  }
  // Shorthand form: value:label; value2:label2
  const out: Array<{ label: string; value: string }> = [];
  for (const part of v.split(";")) {
    const trimmedPart = part.trim();
    if (!trimmedPart) continue;
    const colon = trimmedPart.indexOf(":");
    if (colon === -1) {
      // No colon — treat as both value+label
      out.push({ label: trimmedPart, value: trimmedPart });
    } else {
      const value = trimmedPart.slice(0, colon).trim();
      const label = trimmedPart.slice(colon + 1).trim();
      if (!value || !label) return null;
      out.push({ label, value });
    }
  }
  return out;
}

/**
 * Coerce a comma-separated array cell (e.g. testing_services.concern_categories).
 * Empty string → []. Surrounding whitespace per item is trimmed.
 */
export function coerceCsvArray(s: string): string[] {
  const v = s.trim();
  if (v === "") return [];
  return v
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

/**
 * Coerce a YYYY-MM-DD date cell. Returns null when blank or malformed.
 */
export function coerceDate(s: string): string | null {
  const v = s.trim();
  if (v === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

// ─── Writer ──────────────────────────────────────────────────────────────────

/**
 * Render a markdown table from rows + a column spec. Encodes arrays as
 * comma-separated; encodes JSON-options arrays as the shorthand
 * `value:label; value2:label2`; encodes booleans as `true`/`false`.
 *
 * Used by export_md tools so advisors can download the current state, edit
 * locally, and upload back.
 */
export function mdTableFromRows(
  spec: MdTableSpec,
  rows: Array<Record<string, unknown>>,
): string {
  const headers = spec.columns.map((c) => c.name);
  const headerLine = `| ${headers.join(" | ")} |`;
  const sepLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const dataLines = rows.map((r) => {
    const cells = headers.map((h) => formatCell(r[h]));
    return `| ${cells.join(" | ")} |`;
  });

  // Reference comment block — handy for advisors editing the file later.
  const refLines = spec.columns
    .map((c) => `<!-- ${c.name}: ${c.description} -->`)
    .join("\n");

  return [
    `# ${spec.title}`,
    "",
    refLines,
    "",
    headerLine,
    sepLine,
    ...dataLines,
    "",
  ].join("\n");
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    // Escape pipes so they don't break the row.
    return v.replace(/\|/g, "\\|");
  }
  if (Array.isArray(v)) {
    // String array → CSV; option-array → shorthand
    if (v.every((x) => typeof x === "string")) return (v as string[]).join(", ");
    if (
      v.every(
        (x) =>
          x &&
          typeof x === "object" &&
          typeof (x as Record<string, unknown>).label === "string" &&
          typeof (x as Record<string, unknown>).value === "string",
      )
    ) {
      return (v as Array<{ label: string; value: string }>)
        .map((o) => `${o.value}:${o.label}`)
        .join("; ");
    }
    return JSON.stringify(v).replace(/\|/g, "\\|");
  }
  return JSON.stringify(v).replace(/\|/g, "\\|");
}

// ─── Hash helper for audit ──────────────────────────────────────────────────

/**
 * SHA-256 of the raw MD content, base64-url encoded. Stored in
 * scheduler_admin_audit_log.md_content_hash to de-dup repeat uploads of the
 * same file (e.g. accidental re-uploads).
 */
export async function sha256Hex(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
