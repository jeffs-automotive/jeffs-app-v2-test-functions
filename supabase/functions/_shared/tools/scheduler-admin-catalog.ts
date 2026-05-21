// scheduler-admin-catalog.ts — Option B (per-service-block) uploaders +
// exporters + revert for testing_services and routine_services.
//
// Replaces the legacy table-row uploaders in scheduler-admin.ts for these
// two tables. Three pieces:
//
//   1. uploadTestingServicesMdV2 — parseMdSections → validate → diff → snapshot → apply
//      Same shape for uploadRoutineServicesMdV2.
//   2. exportTestingServicesMdV2 / exportRoutineServicesMdV2 — dump DB state
//      in the Option B per-service-block format. Round-trips through the
//      uploader cleanly.
//   3. revertMdUpload(upload_id) — reads pre_state_snapshot from audit log,
//      UPSERTs every row back. Idempotent. Rejects revert-of-revert chains.
//      Rejects if the snapshot was pruned (>30d retention).
//
// Pre-parser validation rules (BLOCKS apply if violated):
//   - service_key matches ^[a-z0-9_]+$
//   - no duplicate service_keys in the same upload
//   - starting_price_cents is non-negative integer (or null where allowed)
//   - concern_categories ⊆ 14 canonical slugs
//   - description length 10..500 chars
//   - abbreviation length 1..30 chars
//
// Pre-parser warning rules (visible on dry_run, not blocking):
//   - price moves >50% in either direction (catches typos)
//   - service being deactivated (soft-delete)
//   - description was set then cleared (suspicious)
//
// Dry-run flow (default — per Chris's 2026-05-19 decision):
//   - Call with dry_run=true (or omit): tool parses + validates + computes
//     diff + computes confirm_token. Writes NOTHING. Returns the report.
//   - Advisor reviews the report. Approves.
//   - Call with dry_run=false + expected_confirm_token=<token from dry_run>:
//     tool re-parses, re-computes the confirm_token, must match, then
//     captures pre_state_snapshot + applies + writes audit row.
//   - Mismatch → reject with reason. Forces a fresh dry_run.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import {
  formatPriceCents,
  parseBool,
  parseCsvList,
  parseIntField,
  parseMdSections,
  parseMdTable,
  parsePriceCents,
  parseStringField,
  serializeMdSections,
  sha256Hex,
  type ParsedMdSection,
  type ParseError,
  type SectionSpec,
} from "../scheduler-admin-md.ts";

import type { AdminAudit, UploadResult, ValidationFinding } from "./scheduler-admin.ts";

const CONCERN_CATEGORY_SLUGS = new Set([
  "noise", "vibration", "pulling", "smell", "smoke", "leak", "warning_light",
  "performance", "electrical", "hvac", "brakes", "steering", "tires", "other",
]);

const MIN_DESCRIPTION_LEN = 10;
const MAX_DESCRIPTION_LEN = 500;
const MAX_ABBREVIATION_LEN = 30;
const PRICE_WARN_PCT = 0.5;

// ═══════════════════════════════════════════════════════════════════════
// Shared types
// ═══════════════════════════════════════════════════════════════════════

export interface UploadV2Args {
  md_content: string;
  audit: AdminAudit;
  /** Default TRUE — must explicitly pass false to apply. */
  dry_run?: boolean;
  /** Required when dry_run=false; must match the token from a recent dry_run. */
  expected_confirm_token?: string;
}

interface RowDiff<TRow> {
  added: TRow[];
  modified: Array<{ before: TRow; after: TRow; changed_fields: string[] }>;
  deactivated: TRow[];
  unchanged: TRow[];
}

interface ParsedCatalog<TRow> {
  rows: TRow[];
  findings: ValidationFinding[];
}

interface CatalogConfig<TRow extends { service_key: string; active: boolean; starting_price_cents?: number | null }> {
  tableName: "testing_services" | "routine_services";
  selectColumns: string;
  /** Parse + validate ONE section into a typed row. Pushes findings if invalid. */
  parseSection: (
    section: ParsedMdSection,
    findings: ValidationFinding[],
  ) => TRow | null;
  /** Return the field names that changed between before+after. */
  diffFields: (before: TRow, after: TRow) => string[];
  /** Build the row for upsert (add shop_id). */
  toUpsertRow: (row: TRow, shopId: number) => Record<string, unknown>;
  /** Pretty-print a row for the diff summary. */
  prettyRow: (row: TRow) => string;
}

// ═══════════════════════════════════════════════════════════════════════
// testing_services — Option B
// ═══════════════════════════════════════════════════════════════════════

interface TestingServiceRow {
  service_key: string;
  display_name: string;
  abbreviation: string;
  starting_price_cents: number;
  notes: string | null;
  description: string | null;
  example_keywords: string[] | null;
  concern_categories: string[];
  active: boolean;
}

