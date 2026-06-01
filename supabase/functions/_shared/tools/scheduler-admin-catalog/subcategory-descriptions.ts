// subcategory-descriptions MD-upload surface.
// Extracted from scheduler-admin-catalog.ts (file-size-refactor). Mechanical
// split — no logic changes. Public API preserved via the ./index.ts barrel +
// the scheduler-admin-catalog.ts re-export shim.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  computeCanonicalAfterState,
  logAuditEntry,
  parseCsvList,
  sha256Hex,
  type SnapshotKind,
} from "../../scheduler-admin-md.ts";
import type { UploadResult, ValidationFinding } from "../scheduler-admin.ts";
import {
  type UploadV2Args,
} from "./_shared.ts";
import { _failResult, _logAuditError, arraysEqualAsSets } from "./helpers.ts";

const MIN_SUBCATEGORY_DESCRIPTION_LEN = 10;
const MAX_SUBCATEGORY_DESCRIPTION_LEN = 1000;
const MAX_EXAMPLES_PER_FIELD = 10;
const MAX_SYNONYMS = 20;

interface SubcategoryDescriptionRow {
  category: string;
  slug: string;
  description: string;
  positive_examples: string[];
  negative_examples: string[];
  synonyms: string[];
}

interface SubcategoryDescriptionDiffEntry {
  category: string;
  slug: string;
  before: {
    description: string;
    positive_examples: string[];
    negative_examples: string[];
    synonyms: string[];
  };
  after: {
    description: string;
    positive_examples: string[];
    negative_examples: string[];
    synonyms: string[];
  };
  changed_fields: string[];
}

/** Parse the per-block MD for subcategory descriptions.
 *  Composite heading = `## <category>/<slug>`. Field-list lines may span
 *  multiple lines using a leading `- ` for each entry (for Positive/Negative
 *  examples). Other fields are single-line `Field: value`.
 *
 *  Throws on structural errors. Returns parsed rows with raw values; caller
 *  validates length / count constraints. */
