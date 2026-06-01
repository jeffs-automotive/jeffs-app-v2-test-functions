// question-required-facts MD-upload surface.
// Extracted from scheduler-admin-catalog.ts (file-size-refactor). Mechanical
// split — no logic changes. Public API preserved via the ./index.ts barrel +
// the scheduler-admin-catalog.ts re-export shim.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  computeCanonicalAfterState,
  logAuditEntry,
  parseMdTable,
  sha256Hex,
  type ParseError,
  type SnapshotKind,
} from "../../scheduler-admin-md.ts";
import type { UploadResult, ValidationFinding } from "../scheduler-admin.ts";
import {
  type UploadV2Args,
} from "./_shared.ts";
import { _failResult, _logAuditError, arraysEqualAsSets } from "./helpers.ts";

const EXTRACTED_FACTS_ALL_KEYS: readonly string[] = [
  "location_side",
  "location_axle",
  "speed_band",
  "speed_specific_mph",
  "onset_timing",
  "started_when",
  "hvac_mode",
  "airflow_state",
  "pedal_feel",
  "smell_descriptor",
  "noise_descriptor",
  "smoke_color",
  "fluid_color",
  "fluid_under_car_location",
  "warning_light_named",
  "warning_light_behavior",
  "engine_running",
  "recent_action",
  "parking_brake_state",
  "tire_state",
  "steering_feel",
  "pull_direction",
  "lights_state",
  "accessory_affected",
  "weather_condition",
  "sound_or_smoke_location_zone",
  "vehicle_powertrain",
  "drivable_state",
  "customer_request_type",
] as const;

const REQUIRED_FACTS_COLUMNS_REQUIRED = ["question_id", "required_facts"];

interface QuestionRequiredFactsRow {
  question_id: number;
  required_facts: string[];
}

interface QuestionRequiredFactsDiffEntry {
  question_id: number;
  before: string[];
  after: string[];
}

/** Parse a slot-name list cell. Blank / (none) / - → []. Otherwise: split on
 *  comma, trim, drop blanks, de-dupe in order. */