const TESTING_CONFIG: CatalogConfig<TestingServiceRow> = {
  tableName: "testing_services",
  selectColumns:
    "service_key, display_name, abbreviation, starting_price_cents, notes, description, example_keywords, concern_categories, active",
  parseSection: (section, findings) => {
    const fields = section.fields;
    const errs: ValidationFinding[] = [];
    const push = (field: string, message: string) =>
      errs.push({ key: section.key, field, level: "error", message });

    const display_name = parseStringField(fields.display_name);
    if (!display_name) push("display_name", "missing or blank");

    const abbreviation = parseStringField(fields.abbreviation);
    if (!abbreviation) push("abbreviation", "missing or blank");
    else if (abbreviation.length > MAX_ABBREVIATION_LEN) {
      push("abbreviation", `>${MAX_ABBREVIATION_LEN} chars`);
    }

    let price = 0;
    try {
      const parsed = parsePriceCents(fields.starting_price);
      if (parsed === null) push("starting_price", "required (use 'Free' for $0)");
      else price = parsed;
    } catch (e) {
      push("starting_price", e instanceof Error ? e.message : String(e));
    }

    const notes = parseStringField(fields.notes);
    const description = parseStringField(fields.description);
    if (description && description.length < MIN_DESCRIPTION_LEN) {
      push("description", `<${MIN_DESCRIPTION_LEN} chars (too short — write a complete sentence)`);
    }
    if (description && description.length > MAX_DESCRIPTION_LEN) {
      push("description", `>${MAX_DESCRIPTION_LEN} chars (too long — trim to 1-2 sentences)`);
    }

    const example_keywords = fields.example_keywords ? parseCsvList(fields.example_keywords) : null;

    const concern_categories = parseCsvList(fields.concern_categories);
    for (const cat of concern_categories) {
      if (!CONCERN_CATEGORY_SLUGS.has(cat)) {
        push("concern_categories", `"${cat}" is not one of the 14 canonical slugs`);
      }
    }

    let active: boolean;
    try {
      active = parseBool(fields.active, "active");
    } catch (e) {
      push("active", e instanceof Error ? e.message : String(e));
      active = true;
    }

    findings.push(...errs);
    if (errs.length > 0) return null;

    return {
      service_key: section.key,
      display_name: display_name!,
      abbreviation: abbreviation!,
      starting_price_cents: price,
      notes,
      description,
      example_keywords,
      concern_categories,
      active,
    };
  },
  diffFields: (before, after) => {
    const changed: string[] = [];
    if (before.display_name !== after.display_name) changed.push("display_name");
    if (before.abbreviation !== after.abbreviation) changed.push("abbreviation");
    if (before.starting_price_cents !== after.starting_price_cents) changed.push("starting_price_cents");
    if ((before.notes ?? null) !== (after.notes ?? null)) changed.push("notes");
    if ((before.description ?? null) !== (after.description ?? null)) changed.push("description");
    if (
      JSON.stringify([...(before.example_keywords ?? [])].sort()) !==
      JSON.stringify([...(after.example_keywords ?? [])].sort())
    ) changed.push("example_keywords");
    if (
      JSON.stringify([...before.concern_categories].sort()) !==
      JSON.stringify([...after.concern_categories].sort())
    ) changed.push("concern_categories");
    if (before.active !== after.active) changed.push("active");
    return changed;
  },
  toUpsertRow: (row, shopId) => ({ ...row, shop_id: shopId }),
  prettyRow: (row) =>
    `${row.service_key} (${row.display_name}, ${formatPriceCents(row.starting_price_cents)}, active=${row.active})`,
};

export async function uploadTestingServicesMdV2(
  sb: SupabaseClient,
  shopId: number,
  args: UploadV2Args,
): Promise<UploadResult> {
  return await _uploadCatalogV2(sb, shopId, args, TESTING_CONFIG);
}

// ═══════════════════════════════════════════════════════════════════════
// routine_services — Option B
// ═══════════════════════════════════════════════════════════════════════

interface RoutineServiceRow {
  service_key: string;
  display_name: string;
  abbreviation: string;
  display_order: number;
  wait_eligible: boolean;
  requires_explanation: boolean;
  concern_categories: string[] | null;
  starting_price_cents: number | null;
  price_waived_note: string | null;
  description: string | null;
  active: boolean;
}

