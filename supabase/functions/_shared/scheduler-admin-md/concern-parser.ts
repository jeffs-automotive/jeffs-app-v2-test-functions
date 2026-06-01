// concern-parser — scheduler admin MD module.
// Extracted from scheduler-admin-md.ts (file-size-refactor). Mechanical split
// — no logic changes. Public API preserved via ./index.ts + the re-export shim.



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
