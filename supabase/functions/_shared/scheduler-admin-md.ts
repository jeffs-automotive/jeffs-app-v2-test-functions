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

// ─── Concern-category MD parser (hierarchical, NOT tabular) ─────────────────
//
// Format (taken from dotfiles/.../references/concerns/{slug}/{slug}-concerns.md):
//
//   # {Category Display Label}
//
//   -- {Sub-Category Name} Checklist --
//   1. Question 1
//   2. Question 2
//   ...
//
//   -- {Next Sub-Category Name} Checklist --
//   1. ...
//
//   ---
//
//   Sources consulted:
//   - https://...
//
// Parser stops at the `---` horizontal rule — content below is metadata,
// not parsed into the DB. Numbered-list questions can wrap across multiple
// lines if needed; the parser joins continuation lines (indented OR
// non-numbered) onto the prior question.

export interface ParsedConcernQuestion {
  question_text: string;
  display_order: number;
  /** Optional answer-options. When present, the upload tool uses this
   *  array for the question's `options` JSONB column. When absent, the
   *  upload tool falls back to the default Yes/No/Sometimes set. Added
   *  2026-05-18 per the CAT-2 catalog rebuild — the canonical MD format
   *  now carries options + multi_select inline so upload doesn't
   *  regress questions that have non-yes/no chips (location, onset,
   *  speed bands, etc.). */
  options?: Array<{ label: string; value: string }>;
  /** Optional multi-select flag (TRUE → chip card allows multi-toggle +
   *  Continue button). Encoded in the MD as a leading `[multi]` token
   *  in the question text. Falls back to FALSE when absent. */
  multi_select?: boolean;
}

export interface ParsedConcernSubcategory {
  slug: string;
  display_label: string;
  display_order: number;
  questions: ParsedConcernQuestion[];
}

export interface ParsedConcernDoc {
  display_label: string;
  subcategories: ParsedConcernSubcategory[];
}

/**
 * Slugify a sub-category display label into a stable DB key.
 * "High-Pitched Squealing" → "high_pitched_squealing".
 * "AC Blows Warm or Hot Air" → "ac_blows_warm_or_hot_air".
 */