const ROUTINE_CONFIG: CatalogConfig<RoutineServiceRow> = {
  tableName: "routine_services",
  selectColumns:
    "service_key, display_name, abbreviation, display_order, wait_eligible, requires_explanation, concern_categories, starting_price_cents, price_waived_note, description, active",
  parseSection: (section, findings) => {
    const fields = section.fields;
    const errs: ValidationFinding[] = [];
    const push = (field: string, message: string) =>
      errs.push({ key: section.key, field, level: "error", message });

    const display_name = parseStringField(fields.display_name);
    if (!display_name) push("display_name", "missing or blank");

    const abbreviation = parseStringField(fields.abbreviation);
    if (!abbreviation) push("abbreviation", "missing or blank");
    else if (abbreviation.length > MAX_ABBREVIATION_LEN) {
      push("abbreviation", `>${MAX_ABBREVIATION_LEN} chars`);
    }

    let display_order = 999;
    try {
      display_order = parseIntField(fields.display_order, "display_order");
      if (display_order < 0) push("display_order", "must be >= 0");
    } catch (e) {
      push("display_order", e instanceof Error ? e.message : String(e));
    }

    let wait_eligible = false;
    try { wait_eligible = parseBool(fields.wait_eligible, "wait_eligible"); }
    catch (e) { push("wait_eligible", e instanceof Error ? e.message : String(e)); }

    let requires_explanation = false;
    try { requires_explanation = parseBool(fields.requires_explanation, "requires_explanation"); }
    catch (e) { push("requires_explanation", e instanceof Error ? e.message : String(e)); }

    let starting_price_cents: number | null = null;
    try {
      starting_price_cents = parsePriceCents(fields.starting_price);
      if (starting_price_cents !== null && starting_price_cents < 0) {
        push("starting_price", "must be >= 0");
      }
    } catch (e) {
      push("starting_price", e instanceof Error ? e.message : String(e));
    }

    const price_waived_note = parseStringField(fields.price_waived_note);
    const description = parseStringField(fields.description);
    if (description && description.length < MIN_DESCRIPTION_LEN) {
      push("description", `<${MIN_DESCRIPTION_LEN} chars (too short — write a complete sentence)`);
    }
    if (description && description.length > MAX_DESCRIPTION_LEN) {
      push("description", `>${MAX_DESCRIPTION_LEN} chars (too long — trim to 1-2 sentences)`);
    }

    const concern_categories = fields.concern_categories ? parseCsvList(fields.concern_categories) : null;
    if (concern_categories) {
      for (const cat of concern_categories) {
        if (!CONCERN_CATEGORY_SLUGS.has(cat)) {
          push("concern_categories", `"${cat}" is not one of the 14 canonical slugs`);
        }
      }
    }

    let active = true;
    try { active = parseBool(fields.active, "active"); }
    catch (e) { push("active", e instanceof Error ? e.message : String(e)); }

    findings.push(...errs);
    if (errs.length > 0) return null;

    return {
      service_key: section.key,
      display_name: display_name!,
      abbreviation: abbreviation!,
      display_order,
      wait_eligible,
      requires_explanation,
      concern_categories,
      starting_price_cents,
      price_waived_note,
      description,
      active,
    };
  },
  diffFields: (before, after) => {
    const changed: string[] = [];
    if (before.display_name !== after.display_name) changed.push("display_name");
    if (before.abbreviation !== after.abbreviation) changed.push("abbreviation");
    if (before.display_order !== after.display_order) changed.push("display_order");
    if (before.wait_eligible !== after.wait_eligible) changed.push("wait_eligible");
    if (before.requires_explanation !== after.requires_explanation) changed.push("requires_explanation");
    if (
      JSON.stringify([...(before.concern_categories ?? [])].sort()) !==
      JSON.stringify([...(after.concern_categories ?? [])].sort())
    ) changed.push("concern_categories");
    if ((before.starting_price_cents ?? null) !== (after.starting_price_cents ?? null)) changed.push("starting_price_cents");
    if ((before.price_waived_note ?? null) !== (after.price_waived_note ?? null)) changed.push("price_waived_note");
    if ((before.description ?? null) !== (after.description ?? null)) changed.push("description");
    if (before.active !== after.active) changed.push("active");
    return changed;
  },
  toUpsertRow: (row, shopId) => ({ ...row, shop_id: shopId }),
  prettyRow: (row) =>
    `${row.service_key} (${row.display_name}, ${formatPriceCents(row.starting_price_cents)}, active=${row.active})`,
};

export async function uploadRoutineServicesMdV2(
  sb: SupabaseClient,
  shopId: number,
  args: UploadV2Args,
): Promise<UploadResult> {
  return await _uploadCatalogV2(sb, shopId, args, ROUTINE_CONFIG);
}

// ═══════════════════════════════════════════════════════════════════════
// Shared catalog uploader
// ═══════════════════════════════════════════════════════════════════════

