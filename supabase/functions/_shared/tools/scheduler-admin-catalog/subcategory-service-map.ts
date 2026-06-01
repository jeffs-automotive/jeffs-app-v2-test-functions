// subcategory-service-map MD-upload surface.
// Extracted from scheduler-admin-catalog.ts (file-size-refactor). Mechanical
// split — no logic changes. Public API preserved via the ./index.ts barrel +
// the scheduler-admin-catalog.ts re-export shim.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  computeCanonicalAfterState,
  logAuditEntry,
  parseMdSections,
  parseMdTable,
  sha256Hex,
  type ParseError,
  type SnapshotKind,
} from "../../scheduler-admin-md.ts";
import type { UploadResult, ValidationFinding } from "../scheduler-admin.ts";
import {
  CONCERN_CATEGORY_SLUGS,
  type UploadV2Args,
} from "./_shared.ts";
import { _failResult, _logAuditError, arraysEqualAsSets } from "./helpers.ts";

const MAPPING_COLUMNS_REQUIRED = [
  "category",
  "subcategory_slug",
  "testing_service_keys",
];

interface SubcategoryServiceMapRow {
  /** Natural key: parent concern_category. */
  category: string;
  /** Natural key: subcategory slug within that category. */
  subcategory_slug: string;
  /** Empty array means "clear this mapping". */
  testing_service_keys: string[];
}

interface SubcategoryMapDiffEntry {
  category: string;
  subcategory_slug: string;
  before: string[];
  after: string[];
}

/** Parse a wide-table cell value into a service_key list.
 *  Blank, "(none)", "-" → []. Otherwise: split on comma, trim, drop blanks, dedupe in order. */