function parseSubcategoryDescriptionsMd(md: string): SubcategoryDescriptionRow[] {
  const lines = md.split(/\r?\n/);
  const rows: SubcategoryDescriptionRow[] = [];
  type Pending = {
    category: string;
    slug: string;
    description: string | null;
    positive_examples: string[] | null;
    negative_examples: string[] | null;
    synonyms: string[] | null;
    heading_line: number;
  };
  let current: Pending | null = null;
  // Tracks which multi-line list we're currently collecting items for.
  // Reset when a new `Field:` line is encountered.
  let collecting: "positive_examples" | "negative_examples" | null = null;
  const seenKeys = new Set<string>();

  const flush = () => {
    if (!current) return;
    if (current.description === null) {
      throw new Error(
        `line ${current.heading_line}: section "${current.category}/${current.slug}" is missing Description field`,
      );
    }
    rows.push({
      category: current.category,
      slug: current.slug,
      description: current.description,
      positive_examples: current.positive_examples ?? [],
      negative_examples: current.negative_examples ?? [],
      synonyms: current.synonyms ?? [],
    });
    current = null;
    collecting = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    const lineNo = i + 1;

    if (line === "" || line.startsWith("---")) {
      // Bullets immediately under a `Positive/Negative examples:` header span
      // blank-free blocks; an explicit blank line terminates the list collection.
      collecting = null;
      continue;
    }

    // HTML comments — handle BOTH single-line (`<!-- ... -->` on one line) AND
    // multi-line (open `<!--` on this line, closing `-->` on a later line).
    // Walks past intermediate lines so they don't get mis-parsed as Field lines.
    if (line.startsWith("<!--")) {
      collecting = null;
      if (line.includes("-->")) {
        continue; // single-line comment closed on same line
      }
      // Multi-line: skip ahead until we find the closing `-->`.
      let j = i + 1;
      while (j < lines.length && !lines[j].includes("-->")) j++;
      i = j; // jump past the closing line
      continue;
    }

    if (line.startsWith("# ") && !line.startsWith("## ")) {
      // H1 is informational
      continue;
    }

    if (line.startsWith("## ")) {
      // Composite heading: <category>/<slug>
      flush();
      const headingBody = line.slice(3).trim();
      const slashIdx = headingBody.indexOf("/");
      if (slashIdx <= 0 || slashIdx === headingBody.length - 1) {
        throw new Error(
          `line ${lineNo}: heading "${headingBody}" must use the composite form "<category>/<slug>" (e.g. "brakes/high_pitched_squealing")`,
        );
      }
      const category = headingBody.slice(0, slashIdx).trim();
      const slug = headingBody.slice(slashIdx + 1).trim();
      if (!/^[a-z0-9_]+$/.test(category)) {
        throw new Error(
          `line ${lineNo}: category "${category}" must match ^[a-z0-9_]+$ (lowercase + digits + underscores only)`,
        );
      }
      if (!/^[a-z0-9_]+$/.test(slug)) {
        throw new Error(
          `line ${lineNo}: slug "${slug}" must match ^[a-z0-9_]+$ (lowercase + digits + underscores only)`,
        );
      }
      const pseudoKey = `${category}::${slug}`;
      if (seenKeys.has(pseudoKey)) {
        throw new Error(
          `line ${lineNo}: duplicate (category, slug) "${category}/${slug}" — already defined earlier in this file`,
        );
      }
      seenKeys.add(pseudoKey);
      current = {
        category,
        slug,
        description: null,
        positive_examples: null,
        negative_examples: null,
        synonyms: null,
        heading_line: lineNo,
      };
      collecting = null;
      continue;
    }

    // Multi-line list continuation (under a Positive/Negative examples header)
    if (collecting && line.startsWith("- ")) {
      const entry = line.slice(2).trim();
      // Strip surrounding quotes if present
      const unquoted = entry.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1").trim();
      if (unquoted === "") continue;
      // Cap entries — actual length validation happens in the caller's diff phase.
      if (current) {
        const list = current[collecting];
        if (list) list.push(unquoted);
      }
      continue;
    }

    if (!current) {
      // Bare text before any `## heading` — ignore (could be intro prose).
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) {
      throw new Error(
        `line ${lineNo}: expected "Field: value" inside section "${current.category}/${current.slug}"; got "${line}"`,
      );
    }
    const fieldName = line.slice(0, colonIdx).trim().toLowerCase().replace(/\s+/g, "_");
    const fieldValueRaw = line.slice(colonIdx + 1).trim();

    if (fieldName === "description") {
      current.description = fieldValueRaw;
      collecting = null;
    } else if (fieldName === "positive_examples") {
      // Either comma-list on the same line OR multi-line continuation (`- ...`)
      const inline = fieldValueRaw === "" || fieldValueRaw === "(none)" ? [] : parseCsvList(fieldValueRaw);
      current.positive_examples = inline;
      // If empty inline, follow-up `- ` lines append to the list
      collecting = "positive_examples";
    } else if (fieldName === "negative_examples") {
      const inline = fieldValueRaw === "" || fieldValueRaw === "(none)" ? [] : parseCsvList(fieldValueRaw);
      current.negative_examples = inline;
      collecting = "negative_examples";
    } else if (fieldName === "synonyms") {
      const inline = fieldValueRaw === "" || fieldValueRaw === "(none)" ? [] : parseCsvList(fieldValueRaw);
      current.synonyms = inline;
      collecting = null;
    } else {
      // Unknown field — error (catches typos like "Descripton")
      throw new Error(
        `line ${lineNo}: unknown field "${fieldName}" in section "${current.category}/${current.slug}" — valid fields: description, positive_examples, negative_examples, synonyms`,
      );
    }
  }
  flush();
  return rows;
}

/** Strip trailing arrow annotation from a negative example, e.g.
 *  `"Grinding noise" → metallic_grinding` → `"Grinding noise"`.
 *  Keeps the customer utterance only; the LLM doesn't need the arrow target.
 *  Tolerates both `→` and `->`. */
function _stripArrowAnnotation(s: string): string {
  const arrow = s.search(/\s*(→|->)\s*/);
  if (arrow >= 0) return s.slice(0, arrow).trim();
  return s.trim();
}