async function _uploadCatalogV2<TRow extends {
  service_key: string;
  active: boolean;
  starting_price_cents?: number | null;
}>(
  sb: SupabaseClient,
  shopId: number,
  args: UploadV2Args,
  config: CatalogConfig<TRow>,
): Promise<UploadResult> {
  const { md_content, audit, dry_run = true, expected_confirm_token } = args;
  const hash = await sha256Hex(md_content);

  // ── Parse
  let sections;
  try {
    sections = parseMdSections(md_content);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!dry_run) {
      await _logAudit(sb, { audit, table_name: config.tableName, operation: "upload_md", md_content_hash: hash, error_message: msg });
    }
    return _failResult(config.tableName, hash, 0, msg, dry_run);
  }

  // ── Validate per-section
  const findings: ValidationFinding[] = [];
  const seenKeys = new Set<string>();
  const validRows: TRow[] = [];
  for (const section of sections.sections) {
    if (seenKeys.has(section.key)) {
      findings.push({ key: section.key, field: "service_key", level: "error", message: "duplicate service_key in this upload" });
      continue;
    }
    seenKeys.add(section.key);
    const row = config.parseSection(section, findings);
    if (row) validRows.push(row);
  }

  const errors = findings.filter((f) => f.level === "error");
  if (validRows.length === 0 || errors.length > 0) {
    const msg = `${errors.length} validation error(s); 0 valid rows`;
    if (!dry_run) {
      await _logAudit(sb, { audit, table_name: config.tableName, operation: "upload_md", md_content_hash: hash, error_message: msg });
    }
    return {
      ok: false,
      table_name: config.tableName,
      md_content_hash: hash,
      rows_parsed: sections.sections.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      validation_errors: errors.map((f) => ({ row_index: -1, field: `${f.key}.${f.field}`, message: f.message })),
      validation_warnings: findings.filter((f) => f.level === "warning"),
      dry_run,
      error_message: msg,
    };
  }

  // ── Fetch current state
  const { data: currentRows, error: fetchErr } = await sb
    .from(config.tableName)
    .select(config.selectColumns)
    .eq("shop_id", shopId);
  if (fetchErr) {
    const msg = `current-state fetch failed: ${fetchErr.message}`;
    if (!dry_run) {
      await _logAudit(sb, { audit, table_name: config.tableName, operation: "upload_md", md_content_hash: hash, error_message: msg });
    }
    return _failResult(config.tableName, hash, sections.sections.length, msg, dry_run);
  }

  const currentByKey = new Map<string, TRow>();
  // `.from(config.tableName)` with a runtime string falls back to
  // postgrest-js GenericStringError[]; the fetchErr branch above already
  // discriminates real errors, so the remaining rows are safe to widen.
  for (const row of (currentRows ?? []) as unknown as TRow[]) {
    currentByKey.set(row.service_key, row);
  }

  // ── Compute diff
  const diff: RowDiff<TRow> = { added: [], modified: [], deactivated: [], unchanged: [] };
  const uploadedKeys = new Set(validRows.map((r) => r.service_key));
  for (const row of validRows) {
    const current = currentByKey.get(row.service_key);
    if (!current) {
      diff.added.push(row);
    } else {
      const changed = config.diffFields(current, row);
      if (changed.length > 0) {
        diff.modified.push({ before: current, after: row, changed_fields: changed });
      } else {
        diff.unchanged.push(row);
      }
    }
  }
  for (const [key, row] of currentByKey) {
    if (!uploadedKeys.has(key) && row.active) {
      diff.deactivated.push(row);
    }
  }

  // ── Smell-test warnings
  const warnings: ValidationFinding[] = [...findings.filter((f) => f.level === "warning")];
  for (const mod of diff.modified) {
    if (mod.changed_fields.includes("starting_price_cents")) {
      const beforeCents = mod.before.starting_price_cents ?? 0;
      const afterCents = mod.after.starting_price_cents ?? 0;
      if (beforeCents > 0) {
        const pct = Math.abs(afterCents - beforeCents) / beforeCents;
        if (pct >= PRICE_WARN_PCT) {
          warnings.push({
            key: mod.after.service_key,
            field: "starting_price_cents",
            level: "warning",
            message: `price changed ${formatPriceCents(beforeCents)} → ${formatPriceCents(afterCents)} (${(pct * 100).toFixed(0)}% change — confirm not a typo)`,
          });
        }
      } else if (afterCents > 0) {
        warnings.push({
          key: mod.after.service_key,
          field: "starting_price_cents",
          level: "warning",
          message: `price set to ${formatPriceCents(afterCents)} (was Free) — confirm not a typo`,
        });
      }
    }
    if (mod.changed_fields.includes("active") && mod.before.active && !mod.after.active) {
      warnings.push({
        key: mod.after.service_key,
        field: "active",
        level: "warning",
        message: "service deactivated (will be hidden from picker)",
      });
    }
  }
  for (const row of diff.deactivated) {
    warnings.push({
      key: row.service_key,
      field: "_omitted",
      level: "warning",
      message: "row present in DB but missing from MD — will be soft-deleted (active=false)",
    });
  }

  // ── Build diff_summary
  const diffSummary: Record<string, unknown> = {
    added: diff.added.map((r) => config.prettyRow(r)),
    modified: diff.modified.map((m) => ({
      service_key: m.after.service_key,
      changed_fields: m.changed_fields,
      pretty: config.prettyRow(m.after),
    })),
    deactivated: diff.deactivated.map((r) => r.service_key),
    unchanged_count: diff.unchanged.length,
  };

  const confirm_token = await sha256Hex(JSON.stringify({ md: hash, diff: diffSummary }));

  // ── Dry-run path
  if (dry_run) {
    return {
      ok: true,
      table_name: config.tableName,
      md_content_hash: hash,
      rows_parsed: sections.sections.length,
      rows_added: diff.added.length,
      rows_modified: diff.modified.length,
      rows_deactivated: diff.deactivated.length,
      validation_warnings: warnings.length > 0 ? warnings : undefined,
      diff_summary: diffSummary,
      dry_run: true,
      confirm_token,
    };
  }

  // ── Apply path — require matching confirm_token
  if (expected_confirm_token !== confirm_token) {
    return {
      ok: false,
      table_name: config.tableName,
      md_content_hash: hash,
      rows_parsed: sections.sections.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      validation_warnings: warnings,
      diff_summary: diffSummary,
      dry_run: false,
      confirm_token,
      error_message: expected_confirm_token
        ? "confirm_token mismatch — DB state or MD content changed since dry_run. Re-run dry_run and pass the new token."
        : "missing expected_confirm_token — run dry_run first, then pass the returned token back.",
    };
  }

  // ── Capture pre_state_snapshot (BEFORE writes)
  const snapshotBefore: Record<string, TRow> = {};
  for (const mod of diff.modified) snapshotBefore[mod.before.service_key] = mod.before;
  for (const row of diff.deactivated) snapshotBefore[row.service_key] = row;
  const snapshot = {
    before: snapshotBefore,
    added_keys: diff.added.map((r) => r.service_key),
  };

  // ── Apply
  let applyError: string | null = null;
  try {
    const toUpsert = [
      ...diff.added.map((r) => config.toUpsertRow(r, shopId)),
      ...diff.modified.map((m) => config.toUpsertRow(m.after, shopId)),
    ];
    if (toUpsert.length > 0) {
      const { error } = await sb.from(config.tableName).upsert(toUpsert, { onConflict: "shop_id,service_key" });
      if (error) throw new Error(`upsert failed: ${error.message}`);
    }
    if (diff.deactivated.length > 0) {
      const { error } = await sb
        .from(config.tableName)
        .update({ active: false })
        .eq("shop_id", shopId)
        .in("service_key", diff.deactivated.map((r) => r.service_key));
      if (error) throw new Error(`deactivate failed: ${error.message}`);
    }
  } catch (e) {
    applyError = e instanceof Error ? e.message : String(e);
  }

  // ── Audit row (with snapshot if apply succeeded)
  const audit_log_id = await _logAudit(sb, {
    audit,
    table_name: config.tableName,
    operation: "upload_md",
    rows_added: diff.added.length,
    rows_modified: diff.modified.length,
    rows_deactivated: diff.deactivated.length,
    md_content_hash: hash,
    diff_summary: diffSummary,
    pre_state_snapshot: applyError ? null : snapshot,
    error_message: applyError ?? undefined,
  });

  return {
    ok: !applyError,
    table_name: config.tableName,
    md_content_hash: hash,
    rows_parsed: sections.sections.length,
    rows_added: diff.added.length,
    rows_modified: diff.modified.length,
    rows_deactivated: diff.deactivated.length,
    validation_warnings: warnings.length > 0 ? warnings : undefined,
    diff_summary: diffSummary,
    dry_run: false,
    confirm_token,
    audit_log_id: audit_log_id ?? undefined,
    error_message: applyError ?? undefined,
  };
}