function parseServiceKeyList(raw: string): string[] {
  const v = raw.trim();
  if (v === "" || v === "(none)" || v === "-" || v === "—") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of v.split(",")) {
    const t = piece.trim();
    if (t === "") continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Cell renderer for the exporter — round-trip-stable with parseServiceKeyList. */
function formatServiceKeyList(arr: string[] | null | undefined): string {
  if (!arr || arr.length === 0) return "(none)";
  return arr.join(", ");
}

export async function uploadSubcategoryServiceMapMdV2(
  sb: SupabaseClient,
  shopId: number,
  args: UploadV2Args,
): Promise<UploadResult> {
  const { md_content, audit, dry_run = true, expected_confirm_token } = args;
  const tableName = "concern_subcategories";
  const hash = await sha256Hex(md_content);

  // ── Parse the wide table
  let parsed: { table: { headers: string[]; rows: Record<string, string>[] }; errors: ParseError[] };
  try {
    parsed = parseMdTable(md_content);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!dry_run) {
      await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    }
    return _failResult(tableName, hash, 0, msg, dry_run);
  }

  // ── Column-presence check
  const missingColumns = MAPPING_COLUMNS_REQUIRED.filter(
    (c) => !parsed.table.headers.includes(c),
  );
  if (missingColumns.length > 0) {
    const msg = `missing required columns: ${missingColumns.join(", ")}`;
    if (!dry_run) {
      await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    }
    return _failResult(tableName, hash, parsed.table.rows.length, msg, dry_run);
  }

  // ── Per-row parse + canonical-category check + duplicate-key check
  const findings: ValidationFinding[] = [];
  const uploadRows: SubcategoryServiceMapRow[] = [];
  const seenKeys = new Set<string>();
  parsed.table.rows.forEach((r, idx) => {
    const category = (r.category ?? "").trim();
    const slug = (r.subcategory_slug ?? "").trim();
    const cellRaw = r.testing_service_keys ?? "";
    const pseudoKey = `${category}::${slug}`;

    if (!category) {
      findings.push({ key: `row_${idx + 1}`, field: "category", level: "error", message: "missing or blank" });
      return;
    }
    if (!CONCERN_CATEGORY_SLUGS.has(category)) {
      findings.push({ key: pseudoKey, field: "category", level: "error", message: `"${category}" is not one of the 14 canonical slugs` });
      return;
    }
    if (!slug) {
      findings.push({ key: pseudoKey, field: "subcategory_slug", level: "error", message: "missing or blank" });
      return;
    }
    if (!/^[a-z0-9_]+$/.test(slug)) {
      findings.push({ key: pseudoKey, field: "subcategory_slug", level: "error", message: `"${slug}" must match ^[a-z0-9_]+$ (lowercase + digits + underscores)` });
      return;
    }
    if (seenKeys.has(pseudoKey)) {
      findings.push({ key: pseudoKey, field: "subcategory_slug", level: "error", message: "duplicate (category, subcategory_slug) in this upload" });
      return;
    }
    seenKeys.add(pseudoKey);

    const services = parseServiceKeyList(cellRaw);
    for (const s of services) {
      if (!/^[a-z0-9_]+$/.test(s)) {
        findings.push({ key: pseudoKey, field: "testing_service_keys", level: "error", message: `"${s}" must match ^[a-z0-9_]+$` });
        return;
      }
    }

    uploadRows.push({ category, subcategory_slug: slug, testing_service_keys: services });
  });

  const errors = findings.filter((f) => f.level === "error");
  if (uploadRows.length === 0 || errors.length > 0) {
    const msg = `${errors.length} validation error(s); ${uploadRows.length} parseable rows`;
    if (!dry_run) {
      await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    }
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      parse_errors: parsed.errors.length > 0 ? parsed.errors : undefined,
      validation_errors: errors.map((f) => ({ row_index: -1, field: `${f.key}.${f.field}`, message: f.message })),
      validation_warnings: findings.filter((f) => f.level === "warning"),
      dry_run,
      error_message: msg,
    };
  }

  // ── Cross-validate against DB: (category, slug) must exist + service_keys must exist + be active
  const { data: existingSubsData, error: subsErr } = await sb
    .from("concern_subcategories")
    .select("id, category, slug, eligible_testing_service_keys, active")
    .eq("shop_id", shopId);
  if (subsErr) {
    const msg = `concern_subcategories fetch failed: ${subsErr.message}`;
    if (!dry_run) {
      await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    }
    return _failResult(tableName, hash, parsed.table.rows.length, msg, dry_run);
  }
  const existingSubs = (existingSubsData ?? []) as unknown as Array<{
    id: number;
    category: string;
    slug: string;
    eligible_testing_service_keys: string[] | null;
    active: boolean;
  }>;
  const subByKey = new Map<string, (typeof existingSubs)[number]>();
  for (const s of existingSubs) subByKey.set(`${s.category}::${s.slug}`, s);

  const { data: existingSvcData, error: svcErr } = await sb
    .from("testing_services")
    .select("service_key, active")
    .eq("shop_id", shopId);
  if (svcErr) {
    const msg = `testing_services fetch failed: ${svcErr.message}`;
    if (!dry_run) {
      await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    }
    return _failResult(tableName, hash, parsed.table.rows.length, msg, dry_run);
  }
  const activeSvcKeys = new Set<string>();
  const inactiveSvcKeys = new Set<string>();
  for (const r of (existingSvcData ?? []) as Array<{ service_key: string; active: boolean }>) {
    if (r.active) activeSvcKeys.add(r.service_key);
    else inactiveSvcKeys.add(r.service_key);
  }

  const crossErrors: ValidationFinding[] = [];
  for (const row of uploadRows) {
    const pseudoKey = `${row.category}::${row.subcategory_slug}`;
    const sub = subByKey.get(pseudoKey);
    if (!sub) {
      crossErrors.push({ key: pseudoKey, field: "subcategory_slug", level: "error", message: `no row in concern_subcategories for (category=${row.category}, slug=${row.subcategory_slug})` });
      continue;
    }
    if (!sub.active) {
      crossErrors.push({ key: pseudoKey, field: "subcategory_slug", level: "warning", message: "subcategory is currently inactive (mapping will be set but won't take effect until subcategory is reactivated)" });
    }
    for (const svc of row.testing_service_keys) {
      if (activeSvcKeys.has(svc)) continue;
      if (inactiveSvcKeys.has(svc)) {
        crossErrors.push({ key: pseudoKey, field: "testing_service_keys", level: "error", message: `"${svc}" exists in testing_services but is INACTIVE (cannot map to an inactive service)` });
      } else {
        crossErrors.push({ key: pseudoKey, field: "testing_service_keys", level: "error", message: `"${svc}" does not exist in testing_services` });
      }
    }
  }
  const crossHardErrors = crossErrors.filter((f) => f.level === "error");
  if (crossHardErrors.length > 0) {
    const msg = `${crossHardErrors.length} cross-validation error(s)`;
    if (!dry_run) {
      await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    }
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      parse_errors: parsed.errors.length > 0 ? parsed.errors : undefined,
      validation_errors: crossHardErrors.map((f) => ({ row_index: -1, field: `${f.key}.${f.field}`, message: f.message })),
      validation_warnings: crossErrors.filter((f) => f.level === "warning"),
      dry_run,
      error_message: msg,
    };
  }

  // ── Compute diff
  const diffEntries: SubcategoryMapDiffEntry[] = [];
  const noop: string[] = [];
  for (const row of uploadRows) {
    const pseudoKey = `${row.category}::${row.subcategory_slug}`;
    const sub = subByKey.get(pseudoKey)!;
    const before = sub.eligible_testing_service_keys ?? [];
    const after = row.testing_service_keys;
    if (arraysEqualAsSets(before, after)) {
      noop.push(pseudoKey);
      continue;
    }
    diffEntries.push({
      category: row.category,
      subcategory_slug: row.subcategory_slug,
      before,
      after,
    });
  }

  const warnings: ValidationFinding[] = [...findings.filter((f) => f.level === "warning"), ...crossErrors.filter((f) => f.level === "warning")];

  // E4 (2026-05-26): diff_summary.surfaces[] per ADR-021 + PLAN §7. Surface =
  // 'subcategory_service_map' (logical) — disambiguates from the 2 other
  // surfaces that share table_name='concern_subcategories'.
  const diffSummary: Record<string, unknown> = {
    surfaces: ["subcategory_service_map"],
    modified: diffEntries.map((d) => ({
      category: d.category,
      subcategory_slug: d.subcategory_slug,
      before: d.before,
      after: d.after,
    })),
    unchanged_count: noop.length,
    rows_in_md: uploadRows.length,
    rows_in_db_unmentioned: existingSubs.length - uploadRows.length,
  };

  const confirm_token = await sha256Hex(JSON.stringify({ md: hash, diff: diffSummary }));

  // ── Dry-run path
  if (dry_run) {
    return {
      ok: true,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
      rows_added: 0,
      rows_modified: diffEntries.length,
      rows_deactivated: 0,
      validation_warnings: warnings.length > 0 ? warnings : undefined,
      diff_summary: diffSummary,
      dry_run: true,
      confirm_token,
    };
  }

  // ── Apply requires matching confirm_token
  if (expected_confirm_token !== confirm_token) {
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
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
  const snapshotBefore: Record<string, { id: number; category: string; slug: string; eligible_testing_service_keys: string[] }> = {};
  for (const d of diffEntries) {
    const sub = subByKey.get(`${d.category}::${d.subcategory_slug}`)!;
    snapshotBefore[`${d.category}::${d.subcategory_slug}`] = {
      id: sub.id,
      category: d.category,
      slug: d.subcategory_slug,
      eligible_testing_service_keys: d.before,
    };
  }
  const snapshotBase = { before: snapshotBefore, added_keys: [] as string[] };

  // ── Apply (UPDATE only — mapping uploads never INSERT subcategories)
  let applyError: string | null = null;
  try {
    for (const d of diffEntries) {
      const sub = subByKey.get(`${d.category}::${d.subcategory_slug}`)!;
      const { error } = await sb
        .from("concern_subcategories")
        .update({
          eligible_testing_service_keys: d.after,
          updated_by_oauth_client_id: audit.oauth_client_id,
          updated_by_name: audit.display_name,
        })
        .eq("id", sub.id);
      if (error) throw new Error(`update id=${sub.id} (${d.category}/${d.subcategory_slug}) failed: ${error.message}`);
    }
  } catch (e) {
    applyError = e instanceof Error ? e.message : String(e);
  }

  // ── E4 (2026-05-26): Enrich snapshot with byte-parity fields after writes
  // succeed. Kind = 'concern_subcategories_map_v2'. See _uploadCatalogV2 for
  // the canonical rationale + soft-fail policy (apply succeeded but
  // canonical compute failed → audit row written without snapshot, future
  // revert blocked with cannot_safely_verify).
  const SNAPSHOT_KIND: SnapshotKind = "concern_subcategories_map_v2";
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

  // ── Audit
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
    rows_parsed: parsed.table.rows.length,
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

export async function exportSubcategoryServiceMapMdV2(
  sb: SupabaseClient,
  shopId: number,
): Promise<{ md_content: string; row_count: number }> {
  const { data, error } = await sb
    .from("concern_subcategories")
    .select("category, slug, display_label, eligible_testing_service_keys, active")
    .eq("shop_id", shopId)
    .eq("active", true)
    .order("category", { ascending: true })
    .order("display_order", { ascending: true });
  if (error) throw new Error(`subcategory_service_map export failed: ${error.message}`);

  const rows = (data ?? []) as unknown as Array<{
    category: string;
    slug: string;
    display_label: string;
    eligible_testing_service_keys: string[] | null;
  }>;

  const lines: string[] = [];
  lines.push("# Subcategory → Testing Service Mappings");
  lines.push("");
  lines.push("<!--");
  lines.push("Each row maps one (concern_category, subcategory_slug) pair to a");
  lines.push("comma-separated list of testing_service_keys it's eligible under.");
  lines.push("");
  lines.push("When the list is non-empty, the diagnostic LLM routes ONLY to the");
  lines.push("listed services for that subcategory (testing_services.concern_categories[]");
  lines.push("is ignored for this subcategory).");
  lines.push("");
  lines.push("When the cell is blank or '(none)', the subcategory falls back to the");
  lines.push("current concern_categories[]-based fan-out (no change vs. legacy behavior).");
  lines.push("");
  lines.push("Edit by changing the testing_service_keys cell on the row you want to");
  lines.push("re-route. Omitting a row entirely leaves its current mapping unchanged.");
  lines.push("Use a blank cell or '(none)' to CLEAR an existing mapping.");
  lines.push("");
  lines.push("Validation rules:");
  lines.push("  - category must be one of the 14 canonical concern category slugs");
  lines.push("  - subcategory_slug must exist in concern_subcategories with matching category");
  lines.push("  - each testing_service_key must exist in testing_services AND be active");
  lines.push("  - duplicate (category, subcategory_slug) in same upload is blocked");
  lines.push("");
  lines.push("This MD does NOT create / modify / delete subcategories or testing");
  lines.push("services themselves — only the mapping column. Use concern category MD");
  lines.push("and testing-services.md uploads for catalog edits.");
  lines.push("-->");
  lines.push("");
  lines.push("| category | subcategory_slug | testing_service_keys |");
  lines.push("| --- | --- | --- |");
  for (const r of rows) {
    lines.push(`| ${r.category} | ${r.slug} | ${formatServiceKeyList(r.eligible_testing_service_keys)} |`);
  }
  lines.push("");

  return { md_content: lines.join("\n"), row_count: rows.length };
}

// ═══════════════════════════════════════════════════════════════════════
// subcategory_descriptions — per-block uploader/exporter (2026-05-21)
//
// Mutates ONLY the 4 stage-1-classifier metadata columns on
// concern_subcategories: description, positive_examples, negative_examples,
// synonyms. Does NOT create/modify/delete subcategories themselves.
//
// MD format — per-subcategory block. Heading is composite
// `## <category>/<slug>` (split on `/`) because subcategory slugs are
// unique only within a category. parseMdSections enforces ^[a-z0-9_]+$
// on its keys, so we cannot reuse it — this file uses a small custom
// parser tailored to the `<category>/<slug>` heading.
//
// Example:
//
//   # Subcategory Descriptions
//
//   ## brakes/high_pitched_squealing
//   Description: High-pitched continuous squeal from one or more wheels,
//     usually appearing when the brake pedal is lightly pressed or released.
//   Positive examples:
//     - "Brakes squeal when I let off the pedal"
//     - "Squeaking noise when I'm coming to a stop"
//   Negative examples:
//     - "Grinding noise when I brake"
//   Synonyms: squeak, squeal, screech, whine, brake noise
//
// Field semantics (omitted rows are LEFT ALONE; explicit empty CLEARS):
//   - Description: 10-1000 chars. Required when block is present.
//   - Positive examples / Negative examples: either comma-list OR
//     multi-line with `- ` prefix per entry. Cap 10 each.
//   - Synonyms: comma-list. Cap 20.
//
// Validation rules (BLOCK apply):
//   - (category, slug) must exist in concern_subcategories AND be active
//   - description length 10..1000
//   - positive_examples.length <= 10
//   - negative_examples.length <= 10
//   - synonyms.length <= 20
//   - duplicate (category, slug) in same upload
//
// Two-step dry_run + confirm_token apply, mirrors the V2 catalog
// uploaders. Same audit log table (scheduler_admin_audit_log) with
// table_name='concern_subcategories' + operation='upload_md'.
// ═══════════════════════════════════════════════════════════════════════