export async function uploadSubcategoryDescriptionsMdV2(
  sb: SupabaseClient,
  shopId: number,
  args: UploadV2Args,
): Promise<UploadResult> {
  const { md_content, audit, dry_run = true, expected_confirm_token } = args;
  const tableName = "concern_subcategories";
  const hash = await sha256Hex(md_content);

  // ── Parse the per-block MD
  let parsedRows: SubcategoryDescriptionRow[];
  try {
    parsedRows = parseSubcategoryDescriptionsMd(md_content);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!dry_run) {
      await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    }
    return _failResult(tableName, hash, 0, msg, dry_run);
  }

  // ── Strip arrow annotations from negative examples (advisor-friendly format)
  for (const row of parsedRows) {
    row.negative_examples = row.negative_examples.map(_stripArrowAnnotation);
  }

  // ── Per-row validation
  const findings: ValidationFinding[] = [];
  const validRows: SubcategoryDescriptionRow[] = [];
  for (const row of parsedRows) {
    const pseudoKey = `${row.category}/${row.slug}`;
    const rowErrs: ValidationFinding[] = [];
    const push = (field: string, message: string) =>
      rowErrs.push({ key: pseudoKey, field, level: "error", message });

    if (row.description.length < MIN_SUBCATEGORY_DESCRIPTION_LEN) {
      push("description", `<${MIN_SUBCATEGORY_DESCRIPTION_LEN} chars (too short — write a complete 2-3 sentence description so the LLM has enough context)`);
    }
    if (row.description.length > MAX_SUBCATEGORY_DESCRIPTION_LEN) {
      push("description", `>${MAX_SUBCATEGORY_DESCRIPTION_LEN} chars (too long — trim to 2-3 sentences; longer wastes LLM tokens on every classification)`);
    }
    if (row.positive_examples.length > MAX_EXAMPLES_PER_FIELD) {
      push("positive_examples", `${row.positive_examples.length} entries exceeds cap of ${MAX_EXAMPLES_PER_FIELD}`);
    }
    if (row.negative_examples.length > MAX_EXAMPLES_PER_FIELD) {
      push("negative_examples", `${row.negative_examples.length} entries exceeds cap of ${MAX_EXAMPLES_PER_FIELD}`);
    }
    if (row.synonyms.length > MAX_SYNONYMS) {
      push("synonyms", `${row.synonyms.length} entries exceeds cap of ${MAX_SYNONYMS}`);
    }

    findings.push(...rowErrs);
    if (rowErrs.length === 0) validRows.push(row);
  }

  const errors = findings.filter((f) => f.level === "error");
  if (validRows.length === 0 || errors.length > 0) {
    const msg = `${errors.length} validation error(s); ${validRows.length} valid rows`;
    if (!dry_run) {
      await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    }
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsedRows.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      validation_errors: errors.map((f) => ({ row_index: -1, field: `${f.key}.${f.field}`, message: f.message })),
      validation_warnings: findings.filter((f) => f.level === "warning"),
      dry_run,
      error_message: msg,
    };
  }

  // ── Cross-validate: (category, slug) must exist + active in concern_subcategories
  const { data: existingSubsData, error: subsErr } = await sb
    .from("concern_subcategories")
    .select("id, category, slug, description, positive_examples, negative_examples, synonyms, active")
    .eq("shop_id", shopId);
  if (subsErr) {
    const msg = `concern_subcategories fetch failed: ${subsErr.message}`;
    if (!dry_run) {
      await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    }
    return _failResult(tableName, hash, parsedRows.length, msg, dry_run);
  }
  const existingSubs = (existingSubsData ?? []) as unknown as Array<{
    id: number;
    category: string;
    slug: string;
    description: string;
    positive_examples: string[];
    negative_examples: string[];
    synonyms: string[];
    active: boolean;
  }>;
  const subByKey = new Map<string, (typeof existingSubs)[number]>();
  for (const s of existingSubs) subByKey.set(`${s.category}::${s.slug}`, s);

  const crossErrors: ValidationFinding[] = [];
  for (const row of validRows) {
    const pseudoKey = `${row.category}::${row.slug}`;
    const sub = subByKey.get(pseudoKey);
    if (!sub) {
      crossErrors.push({
        key: `${row.category}/${row.slug}`,
        field: "slug",
        level: "error",
        message: `no row in concern_subcategories for (category=${row.category}, slug=${row.slug})`,
      });
      continue;
    }
    if (!sub.active) {
      crossErrors.push({
        key: `${row.category}/${row.slug}`,
        field: "slug",
        level: "warning",
        message: "subcategory is currently inactive (description will be stored but won't take effect until subcategory is reactivated)",
      });
    }
  }
  const crossHard = crossErrors.filter((f) => f.level === "error");
  if (crossHard.length > 0) {
    const msg = `${crossHard.length} cross-validation error(s)`;
    if (!dry_run) {
      await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    }
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsedRows.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      validation_errors: crossHard.map((f) => ({ row_index: -1, field: `${f.key}.${f.field}`, message: f.message })),
      validation_warnings: crossErrors.filter((f) => f.level === "warning"),
      dry_run,
      error_message: msg,
    };
  }

  // ── Compute diff (rows omitted from MD are LEFT ALONE)
  const diffEntries: SubcategoryDescriptionDiffEntry[] = [];
  const noop: string[] = [];
  for (const row of validRows) {
    const sub = subByKey.get(`${row.category}::${row.slug}`)!;
    const before = {
      description: sub.description ?? "",
      positive_examples: sub.positive_examples ?? [],
      negative_examples: sub.negative_examples ?? [],
      synonyms: sub.synonyms ?? [],
    };
    const after = {
      description: row.description,
      positive_examples: row.positive_examples,
      negative_examples: row.negative_examples,
      synonyms: row.synonyms,
    };
    const changed: string[] = [];
    if (before.description !== after.description) changed.push("description");
    if (!arraysEqualInOrder(before.positive_examples, after.positive_examples)) changed.push("positive_examples");
    if (!arraysEqualInOrder(before.negative_examples, after.negative_examples)) changed.push("negative_examples");
    if (!arraysEqualAsSets(before.synonyms, after.synonyms)) changed.push("synonyms");

    if (changed.length === 0) {
      noop.push(`${row.category}/${row.slug}`);
      continue;
    }
    diffEntries.push({
      category: row.category,
      slug: row.slug,
      before,
      after,
      changed_fields: changed,
    });
  }

  const warnings: ValidationFinding[] = [...findings.filter((f) => f.level === "warning"), ...crossErrors.filter((f) => f.level === "warning")];

  // E4 (2026-05-26): diff_summary.surfaces[] per ADR-021 + PLAN §7. Surface =
  // 'subcategory_descriptions' (logical) — disambiguates from the 2 other
  // surfaces that share table_name='concern_subcategories'.
  const diffSummary: Record<string, unknown> = {
    surfaces: ["subcategory_descriptions"],
    modified: diffEntries.map((d) => ({
      category: d.category,
      slug: d.slug,
      changed_fields: d.changed_fields,
      description_preview_before: d.before.description.slice(0, 80),
      description_preview_after: d.after.description.slice(0, 80),
    })),
    unchanged_count: noop.length,
    rows_in_md: validRows.length,
    rows_in_db_unmentioned: existingSubs.length - validRows.length,
  };

  const confirm_token = await sha256Hex(JSON.stringify({ md: hash, diff: diffSummary }));

  if (dry_run) {
    return {
      ok: true,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsedRows.length,
      rows_added: 0,
      rows_modified: diffEntries.length,
      rows_deactivated: 0,
      validation_warnings: warnings.length > 0 ? warnings : undefined,
      diff_summary: diffSummary,
      dry_run: true,
      confirm_token,
    };
  }

  if (expected_confirm_token !== confirm_token) {
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsedRows.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      validation_warnings: warnings.length > 0 ? warnings : undefined,
      diff_summary: diffSummary,
      dry_run: false,
      confirm_token,
      error_message: expected_confirm_token
        ? "confirm_token mismatch — DB state or MD content changed since dry_run. Re-run dry_run and pass the new token."
        : "missing expected_confirm_token — run dry_run first, then pass the returned token back.",
    };
  }

  // ── Capture pre_state_snapshot.before
  const snapshotBefore: Record<string, {
    id: number;
    category: string;
    slug: string;
    description: string;
    positive_examples: string[];
    negative_examples: string[];
    synonyms: string[];
  }> = {};
  for (const d of diffEntries) {
    const sub = subByKey.get(`${d.category}::${d.slug}`)!;
    snapshotBefore[`${d.category}/${d.slug}`] = {
      id: sub.id,
      category: d.category,
      slug: d.slug,
      description: d.before.description,
      positive_examples: d.before.positive_examples,
      negative_examples: d.before.negative_examples,
      synonyms: d.before.synonyms,
    };
  }
  const snapshotBase = { before: snapshotBefore, added_keys: [] as string[] };

  // ── Apply (UPDATE only — description uploads never INSERT)
  let applyError: string | null = null;
  try {
    for (const d of diffEntries) {
      const sub = subByKey.get(`${d.category}::${d.slug}`)!;
      const { error } = await sb
        .from("concern_subcategories")
        .update({
          description: d.after.description,
          positive_examples: d.after.positive_examples,
          negative_examples: d.after.negative_examples,
          synonyms: d.after.synonyms,
          updated_by_oauth_client_id: audit.oauth_client_id,
          updated_by_name: audit.display_name,
        })
        .eq("id", sub.id);
      if (error) throw new Error(`update id=${sub.id} (${d.category}/${d.slug}) failed: ${error.message}`);
    }
  } catch (e) {
    applyError = e instanceof Error ? e.message : String(e);
  }

  // ── E4 (2026-05-26): Enrich snapshot with byte-parity fields after writes
  // succeed. Kind = 'concern_subcategories_descriptions_v2'. See
  // _uploadCatalogV2 for the canonical rationale + soft-fail policy.
  const SNAPSHOT_KIND: SnapshotKind = "concern_subcategories_descriptions_v2";
  let enrichedSnapshot: Record<string, unknown> | null = null;
  if (!applyError) {
    try {
      const canonical = await computeCanonicalAfterState({
        kind: SNAPSHOT_KIND,
        supabase: sb,
        shopId,
        snapshot: snapshotBase,
      });
      const afterHash = await sha256Hex(canonical);
      enrichedSnapshot = {
        ...snapshotBase,
        kind: SNAPSHOT_KIND,
        expected_after_state_canonical: canonical,
        after_hash: afterHash,
      };
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.warn(
        JSON.stringify({
          level: "warning",
          msg: "v2_uploader_canonical_after_state_compute_failed",
          detail,
          shop_id: shopId,
          table_name: tableName,
          kind: SNAPSHOT_KIND,
        }),
      );
      enrichedSnapshot = null;
      applyError =
        `apply succeeded but expected_after_state_canonical compute failed: ${detail} ` +
        `(audit row written without snapshot — revert on this upload will be blocked)`;
    }
  }

  const auditResult = await logAuditEntry({
    supabase: sb,
    shopId,
    oauthClientId: audit.oauth_client_id,
    userLabel: audit.display_name,
    tableName,
    operation: "upload_md",
    rowsAdded: 0,
    rowsModified: diffEntries.length,
    rowsDeactivated: 0,
    mdContentHash: hash,
    diffSummary,
    preStateSnapshot: enrichedSnapshot,
    errorMessage: applyError ?? undefined,
  });
  const audit_log_id = "id" in auditResult ? auditResult.id : null;

  return {
    ok: !applyError,
    table_name: tableName,
    md_content_hash: hash,
    rows_parsed: parsedRows.length,
    rows_added: 0,
    rows_modified: diffEntries.length,
    rows_deactivated: 0,
    validation_warnings: warnings.length > 0 ? warnings : undefined,
    diff_summary: diffSummary,
    dry_run: false,
    confirm_token,
    audit_log_id: audit_log_id ?? undefined,
    error_message: applyError ?? undefined,
  };
}