function _failResult(
  tableName: string,
  hash: string,
  parsed: number,
  msg: string,
  dry_run: boolean,
): UploadResult {
  return {
    ok: false,
    table_name: tableName,
    md_content_hash: hash,
    rows_parsed: parsed,
    rows_added: 0,
    rows_modified: 0,
    rows_deactivated: 0,
    dry_run,
    error_message: msg,
  };
}

async function _logAudit(
  sb: SupabaseClient,
  args: {
    audit: AdminAudit;
    table_name: string;
    operation: "upload_md" | "revert_upload";
    rows_added?: number;
    rows_modified?: number;
    rows_deactivated?: number;
    md_content_hash?: string;
    diff_summary?: Record<string, unknown>;
    pre_state_snapshot?: Record<string, unknown> | null;
    error_message?: string;
  },
): Promise<number | null> {
  const { data, error } = await sb
    .from("scheduler_admin_audit_log")
    .insert({
      oauth_client_id: args.audit.oauth_client_id,
      user_label: args.audit.display_name,
      table_name: args.table_name,
      operation: args.operation,
      rows_added: args.rows_added ?? 0,
      rows_modified: args.rows_modified ?? 0,
      rows_deactivated: args.rows_deactivated ?? 0,
      md_content_hash: args.md_content_hash ?? null,
      diff_summary: args.diff_summary ?? null,
      pre_state_snapshot: args.pre_state_snapshot ?? null,
      error_message: args.error_message ?? null,
    })
    .select("id")
    .single();
  if (error) {
    console.warn(JSON.stringify({
      level: "warning",
      msg: "scheduler_admin_audit_log_insert_failed_v2",
      detail: error.message,
      table_name: args.table_name,
      operation: args.operation,
    }));
    return null;
  }
  return (data?.id as number) ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
// Exporters — round-trip-safe Option B serialization
// ═══════════════════════════════════════════════════════════════════════

const TESTING_EXPORT_SPEC: SectionSpec = {
  title: "Testing Services",
  guidance: [
    "Each `## service_key` block is one diagnostic/testing service the diagnostic LLM",
    "can recommend from the customer's free-text concern. Edit fields inline + re-upload",
    "via Claude Desktop. The orchestrator always shows a diff for advisor approval before",
    "applying — bulk uploads are dry-run by default.",
    "",
    "Required fields per service: Display name, Abbreviation, Starting price, Concern categories, Active.",
    "Optional: Notes (advisor-side), Description (customer-facing), Example keywords (LLM routing hints).",
    "",
    "Price format: \"$XX.XX\" or \"Free\". Description: 1-2 customer-facing sentences (10-500 chars).",
    "Concern categories: comma-separated from the 14 canonical slugs:",
    "  noise, vibration, pulling, smell, smoke, leak, warning_light, performance,",
    "  electrical, hvac, brakes, steering, tires, other",
    "Active: true/false. Soft-delete a service by setting Active: false (preserves history).",
    "",
    "To remove a service from the catalog entirely: delete its `## service_key` block AND",
    "re-upload — the parser will soft-delete any DB rows missing from the file.",
  ].join("\n"),
  fields: [
    { label: "Display name", get: (r) => String(r.display_name ?? "") },
    { label: "Abbreviation", get: (r) => String(r.abbreviation ?? "") },
    { label: "Starting price", get: (r) => formatPriceCents(r.starting_price_cents as number | null) },
    { label: "Notes", get: (r) => (r.notes ? String(r.notes) : "(none)") },
    { label: "Description", get: (r) => (r.description ? String(r.description) : "(none)") },
    { label: "Example keywords", get: (r) => {
      const arr = r.example_keywords as string[] | null | undefined;
      return arr && arr.length > 0 ? arr.join(", ") : "(none)";
    }},
    { label: "Concern categories", get: (r) => {
      const arr = r.concern_categories as string[] | null | undefined;
      return arr && arr.length > 0 ? arr.join(", ") : "(none)";
    }},
    { label: "Active", get: (r) => (r.active ? "true" : "false") },
  ],
};

const ROUTINE_EXPORT_SPEC: SectionSpec = {
  title: "Routine Services",
  guidance: [
    "Each `## service_key` block is one chip on the Step 7 picker. Edit fields inline +",
    "re-upload via Claude Desktop. The orchestrator always shows a diff for advisor approval",
    "before applying — bulk uploads are dry-run by default.",
    "",
    "Required: Display name, Abbreviation, Display order, Wait eligible, Requires explanation, Active.",
    "Optional: Concern categories (only meaningful when Requires explanation: true), Starting price,",
    "Price waived note, Description (customer-facing 1-2 sentence chip caption).",
    "",
    "Wait eligible: true if customer can wait in lobby (oil change, tire rotate, etc.). false = drop-off only.",
    "Requires explanation: true if picking this chip kicks off the concern-explanation diagnostic flow.",
    "  Currently true for the 5 diagnostic-routine chips: Brake Inspection, Check Battery,",
    "  Warning Lights, Check Suspension, Check A/C. Each must have a Concern categories list.",
    "Display order: integer; lower = shown first.",
    "Starting price: \"$XX.XX\" / \"Free\" / \"(none)\" (omit to render no price).",
    "Price waived note: short customer-facing caveat under the price (e.g. \"Fee waived if a repair or more testing is needed and approved\").",
  ].join("\n"),
  fields: [
    { label: "Display name", get: (r) => String(r.display_name ?? "") },
    { label: "Abbreviation", get: (r) => String(r.abbreviation ?? "") },
    { label: "Display order", get: (r) => String(r.display_order ?? 0) },
    { label: "Wait eligible", get: (r) => (r.wait_eligible ? "true" : "false") },
    { label: "Requires explanation", get: (r) => (r.requires_explanation ? "true" : "false") },
    { label: "Concern categories", get: (r) => {
      const arr = r.concern_categories as string[] | null | undefined;
      return arr && arr.length > 0 ? arr.join(", ") : "(none)";
    }},
    { label: "Starting price", get: (r) => formatPriceCents(r.starting_price_cents as number | null) },
    { label: "Price waived note", get: (r) => (r.price_waived_note ? String(r.price_waived_note) : "(none)") },
    { label: "Description", get: (r) => (r.description ? String(r.description) : "(none)") },
    { label: "Active", get: (r) => (r.active ? "true" : "false") },
  ],
};

export async function exportTestingServicesMdV2(
  sb: SupabaseClient,
  shopId: number,
): Promise<{ md_content: string; row_count: number }> {
  const { data, error } = await sb
    .from("testing_services")
    .select(TESTING_CONFIG.selectColumns)
    .eq("shop_id", shopId)
    .order("service_key", { ascending: true });
  if (error) throw new Error(`testing_services export failed: ${error.message}`);
  // see scheduler-admin-catalog.ts:433 comment — runtime table name +
  // un-parameterized SupabaseClient yields GenericStringError[]; cast
  // via unknown after the error branch is discriminated.
  const md = serializeMdSections((data ?? []) as unknown as Record<string, unknown>[], "service_key", TESTING_EXPORT_SPEC);
  return { md_content: md, row_count: (data ?? []).length };
}

export async function exportRoutineServicesMdV2(
  sb: SupabaseClient,
  shopId: number,
): Promise<{ md_content: string; row_count: number }> {
  const { data, error } = await sb
    .from("routine_services")
    .select(ROUTINE_CONFIG.selectColumns)
    .eq("shop_id", shopId)
    .order("display_order", { ascending: true });
  if (error) throw new Error(`routine_services export failed: ${error.message}`);
  // see comment on exportTestingServicesMdV2.
  const md = serializeMdSections((data ?? []) as unknown as Record<string, unknown>[], "service_key", ROUTINE_EXPORT_SPEC);
  return { md_content: md, row_count: (data ?? []).length };
}

// ═══════════════════════════════════════════════════════════════════════
// revert_md_upload — undo a recent upload
// ═══════════════════════════════════════════════════════════════════════

export interface RevertArgs {
  /** ID returned in audit_log_id from a prior upload. */
  upload_id: number;
  audit: AdminAudit;
  /** Default TRUE — must explicitly pass false to apply the revert. */
  dry_run?: boolean;
}

export interface RevertResult {
  ok: boolean;
  upload_id: number;
  table_name?: string;
  original_md_content_hash?: string;
  original_diff?: Record<string, unknown>;
  /** Plan of what the revert will do (always shown). */
  revert_plan?: {
    restore: Array<{ service_key: string; via: "upsert" }>;
    deactivate: Array<{ service_key: string; reason: "was_added_by_original_upload" }>;
    no_op_count: number;
  };
  dry_run?: boolean;
  /** Set when dry_run=false and apply succeeded — the revert's own audit_log_id. */
  revert_audit_log_id?: number;
  error_message?: string;
}

export async function revertMdUpload(
  sb: SupabaseClient,
  shopId: number,
  args: RevertArgs,
): Promise<RevertResult> {
  const { upload_id, audit, dry_run = true } = args;

  const { data: row, error } = await sb
    .from("scheduler_admin_audit_log")
    .select("id, table_name, operation, md_content_hash, diff_summary, pre_state_snapshot, snapshot_pruned_at, occurred_at")
    .eq("id", upload_id)
    .maybeSingle();

  if (error || !row) {
    return { ok: false, upload_id, error_message: `audit log row ${upload_id} not found` };
  }

  if (row.operation !== "upload_md") {
    return {
      ok: false,
      upload_id,
      error_message: `cannot revert: audit row ${upload_id} is operation=${row.operation}, not upload_md (no revert-of-revert chains)`,
    };
  }

  if (row.snapshot_pruned_at) {
    return {
      ok: false,
      upload_id,
      table_name: row.table_name as string,
      error_message: `cannot revert: pre_state_snapshot was pruned on ${row.snapshot_pruned_at} (30-day retention)`,
    };
  }

  if (!row.pre_state_snapshot) {
    return {
      ok: false,
      upload_id,
      table_name: row.table_name as string,
      error_message: "cannot revert: no pre_state_snapshot captured (legacy upload before snapshot column was added, or upload failed before apply)",
    };
  }

  const snapshot = row.pre_state_snapshot as {
    before: Record<string, Record<string, unknown>>;
    added_keys: string[];
  };

  const tableName = row.table_name as string;
  if (tableName !== "testing_services" && tableName !== "routine_services") {
    return {
      ok: false,
      upload_id,
      table_name: tableName,
      error_message: `revert only supports testing_services or routine_services (got ${tableName})`,
    };
  }

  const restorePlan: Array<{ service_key: string; via: "upsert" }> = [];
  for (const key of Object.keys(snapshot.before)) {
    restorePlan.push({ service_key: key, via: "upsert" });
  }
  const deactivatePlan: Array<{ service_key: string; reason: "was_added_by_original_upload" }> = [];
  for (const key of snapshot.added_keys) {
    deactivatePlan.push({ service_key: key, reason: "was_added_by_original_upload" });
  }

  const plan = {
    restore: restorePlan,
    deactivate: deactivatePlan,
    no_op_count: 0,
  };

  if (dry_run) {
    return {
      ok: true,
      upload_id,
      table_name: tableName,
      original_md_content_hash: row.md_content_hash as string | undefined,
      original_diff: row.diff_summary as Record<string, unknown> | undefined,
      revert_plan: plan,
      dry_run: true,
    };
  }

  // ── Apply revert
  let applyError: string | null = null;
  try {
    if (restorePlan.length > 0) {
      const upsertRows = restorePlan.map((p) => ({
        ...snapshot.before[p.service_key],
        shop_id: shopId,
      }));
      const { error } = await sb.from(tableName).upsert(upsertRows, { onConflict: "shop_id,service_key" });
      if (error) throw new Error(`restore upsert failed: ${error.message}`);
    }
    if (deactivatePlan.length > 0) {
      const { error } = await sb
        .from(tableName)
        .update({ active: false })
        .eq("shop_id", shopId)
        .in("service_key", deactivatePlan.map((p) => p.service_key));
      if (error) throw new Error(`deactivate-added failed: ${error.message}`);
    }
  } catch (e) {
    applyError = e instanceof Error ? e.message : String(e);
  }

  const revert_audit_log_id = await _logAudit(sb, {
    audit,
    table_name: tableName,
    operation: "revert_upload",
    rows_added: 0,
    rows_modified: restorePlan.length,
    rows_deactivated: deactivatePlan.length,
    md_content_hash: undefined,
    diff_summary: {
      reverted_upload_id: upload_id,
      restored: restorePlan.map((p) => p.service_key),
      deactivated_added: deactivatePlan.map((p) => p.service_key),
    },
    error_message: applyError ?? undefined,
  });

  return {
    ok: !applyError,
    upload_id,
    table_name: tableName,
    original_md_content_hash: row.md_content_hash as string | undefined,
    original_diff: row.diff_summary as Record<string, unknown> | undefined,
    revert_plan: plan,
    dry_run: false,
    revert_audit_log_id: revert_audit_log_id ?? undefined,
    error_message: applyError ?? undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// subcategory_service_map — wide-table uploader/exporter (2026-05-20)
//
// Mutates ONLY concern_subcategories.eligible_testing_service_keys (text[]).
// Does NOT create / modify / delete subcategories or testing_services
// themselves — only the mapping column.
//
// MD format (single wide markdown table):
//
//   # Subcategory → Testing Service Mappings
//
//   <!-- format guidance -->
//
//   | category | subcategory_slug | testing_service_keys |
//   | --- | --- | --- |
//   | warning_light | check_engine_light | check_engine_light_testing |
//   | warning_light | engine_temperature_light | coolant_leak_testing, check_engine_light_testing |
//   | warning_light | brake_system_red_light | brake_inspection_warning_light |
//   | warning_light | multiple_warning_lights_at_once | warning_light_general |
//   | warning_light | something_unmapped |  |     ← blank cell = CLEAR mapping
//
// Validation rules (BLOCK apply):
//   - category ∈ 14 canonical concern category slugs
//   - subcategory_slug + category must exist in concern_subcategories (active)
//   - duplicate (category, subcategory_slug) in same upload → block
//   - every testing_service_key must exist in testing_services (active)
//
// Diff semantics:
//   - Rows NOT mentioned in the MD are LEFT ALONE (no silent clear).
//   - Rows mentioned with a blank/empty/"(none)" cell are CLEARED (set to '{}').
//   - Rows mentioned with a non-empty cell get their array REPLACED with
//     the listed service_keys (in MD order, de-duped).
//
// Two-step dry_run + confirm_token apply, mirrors the V2 catalog
// uploaders. Same audit log table (scheduler_admin_audit_log) with
// table_name='concern_subcategories' + operation='upload_md'.
// ═══════════════════════════════════════════════════════════════════════

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
      await _logAudit(sb, {
        audit,
        table_name: tableName,
        operation: "upload_md",
        md_content_hash: hash,
        error_message: msg,
      });
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
      await _logAudit(sb, {
        audit,
        table_name: tableName,
        operation: "upload_md",
        md_content_hash: hash,
        error_message: msg,
      });
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
      await _logAudit(sb, {
        audit,
        table_name: tableName,
        operation: "upload_md",
        md_content_hash: hash,
        error_message: msg,
      });
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
      await _logAudit(sb, {
        audit,
        table_name: tableName,
        operation: "upload_md",
        md_content_hash: hash,
        error_message: msg,
      });
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
      await _logAudit(sb, {
        audit,
        table_name: tableName,
        operation: "upload_md",
        md_content_hash: hash,
        error_message: msg,
      });
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
      await _logAudit(sb, {
        audit,
        table_name: tableName,
        operation: "upload_md",
        md_content_hash: hash,
        error_message: msg,
      });
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

  const diffSummary: Record<string, unknown> = {
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

  // ── Capture pre_state_snapshot
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
  const snapshot = { before: snapshotBefore, added_keys: [] as string[] };

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

  // ── Audit
  const audit_log_id = await _logAudit(sb, {
    audit,
    table_name: tableName,
    operation: "upload_md",
    rows_added: 0,
    rows_modified: diffEntries.length,
    rows_deactivated: 0,
    md_content_hash: hash,
    diff_summary: diffSummary,
    pre_state_snapshot: applyError ? null : snapshot,
    error_message: applyError ?? undefined,
  });

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

function arraysEqualAsSets(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const v of b) if (!setA.has(v)) return false;
  return true;
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

    if (line === "" || line.startsWith("<!--") || line.startsWith("---")) {
      // Bullets immediately under a `Positive/Negative examples:` header span
      // blank-free blocks; an explicit blank line terminates the list collection.
      collecting = null;
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
      await _logAudit(sb, { audit, table_name: tableName, operation: "upload_md", md_content_hash: hash, error_message: msg });
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
      await _logAudit(sb, { audit, table_name: tableName, operation: "upload_md", md_content_hash: hash, error_message: msg });
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
      await _logAudit(sb, { audit, table_name: tableName, operation: "upload_md", md_content_hash: hash, error_message: msg });
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
      await _logAudit(sb, { audit, table_name: tableName, operation: "upload_md", md_content_hash: hash, error_message: msg });
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

  const diffSummary: Record<string, unknown> = {
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

  // ── Capture pre_state_snapshot
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
  const snapshot = { before: snapshotBefore, added_keys: [] as string[] };

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

  const audit_log_id = await _logAudit(sb, {
    audit,
    table_name: tableName,
    operation: "upload_md",
    rows_added: 0,
    rows_modified: diffEntries.length,
    rows_deactivated: 0,
    md_content_hash: hash,
    diff_summary: diffSummary,
    pre_state_snapshot: applyError ? null : snapshot,
    error_message: applyError ?? undefined,
  });

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
      await _logAudit(sb, { audit, table_name: tableName, operation: "upload_md", md_content_hash: hash, error_message: msg });
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
      await _logAudit(sb, { audit, table_name: tableName, operation: "upload_md", md_content_hash: hash, error_message: msg });
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
      await _logAudit(sb, { audit, table_name: tableName, operation: "upload_md", md_content_hash: hash, error_message: msg });
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
      await _logAudit(sb, { audit, table_name: tableName, operation: "upload_md", md_content_hash: hash, error_message: msg });
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
      await _logAudit(sb, { audit, table_name: tableName, operation: "upload_md", md_content_hash: hash, error_message: msg });
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

  const diffSummary: Record<string, unknown> = {
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

  // ── Capture pre_state_snapshot
  const snapshotBefore: Record<string, { id: number; required_facts: string[] }> = {};
  for (const d of diffEntries) {
    snapshotBefore[`qid_${d.question_id}`] = { id: d.question_id, required_facts: d.before };
  }
  const snapshot = { before: snapshotBefore, added_keys: [] as string[] };

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

  const audit_log_id = await _logAudit(sb, {
    audit,
    table_name: tableName,
    operation: "upload_md",
    rows_added: 0,
    rows_modified: diffEntries.length,
    rows_deactivated: 0,
    md_content_hash: hash,
    diff_summary: diffSummary,
    pre_state_snapshot: applyError ? null : snapshot,
    error_message: applyError ?? undefined,
  });

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