function parseFactKeyList(raw: string): string[] {
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

function formatFactKeyList(arr: string[] | null | undefined): string {
  if (!arr || arr.length === 0) return "(none)";
  return arr.join(", ");
}

export async function uploadQuestionRequiredFactsMdV2(
  sb: SupabaseClient,
  shopId: number,
  args: UploadV2Args,
): Promise<UploadResult> {
  const { md_content, audit, dry_run = true, expected_confirm_token } = args;
  const tableName = "concern_questions";
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
  const missingColumns = REQUIRED_FACTS_COLUMNS_REQUIRED.filter(
    (c) => !parsed.table.headers.includes(c),
  );
  if (missingColumns.length > 0) {
    const msg = `missing required columns: ${missingColumns.join(", ")}`;
    if (!dry_run) {
      await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    }
    return _failResult(tableName, hash, parsed.table.rows.length, msg, dry_run);
  }

  // ── Per-row parse + slot-name check + duplicate-key check
  const findings: ValidationFinding[] = [];
  const uploadRows: QuestionRequiredFactsRow[] = [];
  const seenIds = new Set<number>();
  parsed.table.rows.forEach((r, idx) => {
    const qidRaw = (r.question_id ?? "").trim();
    const factsCellRaw = r.required_facts ?? "";
    const pseudoKey = `row_${idx + 1}`;

    if (!qidRaw) {
      findings.push({ key: pseudoKey, field: "question_id", level: "error", message: "missing or blank" });
      return;
    }
    if (!/^\d+$/.test(qidRaw)) {
      findings.push({ key: pseudoKey, field: "question_id", level: "error", message: `"${qidRaw}" must be a positive integer` });
      return;
    }
    const qid = parseInt(qidRaw, 10);
    if (qid <= 0) {
      findings.push({ key: pseudoKey, field: "question_id", level: "error", message: `${qid} must be > 0` });
      return;
    }
    if (seenIds.has(qid)) {
      findings.push({ key: `qid_${qid}`, field: "question_id", level: "error", message: "duplicate question_id in this upload" });
      return;
    }
    seenIds.add(qid);

    const facts = parseFactKeyList(factsCellRaw);
    const factErrors: string[] = [];
    for (const f of facts) {
      if (!EXTRACTED_FACTS_ALL_KEYS.includes(f)) {
        factErrors.push(f);
      }
    }
    if (factErrors.length > 0) {
      findings.push({
        key: `qid_${qid}`,
        field: "required_facts",
        level: "error",
        message: `unknown ExtractedFacts slot(s): ${factErrors.join(", ")} — must be one of: ${EXTRACTED_FACTS_ALL_KEYS.join(", ")}`,
      });
      return;
    }

    uploadRows.push({ question_id: qid, required_facts: facts });
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

  // ── Cross-validate: question_id must exist + active in concern_questions
  const ids = uploadRows.map((r) => r.question_id);
  const { data: existingQsData, error: qsErr } = await sb
    .from("concern_questions")
    .select("id, question_text, active, required_facts")
    .eq("shop_id", shopId)
    .in("id", ids);
  if (qsErr) {
    const msg = `concern_questions fetch failed: ${qsErr.message}`;
    if (!dry_run) {
      await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    }
    return _failResult(tableName, hash, parsed.table.rows.length, msg, dry_run);
  }
  const existingQs = (existingQsData ?? []) as unknown as Array<{
    id: number;
    question_text: string;
    active: boolean;
    required_facts: string[] | null;
  }>;
  const qById = new Map<number, (typeof existingQs)[number]>();
  for (const q of existingQs) qById.set(q.id, q);

  const crossErrors: ValidationFinding[] = [];
  for (const row of uploadRows) {
    const q = qById.get(row.question_id);
    if (!q) {
      crossErrors.push({
        key: `qid_${row.question_id}`,
        field: "question_id",
        level: "error",
        message: `no row in concern_questions for id=${row.question_id} (shop_id=${shopId})`,
      });
      continue;
    }
    if (!q.active) {
      crossErrors.push({
        key: `qid_${row.question_id}`,
        field: "question_id",
        level: "warning",
        message: `question ${row.question_id} is currently inactive (required_facts will be stored but won't take effect until the question is reactivated)`,
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
      rows_parsed: parsed.table.rows.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      parse_errors: parsed.errors.length > 0 ? parsed.errors : undefined,
      validation_errors: crossHard.map((f) => ({ row_index: -1, field: `${f.key}.${f.field}`, message: f.message })),
      validation_warnings: crossErrors.filter((f) => f.level === "warning"),
      dry_run,
      error_message: msg,
    };
  }

  // ── Compute diff
  const diffEntries: QuestionRequiredFactsDiffEntry[] = [];
  const noop: number[] = [];
  for (const row of uploadRows) {
    const q = qById.get(row.question_id)!;
    const before = q.required_facts ?? [];
    const after = row.required_facts;
    if (arraysEqualAsSets(before, after)) {
      noop.push(row.question_id);
      continue;
    }
    diffEntries.push({ question_id: row.question_id, before, after });
  }

  const warnings: ValidationFinding[] = [...findings.filter((f) => f.level === "warning"), ...crossErrors.filter((f) => f.level === "warning")];

  // E4 (2026-05-26): diff_summary.surfaces[] per ADR-021 + PLAN §7. Surface =
  // 'question_required_facts' (logical) — disambiguates from the other
  // surface that shares table_name='concern_questions'.
  const diffSummary: Record<string, unknown> = {
    surfaces: ["question_required_facts"],
    modified: diffEntries.map((d) => ({
      question_id: d.question_id,
      before: d.before,
      after: d.after,
    })),
    unchanged_count: noop.length,
    rows_in_md: uploadRows.length,
  };

  const confirm_token = await sha256Hex(JSON.stringify({ md: hash, diff: diffSummary }));

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
  const snapshotBefore: Record<string, { id: number; required_facts: string[] }> = {};
  for (const d of diffEntries) {
    snapshotBefore[`qid_${d.question_id}`] = { id: d.question_id, required_facts: d.before };
  }
  const snapshotBase = { before: snapshotBefore, added_keys: [] as string[] };

  // ── Apply (UPDATE only — required_facts uploads never INSERT questions)
  let applyError: string | null = null;
  try {
    for (const d of diffEntries) {
      const { error } = await sb
        .from("concern_questions")
        .update({
          required_facts: d.after,
          updated_by_oauth_client_id: audit.oauth_client_id,
          updated_by_name: audit.display_name,
        })
        .eq("id", d.question_id);
      if (error) throw new Error(`update id=${d.question_id} failed: ${error.message}`);
    }
  } catch (e) {
    applyError = e instanceof Error ? e.message : String(e);
  }

  // ── E4 (2026-05-26): Enrich snapshot with byte-parity fields after writes
  // succeed. Kind = 'concern_questions_required_facts_v2'. See
  // _uploadCatalogV2 for the canonical rationale + soft-fail policy.
  const SNAPSHOT_KIND: SnapshotKind = "concern_questions_required_facts_v2";
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

export async function exportQuestionRequiredFactsMdV2(
  sb: SupabaseClient,
  shopId: number,
): Promise<{ md_content: string; row_count: number }> {
  const { data, error } = await sb
    .from("concern_questions")
    .select("id, question_text, required_facts, active, display_order")
    .eq("shop_id", shopId)
    .eq("active", true)
    .order("id", { ascending: true });
  if (error) throw new Error(`question_required_facts export failed: ${error.message}`);

  const rows = (data ?? []) as unknown as Array<{
    id: number;
    question_text: string;
    required_facts: string[] | null;
  }>;

  const lines: string[] = [];
  lines.push("# Question Required Facts");
  lines.push("");
  lines.push("<!--");
  lines.push("Each row maps one concern_questions.id to a comma-separated list of");
  lines.push("ExtractedFacts slot names that must be present in the Stage 1 LLM's");
  lines.push("extracted facts for the question to count as 'answered' by the");
  lines.push("Stage 3 question-gate.");
  lines.push("");
  lines.push("Required columns: question_id, required_facts.");
  lines.push("");
  lines.push("Diff semantics:");
  lines.push("  - Rows OMITTED from this file are LEFT ALONE.");
  lines.push("  - Blank cell / `(none)` / `-` CLEARS the required_facts list");
  lines.push("    (question falls back to free-text 'answered' marking).");
  lines.push("  - Non-empty cell REPLACES the list (in MD order, de-duped).");
  lines.push("");
  lines.push("Validation rules (BLOCKS apply):");
  lines.push("  - question_id is a positive integer");
  lines.push("  - question_id exists in concern_questions");
  lines.push("  - every required_facts slot is one of the 29 canonical");
  lines.push("    ExtractedFacts keys (see scheduler-app/src/lib/scheduler/");
  lines.push("    wizard/llm/extracted-facts.ts EXTRACTED_FACTS_ALL_KEYS):");
  for (let i = 0; i < EXTRACTED_FACTS_ALL_KEYS.length; i += 3) {
    const chunk = EXTRACTED_FACTS_ALL_KEYS.slice(i, i + 3);
    lines.push(`      ${chunk.join(", ")}`);
  }
  lines.push("  - duplicate question_id in same upload");
  lines.push("");
  lines.push("This MD does NOT create / modify / delete questions themselves —");
  lines.push("only the required_facts column. Use upload_concern_category_md to");
  lines.push("edit question text or add/remove questions.");
  lines.push("-->");
  lines.push("");
  lines.push("| question_id | required_facts |");
  lines.push("| --- | --- |");
  for (const r of rows) {
    lines.push(`| ${r.id} | ${formatFactKeyList(r.required_facts)} |`);
  }
  lines.push("");

  return { md_content: lines.join("\n"), row_count: rows.length };
}
