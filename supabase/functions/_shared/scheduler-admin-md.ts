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