export function slugifyForConcernSubcategory(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

/**
 * Parse a concern-category MD document into structured form. Strict on
 * structure (must have H1, must have at least one sub-category, each
 * sub-category must have at least one question) — soft on incidental
 * whitespace.
 *
 * Throws Error with a descriptive message when the structure is wrong.
 * Caller should surface that message in the UploadResult.error_message.
 */
// ─── Concern-category guideline parser (added 2026-05-18) ──────────────────
//
// Concern-category guidelines are short prose paragraphs the diagnostic
// LLM reads BEFORE the questions for that category. Format:
//
//   # {Display Label} — Diagnostic Guideline
//
//   {Prose body — single paragraph or several. Markdown is preserved as
//    plain text; the diagnostic LLM consumes it as a system-prompt
//    fragment, not as rendered HTML.}
//
//   ---
//
//   {Optional notes / sources — ignored by the parser.}
//
// Strict: must have an H1 (`# {label}`), must have ≥ 1 non-blank prose
// line below the H1, stops at the first `---` horizontal rule.

export interface ParsedConcernGuidelineDoc {
  display_label: string;
  guideline_prose: string;
}

export function parseConcernCategoryGuidelineMd(
  content: string,
): ParsedConcernGuidelineDoc {
  const allLines = content.split(/\r?\n/);
  const hrIdx = allLines.findIndex((l) => /^---\s*$/.test(l.trim()));
  const body = hrIdx >= 0 ? allLines.slice(0, hrIdx) : allLines;

  let displayLabel: string | null = null;
  let i = 0;
  for (; i < body.length; i++) {
    const line = body[i]?.trim() ?? "";
    if (line === "") continue;
    const h1 = line.match(/^#\s+(.+?)\s*$/);
    if (!h1) {
      throw new Error(
        `guideline MD: expected H1 ('# Category — Diagnostic Guideline') as first non-blank line, got "${line.slice(0, 80)}"`,
      );
    }
    // Strip the trailing " — Diagnostic Guideline" suffix if present so
    // display_label round-trips against the regular category labels.
    displayLabel = h1[1]?.replace(/\s+[—\-]\s+Diagnostic Guideline\s*$/i, "").trim() ?? null;
    i++;
    break;
  }
  if (!displayLabel) {
    throw new Error("guideline MD: missing H1 category label");
  }

  // Collect non-blank prose lines, preserving paragraph breaks via single
  // newlines (consecutive blank lines collapse to one). Returns a single
  // string suitable for storage in the guideline_prose TEXT column.
  const proseLines: string[] = [];
  let lastBlank = true;
  for (; i < body.length; i++) {
    const line = body[i] ?? "";
    if (line.trim() === "") {
      if (!lastBlank) proseLines.push("");
      lastBlank = true;
    } else {
      proseLines.push(line.trim());
      lastBlank = false;
    }
  }
  // Trim trailing blanks
  while (proseLines.length > 0 && proseLines[proseLines.length - 1] === "") {
    proseLines.pop();
  }
  const prose = proseLines.join("\n").trim();
  if (prose.length === 0) {
    throw new Error(
      "guideline MD: empty prose body — at least one non-blank line is required",
    );
  }

  return { display_label: displayLabel, guideline_prose: prose };
}

export function parseConcernCategoryMd(content: string): ParsedConcernDoc {
  const allLines = content.split(/\r?\n/);

  // Trim everything below the first `---` horizontal rule (the sources
  // section). The regex tolerates `---` with optional trailing spaces.
  let bodyLines = allLines;
  const hrIndex = allLines.findIndex((l) => /^---\s*$/.test(l.trim()));
  if (hrIndex >= 0) {
    bodyLines = allLines.slice(0, hrIndex);
  }

  // Find the H1 line. Must exist and be the first non-blank line.
  let displayLabel: string | null = null;
  let i = 0;
  for (; i < bodyLines.length; i++) {
    const line = bodyLines[i]?.trim() ?? "";
    if (line === "") continue;
    const h1Match = line.match(/^#\s+(.+?)\s*$/);
    if (!h1Match) {
      throw new Error(
        `concern MD: expected H1 ('# Category Name') as first non-blank line, got "${line.slice(0, 80)}"`,
      );
    }
    displayLabel = h1Match[1]?.trim() ?? null;
    i++;
    break;
  }
  if (!displayLabel) {
    throw new Error("concern MD: missing H1 category label");
  }

  // Walk the rest, breaking into sub-category sections.
  const subcategories: ParsedConcernSubcategory[] = [];
  let currentSub: ParsedConcernSubcategory | null = null;
  let nextQuestionOrder = 1;

  const SUB_HEADER = /^--\s+(.+?)\s+Checklist\s+--\s*$/;
  const NUMBERED = /^(\d+)\.\s+(.+?)\s*$/;
  // Options line: indented hyphen + pipe-separated entries. Each entry is
  // "Label" OR "Label=value". The match uses the RAW line (not trimmed)
  // so we can require indentation to disambiguate from a sub-category
  // header which starts with "--". One required leading whitespace char.
  const OPTIONS_LINE = /^\s+-\s+(.+?)\s*$/;
  // Multi-select prefix: question text starts with "[multi]" (with
  // optional surrounding whitespace).
  const MULTI_PREFIX = /^\[multi\]\s+(.+)$/;

  for (; i < bodyLines.length; i++) {
    const raw = bodyLines[i] ?? "";
    const line = raw.trim();
    if (line === "") {
      // Blank line — separator. No state change.
      continue;
    }

    // HTML comments — skip both single-line and multi-line so they don't get
    // appended to the previous question via the continuation-line collector
    // at the bottom of this loop.
    if (line.startsWith("<!--")) {
      if (line.includes("-->")) {
        continue;
      }
      let j = i + 1;
      while (j < bodyLines.length && !(bodyLines[j] ?? "").includes("-->")) j++;
      i = j;
      continue;
    }

    const subMatch = line.match(SUB_HEADER);
    if (subMatch) {
      if (currentSub && currentSub.questions.length === 0) {
        throw new Error(
          `concern MD: sub-category "${currentSub.display_label}" has no questions`,
        );
      }
      const subLabel = subMatch[1]?.trim() ?? "";
      if (!subLabel) {
        throw new Error(`concern MD: empty sub-category name on line "${line}"`);
      }
      currentSub = {
        slug: slugifyForConcernSubcategory(subLabel),
        display_label: subLabel,
        display_order: subcategories.length + 1,
        questions: [],
      };
      subcategories.push(currentSub);
      nextQuestionOrder = 1;
      continue;
    }

    const numMatch = line.match(NUMBERED);
    if (numMatch) {
      if (!currentSub) {
        throw new Error(
          `concern MD: numbered line found before any "-- {Name} Checklist --" header: "${line.slice(0, 80)}"`,
        );
      }
      let text = numMatch[2]?.trim() ?? "";
      if (!text) {
        throw new Error(
          `concern MD: empty numbered question on line "${line}"`,
        );
      }
      // Strip [multi] prefix if present + flag the question.
      let multi_select = false;
      const multiMatch = text.match(MULTI_PREFIX);
      if (multiMatch) {
        multi_select = true;
        text = multiMatch[1] ?? text;
      }
      currentSub.questions.push({
        question_text: text,
        display_order: nextQuestionOrder,
        multi_select,
      });
      nextQuestionOrder += 1;
      continue;
    }

    // Options line — indented hyphen + pipe-separated entries directly
    // under a numbered question. Test BEFORE the continuation fallback
    // because the OPTIONS_LINE regex requires leading whitespace +
    // `-` which would otherwise be interpreted as a wrapping line.
    //
    // Use the RAW line (with indentation preserved) for the regex check
    // — `line` is trimmed and would lose the indentation that disambiguates
    // options from a sub-category header.
    const optionsMatch = raw.match(OPTIONS_LINE);
    if (
      optionsMatch &&
      currentSub &&
      currentSub.questions.length > 0 &&
      // Belt-and-suspenders: a sub-category header starts with `--`. If the
      // captured body begins with `-` and contains "Checklist", treat it
      // as a header (defensive — the SUB_HEADER regex above should win
      // since it doesn't require leading whitespace, but covering the
      // edge case of an indented "-- foo Checklist --" line).
      !optionsMatch[1]!.match(/\s+Checklist\s+--\s*$/) &&
      optionsMatch[1]!.includes("|")
    ) {
      const last = currentSub.questions[currentSub.questions.length - 1];
      if (last) {
        const optsRaw = optionsMatch[1] ?? "";
        const opts: Array<{ label: string; value: string }> = [];
        for (const chunk of optsRaw.split("|")) {
          const part = chunk.trim();
          if (!part) continue;
          const eq = part.indexOf("=");
          if (eq >= 0) {
            const label = part.slice(0, eq).trim();
            const value = part.slice(eq + 1).trim();
            if (label && value) opts.push({ label, value });
          } else {
            // No explicit value → slugify the label.
            const label = part;
            const value = slugifyForConcernSubcategory(label) || "opt";
            if (label) opts.push({ label, value });
          }
        }
        if (opts.length > 0) {
          last.options = opts;
        }
      }
      continue;
    }

    // Continuation line (line under a numbered question that wraps)
    if (currentSub && currentSub.questions.length > 0) {
      const last = currentSub.questions[currentSub.questions.length - 1];
      if (last) {
        last.question_text = `${last.question_text} ${line}`;
      }
      continue;
    }

    // Otherwise the line is stray — ignore for forward compatibility
    // (e.g., advisors may add ad-hoc notes between sections; we don't fail
    // on those).
  }

  if (subcategories.length === 0) {
    throw new Error(
      "concern MD: no sub-categories found — every doc needs at least one '-- {Name} Checklist --' block",
    );
  }
  if (currentSub && currentSub.questions.length === 0) {
    throw new Error(
      `concern MD: sub-category "${currentSub.display_label}" has no questions`,
    );
  }

  return {
    display_label: displayLabel,
    subcategories,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Per-service-block format (Option B — adopted 2026-05-19)
//
// Replaces the wide-table format for testing-services.md + routine-services.md
// — descriptions are 1-2 sentences and don't fit comfortably in table cells.
//
// Format:
//
//   # Testing Services
//
//   <!-- format guidance comment -->
//
//   ## alternator_testing
//   Display name: Alternator testing (simple electrical)
//   Abbreviation: ALT TESTING
//   Starting price: $89.95
//   Notes: Starting price
//   Description: Tests alternator output under load and inspects related electrical components.
//   Concern categories: electrical, warning_light
//   Active: true
//
//   ## battery_test
//   Display name: Battery test
//   ...
//
// Parser rules:
//   - Each `## <service_key>` heading starts a new section
//   - Each `Field: value` line under a section is a field assignment
//     (Field name matched case-insensitively, normalized to snake_case)
//   - Blank lines and `<!-- ... -->` comments are ignored
//   - The H1 (`# Title`) is informational and ignored by the parser
//   - Order of fields within a section doesn't matter
//   - Multi-line values not currently supported — keep to one line
//
// Field value parsing:
//   - "Starting price" → cents (parses "$XX.XX", "XX.XX", "Free", "free", "0", "(none)")
//   - "Concern categories" → comma-separated array (also accepts " · " separator)
//   - "Example keywords" → comma-separated array
//   - "Active", "Wait eligible", "Requires explanation" → boolean (true/false/yes/no)
//   - "Display order" → integer
//   - Everything else → string (trimmed; empty string → null)

export interface ParsedMdSection {
  /** The service_key from the `## heading`. */
  key: string;
  /** Raw field map, keys lowercased + spaces→underscores. */
  fields: Record<string, string>;
  /** Source line number of the heading (1-indexed) for error messages. */
  heading_line: number;
}

export interface ParsedMdSections {
  /** Title from the H1, or empty if absent. */
  title: string;
  sections: ParsedMdSection[];
}

/**
 * Parse an MD file in the Option B per-service-block format. Returns sections
 * keyed by their `## heading` (the service_key). Field names are normalized
 * (lowercase + spaces→underscores) but values are kept as raw trimmed strings
 * — value parsing (price → cents, csv → array, etc.) is the caller's job.
 *
 * Throws on:
 *   - Duplicate `## heading` (same service_key twice)
 *   - Malformed field line (no `:` separator)
 *   - service_key not matching ^[a-z0-9_]+$
 */
export function parseMdSections(md: string): ParsedMdSections {
  const lines = md.split(/\r?\n/);
  let title = "";
  const sections: ParsedMdSection[] = [];
  const seenKeys = new Set<string>();
  let current: ParsedMdSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    const lineNo = i + 1;

    if (line === "" || line.startsWith("---")) {
      continue;
    }

    // HTML comments — handle BOTH single-line (`<!-- ... -->` on one line) AND
    // multi-line (open `<!--` here, closing `-->` on a later line). Walks past
    // intermediate lines so they don't get mis-parsed as Field lines. Without
    // this, a between-section multi-line comment like:
    //   <!-- ====
    //        BANNER
    //   ==== -->
    // would skip the `<!--` line, then choke on the BANNER line as a Field.
    if (line.startsWith("<!--")) {
      if (line.includes("-->")) {
        continue; // single-line comment closed on same line
      }
      let j = i + 1;
      while (j < lines.length && !lines[j].includes("-->")) j++;
      i = j; // jump past the closing line
      continue;
    }

    if (line.startsWith("# ") && !line.startsWith("## ")) {
      title = line.slice(2).trim();
      continue;
    }

    if (line.startsWith("## ")) {
      const key = line.slice(3).trim();
      if (!/^[a-z0-9_]+$/.test(key)) {
        throw new Error(
          `line ${lineNo}: service_key "${key}" must match ^[a-z0-9_]+$ (lowercase + digits + underscores only)`,
        );
      }
      if (seenKeys.has(key)) {
        throw new Error(
          `line ${lineNo}: duplicate service_key "${key}" (already defined earlier in the file)`,
        );
      }
      seenKeys.add(key);
      current = { key, fields: {}, heading_line: lineNo };
      sections.push(current);
      continue;
    }

    // Field line — must be under a section
    if (!current) {
      // Bare text outside a section — skip (could be intro prose under H1)
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) {
      throw new Error(
        `line ${lineNo}: expected "Field: value" inside section "${current.key}"; got "${line}"`,
      );
    }
    const fieldName = line.slice(0, colonIdx).trim().toLowerCase().replace(/\s+/g, "_");
    const fieldValue = line.slice(colonIdx + 1).trim();
    current.fields[fieldName] = fieldValue;
  }

  return { title, sections };
}

// ─── Field value parsers (helpers callers can use) ──────────────────────

/**
 * Parse a price expression to cents (integer ≥ 0) or null.
 * Accepts: "$49.95", "49.95", "4995", "Free", "free", "(none)", "" → null, "0" → 0.
 * Throws on garbage.
 */
export function parsePriceCents(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const s = raw.trim();
  if (s === "" || /^\(?none\)?$/i.test(s)) return null;
  if (/^free$/i.test(s)) return 0;
  // Dollar form: $X.XX or $X
  const dollarMatch = s.match(/^\$?\s*(\d+)(?:\.(\d{1,2}))?\s*$/);
  if (dollarMatch) {
    const dollars = parseInt(dollarMatch[1], 10);
    const centsRaw = dollarMatch[2] ?? "0";
    const cents = parseInt(centsRaw.padEnd(2, "0"), 10);
    return dollars * 100 + cents;
  }
  throw new Error(
    `invalid price "${raw}" — expected "$XX.XX", "XX.XX", "Free", or "(none)"`,
  );
}

/**
 * Format cents as "$XX.XX" or "Free" or "(none)".
 */
export function formatPriceCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "(none)";
  if (cents === 0) return "Free";
  const dollars = Math.floor(cents / 100);
  const remainder = cents % 100;
  return `$${dollars}.${remainder.toString().padStart(2, "0")}`;
}

/**
 * Parse a CSV-or-bullet-separated list into a trimmed string array.
 * Accepts "a, b, c" or "a · b · c" or "a; b; c". Empty → [].
 */
export function parseCsvList(raw: string | undefined): string[] {
  if (!raw) return [];
  const s = raw.trim();
  if (s === "" || s === "(none)") return [];
  return s.split(/\s*[,·;]\s*/).map((x) => x.trim()).filter(Boolean);
}

/**
 * Parse "true"/"false"/"yes"/"no"/"1"/"0" to boolean. Throws on garbage.
 */
export function parseBool(raw: string | undefined, fieldName = "field"): boolean {
  if (raw === undefined) {
    throw new Error(`${fieldName}: missing value`);
  }
  const s = raw.trim().toLowerCase();
  if (s === "true" || s === "yes" || s === "1") return true;
  if (s === "false" || s === "no" || s === "0") return false;
  throw new Error(`${fieldName}: expected true/false/yes/no/1/0, got "${raw}"`);
}

/**
 * Parse an integer. Throws on garbage.
 */
export function parseIntField(raw: string | undefined, fieldName = "field"): number {
  if (raw === undefined) {
    throw new Error(`${fieldName}: missing value`);
  }
  const s = raw.trim();
  const n = parseInt(s, 10);
  if (!/^-?\d+$/.test(s) || Number.isNaN(n)) {
    throw new Error(`${fieldName}: expected integer, got "${raw}"`);
  }
  return n;
}

/**
 * Parse a string field — empty → null, otherwise trimmed string.
 */
export function parseStringField(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const s = raw.trim();
  if (s === "" || s === "(none)") return null;
  return s;
}

// ─── Serializer ─────────────────────────────────────────────────────────

export interface SectionSpec {
  /** The H1 title. */
  title: string;
  /** Multi-line HTML comment shown above the first section as advisor guidance. */
  guidance?: string;
  /** Ordered field list — Field display name (e.g. "Display name") + serializer. */
  fields: Array<{
    label: string;
    /** Read the value from the row + return the string to render after "Label: ". */
    get: (row: Record<string, unknown>) => string;
  }>;
}

/**
 * Render an array of rows into the Option B per-service-block MD format.
 * `keyField` is the column name that becomes the `## heading`.
 */
export function serializeMdSections(
  rows: Record<string, unknown>[],
  keyField: string,
  spec: SectionSpec,
): string {
  const out: string[] = [];
  out.push(`# ${spec.title}`);
  out.push("");
  if (spec.guidance) {
    out.push("<!--");
    out.push(spec.guidance);
    out.push("-->");
    out.push("");
  }
  const sorted = [...rows].sort((a, b) => {
    const ak = String(a[keyField] ?? "");
    const bk = String(b[keyField] ?? "");
    return ak.localeCompare(bk);
  });
  for (const row of sorted) {
    const key = String(row[keyField] ?? "");
    out.push(`## ${key}`);
    for (const field of spec.fields) {
      const value = field.get(row);
      out.push(`${field.label}: ${value}`);
    }
    out.push("");
  }
  return out.join("\n").trim() + "\n";
}

// ═══════════════════════════════════════════════════════════════════════════
// scheduler-edge-parity E2 — Shared helpers for Pattern S + revert dispatch
// ═══════════════════════════════════════════════════════════════════════════
//
// Authored 2026-05-26 per PLAN.md §4.8 + ROUND-6-RESIDUALS E1cf-N2 +
// ADR-025 (pipe-delimited canonical state format).
//
// 4 exported helpers:
//   1. computeConfirmToken(args)         — Pattern S deterministic token
//                                          (mirrors plpgsql formula per E1cf-N2)
//   2. computeCanonicalAfterState(args)  — 10 kind handlers emitting the
//                                          pipe-delimited canonical format per
//                                          ADR-025, byte-for-byte matching
//                                          `canonical_state_<kind>` plpgsql in
//                                          migration 20260526000100.
//   3. canonicalizeDiff(diffSummary)     — stable JSON canonicalization
//                                          (sorted object keys + allow-list
//                                          set-typed array sorting).
//   4. logAuditEntry(args)               — consolidated audit-row INSERT helper.
//                                          REQUIRES shopId (closes prior NULL
//                                          shop_id footgun — see Migration A).
//
// Import dependency: SupabaseClient from npm:@supabase/supabase-js@2 — same
// specifier the 22 other _shared/ + _shared/tools/ files use. The original
// E2 author's jsr: specifier produced "Property 'supabaseUrl' is protected"
// errors at every call site (npm/jsr give nominally-distinct types from
// Deno's perspective), discovered during E4 retrofit 2026-05-26.
// ═══════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// ─── Snapshot kind allow-list (closed set) ─────────────────────────────────

/**
 * The 10 canonical snapshot_kind values per ADR-024 + ADR-025. This is the
 * closed allow-list used by `lock_surface_for_kind`, the dispatch RPC,
 * the apply RPCs' confirm_token formula (per E1cf-N2), and the TS-side
 * `computeCanonicalAfterState()` helper.
 *
 * Drift between this list and the plpgsql allow-list = production bug.
 */
export type SnapshotKind =
  | "testing_services_v2"
  | "routine_services_v2"
  | "concern_subcategories_descriptions_v2"
  | "concern_subcategories_map_v2"
  | "concern_questions_required_facts_v2"
  | "concern_questions_flat"
  | "concern_questions_per_category"
  | "concern_category_guidelines"
  | "appointment_default_limits"
  | "closed_dates_future";

const SNAPSHOT_KIND_ALLOWLIST: ReadonlySet<SnapshotKind> = new Set<SnapshotKind>([
  "testing_services_v2",
  "routine_services_v2",
  "concern_subcategories_descriptions_v2",
  "concern_subcategories_map_v2",
  "concern_questions_required_facts_v2",
  "concern_questions_flat",
  "concern_questions_per_category",
  "concern_category_guidelines",
  "appointment_default_limits",
  "closed_dates_future",
]);

/** Kinds whose confirm_token formula includes a `:<category_slug>` suffix. */
const KINDS_REQUIRING_CATEGORY_SLUG: ReadonlySet<SnapshotKind> = new Set<
  SnapshotKind
>([
  "concern_questions_per_category",
  "concern_category_guidelines",
]);

/** Kinds whose confirm_token formula includes a `:<original_today>` suffix. */
const KINDS_REQUIRING_ORIGINAL_TODAY: ReadonlySet<SnapshotKind> = new Set<
  SnapshotKind
>([
  "closed_dates_future",
]);

// ─── 1. computeConfirmToken ─────────────────────────────────────────────────

/**
 * Arguments for `computeConfirmToken()`. The 5 base fields are required for
 * every kind; the kind-specific fields (`categorySlug`, `originalToday`) are
 * required only when the kind matches.
 */
export interface ComputeConfirmTokenArgs {
  shopId: number;
  kind: SnapshotKind;
  expectedCurrentHash: string;
  mdContentHash: string;
  actorEmail: string;
  /** REQUIRED when kind ∈ {concern_questions_per_category, concern_category_guidelines}; ignored otherwise. */
  categorySlug?: string;
  /** REQUIRED when kind = closed_dates_future. ISO `YYYY-MM-DD`. Ignored otherwise. */
  originalToday?: string;
}

/**
 * Compute the deterministic Pattern S confirm_token. MUST produce the same
 * bytes as the plpgsql apply RPCs' inline formula (per ROUND-6-RESIDUALS
 * E1cf-N2):
 *
 *   sha256(shop_id || ':' || kind || ':' || expected_current_hash || ':' ||
 *          md_content_hash || ':' || actor_email [|| ':' || category_slug]
 *                                  [|| ':' || original_today])
 *
 * Used by:
 *   - E4 V2 catalog uploaders to compute the token for dry_run response
 *   - E5a-e legacy uploader Pattern S refactors to compute the token
 *   - Anywhere the TS side needs to verify a confirm_token matches.
 *
 * Token mismatch path in the apply RPC RAISEs
 * `'revert_blocked: confirm_token_mismatch: …'`.
 *
 * @returns hex-encoded SHA-256 (64 chars lowercase) — matches pgcrypto's
 *          `encode(digest(text, 'sha256'), 'hex')` output byte-for-byte.
 *
 * @throws if `kind` is not in the canonical allow-list, or if a kind-specific
 *         field is required but missing.
 */
export async function computeConfirmToken(
  args: ComputeConfirmTokenArgs,
): Promise<string> {
  if (!SNAPSHOT_KIND_ALLOWLIST.has(args.kind)) {
    throw new Error(
      `computeConfirmToken: kind "${args.kind}" not in canonical allow-list (10 kinds)`,
    );
  }
  if (KINDS_REQUIRING_CATEGORY_SLUG.has(args.kind)) {
    if (!args.categorySlug || args.categorySlug.length === 0) {
      throw new Error(
        `computeConfirmToken: kind "${args.kind}" REQUIRES categorySlug (got ${JSON.stringify(args.categorySlug)})`,
      );
    }
  }
  if (KINDS_REQUIRING_ORIGINAL_TODAY.has(args.kind)) {
    if (!args.originalToday || !/^\d{4}-\d{2}-\d{2}$/.test(args.originalToday)) {
      throw new Error(
        `computeConfirmToken: kind "${args.kind}" REQUIRES originalToday in YYYY-MM-DD form (got ${JSON.stringify(args.originalToday)})`,
      );
    }
  }

  // Build the colon-delimited base input. Order is LOAD-BEARING — plpgsql
  // formula concatenates in this exact sequence (per E1cf-N2 + each apply
  // RPC's header comment).
  let input = `${args.shopId}:${args.kind}:${args.expectedCurrentHash}:${args.mdContentHash}:${args.actorEmail}`;

  if (KINDS_REQUIRING_CATEGORY_SLUG.has(args.kind)) {
    input += `:${args.categorySlug}`;
  }
  if (KINDS_REQUIRING_ORIGINAL_TODAY.has(args.kind)) {
    input += `:${args.originalToday}`;
  }

  // sha256Hex is already defined above (line ~343) — reuse for byte-parity
  // with the apply RPCs' pgcrypto `encode(digest(text, 'sha256'), 'hex')`.
  return await sha256Hex(input);
}

// ─── 2. computeCanonicalAfterState ─────────────────────────────────────────

/**
 * Arguments for `computeCanonicalAfterState()`. Uses a service-role
 * SupabaseClient because the canonical-state query reads from tables whose
 * RLS policies may not permit the caller's auth context. The apply / revert
 * RPCs run as SECURITY DEFINER so they bypass RLS; the TS-side helper
 * needs equivalent read access via service_role.
 */
export interface ComputeCanonicalAfterStateArgs {
  kind: SnapshotKind;
  supabase: SupabaseClient;
  shopId: number;
  /** The p_snapshot JSONB equivalent — same shape the apply path emits. */
  snapshot: Record<string, unknown>;
}

/**
 * TS-side mirror of plpgsql `canonical_state_<kind>(p_shop_id, p_snapshot)`.
 * Emits the pipe-delimited canonical text per ADR-025 byte-for-byte
 * identically to the matching plpgsql serializer in migration
 * `20260526000100_revert_md_upload_dispatch.sql` (lines 518-1138).
 *
 * Used by:
 *   - E4 V2 catalog uploader modifications to populate
 *     `expected_after_state_canonical` AFTER write (post-mutation read)
 *   - Revert-path diff diagnostics when TS code needs the current canonical
 *     state for human-readable display
 *
 * The 5 NEW legacy apply RPCs (PLAN §4.1-4.5) compute their own
 * `expected_after_state_canonical` server-side via `canonical_state_<kind>`
 * — they do NOT use this TS helper.
 *
 * @throws on unknown kind, missing snapshot fields, or Supabase query error.
 *
 * Byte-parity contract per ADR-025 + E1b-N3: a future E10 integration test
 * will seed deterministic data, call BOTH plpgsql `canonical_state_<kind>`
 * (via Supabase RPC) AND this TS helper, and assert the two TEXT outputs
 * are byte-for-byte identical.
 */
export async function computeCanonicalAfterState(
  args: ComputeCanonicalAfterStateArgs,
): Promise<string> {
  const { kind, supabase, shopId, snapshot } = args;
  if (!SNAPSHOT_KIND_ALLOWLIST.has(kind)) {
    throw new Error(
      `computeCanonicalAfterState: kind "${kind}" not in canonical allow-list (10 kinds)`,
    );
  }

  switch (kind) {
    case "testing_services_v2":
      return await canonicalStateTestingServicesV2(supabase, shopId);
    case "routine_services_v2":
      return await canonicalStateRoutineServicesV2(supabase, shopId);
    case "concern_subcategories_descriptions_v2":
      return await canonicalStateSubcategoryDescriptionsV2(supabase, shopId);
    case "concern_subcategories_map_v2":
      return await canonicalStateSubcategoryServiceMapV2(supabase, shopId);
    case "concern_questions_required_facts_v2":
      return await canonicalStateQuestionRequiredFactsV2(supabase, shopId);
    case "concern_questions_flat":
      return await canonicalStateConcernQuestionsFlat(supabase, shopId);
    case "concern_questions_per_category":
      return await canonicalStateConcernCategoryUpload(supabase, shopId, snapshot);
    case "concern_category_guidelines":
      return await canonicalStateConcernCategoryGuideline(supabase, shopId, snapshot);
    case "appointment_default_limits":
      return await canonicalStateAppointmentDefaultLimits(supabase, shopId);
    case "closed_dates_future":
      return await canonicalStateClosedDatesFuture(supabase, shopId, snapshot);
  }
}

// ─── Canonical-state value formatters (shared across handlers) ─────────────

/** Mirror plpgsql `COALESCE(<col>, '<null>')` for nullable TEXT columns. */
function nullStr(v: unknown): string {
  if (v === null || v === undefined) return "<null>";
  return String(v);
}

/** Mirror plpgsql `COALESCE(<col>::TEXT, '<null>')` for nullable scalars. */
function nullScalar(v: unknown): string {
  if (v === null || v === undefined) return "<null>";
  return String(v);
}

/** Mirror plpgsql `CASE WHEN <col> THEN 'true' ELSE 'false' END`. */
function boolStr(v: unknown): string {
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
function sortedTextArray(v: unknown): string {
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
function orderedTextArray(v: unknown): string {
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
function jsonbColumnText(v: unknown): string {
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

// ─── Canonical-state handlers (10 kinds, mirror migration lines 518-1138) ──

/** Kind 1: testing_services_v2 — mirrors migration lines 518-571. */
async function canonicalStateTestingServicesV2(
  sb: SupabaseClient,
  shopId: number,
): Promise<string> {
  const { data, error } = await sb
    .from("testing_services")
    .select(
      "id, service_key, display_name, abbreviation, starting_price_cents, notes, description, example_keywords, concern_categories, active",
    )
    .eq("shop_id", shopId)
    .order("service_key", { ascending: true });
  if (error) {
    throw new Error(
      `canonical_state_testing_services_v2: ${error.message}`,
    );
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const lines = rows.map((r) =>
    `| id=${nullStr(r.id)} | service_key=${nullStr(r.service_key)} | display_name=${nullStr(r.display_name)} | abbreviation=${nullStr(r.abbreviation)} | starting_price_cents=${nullScalar(r.starting_price_cents)} | notes=${nullStr(r.notes)} | description=${nullStr(r.description)} | example_keywords=${sortedTextArray(r.example_keywords)} | concern_categories=${sortedTextArray(r.concern_categories)} | active=${boolStr(r.active)} |`
  );
  const body = lines.join("\n");
  return `# testing_services_v2 shop=${shopId} rows=${rows.length}\n${body}\n`;
}

/** Kind 2: routine_services_v2 — mirrors migration lines 579-632. */
async function canonicalStateRoutineServicesV2(
  sb: SupabaseClient,
  shopId: number,
): Promise<string> {
  const { data, error } = await sb
    .from("routine_services")
    .select(
      "id, service_key, display_name, abbreviation, display_order, wait_eligible, requires_explanation, concern_categories, starting_price_cents, price_waived_note, description, active",
    )
    .eq("shop_id", shopId)
    .order("service_key", { ascending: true });
  if (error) {
    throw new Error(
      `canonical_state_routine_services_v2: ${error.message}`,
    );
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const lines = rows.map((r) =>
    `| id=${nullStr(r.id)} | service_key=${nullStr(r.service_key)} | display_name=${nullStr(r.display_name)} | abbreviation=${nullStr(r.abbreviation)} | display_order=${nullScalar(r.display_order)} | wait_eligible=${boolStr(r.wait_eligible)} | requires_explanation=${boolStr(r.requires_explanation)} | concern_categories=${sortedTextArray(r.concern_categories)} | starting_price_cents=${nullScalar(r.starting_price_cents)} | price_waived_note=${nullStr(r.price_waived_note)} | description=${nullStr(r.description)} | active=${boolStr(r.active)} |`
  );
  const body = lines.join("\n");
  return `# routine_services_v2 shop=${shopId} rows=${rows.length}\n${body}\n`;
}

/** Kind 3: concern_subcategories_descriptions_v2 — mirrors migration lines 639-689. */
async function canonicalStateSubcategoryDescriptionsV2(
  sb: SupabaseClient,
  shopId: number,
): Promise<string> {
  const { data, error } = await sb
    .from("concern_subcategories")
    .select(
      "id, category, slug, description, positive_examples, negative_examples, synonyms, active",
    )
    .eq("shop_id", shopId)
    .order("category", { ascending: true })
    .order("slug", { ascending: true });
  if (error) {
    throw new Error(
      `canonical_state_subcategory_descriptions_v2: ${error.message}`,
    );
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const lines = rows.map((r) =>
    `| id=${nullStr(r.id)} | category=${nullStr(r.category)} | slug=${nullStr(r.slug)} | description=${nullStr(r.description)} | positive_examples=${sortedTextArray(r.positive_examples)} | negative_examples=${sortedTextArray(r.negative_examples)} | synonyms=${sortedTextArray(r.synonyms)} | active=${boolStr(r.active)} |`
  );
  const body = lines.join("\n");
  return `# concern_subcategories_descriptions_v2 shop=${shopId} rows=${rows.length}\n${body}\n`;
}

/** Kind 4: concern_subcategories_map_v2 — mirrors migration lines 699-739. */
async function canonicalStateSubcategoryServiceMapV2(
  sb: SupabaseClient,
  shopId: number,
): Promise<string> {
  const { data, error } = await sb
    .from("concern_subcategories")
    .select("id, category, slug, eligible_testing_service_keys, active")
    .eq("shop_id", shopId)
    .order("category", { ascending: true })
    .order("slug", { ascending: true });
  if (error) {
    throw new Error(
      `canonical_state_subcategory_service_map_v2: ${error.message}`,
    );
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const lines = rows.map((r) =>
    `| id=${nullStr(r.id)} | category=${nullStr(r.category)} | slug=${nullStr(r.slug)} | eligible_testing_service_keys=${sortedTextArray(r.eligible_testing_service_keys)} | active=${boolStr(r.active)} |`
  );
  const body = lines.join("\n");
  return `# concern_subcategories_map_v2 shop=${shopId} rows=${rows.length}\n${body}\n`;
}

/** Kind 5: concern_questions_required_facts_v2 — mirrors migration lines 749-794.
 *  NOTE: `required_facts` is ORDERED (MD-order preserved); use orderedTextArray. */
async function canonicalStateQuestionRequiredFactsV2(
  sb: SupabaseClient,
  shopId: number,
): Promise<string> {
  const { data, error } = await sb
    .from("concern_questions")
    .select("id, required_facts, active")
    .eq("shop_id", shopId)
    .order("id", { ascending: true });
  if (error) {
    throw new Error(
      `canonical_state_question_required_facts_v2: ${error.message}`,
    );
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const lines = rows.map((r) =>
    `| id=${nullStr(r.id)} | required_facts=${orderedTextArray(r.required_facts)} | active=${boolStr(r.active)} |`
  );
  const body = lines.join("\n");
  return `# concern_questions_required_facts_v2 shop=${shopId} rows=${rows.length}\n${body}\n`;
}

/** Kind 6: concern_questions_flat — mirrors migration lines 805-845. */
async function canonicalStateConcernQuestionsFlat(
  sb: SupabaseClient,
  shopId: number,
): Promise<string> {
  const { data, error } = await sb
    .from("concern_questions")
    .select("id, category, question_text, display_order, active, options")
    .eq("shop_id", shopId)
    .order("category", { ascending: true })
    .order("display_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    throw new Error(
      `canonical_state_concern_questions_flat: ${error.message}`,
    );
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  // Column order in the format() string is: id, category, display_order,
  // question_text, options, active — matches migration line 835-836.
  const lines = rows.map((r) =>
    `| id=${nullStr(r.id)} | category=${nullStr(r.category)} | display_order=${nullScalar(r.display_order)} | question_text=${nullStr(r.question_text)} | options=${jsonbColumnText(r.options)} | active=${boolStr(r.active)} |`
  );
  const body = lines.join("\n");
  return `# concern_questions_flat shop=${shopId} rows=${rows.length}\n${body}\n`;
}

/** Kind 7: concern_questions_per_category (R6-B3) — mirrors migration lines 868-964.
 *  Reads BOTH concern_subcategories AND concern_questions for (shop_id, category).
 *  Category derived from snapshot: category_slug → subcategories_before first → questions_before first. */
async function canonicalStateConcernCategoryUpload(
  sb: SupabaseClient,
  shopId: number,
  snapshot: Record<string, unknown>,
): Promise<string> {
  // Derive category per migration lines 884-905.
  let category: string | null = null;

  const directSlug = snapshot["category_slug"];
  if (typeof directSlug === "string" && directSlug.length > 0) {
    category = directSlug;
  }

  if (category === null) {
    const subsBefore = snapshot["subcategories_before"];
    if (subsBefore && typeof subsBefore === "object" && !Array.isArray(subsBefore)) {
      for (const key of Object.keys(subsBefore as Record<string, unknown>)) {
        const row = (subsBefore as Record<string, unknown>)[key];
        if (row && typeof row === "object" && !Array.isArray(row)) {
          const c = (row as Record<string, unknown>)["category"];
          if (typeof c === "string" && c.length > 0) {
            category = c;
            break;
          }
        }
      }
    }
  }

  if (category === null) {
    const qsBefore = snapshot["questions_before"];
    if (qsBefore && typeof qsBefore === "object" && !Array.isArray(qsBefore)) {
      for (const key of Object.keys(qsBefore as Record<string, unknown>)) {
        const row = (qsBefore as Record<string, unknown>)[key];
        if (row && typeof row === "object" && !Array.isArray(row)) {
          const c = (row as Record<string, unknown>)["category"];
          if (typeof c === "string" && c.length > 0) {
            category = c;
            break;
          }
        }
      }
    }
  }

  if (category === null) {
    throw new Error(
      "canonical_state_concern_category_upload: snapshot missing category_slug AND has no subcategories_before/questions_before rows to derive it from",
    );
  }

  // Subcategories block — mirrors migration lines 907-928.
  const { data: subData, error: subErr } = await sb
    .from("concern_subcategories")
    .select("id, category, slug, display_label, display_order, active")
    .eq("shop_id", shopId)
    .eq("category", category)
    .order("display_order", { ascending: true })
    .order("slug", { ascending: true });
  if (subErr) {
    throw new Error(
      `canonical_state_concern_category_upload (subcategories): ${subErr.message}`,
    );
  }
  const subs = (subData ?? []) as unknown as Array<Record<string, unknown>>;
  const subLines = subs.map((r) =>
    `| id=${nullStr(r.id)} | slug=${nullStr(r.slug)} | display_label=${nullStr(r.display_label)} | display_order=${nullScalar(r.display_order)} | active=${boolStr(r.active)} |`
  );
  const subsBlock = subLines.join("\n");

  // Questions block — mirrors migration lines 930-958. LEFT JOIN to
  // subcategories on (id, shop_id) to source sub_slug. Sort by sub_slug,
  // then display_order, then id.
  const { data: qData, error: qErr } = await sb
    .from("concern_questions")
    .select(
      "id, subcategory_id, question_text, display_order, active, multi_select, options",
    )
    .eq("shop_id", shopId)
    .eq("category", category);
  if (qErr) {
    throw new Error(
      `canonical_state_concern_category_upload (questions): ${qErr.message}`,
    );
  }
  // Build sub_slug lookup from the sub rows we already fetched (matches the
  // LEFT JOIN in plpgsql — same (id, shop_id) scoping).
  const slugById = new Map<string, string>();
  for (const s of subs) {
    if (s.id !== null && s.id !== undefined) {
      slugById.set(String(s.id), nullStr(s.slug));
    }
  }
  type QRow = Record<string, unknown>;
  type QRowWithSlug = Record<string, unknown> & { sub_slug: string };
  const qRows: QRowWithSlug[] = ((qData ?? []) as unknown as QRow[]).map(
    (r): QRowWithSlug => ({
      ...r,
      sub_slug: r.subcategory_id !== null && r.subcategory_id !== undefined
        ? slugById.get(String(r.subcategory_id)) ?? "<null>"
        : "<null>",
    }),
  );
  // Sort: COALESCE(cs.slug, '') ASC, display_order ASC, id ASC.
  // For empty/null sub_slug, the COALESCE produces empty string which
  // sorts before any actual slug — match that here by treating "<null>"
  // as the empty sort key. Plpgsql uses '' for missing slug; we use
  // empty string for ordering, "<null>" for output.
  qRows.sort((a, b) => {
    const aSlugSort = a.sub_slug === "<null>" ? "" : a.sub_slug;
    const bSlugSort = b.sub_slug === "<null>" ? "" : b.sub_slug;
    if (aSlugSort < bSlugSort) return -1;
    if (aSlugSort > bSlugSort) return 1;
    const aOrd = a.display_order === null || a.display_order === undefined
      ? Number.NEGATIVE_INFINITY
      : Number(a.display_order);
    const bOrd = b.display_order === null || b.display_order === undefined
      ? Number.NEGATIVE_INFINITY
      : Number(b.display_order);
    if (aOrd < bOrd) return -1;
    if (aOrd > bOrd) return 1;
    const aId = BigInt(String(a.id ?? "0"));
    const bId = BigInt(String(b.id ?? "0"));
    if (aId < bId) return -1;
    if (aId > bId) return 1;
    return 0;
  });
  const qLines = qRows.map((r) =>
    `| id=${nullStr(r.id)} | sub_slug=${r.sub_slug} | subcategory_id=${nullScalar(r.subcategory_id)} | display_order=${nullScalar(r.display_order)} | question_text=${nullStr(r.question_text)} | options=${jsonbColumnText(r.options)} | multi_select=${boolStr(r.multi_select)} | active=${boolStr(r.active)} |`
  );
  const qsBlock = qLines.join("\n");

  // Final composition — mirrors migration line 960-963 format() exactly.
  return `# concern_questions_per_category shop=${shopId} category=${category}\n## subcategories rows=${subs.length}\n${subsBlock}\n## questions rows=${qRows.length}\n${qsBlock}\n`;
}

/** Kind 8: concern_category_guidelines — mirrors migration lines 975-1020.
 *  Category scope: distinct categories from snapshot.before keys + snapshot.added_keys. */
async function canonicalStateConcernCategoryGuideline(
  sb: SupabaseClient,
  shopId: number,
  snapshot: Record<string, unknown>,
): Promise<string> {
  // Mirror plpgsql lines 989-996: union of keys + added_keys, distinct,
  // non-empty.
  const set = new Set<string>();
  const before = snapshot["before"];
  if (before && typeof before === "object" && !Array.isArray(before)) {
    for (const key of Object.keys(before as Record<string, unknown>)) {
      if (key && key.length > 0) set.add(key);
    }
  }
  const added = snapshot["added_keys"];
  if (Array.isArray(added)) {
    for (const v of added) {
      const s = String(v);
      if (s && s.length > 0) set.add(s);
    }
  }
  const categories = Array.from(set);

  // If no scope: read returns 0 rows; format() still emits the header.
  if (categories.length === 0) {
    return `# concern_category_guidelines shop=${shopId} rows=0\n\n`;
  }

  const { data, error } = await sb
    .from("concern_category_guidelines")
    .select("category, display_label, guideline_prose")
    .eq("shop_id", shopId)
    .in("category", categories)
    .order("category", { ascending: true });
  if (error) {
    throw new Error(
      `canonical_state_concern_category_guideline: ${error.message}`,
    );
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const lines = rows.map((r) =>
    `| category=${nullStr(r.category)} | display_label=${nullStr(r.display_label)} | guideline_prose=${nullStr(r.guideline_prose)} |`
  );
  const body = lines.join("\n");
  return `# concern_category_guidelines shop=${shopId} rows=${rows.length}\n${body}\n`;
}

/** Kind 9: appointment_default_limits — mirrors migration lines 1030-1069.
 *  Composite PK (shop_id, day_of_week) — id column excluded (per E1cf-N1).
 *  Sort by day_of_week ASC. */
async function canonicalStateAppointmentDefaultLimits(
  sb: SupabaseClient,
  shopId: number,
): Promise<string> {
  const { data, error } = await sb
    .from("appointment_default_limits")
    .select(
      "day_of_week, is_closed, waiter_8am_slots, waiter_9am_slots, dropoff_total, notes",
    )
    .eq("shop_id", shopId)
    .order("day_of_week", { ascending: true });
  if (error) {
    throw new Error(
      `canonical_state_appointment_default_limits: ${error.message}`,
    );
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const lines = rows.map((r) =>
    `| day_of_week=${nullScalar(r.day_of_week)} | is_closed=${boolStr(r.is_closed)} | waiter_8am_slots=${nullScalar(r.waiter_8am_slots)} | waiter_9am_slots=${nullScalar(r.waiter_9am_slots)} | dropoff_total=${nullScalar(r.dropoff_total)} | notes=${nullStr(r.notes)} |`
  );
  const body = lines.join("\n");
  return `# appointment_default_limits shop=${shopId} rows=${rows.length}\n${body}\n`;
}

/** Kind 10: closed_dates_future — mirrors migration lines 1082-1134.
 *  Filters closed_date >= snapshot.original_today (REQUIRED snapshot field).
 *  id column INTENTIONALLY EXCLUDED per migration line 1102 comment. */
async function canonicalStateClosedDatesFuture(
  sb: SupabaseClient,
  shopId: number,
  snapshot: Record<string, unknown>,
): Promise<string> {
  const originalToday = snapshot["original_today"];
  if (
    typeof originalToday !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(originalToday)
  ) {
    throw new Error(
      "canonical_state_closed_dates_future: snapshot missing original_today (required to scope canonical read to the same forward window the uploader saw)",
    );
  }

  const { data, error } = await sb
    .from("closed_dates")
    .select("closed_date, reason, source")
    .eq("shop_id", shopId)
    .gte("closed_date", originalToday)
    .order("closed_date", { ascending: true });
  if (error) {
    throw new Error(
      `canonical_state_closed_dates_future: ${error.message}`,
    );
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const lines = rows.map((r) =>
    `| closed_date=${nullStr(r.closed_date)} | reason=${nullStr(r.reason)} | source=${nullStr(r.source)} |`
  );
  const body = lines.join("\n");
  return `# closed_dates_future shop=${shopId} rows=${rows.length} original_today=${originalToday}\n${body}\n`;
}

// ─── 3. canonicalizeDiff ───────────────────────────────────────────────────

/**
 * Allow-list of object keys whose values are SET-typed arrays — i.e., array
 * order is NOT semantically meaningful so we sort for stability. Per PLAN
 * §4.8: keys ending in `_keys` or `_ids`, plus `surfaces`.
 */
function isSetTypedArrayKey(key: string): boolean {
  if (key === "surfaces") return true;
  if (key.endsWith("_keys")) return true;
  if (key.endsWith("_ids")) return true;
  return false;
}

/**
 * Stable JSON canonicalization for the `diff_summary` JSONB column. Used
 * (indirectly) by `computeConfirmToken()` callers that derive the
 * `md_content_hash` / `expected_current_hash` inputs, and by tests that
 * compare diff_summary across runs.
 *
 * Rules per PLAN §4.8:
 *   - Object keys ALWAYS sorted alphabetically
 *   - Set-typed arrays sorted (allow-list: keys ending in `_keys` or
 *     `_ids`, plus `surfaces`)
 *   - Ordered arrays preserved (everything not in the sort allow-list)
 *   - NULL → `null`
 *   - Numbers as-is
 *   - Strings JSON-escaped, double-quoted
 *
 * Test invariant: `canonicalizeDiff({z: 1, a: 2}) === '{"a":2,"z":1}'`.
 */
export function canonicalizeDiff(diff: Record<string, unknown>): string {
  return stringifyCanonical(diff, /* parentKey */ undefined);
}

function stringifyCanonical(value: unknown, parentKey: string | undefined): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    // Sort only if parent key is in the set-typed allow-list. Otherwise
    // preserve order (ordered arrays like `questions[]`, `options[]`).
    const items = value.map((x) => stringifyCanonical(x, undefined));
    if (parentKey !== undefined && isSetTypedArrayKey(parentKey)) {
      // Sort the already-stringified array elements lexicographically for
      // determinism. Mirrors plpgsql `jsonb_agg(elem ORDER BY elem)`.
      items.sort();
    }
    return "[" + items.join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map(
      (k) => `${JSON.stringify(k)}:${stringifyCanonical(obj[k], k)}`,
    );
    return "{" + parts.join(",") + "}";
  }
  return "null";
}

// ─── 4. logAuditEntry (consolidated) ───────────────────────────────────────

/**
 * Arguments for `logAuditEntry()`. `shopId` is REQUIRED (replaces the
 * historical "may forget shop_id" footgun the inline insert sites suffer).
 */
export interface LogAuditEntryArgs {
  supabase: SupabaseClient;
  /** REQUIRED. Throws if missing. Tenant scope per Migration A column. */
  shopId: number;
  oauthClientId?: string | null;
  /** Operator-readable label per ADR-010 actor_email semantic. */
  userLabel?: string | null;
  /** 'routine_services' | 'testing_services' | 'concern_questions' | etc. */
  tableName: string;
  operation: "upload_md" | "manual_change" | "export_md" | "revert_upload";
  rowsAdded?: number;
  rowsModified?: number;
  rowsDeactivated?: number;
  mdContentHash?: string | null;
  diffSummary?: Record<string, unknown> | null;
  errorMessage?: string | null;
  preStateSnapshot?: Record<string, unknown> | null;
  successorRevertId?: number | null;
  revertsUploadId?: number | null;
}

/**
 * MIGRATION NOTE: this helper REPLACES inline insert sites in
 * scheduler-admin.ts + scheduler-admin-catalog.ts. E4 + E5 builders MUST
 * refactor those sites to call this helper instead of inline-inserting;
 * the existing inline sites have a known bug where shop_id can be NULL
 * (fixed in Migration A + B).
 *
 * Call sites to migrate (audit before changing):
 *   - supabase/functions/_shared/tools/scheduler-admin.ts:
 *       logAdminAudit() helper at L108 + 33 inline call sites
 *       (L216, L241, L317, L347, L426, L533, L557, L622, L651, L729,
 *        L821, L845, L920, L949, L1067, L1157, L1181, L1247, L1275,
 *        L1335, L1418, L1442, L1481, L1514, L1580, L1837, L1869, L1898,
 *        L1962, L2000, L2169, L2254, L2283, L2321, L2358, L2387)
 *   - supabase/functions/_shared/tools/scheduler-admin-catalog.ts:
 *       _logAudit() helper at L641 + 24 inline call sites
 *       (L381, L404, L429, L591, L934, L1062, L1080, L1138, L1170, L1197,
 *        L1238, L1368, L1742, L1785, L1810, L1853, L2004, L2250, L2262,
 *        L2319, L2347, L2385, L2491)
 *
 * Refactor scope for E4/E5: replace each inline insert with a
 * `logAuditEntry()` call that EXPLICITLY threads through the caller's
 * `shopId`. The existing helpers `logAdminAudit` + `_logAudit` should be
 * deleted in the same PR.
 *
 * Logs Sentry-style structured warnings on insert failure (matches the
 * inline sites' current log shape so dashboards keep working).
 *
 * @returns `{ id }` on success or `{ error }` on insert failure. Caller
 *          can ignore the result if it only needs side-effect logging.
 *
 * @throws if `shopId` is missing/null/non-positive (sentinel `-1` is
 *         BLOCKED on new writes — Migration A's sentinel handling is for
 *         backfill ONLY).
 */
export async function logAuditEntry(
  args: LogAuditEntryArgs,
): Promise<{ id: number } | { error: string }> {
  // REQUIRED-shopId guard. Sentinel `-1` is only for backfill; new writes
  // MUST carry a real positive shop_id.
  if (
    args.shopId === undefined ||
    args.shopId === null ||
    typeof args.shopId !== "number" ||
    !Number.isFinite(args.shopId) ||
    args.shopId <= 0
  ) {
    throw new Error(
      `logAuditEntry: shopId is REQUIRED and must be a positive integer (got ${JSON.stringify(args.shopId)}). Sentinel -1 is reserved for backfill PHASE 2 only — new writes always carry a real shop_id.`,
    );
  }

  const { data, error } = await args.supabase
    .from("scheduler_admin_audit_log")
    .insert({
      shop_id: args.shopId,
      oauth_client_id: args.oauthClientId ?? null,
      user_label: args.userLabel ?? null,
      table_name: args.tableName,
      operation: args.operation,
      rows_added: args.rowsAdded ?? 0,
      rows_modified: args.rowsModified ?? 0,
      rows_deactivated: args.rowsDeactivated ?? 0,
      md_content_hash: args.mdContentHash ?? null,
      diff_summary: args.diffSummary ?? null,
      pre_state_snapshot: args.preStateSnapshot ?? null,
      error_message: args.errorMessage ?? null,
      successor_revert_id: args.successorRevertId ?? null,
      reverts_upload_id: args.revertsUploadId ?? null,
    })
    .select("id")
    .single();

  if (error) {
    console.warn(
      JSON.stringify({
        level: "warning",
        msg: "scheduler_admin_audit_log_insert_failed",
        detail: error.message,
        shop_id: args.shopId,
        table_name: args.tableName,
        operation: args.operation,
      }),
    );
    return { error: error.message };
  }

  return { id: data?.id as number };
}