function arraysEqualInOrder(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function exportSubcategoryDescriptionsMdV2(
  sb: SupabaseClient,
  shopId: number,
): Promise<{ md_content: string; row_count: number }> {
  const { data, error } = await sb
    .from("concern_subcategories")
    .select("category, slug, description, positive_examples, negative_examples, synonyms, active, display_order")
    .eq("shop_id", shopId)
    .eq("active", true)
    .order("category", { ascending: true })
    .order("display_order", { ascending: true });
  if (error) throw new Error(`subcategory_descriptions export failed: ${error.message}`);

  const rows = (data ?? []) as unknown as Array<{
    category: string;
    slug: string;
    description: string;
    positive_examples: string[];
    negative_examples: string[];
    synonyms: string[];
  }>;

  const lines: string[] = [];
  lines.push("# Subcategory Descriptions");
  lines.push("");
  lines.push("<!--");
  lines.push("Each `## <category>/<slug>` block carries the stage-1 metadata the");
  lines.push("3-stage diagnostic LLM classifier uses to pick the right subcategory");
  lines.push("from a customer's free-text concern.");
  lines.push("");
  lines.push("Fields per block (4):");
  lines.push("  - Description: 2-3 sentence subcategory description. 10-1000 chars.");
  lines.push("    Required. Empty default in the DB falls back to slug + category");
  lines.push("    name (degraded but functional).");
  lines.push("  - Positive examples: customer utterances that SHOULD match this");
  lines.push("    subcategory. Few-shot exemplars in the stage-1 prompt.");
  lines.push("    Comma-list OR multi-line with `- ` prefix per entry. Cap 10.");
  lines.push("  - Negative examples: utterances that should NOT match this");
  lines.push("    subcategory (boundary cases). Same format. Cap 10.");
  lines.push("    You MAY append `→ <other_slug>` for advisor reference — the");
  lines.push("    arrow + target are stripped before storage.");
  lines.push("  - Synonyms: alt phrasings the customer might use ('AC', 'air con').");
  lines.push("    Comma-list. Cap 20.");
  lines.push("");
  lines.push("Diff semantics:");
  lines.push("  - Rows OMITTED from the MD are LEFT ALONE (no silent clear).");
  lines.push("  - To CLEAR a list field, write `Field: (none)` OR omit `- ` lines.");
  lines.push("");
  lines.push("Validation rules (BLOCKS apply):");
  lines.push("  - (category, slug) must exist in concern_subcategories");
  lines.push("  - Description length 10..1000");
  lines.push("  - positive_examples / negative_examples count <= 10 each");
  lines.push("  - synonyms count <= 20");
  lines.push("  - duplicate (category, slug) in same upload");
  lines.push("");
  lines.push("Two-step flow: dry_run=true (default) → review diff →");
  lines.push("dry_run=false + expected_confirm_token=<token>.");
  lines.push("-->");
  lines.push("");
  for (const r of rows) {
    lines.push(`## ${r.category}/${r.slug}`);
    lines.push(`Description: ${r.description ?? ""}`);
    if (r.positive_examples && r.positive_examples.length > 0) {
      lines.push("Positive examples:");
      for (const ex of r.positive_examples) lines.push(`  - "${ex}"`);
    } else {
      lines.push("Positive examples: (none)");
    }
    if (r.negative_examples && r.negative_examples.length > 0) {
      lines.push("Negative examples:");
      for (const ex of r.negative_examples) lines.push(`  - "${ex}"`);
    } else {
      lines.push("Negative examples: (none)");
    }
    const syns = r.synonyms ?? [];
    lines.push(`Synonyms: ${syns.length > 0 ? syns.join(", ") : "(none)"}`);
    lines.push("");
  }
  return { md_content: lines.join("\n").trim() + "\n", row_count: rows.length };
}

// ═══════════════════════════════════════════════════════════════════════
// question_required_facts — wide-table uploader/exporter (2026-05-21)
//
// Mutates ONLY concern_questions.required_facts (TEXT[]). Does NOT
// create / modify / delete questions themselves.
//
// MD format — single wide markdown table:
//
//   # Question Required Facts
//
//   <!-- format guidance comment -->
//
//   | question_id | required_facts |
//   | --- | --- |
//   | 688 | speed_specific_mph |
//   | 691 | location_side |
//   | 967 | hvac_mode |
//   | 727 | recent_action, warning_light_behavior |
//   | 716 | location_side, location_axle |
//
// Validation rules (BLOCK apply):
//   - question_id is a positive integer
//   - question_id exists in concern_questions for this shop AND active=true
//   - each required_facts value is in EXTRACTED_FACTS_ALL_KEYS (defined
//     below, parallel-mirror of
//     scheduler-app/src/lib/scheduler/wizard/llm/extracted-facts.ts)
//   - duplicate question_id in same upload
//
// Diff semantics:
//   - Rows OMITTED from the MD are LEFT ALONE.
//   - Blank cell / `(none)` / `-` CLEARS the mapping (sets to '{}').
//   - Non-empty cell REPLACES the array (in MD order, de-duped).
//
// Two-step dry_run + confirm_token apply, mirrors the V2 catalog
// uploaders. Audit log table_name='concern_questions',
// operation='upload_md'.
// ═══════════════════════════════════════════════════════════════════════

// PARALLEL-MIRROR OBLIGATION:
//   The list below MUST stay in lock-step with the EXTRACTED_FACTS_ALL_KEYS
//   exported from scheduler-app/src/lib/scheduler/wizard/llm/extracted-facts.ts.
//   That file is the source of truth for the Stage 1 fact-extraction LLM
//   contract; this list is the source of truth for what the upload tool
//   accepts. When the schema changes (slot added/removed/renamed), update
//   BOTH files in the same commit AND redeploy the orchestrator-mcp edge fn.
//   See extracted-facts.ts § "Parallel mirror" for the corresponding note.
