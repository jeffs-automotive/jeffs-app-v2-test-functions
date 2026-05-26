// Admin tool functions for the scheduler MD-upload + maintenance workflow.
//
// Per chat-design.md "MD-upload pattern" + scheduler_phase1_design_lock.md
// 2026-05-13. Service advisors edit the predefined-data tables by uploading
// markdown files; the tools here parse, diff against current DB state,
// apply changes, and log to scheduler_admin_audit_log.
//
// Tables covered:
//   - routine_services
//   - testing_services
//   - concern_questions
//   - appointment_default_limits
//   - closed_dates
//
// Helper tools also exposed here:
//   - runAppointmentsSync   — on-demand call to the appointments-sync function
//   - findOrphanCustomers   — locally-cached customers Tekmetric has deleted
//
// Audit: every successful upload writes ONE row to scheduler_admin_audit_log
// with the md_content_hash + structured diff_summary JSONB. Re-uploading
// the same MD content fast-paths to a no-op (caught via the hash).
//
// ─── scheduler-edge-parity E5 (2026-05-26) ──────────────────────────────
// The 5 LEGACY uploaders below have been refactored to Pattern S per
// PLAN §4.1-4.5. Each two-step:
//   1. dry_run mode (default TRUE) — parse + validate + diff + compute
//      confirm_token; NO writes; returns preview.
//   2. apply mode (dry_run=false + expected_confirm_token) — delegates the
//      apply phase to the per-kind apply_<table>_upload plpgsql RPC
//      (migration 20260526000500). The apply RPC takes the surface lock,
//      re-verifies canonical state + token, performs mutations, and writes
//      the audit row atomically.
//
// Audit-log inserts in this file ALL go through the consolidated
// `logAuditEntry` helper in scheduler-admin-md.ts (requires shopId per E2).
// The historical local `logAdminAudit` helper has been DELETED (see comment
// at end of file).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import {
  coerceBool,
  coerceCsvArray,
  coerceDate,
  coerceInt,
  coerceOptions,
  computeCanonicalAfterState,
  computeConfirmToken,
  formatPriceCents,
  logAuditEntry,
  mdTableFromRows,
  parseBool as parseBoolField,
  parseConcernCategoryGuidelineMd,
  parseConcernCategoryMd,
  parseCsvList,
  parseIntField,
  parseMdSections,
  parseMdTable,
  parsePriceCents,
  parseStringField,
  serializeMdSections,
  sha256Hex,
  slugifyForConcernSubcategory,
  type ParsedConcernSubcategory,
  type ParsedMdSection,
  type SectionSpec,
  type SnapshotKind,
} from "../scheduler-admin-md.ts";

// NOTE: catalog-uploader helpers (CONCERN_CATEGORY_SLUGS Set form,
// MAX_DESCRIPTION_LEN, etc.) live in ./scheduler-admin-catalog.ts where the
// service-catalog uploaders moved during the d62447f Option B refactor.
// The legacy concern-category uploaders in THIS file use the array form of
// CONCERN_CATEGORY_SLUGS declared near the bottom (search ConcernCategorySlug).

export interface ValidationFinding {
  /** Either a service_key (Option B) or a row_index (Option A legacy). */
  key: string;
  field: string;
  level: "error" | "warning";
  message: string;
}

// ─── Shared types ───────────────────────────────────────────────────────────

export interface AdminAudit {
  oauth_client_id: string;
  display_name: string;
}

export interface UploadResult {
  ok: boolean;
  table_name: string;
  md_content_hash: string;
  rows_parsed: number;
  rows_added: number;
  rows_modified: number;
  rows_deactivated: number;
  duplicate_upload?: boolean;
  parse_errors?: Array<{ line_number: number; message: string }>;
  validation_errors?: Array<{ row_index: number; field: string; message: string }>;
  /** Soft warnings (e.g. price moved >50%, service being removed). Surface to advisor for review even on dry_run apply. */
  validation_warnings?: ValidationFinding[];
  diff_summary?: Record<string, unknown>;
  /** When dry_run=true, the call did NOT write to DB. Advisor must call again with dry_run=false + confirm_token to apply. */
  dry_run?: boolean;
  /** Returned from dry_run; must be passed back unchanged on the apply call. */
  confirm_token?: string;
  /** Set on a successful apply — the audit-log row id, usable with revert_md_upload. */
  audit_log_id?: number;
  /** Set on apply-mode RPC failures — canonical reason_code per ADR-007. */
  reason_code?: string;
  /** Per ADR-002 attempt_id — only populated by revert paths; null for apply paths since apply RPCs don't write attempt rows. */
  attempt_id?: number | null;
  error_message?: string;
}

// ─── Internal helper — error-path audit row insert ──────────────────────────
//
// Mirrors the pattern in scheduler-admin-catalog.ts:_logAuditError. Used for
// the (PARSE FAIL / VALIDATE FAIL / FETCH FAIL) error paths only. Happy-path
// audit row inserts go inline through logAuditEntry() so the snapshot +
// diff_summary + rows_* counts stay adjacent to the data they describe.
//
// Critically: this helper is only called when `!dry_run`. dry-run failures
// return the failure result without writing an audit row (matching the V2
// catalog pattern — no DB side-effects on dry-run).

async function _logAuditError(
  sb: SupabaseClient,
  shopId: number,
  audit: AdminAudit,
  tableName: string,
  hash: string,
  errorMessage: string,
): Promise<void> {
  await logAuditEntry({
    supabase: sb,
    shopId,
    oauthClientId: audit.oauth_client_id,
    userLabel: audit.display_name,
    tableName,
    operation: "upload_md",
    mdContentHash: hash,
    errorMessage,
  });
}

// ─── Apply-RPC error classifier (mirrors ADR-008 outer classifier) ─────────
//
// The 5 apply RPCs RAISE EXCEPTION with one of the canonical prefixes per
// ADR-007. Parse the SQLERRM and classify into a reason_code. NEVER throws —
// returns an opaque "rpc_failed" fallback so the audit trail still surfaces.

function classifyApplyRpcError(
  errorMessage: string | null | undefined,
): { reason_code: string; sanitized: string } {
  const msg = errorMessage ?? "";

  if (msg.includes("staleness_check_failed:")) {
    return {
      reason_code: "current_state_drift",
      sanitized:
        "DB state diverged since the prior dry_run. Re-run dry_run for a fresh confirm_token, present the new diff to the advisor, then re-apply.",
    };
  }
  if (msg.includes("confirm_token_mismatch:")) {
    return {
      reason_code: "confirm_token_mismatch",
      sanitized:
        "confirm_token mismatch — DB state or MD content changed since dry_run, OR a different actor/category/today was used. Re-run dry_run for a fresh token.",
    };
  }
  if (msg.includes("revert_blocked: snapshot_invalid:")) {
    return {
      reason_code: "snapshot_invalid",
      sanitized:
        "snapshot_invalid — apply RPC rejected p_audit/p_diff/p_snapshot input shape. This is a bug in the orchestrator-mcp call, NOT a user error.",
    };
  }
  if (msg.includes("revert_blocked: cross_shop_hijack_attempt:")) {
    return {
      reason_code: "cross_shop_hijack_attempt",
      sanitized:
        "cross_shop_hijack_attempt — apply RPC rejected a request where p_shop_id did not match the row's tenant scope.",
    };
  }
  if (msg.includes("revert_blocked: fk_target_tenant_mismatch:") ||
      msg.includes("revert_blocked: fk_broken:")) {
    return {
      reason_code: "fk_broken",
      sanitized:
        "fk_broken — apply RPC raised a foreign-key violation. A referenced row may have been deleted concurrently, or the diff payload references a row owned by another tenant.",
    };
  }
  // Generic fallback — surfaces the raw message minimally (the apply RPC
  // already sanitizes user-facing prefixes).
  return {
    reason_code: "rpc_failed",
    sanitized: msg || "apply RPC returned an error with no message",
  };
}

// ─── Duplicate-upload short-circuit ─────────────────────────────────────────

/**
 * Check whether the SAME md_content_hash was already uploaded for this
 * table. If so, return a duplicate_upload=true short-circuit result so the
 * advisor knows their file didn't change. Safe on BOTH dry_run + apply
 * (does no writes either way per research-03 §4.1).
 */
async function checkDuplicate(
  sb: SupabaseClient,
  tableName: string,
  hash: string,
): Promise<boolean> {
  const { data } = await sb
    .from("scheduler_admin_audit_log")
    .select("id")
    .eq("table_name", tableName)
    .eq("operation", "upload_md")
    .eq("md_content_hash", hash)
    .is("error_message", null)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return !!data;
}

// ─── routine_services ───────────────────────────────────────────────────────

const ROUTINE_COLUMNS = [
  "service_key",
  "display_name",
  "abbreviation",
  "display_order",
  "wait_eligible",
  "requires_explanation",
  "active",
];

export async function uploadRoutineServicesMd(
  sb: SupabaseClient,
  shopId: number,
  args: { md_content: string; audit: AdminAudit },
): Promise<UploadResult> {
  const tableName = "routine_services";
  const hash = await sha256Hex(args.md_content);

  if (await checkDuplicate(sb, tableName, hash)) {
    return {
      ok: true,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      duplicate_upload: true,
    };
  }

  let parsed;
  try {
    parsed = parseMdTable(args.md_content);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await _logAuditError(sb, shopId, args.audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      error_message: msg,
    };
  }

  // Validate column set
  const missingColumns = ROUTINE_COLUMNS.filter(
    (c) => !parsed.table.headers.includes(c),
  );
  if (missingColumns.length > 0) {
    const msg = `missing required columns: ${missingColumns.join(", ")}`;
    await _logAuditError(sb, shopId, args.audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      error_message: msg,
    };
  }

  // Validate each row + coerce
  const validationErrors: UploadResult["validation_errors"] = [];
  const validRows: Array<{
    service_key: string;
    display_name: string;
    abbreviation: string;
    display_order: number;
    wait_eligible: boolean;
    requires_explanation: boolean;
    active: boolean;
  }> = [];
  parsed.table.rows.forEach((r, idx) => {
    const order = coerceInt(r.display_order);
    const wait = coerceBool(r.wait_eligible);
    const req = coerceBool(r.requires_explanation);
    const active = coerceBool(r.active);
    if (!r.service_key) {
      validationErrors.push({ row_index: idx, field: "service_key", message: "blank" });
      return;
    }
    if (!r.display_name) {
      validationErrors.push({ row_index: idx, field: "display_name", message: "blank" });
      return;
    }
    if (!r.abbreviation) {
      validationErrors.push({ row_index: idx, field: "abbreviation", message: "blank" });
      return;
    }
    if (order === null) {
      validationErrors.push({ row_index: idx, field: "display_order", message: "not an integer" });
      return;
    }
    if (wait === null) {
      validationErrors.push({ row_index: idx, field: "wait_eligible", message: "not a boolean" });
      return;
    }
    if (req === null) {
      validationErrors.push({ row_index: idx, field: "requires_explanation", message: "not a boolean" });
      return;
    }
    if (active === null) {
      validationErrors.push({ row_index: idx, field: "active", message: "not a boolean" });
      return;
    }
    validRows.push({
      service_key: r.service_key,
      display_name: r.display_name,
      abbreviation: r.abbreviation,
      display_order: order,
      wait_eligible: wait,
      requires_explanation: req,
      active,
    });
  });

  if (validRows.length === 0) {
    const msg = `no valid rows (${validationErrors.length} validation errors)`;
    await _logAuditError(sb, shopId, args.audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      parse_errors: parsed.errors,
      validation_errors: validationErrors,
      error_message: msg,
    };
  }

  // Fetch current state
  const { data: currentRows, error: fetchErr } = await sb
    .from("routine_services")
    .select(
      "service_key, display_name, abbreviation, display_order, wait_eligible, requires_explanation, active",
    )
    .eq("shop_id", shopId);
  if (fetchErr) {
    const msg = `current-state fetch failed: ${fetchErr.message}`;
    await _logAuditError(sb, shopId, args.audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      error_message: msg,
    };
  }

  const currentByKey = new Map<string, typeof currentRows[number]>();
  for (const row of currentRows ?? []) {
    currentByKey.set(row.service_key as string, row);
  }
  const uploadedKeys = new Set(validRows.map((r) => r.service_key));

  // Build the diff
  const adds: string[] = [];
  const mods: Array<{ service_key: string; before: unknown; after: unknown }> = [];
  const deactivates: string[] = [];

  for (const row of validRows) {
    const current = currentByKey.get(row.service_key);
    if (!current) {
      adds.push(row.service_key);
    } else if (
      current.display_name !== row.display_name ||
      current.abbreviation !== row.abbreviation ||
      current.display_order !== row.display_order ||
      current.wait_eligible !== row.wait_eligible ||
      current.requires_explanation !== row.requires_explanation ||
      current.active !== row.active
    ) {
      mods.push({ service_key: row.service_key, before: current, after: row });
    }
  }
  for (const [key, row] of currentByKey) {
    if (!uploadedKeys.has(key) && row.active) {
      deactivates.push(key);
    }
  }

  // Apply
  let applyError: string | null = null;
  try {
    if (adds.length > 0 || mods.length > 0) {
      const upsertRows = validRows.map((r) => ({ ...r, shop_id: shopId }));
      const { error: upsertErr } = await sb
        .from("routine_services")
        .upsert(upsertRows, { onConflict: "shop_id,service_key" });
      if (upsertErr) throw new Error(`upsert failed: ${upsertErr.message}`);
    }
    if (deactivates.length > 0) {
      const { error: deactErr } = await sb
        .from("routine_services")
        .update({ active: false })
        .eq("shop_id", shopId)
        .in("service_key", deactivates);
      if (deactErr) throw new Error(`deactivate failed: ${deactErr.message}`);
    }
  } catch (e) {
    applyError = e instanceof Error ? e.message : String(e);
  }

  const diffSummary = {
    added: adds,
    modified: mods.map((m) => m.service_key),
    deactivated: deactivates,
  };

  await logAuditEntry({
    supabase: sb,
    shopId,
    oauthClientId: args.audit.oauth_client_id,
    userLabel: args.audit.display_name,
    tableName,
    operation: "upload_md",
    rowsAdded: adds.length,
    rowsModified: mods.length,
    rowsDeactivated: deactivates.length,
    mdContentHash: hash,
    diffSummary,
    errorMessage: applyError ?? undefined,
  });

  if (applyError) {
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      validation_errors: validationErrors,
      error_message: applyError,
    };
  }

  return {
    ok: true,
    table_name: tableName,
    md_content_hash: hash,
    rows_parsed: parsed.table.rows.length,
    rows_added: adds.length,
    rows_modified: mods.length,
    rows_deactivated: deactivates.length,
    parse_errors: parsed.errors.length > 0 ? parsed.errors : undefined,
    validation_errors: validationErrors.length > 0 ? validationErrors : undefined,
    diff_summary: diffSummary,
  };
}

export async function exportRoutineServicesMd(
  sb: SupabaseClient,
  shopId: number,
): Promise<{ md_content: string; row_count: number }> {
  const { data, error } = await sb
    .from("routine_services")
    .select(
      "service_key, display_name, abbreviation, display_order, wait_eligible, requires_explanation, active",
    )
    .eq("shop_id", shopId)
    .order("display_order", { ascending: true });
  if (error) throw new Error(`routine_services export failed: ${error.message}`);
  const md = mdTableFromRows(
    {
      title: "Routine Services Catalog",
      columns: [
        { name: "service_key", description: "Unique key per shop; never reused" },
        { name: "display_name", description: "Picker chip label shown to customers" },
        { name: "abbreviation", description: "≤8-char Tekmetric appointment-title fragment" },
        { name: "display_order", description: "Integer; lower = earlier in picker" },
        { name: "wait_eligible", description: "true/false — can be done while customer waits" },
        { name: "requires_explanation", description: "true/false — kicks off §7.2 concern explanation flow" },
        { name: "active", description: "true/false — uncheck to soft-delete (preserves history)" },
      ],
    },
    (data ?? []) as Record<string, unknown>[],
  );
  return { md_content: md, row_count: (data ?? []).length };
}

// ─── testing_services ───────────────────────────────────────────────────────

const TESTING_COLUMNS = [
  "service_key",
  "display_name",
  "abbreviation",
  "starting_price_cents",
  "notes",
  "concern_categories",
  "active",
];

export async function uploadTestingServicesMd(
  sb: SupabaseClient,
  shopId: number,
  args: { md_content: string; audit: AdminAudit },
): Promise<UploadResult> {
  const tableName = "testing_services";
  const hash = await sha256Hex(args.md_content);
  if (await checkDuplicate(sb, tableName, hash)) {
    return {
      ok: true,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      duplicate_upload: true,
    };
  }

  let parsed;
  try {
    parsed = parseMdTable(args.md_content);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await _logAuditError(sb, shopId, args.audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      error_message: msg,
    };
  }

  const missingColumns = TESTING_COLUMNS.filter(
    (c) => !parsed.table.headers.includes(c),
  );
  if (missingColumns.length > 0) {
    const msg = `missing required columns: ${missingColumns.join(", ")}`;
    await _logAuditError(sb, shopId, args.audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      error_message: msg,
    };
  }

  const validationErrors: UploadResult["validation_errors"] = [];
  const validRows: Array<{
    service_key: string;
    display_name: string;
    abbreviation: string;
    starting_price_cents: number;
    notes: string | null;
    concern_categories: string[];
    active: boolean;
  }> = [];
  parsed.table.rows.forEach((r, idx) => {
    const price = coerceInt(r.starting_price_cents);
    const active = coerceBool(r.active);
    if (!r.service_key) {
      validationErrors.push({ row_index: idx, field: "service_key", message: "blank" });
      return;
    }
    if (!r.display_name) {
      validationErrors.push({ row_index: idx, field: "display_name", message: "blank" });
      return;
    }
    if (!r.abbreviation) {
      validationErrors.push({ row_index: idx, field: "abbreviation", message: "blank" });
      return;
    }
    if (price === null || price < 0) {
      validationErrors.push({ row_index: idx, field: "starting_price_cents", message: "not a non-negative integer" });
      return;
    }
    if (active === null) {
      validationErrors.push({ row_index: idx, field: "active", message: "not a boolean" });
      return;
    }
    validRows.push({
      service_key: r.service_key,
      display_name: r.display_name,
      abbreviation: r.abbreviation,
      starting_price_cents: price,
      notes: r.notes ? r.notes : null,
      concern_categories: coerceCsvArray(r.concern_categories),
      active,
    });
  });

  if (validRows.length === 0) {
    const msg = `no valid rows (${validationErrors.length} validation errors)`;
    await _logAuditError(sb, shopId, args.audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      parse_errors: parsed.errors,
      validation_errors: validationErrors,
      error_message: msg,
    };
  }

  const { data: currentRows, error: fetchErr } = await sb
    .from("testing_services")
    .select(
      "service_key, display_name, abbreviation, starting_price_cents, notes, concern_categories, active",
    )
    .eq("shop_id", shopId);
  if (fetchErr) {
    const msg = `current-state fetch failed: ${fetchErr.message}`;
    await _logAuditError(sb, shopId, args.audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      error_message: msg,
    };
  }

  const currentByKey = new Map<string, typeof currentRows[number]>();
  for (const row of currentRows ?? []) {
    currentByKey.set(row.service_key as string, row);
  }
  const uploadedKeys = new Set(validRows.map((r) => r.service_key));

  const adds: string[] = [];
  const mods: string[] = [];
  const deactivates: string[] = [];

  for (const row of validRows) {
    const current = currentByKey.get(row.service_key);
    if (!current) {
      adds.push(row.service_key);
    } else if (
      current.display_name !== row.display_name ||
      current.abbreviation !== row.abbreviation ||
      current.starting_price_cents !== row.starting_price_cents ||
      (current.notes ?? null) !== row.notes ||
      JSON.stringify((current.concern_categories ?? []).sort()) !==
        JSON.stringify([...row.concern_categories].sort()) ||
      current.active !== row.active
    ) {
      mods.push(row.service_key);
    }
  }
  for (const [key, row] of currentByKey) {
    if (!uploadedKeys.has(key) && row.active) {
      deactivates.push(key);
    }
  }

  let applyError: string | null = null;
  try {
    if (adds.length > 0 || mods.length > 0) {
      const upsertRows = validRows.map((r) => ({ ...r, shop_id: shopId }));
      const { error: upsertErr } = await sb
        .from("testing_services")
        .upsert(upsertRows, { onConflict: "shop_id,service_key" });
      if (upsertErr) throw new Error(`upsert failed: ${upsertErr.message}`);
    }
    if (deactivates.length > 0) {
      const { error: deactErr } = await sb
        .from("testing_services")
        .update({ active: false })
        .eq("shop_id", shopId)
        .in("service_key", deactivates);
      if (deactErr) throw new Error(`deactivate failed: ${deactErr.message}`);
    }
  } catch (e) {
    applyError = e instanceof Error ? e.message : String(e);
  }

  const diffSummary = {
    added: adds,
    modified: mods,
    deactivated: deactivates,
  };

  await logAuditEntry({
    supabase: sb,
    shopId,
    oauthClientId: args.audit.oauth_client_id,
    userLabel: args.audit.display_name,
    tableName,
    operation: "upload_md",
    rowsAdded: adds.length,
    rowsModified: mods.length,
    rowsDeactivated: deactivates.length,
    mdContentHash: hash,
    diffSummary,
    errorMessage: applyError ?? undefined,
  });

  return {
    ok: !applyError,
    table_name: tableName,
    md_content_hash: hash,
    rows_parsed: parsed.table.rows.length,
    rows_added: adds.length,
    rows_modified: mods.length,
    rows_deactivated: deactivates.length,
    parse_errors: parsed.errors.length > 0 ? parsed.errors : undefined,
    validation_errors: validationErrors.length > 0 ? validationErrors : undefined,
    diff_summary: diffSummary,
    error_message: applyError ?? undefined,
  };
}

export async function exportTestingServicesMd(
  sb: SupabaseClient,
  shopId: number,
): Promise<{ md_content: string; row_count: number }> {
  const { data, error } = await sb
    .from("testing_services")
    .select(
      "service_key, display_name, abbreviation, starting_price_cents, notes, concern_categories, active",
    )
    .eq("shop_id", shopId)
    .order("service_key", { ascending: true });
  if (error) throw new Error(`testing_services export failed: ${error.message}`);
  const md = mdTableFromRows(
    {
      title: "Testing Services Catalog",
      columns: [
        { name: "service_key", description: "Unique key per shop" },
        { name: "display_name", description: "Customer-facing label" },
        { name: "abbreviation", description: "≤8-char Tekmetric title fragment" },
        { name: "starting_price_cents", description: "Integer cents (e.g. 4995 = $49.95). 'Starting' price; advisor caveat shown to customer" },
        { name: "notes", description: "Optional notes shown alongside price quote" },
        { name: "concern_categories", description: "Comma-separated concern categories that map to this service (must match the 14 valid categories)" },
        { name: "active", description: "true/false — uncheck to soft-delete" },
      ],
    },
    (data ?? []) as Record<string, unknown>[],
  );
  return { md_content: md, row_count: (data ?? []).length };
}

// ─── concern_questions (Pattern S — E5d) ────────────────────────────────────
//
// Refactored 2026-05-26 per PLAN §4.1 — snapshot_kind = 'concern_questions_flat'.
// Apply RPC: apply_concern_questions_flat_upload (migration 20260526000500).
// Snapshot shape: {before: {<id>: row}, added_keys: [<new_ids>]}.

const CONCERN_COLUMNS = [
  "category",
  "question_text",
  "options",
  "display_order",
  "active",
];

interface ConcernQuestionFlatRow {
  id: number;
  category: string;
  question_text: string;
  options: unknown;
  display_order: number;
  active: boolean;
  /** Preserved during MODIFY — apply_concern_questions_flat_upload UPDATEs
   *  every column; omitting subcategory_id / multi_select / required_facts
   *  would NULL/default them. Fetched + carried forward unchanged. */
  subcategory_id?: number | null;
  multi_select?: boolean | null;
  required_facts?: string[] | null;
}

export async function uploadConcernQuestionsMd(
  sb: SupabaseClient,
  shopId: number,
  args: {
    md_content: string;
    audit: AdminAudit;
    dry_run?: boolean;
    expected_confirm_token?: string;
  },
): Promise<UploadResult> {
  const tableName = "concern_questions";
  const { md_content, audit, dry_run = true, expected_confirm_token } = args;
  const hash = await sha256Hex(md_content);

  if (await checkDuplicate(sb, tableName, hash)) {
    return {
      ok: true,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      duplicate_upload: true,
      dry_run,
    };
  }

  // ── 1. Parse
  let parsed;
  try {
    parsed = parseMdTable(md_content);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: msg,
    };
  }

  const missingColumns = CONCERN_COLUMNS.filter(
    (c) => !parsed.table.headers.includes(c),
  );
  if (missingColumns.length > 0) {
    const msg = `missing required columns: ${missingColumns.join(", ")}`;
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: msg,
    };
  }

  const VALID_CATEGORIES = [
    "noise", "vibration", "pulling", "smell", "smoke", "leak",
    "warning_light", "performance", "electrical", "hvac", "brakes",
    "steering", "tires", "other",
  ];

  // ── 2. Validate rows
  const validationErrors: UploadResult["validation_errors"] = [];
  const validRows: Array<{
    category: string;
    question_text: string;
    options: Array<{ label: string; value: string }>;
    display_order: number;
    active: boolean;
  }> = [];
  parsed.table.rows.forEach((r, idx) => {
    const order = coerceInt(r.display_order);
    const active = coerceBool(r.active);
    const options = coerceOptions(r.options);
    if (!VALID_CATEGORIES.includes(r.category)) {
      validationErrors.push({
        row_index: idx,
        field: "category",
        message: `not one of: ${VALID_CATEGORIES.join(", ")}`,
      });
      return;
    }
    if (!r.question_text) {
      validationErrors.push({ row_index: idx, field: "question_text", message: "blank" });
      return;
    }
    if (options === null) {
      validationErrors.push({ row_index: idx, field: "options", message: "could not parse (use JSON or shorthand 'value:label; value2:label2')" });
      return;
    }
    if (order === null) {
      validationErrors.push({ row_index: idx, field: "display_order", message: "not an integer" });
      return;
    }
    if (active === null) {
      validationErrors.push({ row_index: idx, field: "active", message: "not a boolean" });
      return;
    }
    validRows.push({
      category: r.category,
      question_text: r.question_text,
      options,
      display_order: order,
      active,
    });
  });

  if (validRows.length === 0) {
    const msg = `no valid rows (${validationErrors.length} validation errors)`;
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      parse_errors: parsed.errors,
      validation_errors: validationErrors,
      dry_run,
      error_message: msg,
    };
  }

  // ── 3. Fetch current state — include subcategory_id / multi_select /
  // required_facts so MODIFIED rows preserve them through the apply RPC's
  // full-column UPDATE.
  const { data: currentRows, error: fetchErr } = await sb
    .from("concern_questions")
    .select(
      "id, category, question_text, options, display_order, active, subcategory_id, multi_select, required_facts",
    )
    .eq("shop_id", shopId);
  if (fetchErr) {
    const msg = `current-state fetch failed: ${fetchErr.message}`;
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: msg,
    };
  }

  const current = (currentRows ?? []) as unknown as ConcernQuestionFlatRow[];
  const currentByKey = new Map<string, ConcernQuestionFlatRow>();
  for (const row of current) {
    currentByKey.set(`${row.category}::${row.question_text}`, row);
  }
  const uploadedKeys = new Set(
    validRows.map((r) => `${r.category}::${r.question_text}`),
  );

  // ── 4. Compute diff (no writes)
  //   added:       new rows (no id; apply RPC INSERTs)
  //   modified:    rows with id + new values
  //   deactivated: ids to soft-delete
  const added: Array<Record<string, unknown>> = [];
  const modified: Array<Record<string, unknown>> = [];
  const deactivated: number[] = [];
  const snapshotBefore: Record<string, ConcernQuestionFlatRow> = {};

  for (const row of validRows) {
    const k = `${row.category}::${row.question_text}`;
    const existing = currentByKey.get(k);
    if (!existing) {
      added.push({
        category: row.category,
        question_text: row.question_text,
        options: row.options,
        display_order: row.display_order,
        active: row.active,
      });
    } else {
      const differs =
        JSON.stringify(existing.options) !== JSON.stringify(row.options) ||
        existing.display_order !== row.display_order ||
        existing.active !== row.active;
      if (differs) {
        // Apply RPC SETs every column — preserve subcategory_id / multi_select
        // / required_facts by passing existing values through unchanged (flat
        // MD format doesn't carry them).
        modified.push({
          id: existing.id,
          category: row.category,
          question_text: row.question_text,
          options: row.options,
          display_order: row.display_order,
          active: row.active,
          subcategory_id: existing.subcategory_id ?? null,
          multi_select: existing.multi_select ?? false,
          required_facts: existing.required_facts ?? null,
        });
        snapshotBefore[String(existing.id)] = existing;
      }
    }
  }
  for (const [key, row] of currentByKey) {
    if (!uploadedKeys.has(key) && row.active) {
      deactivated.push(row.id);
      snapshotBefore[String(row.id)] = row;
    }
  }

  // ── 5. Build snapshot (added_keys: [] until apply RPC runs; placeholder)
  const snapshotBase: Record<string, unknown> = {
    snapshot_kind: "concern_questions_flat",
    before: snapshotBefore,
    added_keys: [] as number[],
  };

  // ── 6. Compute canonical-current state + hash
  // The TS-side canonical reads the CURRENT (pre-write) state. Hash must
  // match what apply_concern_questions_flat_upload computes at STEP 2 via
  // canonical_state_concern_questions_flat(p_shop_id, p_snapshot) — which
  // reads the SAME table for the SAME shop, regardless of snapshot content
  // for this kind. Per ADR-025 byte-parity contract.
  let expectedCurrentHash: string;
  let canonicalCurrent: string;
  try {
    canonicalCurrent = await computeCanonicalAfterState({
      kind: "concern_questions_flat",
      supabase: sb,
      shopId,
      snapshot: snapshotBase,
    });
    expectedCurrentHash = await sha256Hex(canonicalCurrent);
  } catch (e) {
    const msg = `canonical_state_concern_questions_flat compute failed: ${e instanceof Error ? e.message : String(e)}`;
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      validation_errors: validationErrors.length > 0 ? validationErrors : undefined,
      dry_run,
      error_message: msg,
    };
  }

  // ── 7. Compute confirm_token via E2 helper (mirrors apply RPC formula)
  const confirm_token = await computeConfirmToken({
    shopId,
    kind: "concern_questions_flat",
    expectedCurrentHash,
    mdContentHash: hash,
    actorEmail: audit.display_name,
  });

  // ── 8. Build diff_summary
  const diffSummary: Record<string, unknown> = {
    surfaces: ["concern_questions"],
    added: added.map((a) => `${a.category}::${a.question_text}`),
    modified: modified.map((m) => `${m.category}::${m.question_text}`),
    deactivated_ids: deactivated,
    unchanged_count: current.length - modified.length - deactivated.length,
  };

  // ── 9. Dry-run path — return preview, NO writes
  if (dry_run) {
    return {
      ok: true,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
      rows_added: added.length,
      rows_modified: modified.length,
      rows_deactivated: deactivated.length,
      parse_errors: parsed.errors.length > 0 ? parsed.errors : undefined,
      validation_errors: validationErrors.length > 0 ? validationErrors : undefined,
      diff_summary: diffSummary,
      dry_run: true,
      confirm_token,
    };
  }

  // ── 10. Apply mode — call apply_concern_questions_flat_upload RPC
  const pAudit: Record<string, unknown> = {
    actor_email: audit.display_name,
    oauth_client_id: audit.oauth_client_id,
    md_content_hash: hash,
    expected_current_hash: expectedCurrentHash,
    expected_confirm_token: expected_confirm_token ?? null,
    dry_run: false,
  };
  const pDiff: Record<string, unknown> = {
    added,
    modified,
    deactivated,
  };

  const { data: auditLogId, error: rpcErr } = await sb.rpc(
    "apply_concern_questions_flat_upload",
    {
      p_shop_id: shopId,
      p_snapshot: snapshotBase,
      p_diff: pDiff,
      p_audit: pAudit,
    },
  );

  if (rpcErr) {
    const { reason_code, sanitized } = classifyApplyRpcError(rpcErr.message);
    console.warn(JSON.stringify({
      level: "warning",
      msg: "apply_concern_questions_flat_upload_failed",
      shop_id: shopId,
      reason_code,
      detail: rpcErr.message,
    }));
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      validation_errors: validationErrors.length > 0 ? validationErrors : undefined,
      diff_summary: diffSummary,
      dry_run: false,
      confirm_token,
      reason_code,
      attempt_id: null,
      error_message: sanitized,
    };
  }

  return {
    ok: true,
    table_name: tableName,
    md_content_hash: hash,
    rows_parsed: parsed.table.rows.length,
    rows_added: added.length,
    rows_modified: modified.length,
    rows_deactivated: deactivated.length,
    parse_errors: parsed.errors.length > 0 ? parsed.errors : undefined,
    validation_errors: validationErrors.length > 0 ? validationErrors : undefined,
    diff_summary: diffSummary,
    dry_run: false,
    confirm_token,
    audit_log_id: (auditLogId as number | null) ?? undefined,
  };
}

export async function exportConcernQuestionsMd(
  sb: SupabaseClient,
  shopId: number,
): Promise<{ md_content: string; row_count: number }> {
  const { data, error } = await sb
    .from("concern_questions")
    .select("category, question_text, options, display_order, active")
    .eq("shop_id", shopId)
    .order("category", { ascending: true })
    .order("display_order", { ascending: true });
  if (error) throw new Error(`concern_questions export failed: ${error.message}`);
  const md = mdTableFromRows(
    {
      title: "Concern Clarification Questions",
      columns: [
        { name: "category", description: "One of 14: noise, vibration, pulling, smell, smoke, leak, warning_light, performance, electrical, hvac, brakes, steering, tires, other" },
        { name: "question_text", description: "Customer-facing question text" },
        { name: "options", description: "Multiple-choice options. Shorthand: 'value:label; value2:label2' OR JSON: '[{\"label\":\"X\",\"value\":\"x\"}]'" },
        { name: "display_order", description: "Integer; lower = asked earlier" },
        { name: "active", description: "true/false — uncheck to soft-delete" },
      ],
    },
    (data ?? []) as Record<string, unknown>[],
  );
  return { md_content: md, row_count: (data ?? []).length };
}

// ─── appointment_default_limits (Pattern S — E5b) ──────────────────────────
//
// Refactored 2026-05-26 per PLAN §4.4 — snapshot_kind = 'appointment_default_limits'.
// Apply RPC: apply_appointment_default_limits_upload (migration 20260526000500).
// Composite PK (shop_id, day_of_week) per E1cf-N1.
// Snapshot keys are day_of_week integers 0..6.
// Snapshot shape: {before: {<dow>: row}, added_keys: []}.
// "Omitting a day_of_week from MD = leave alone" semantics (no soft-delete on
// omission) per research-03 §148 + §316.

const LIMITS_COLUMNS = [
  "day_of_week",
  "is_closed",
  "waiter_8am_slots",
  "waiter_9am_slots",
  "dropoff_total",
  "notes",
];

interface AppointmentDefaultLimitRow {
  day_of_week: number;
  is_closed: boolean;
  waiter_8am_slots: number;
  waiter_9am_slots: number;
  dropoff_total: number;
  notes: string | null;
}

export async function uploadAppointmentDefaultLimitsMd(
  sb: SupabaseClient,
  shopId: number,
  args: {
    md_content: string;
    audit: AdminAudit;
    dry_run?: boolean;
    expected_confirm_token?: string;
  },
): Promise<UploadResult> {
  const tableName = "appointment_default_limits";
  const { md_content, audit, dry_run = true, expected_confirm_token } = args;
  const hash = await sha256Hex(md_content);

  if (await checkDuplicate(sb, tableName, hash)) {
    return {
      ok: true,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      duplicate_upload: true,
      dry_run,
    };
  }

  let parsed;
  try {
    parsed = parseMdTable(md_content);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: msg,
    };
  }

  const missingColumns = LIMITS_COLUMNS.filter(
    (c) => !parsed.table.headers.includes(c),
  );
  if (missingColumns.length > 0) {
    const msg = `missing required columns: ${missingColumns.join(", ")}`;
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: msg,
    };
  }

  const validationErrors: UploadResult["validation_errors"] = [];
  const validRows: AppointmentDefaultLimitRow[] = [];
  parsed.table.rows.forEach((r, idx) => {
    const dow = coerceInt(r.day_of_week);
    const closed = coerceBool(r.is_closed);
    const w8 = coerceInt(r.waiter_8am_slots);
    const w9 = coerceInt(r.waiter_9am_slots);
    const drop = coerceInt(r.dropoff_total);
    if (dow === null || dow < 0 || dow > 6) {
      validationErrors.push({ row_index: idx, field: "day_of_week", message: "must be integer 0-6 (0=Sunday)" });
      return;
    }
    if (closed === null) {
      validationErrors.push({ row_index: idx, field: "is_closed", message: "not a boolean" });
      return;
    }
    if (w8 === null || w8 < 0) {
      validationErrors.push({ row_index: idx, field: "waiter_8am_slots", message: "not a non-negative integer" });
      return;
    }
    if (w9 === null || w9 < 0) {
      validationErrors.push({ row_index: idx, field: "waiter_9am_slots", message: "not a non-negative integer" });
      return;
    }
    if (drop === null || drop < 0) {
      validationErrors.push({ row_index: idx, field: "dropoff_total", message: "not a non-negative integer" });
      return;
    }
    validRows.push({
      day_of_week: dow,
      is_closed: closed,
      waiter_8am_slots: w8,
      waiter_9am_slots: w9,
      dropoff_total: drop,
      notes: r.notes ? r.notes : null,
    });
  });

  if (validRows.length === 0) {
    const msg = `no valid rows (${validationErrors.length} validation errors)`;
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      parse_errors: parsed.errors,
      validation_errors: validationErrors,
      dry_run,
      error_message: msg,
    };
  }

  // Fetch current state
  const { data: currentRows, error: fetchErr } = await sb
    .from("appointment_default_limits")
    .select("day_of_week, is_closed, waiter_8am_slots, waiter_9am_slots, dropoff_total, notes")
    .eq("shop_id", shopId);
  if (fetchErr) {
    const msg = `current-state fetch failed: ${fetchErr.message}`;
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: msg,
    };
  }

  const current = (currentRows ?? []) as unknown as AppointmentDefaultLimitRow[];
  const currentByDow = new Map<number, AppointmentDefaultLimitRow>();
  for (const row of current) {
    currentByDow.set(row.day_of_week, row);
  }

  // Compute diff — composite-PK keyed on day_of_week (0..6 integer).
  // Per research-03 + PLAN §4.4: omitting a day_of_week = leave alone
  // (NO soft-delete on omission).
  const added: Array<Record<string, unknown>> = [];
  const modified: Array<Record<string, unknown>> = [];
  const snapshotBefore: Record<string, AppointmentDefaultLimitRow> = {};

  for (const row of validRows) {
    const existing = currentByDow.get(row.day_of_week);
    if (!existing) {
      added.push({
        day_of_week: row.day_of_week,
        is_closed: row.is_closed,
        waiter_8am_slots: row.waiter_8am_slots,
        waiter_9am_slots: row.waiter_9am_slots,
        dropoff_total: row.dropoff_total,
        notes: row.notes,
      });
    } else if (
      existing.is_closed !== row.is_closed ||
      existing.waiter_8am_slots !== row.waiter_8am_slots ||
      existing.waiter_9am_slots !== row.waiter_9am_slots ||
      existing.dropoff_total !== row.dropoff_total ||
      (existing.notes ?? null) !== row.notes
    ) {
      modified.push({
        day_of_week: row.day_of_week,
        is_closed: row.is_closed,
        waiter_8am_slots: row.waiter_8am_slots,
        waiter_9am_slots: row.waiter_9am_slots,
        dropoff_total: row.dropoff_total,
        notes: row.notes,
      });
      snapshotBefore[String(row.day_of_week)] = existing;
    }
  }

  const snapshotBase: Record<string, unknown> = {
    snapshot_kind: "appointment_default_limits",
    before: snapshotBefore,
    added_keys: [] as number[],
  };

  // Canonical-current + hash
  let expectedCurrentHash: string;
  try {
    const canonicalCurrent = await computeCanonicalAfterState({
      kind: "appointment_default_limits",
      supabase: sb,
      shopId,
      snapshot: snapshotBase,
    });
    expectedCurrentHash = await sha256Hex(canonicalCurrent);
  } catch (e) {
    const msg = `canonical_state_appointment_default_limits compute failed: ${e instanceof Error ? e.message : String(e)}`;
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      validation_errors: validationErrors.length > 0 ? validationErrors : undefined,
      dry_run,
      error_message: msg,
    };
  }

  // confirm_token via E2 helper
  const confirm_token = await computeConfirmToken({
    shopId,
    kind: "appointment_default_limits",
    expectedCurrentHash,
    mdContentHash: hash,
    actorEmail: audit.display_name,
  });

  const diffSummary: Record<string, unknown> = {
    surfaces: ["appointment_default_limits"],
    added: added.map((a) => a.day_of_week),
    modified: modified.map((m) => m.day_of_week),
  };

  // Dry-run path
  if (dry_run) {
    return {
      ok: true,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
      rows_added: added.length,
      rows_modified: modified.length,
      rows_deactivated: 0,
      parse_errors: parsed.errors.length > 0 ? parsed.errors : undefined,
      validation_errors: validationErrors.length > 0 ? validationErrors : undefined,
      diff_summary: diffSummary,
      dry_run: true,
      confirm_token,
    };
  }

  // Apply mode — call apply_appointment_default_limits_upload RPC
  const pAudit: Record<string, unknown> = {
    actor_email: audit.display_name,
    oauth_client_id: audit.oauth_client_id,
    md_content_hash: hash,
    expected_current_hash: expectedCurrentHash,
    expected_confirm_token: expected_confirm_token ?? null,
    dry_run: false,
  };
  const pDiff: Record<string, unknown> = { added, modified };

  const { data: auditLogId, error: rpcErr } = await sb.rpc(
    "apply_appointment_default_limits_upload",
    {
      p_shop_id: shopId,
      p_snapshot: snapshotBase,
      p_diff: pDiff,
      p_audit: pAudit,
    },
  );

  if (rpcErr) {
    const { reason_code, sanitized } = classifyApplyRpcError(rpcErr.message);
    console.warn(JSON.stringify({
      level: "warning",
      msg: "apply_appointment_default_limits_upload_failed",
      shop_id: shopId,
      reason_code,
      detail: rpcErr.message,
    }));
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      validation_errors: validationErrors.length > 0 ? validationErrors : undefined,
      diff_summary: diffSummary,
      dry_run: false,
      confirm_token,
      reason_code,
      attempt_id: null,
      error_message: sanitized,
    };
  }

  return {
    ok: true,
    table_name: tableName,
    md_content_hash: hash,
    rows_parsed: parsed.table.rows.length,
    rows_added: added.length,
    rows_modified: modified.length,
    rows_deactivated: 0,
    parse_errors: parsed.errors.length > 0 ? parsed.errors : undefined,
    validation_errors: validationErrors.length > 0 ? validationErrors : undefined,
    diff_summary: diffSummary,
    dry_run: false,
    confirm_token,
    audit_log_id: (auditLogId as number | null) ?? undefined,
  };
}

export async function exportAppointmentDefaultLimitsMd(
  sb: SupabaseClient,
  shopId: number,
): Promise<{ md_content: string; row_count: number }> {
  const { data, error } = await sb
    .from("appointment_default_limits")
    .select("day_of_week, is_closed, waiter_8am_slots, waiter_9am_slots, dropoff_total, notes")
    .eq("shop_id", shopId)
    .order("day_of_week", { ascending: true });
  if (error) throw new Error(`appointment_default_limits export failed: ${error.message}`);
  const md = mdTableFromRows(
    {
      title: "Appointment Default Capacity Limits",
      columns: [
        { name: "day_of_week", description: "0=Sunday, 1=Monday, ..., 6=Saturday" },
        { name: "is_closed", description: "true/false — closed-all-day overrides everything else" },
        { name: "waiter_8am_slots", description: "Integer ≥0 — capacity for 8:00 AM waiter slot" },
        { name: "waiter_9am_slots", description: "Integer ≥0 — capacity for 9:00 AM waiter slot" },
        { name: "dropoff_total", description: "Integer ≥0 — total dropoff capacity for the day" },
        { name: "notes", description: "Optional comment for shop reference (not customer-visible)" },
      ],
    },
    (data ?? []) as Record<string, unknown>[],
  );
  return { md_content: md, row_count: (data ?? []).length };
}

// ─── closed_dates (Pattern S — E5c) ─────────────────────────────────────────
//
// Refactored 2026-05-26 per PLAN §4.5 — snapshot_kind = 'closed_dates_future'.
// Apply RPC: apply_closed_dates_upload (migration 20260526000500).
// Snapshot shape: {before: {<closed_date>: row}, added_keys: [<new_dates>],
//                  original_today: <YYYY-MM-DD>}.
// `original_today` is REQUIRED per ADR-013 — preserves past-closures-immutable
// invariant. The apply RPC takes per-date advisory locks (ADR-013) AFTER the
// surface lock (ADR-024).
//
// `today` is computed UTC here (matches legacy behavior). Future hardening
// will compute it in shop TZ Postgres-side via lock_surface_for_kind passing
// the shop's tz.

const CLOSED_COLUMNS = ["closed_date", "reason"];

export async function uploadClosedDatesMd(
  sb: SupabaseClient,
  shopId: number,
  args: {
    md_content: string;
    audit: AdminAudit;
    dry_run?: boolean;
    expected_confirm_token?: string;
  },
): Promise<UploadResult> {
  const tableName = "closed_dates";
  const { md_content, audit, dry_run = true, expected_confirm_token } = args;
  const hash = await sha256Hex(md_content);

  if (await checkDuplicate(sb, tableName, hash)) {
    return {
      ok: true,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      duplicate_upload: true,
      dry_run,
    };
  }

  let parsed;
  try {
    parsed = parseMdTable(md_content);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: msg,
    };
  }

  const missingColumns = CLOSED_COLUMNS.filter(
    (c) => !parsed.table.headers.includes(c),
  );
  if (missingColumns.length > 0) {
    const msg = `missing required columns: ${missingColumns.join(", ")}`;
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: msg,
    };
  }

  const validationErrors: UploadResult["validation_errors"] = [];
  const validRows: Array<{ closed_date: string; reason: string | null }> = [];
  parsed.table.rows.forEach((r, idx) => {
    const d = coerceDate(r.closed_date);
    if (d === null) {
      validationErrors.push({
        row_index: idx,
        field: "closed_date",
        message: "must be YYYY-MM-DD",
      });
      return;
    }
    validRows.push({
      closed_date: d,
      reason: r.reason ? r.reason : null,
    });
  });

  if (validRows.length === 0) {
    const msg = `no valid rows (${validationErrors.length} validation errors)`;
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      parse_errors: parsed.errors,
      validation_errors: validationErrors,
      dry_run,
      error_message: msg,
    };
  }

  // Compute original_today UTC (legacy behavior; matches existing uploader).
  // The apply RPC stores this in p_audit so future revert can derive the
  // SAME forward window for canonical byte-parity.
  const original_today = new Date().toISOString().slice(0, 10);

  // Fetch current FUTURE-only rows (past closures are immutable).
  // Filter past dates from validRows BEFORE diff so we don't generate
  // p_diff.added/modified entries that the apply RPC would reject.
  const futureValidRows = validRows.filter((r) => r.closed_date >= original_today);
  // Track any past dates that were in the MD (we just ignore them — past
  // closures are read-only history).
  const pastRowsIgnored = validRows.length - futureValidRows.length;

  const { data: currentRows, error: fetchErr } = await sb
    .from("closed_dates")
    .select("closed_date, reason, source")
    .eq("shop_id", shopId)
    .gte("closed_date", original_today);
  if (fetchErr) {
    const msg = `current-state fetch failed: ${fetchErr.message}`;
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: msg,
    };
  }

  type ClosedDateRow = { closed_date: string; reason: string | null; source: string | null };
  const current = (currentRows ?? []) as unknown as ClosedDateRow[];
  const currentByDate = new Map<string, ClosedDateRow>();
  for (const row of current) {
    currentByDate.set(row.closed_date, row);
  }
  const uploadedDates = new Set(futureValidRows.map((r) => r.closed_date));

  // Compute diff
  const added: Array<Record<string, unknown>> = [];
  const modified: Array<Record<string, unknown>> = [];
  const deactivated: string[] = [];
  const snapshotBefore: Record<string, ClosedDateRow> = {};

  for (const row of futureValidRows) {
    const existing = currentByDate.get(row.closed_date);
    if (!existing) {
      added.push({
        closed_date: row.closed_date,
        reason: row.reason,
        source: "admin",
      });
    } else if ((existing.reason ?? null) !== row.reason) {
      modified.push({
        closed_date: row.closed_date,
        reason: row.reason,
        source: existing.source ?? "admin",
      });
      snapshotBefore[row.closed_date] = existing;
    }
  }
  for (const [date, row] of currentByDate) {
    if (!uploadedDates.has(date)) {
      deactivated.push(date);
      snapshotBefore[date] = row;
    }
  }

  // Snapshot — original_today is REQUIRED for canonical scope per ADR-013.
  const snapshotBase: Record<string, unknown> = {
    snapshot_kind: "closed_dates_future",
    before: snapshotBefore,
    added_keys: [] as string[],
    original_today,
  };

  // Canonical-current + hash
  let expectedCurrentHash: string;
  try {
    const canonicalCurrent = await computeCanonicalAfterState({
      kind: "closed_dates_future",
      supabase: sb,
      shopId,
      snapshot: snapshotBase,
    });
    expectedCurrentHash = await sha256Hex(canonicalCurrent);
  } catch (e) {
    const msg = `canonical_state_closed_dates_future compute failed: ${e instanceof Error ? e.message : String(e)}`;
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      validation_errors: validationErrors.length > 0 ? validationErrors : undefined,
      dry_run,
      error_message: msg,
    };
  }

  // confirm_token via E2 helper (closed_dates_future kind REQUIRES originalToday)
  const confirm_token = await computeConfirmToken({
    shopId,
    kind: "closed_dates_future",
    expectedCurrentHash,
    mdContentHash: hash,
    actorEmail: audit.display_name,
    originalToday: original_today,
  });

  const diffSummary: Record<string, unknown> = {
    surfaces: ["closed_dates"],
    added: added.map((a) => a.closed_date),
    modified: modified.map((m) => m.closed_date),
    deactivated,
    original_today,
    past_rows_ignored: pastRowsIgnored,
  };

  // Dry-run path
  if (dry_run) {
    return {
      ok: true,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
      rows_added: added.length,
      rows_modified: modified.length,
      rows_deactivated: deactivated.length,
      parse_errors: parsed.errors.length > 0 ? parsed.errors : undefined,
      validation_errors: validationErrors.length > 0 ? validationErrors : undefined,
      diff_summary: diffSummary,
      dry_run: true,
      confirm_token,
    };
  }

  // Apply mode — call apply_closed_dates_upload RPC
  const pAudit: Record<string, unknown> = {
    actor_email: audit.display_name,
    oauth_client_id: audit.oauth_client_id,
    md_content_hash: hash,
    expected_current_hash: expectedCurrentHash,
    expected_confirm_token: expected_confirm_token ?? null,
    original_today,
    dry_run: false,
  };
  const pDiff: Record<string, unknown> = { added, modified, deactivated };

  const { data: auditLogId, error: rpcErr } = await sb.rpc(
    "apply_closed_dates_upload",
    {
      p_shop_id: shopId,
      p_snapshot: snapshotBase,
      p_diff: pDiff,
      p_audit: pAudit,
    },
  );

  if (rpcErr) {
    const { reason_code, sanitized } = classifyApplyRpcError(rpcErr.message);
    console.warn(JSON.stringify({
      level: "warning",
      msg: "apply_closed_dates_upload_failed",
      shop_id: shopId,
      reason_code,
      detail: rpcErr.message,
    }));
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: parsed.table.rows.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      validation_errors: validationErrors.length > 0 ? validationErrors : undefined,
      diff_summary: diffSummary,
      dry_run: false,
      confirm_token,
      reason_code,
      attempt_id: null,
      error_message: sanitized,
    };
  }

  return {
    ok: true,
    table_name: tableName,
    md_content_hash: hash,
    rows_parsed: parsed.table.rows.length,
    rows_added: added.length,
    rows_modified: modified.length,
    rows_deactivated: deactivated.length,
    parse_errors: parsed.errors.length > 0 ? parsed.errors : undefined,
    validation_errors: validationErrors.length > 0 ? validationErrors : undefined,
    diff_summary: diffSummary,
    dry_run: false,
    confirm_token,
    audit_log_id: (auditLogId as number | null) ?? undefined,
  };
}

export async function exportClosedDatesMd(
  sb: SupabaseClient,
  shopId: number,
): Promise<{ md_content: string; row_count: number }> {
  // Export FUTURE-only — past closures are immutable history. Advisors who
  // need historical lookup can query the DB directly.
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await sb
    .from("closed_dates")
    .select("closed_date, reason")
    .eq("shop_id", shopId)
    .gte("closed_date", today)
    .order("closed_date", { ascending: true });
  if (error) throw new Error(`closed_dates export failed: ${error.message}`);
  const md = mdTableFromRows(
    {
      title: "Closed Dates (Future)",
      columns: [
        { name: "closed_date", description: "YYYY-MM-DD" },
        { name: "reason", description: "Optional comment (Christmas, snow, training, etc.)" },
      ],
    },
    (data ?? []) as Record<string, unknown>[],
  );
  return { md_content: md, row_count: (data ?? []).length };
}

// ─── On-demand appointments sync ────────────────────────────────────────────

/**
 * Trigger an on-demand call to the appointments-sync Edge Function. Same
 * function the cron calls every 5 min — useful when an advisor knows
 * Tekmetric just changed and wants the local shadow refreshed without
 * waiting. Returns the function's structured summary.
 */
export async function runAppointmentsSync(args: {
  supabaseUrl: string;
  serviceRoleKey: string;
  /** Optional: force a full backfill rather than the rolling window. */
  full_backfill?: boolean;
}): Promise<{ ok: boolean; status: number; summary: unknown }> {
  const url = `${args.supabaseUrl.replace(/\/+$/, "")}/functions/v1/appointments-sync`;
  const body = args.full_backfill ? { full_backfill: true } : {};
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${args.serviceRoleKey}`,
      "apikey": args.serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let summary: unknown = null;
  try {
    summary = await res.json();
  } catch {
    summary = await res.text();
  }
  return { ok: res.ok, status: res.status, summary };
}

// ─── Orphan-customer detection ──────────────────────────────────────────────

/**
 * Find customers in our local appointment_holds + appointments shadow whose
 * Tekmetric customer_id is NULL or appears stale (Tekmetric returned 404
 * during the last sync). Used by advisors to clean up after Tekmetric
 * deletions — same shape as the keytag orphan-release flow.
 *
 * Phase 1 implementation: returns local appointments where deleted_at IS
 * NULL but the Tekmetric appointment_id no longer matches any appointment
 * fetched in the most recent sync run. Heuristic — the appointments-sync
 * function already marks deleted_at when it detects deletions, so this
 * surface is small. Mostly used to find drift.
 */
export async function findOrphanCustomers(
  sb: SupabaseClient,
  shopId: number,
  args: { lookback_days?: number } = {},
): Promise<{
  orphans: Array<{
    customer_id: number | null;
    appointment_id: number;
    start_time: string;
    appointment_status: string;
    last_synced_at: string | null;
  }>;
  count: number;
  lookback_days: number;
}> {
  const lookback = args.lookback_days ?? 30;
  const cutoff = new Date(
    Date.now() - lookback * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Heuristic Phase 1: find appointments where the last_synced_at is older
  // than 24h but the appointment hasn't been deleted (sync should have
  // touched it OR marked it deleted). May produce false positives during a
  // sync-paused window — advisors verify in Tekmetric before acting.
  const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from("appointments")
    .select(
      "customer_id, tekmetric_appointment_id, start_time, appointment_status, last_synced_at",
    )
    .eq("shop_id", shopId)
    .is("deleted_at", null)
    .gte("start_time", cutoff)
    .lt("last_synced_at", staleCutoff)
    .limit(50);
  if (error) {
    throw new Error(`findOrphanCustomers failed: ${error.message}`);
  }
  const orphans = (data ?? []).map((r) => ({
    customer_id: r.customer_id as number | null,
    appointment_id: r.tekmetric_appointment_id as number,
    start_time: r.start_time as string,
    appointment_status: r.appointment_status as string,
    last_synced_at: (r.last_synced_at ?? null) as string | null,
  }));
  return { orphans, count: orphans.length, lookback_days: lookback };
}

// ─── Concern category MD upload (Pattern S — E5e) ───────────────────────────
//
// Refactored 2026-05-26 per PLAN §4.2 + R6-B3 + E1b-N1 + E1cf-N4 — snapshot_kind
// = 'concern_questions_per_category'. Apply RPC: apply_concern_category_upload
// (migration 20260526000500).
//
// Significant rewrite: legacy code INTERLEAVED diff + apply across two tables
// (concern_subcategories + concern_questions). New design: parse → fetch BOTH
// tables → build NESTED diff (subcategories + questions, each with
// added/modified/deactivated) → compute confirm_token → dry-run early return
// → else call apply RPC.
//
// Per E1cf-N4 the p_diff shape is:
//   {
//     subcategories: { added: SubcategoryRow[], modified: SubcategoryRow[], deactivated: [<id>] },
//     questions:     { added: QuestionWithSlug[], modified: QuestionRow[], deactivated: [<id>] }
//   }
// where QuestionWithSlug = QuestionRow & { slug_of_sub: string } — the apply
// RPC uses slug_of_sub to resolve subcategory_id for newly-INSERTed subs.
//
// Per E1b-N1 snapshot fields are EXACTLY:
//   subcategories_before, added_subcategory_ids,
//   questions_before, added_question_ids
// (the canonical_state + revert handler read these by name).

const CONCERN_CATEGORY_SLUGS = [
  "noise",
  "vibration",
  "pulling",
  "smell",
  "smoke",
  "leak",
  "warning_light",
  "performance",
  "electrical",
  "hvac",
  "brakes",
  "steering",
  "tires",
  "other",
] as const;

type ConcernCategorySlug = (typeof CONCERN_CATEGORY_SLUGS)[number];

interface SubcategoryRow {
  id: number;
  slug: string;
  display_label: string;
  display_order: number;
  active: boolean;
  /** Preserved during MODIFY — apply RPC's UPDATE sets ALL columns, so omitting
   *  these from the modified payload would NULL them out. Fetched + carried
   *  forward unchanged unless the MD format ever supports editing them. */
  description?: string | null;
  positive_examples?: string[] | null;
  negative_examples?: string[] | null;
  synonyms?: string[] | null;
  eligible_testing_service_keys?: string[] | null;
}

interface ConcernQuestionRow {
  id: number;
  subcategory_id: number | null;
  question_text: string;
  display_order: number;
  active: boolean;
  /** JSONB column — array of {label, value}. Fetched + diffed against the
   *  parsed MD options so the upload tool only writes when the MD's
   *  options actually changed. Added 2026-05-18 with the CAT-2 catalog
   *  rebuild + new MD format. */
  options?: unknown;
  multi_select?: boolean;
  /** Preserved during MODIFY — same rationale as SubcategoryRow descriptive
   *  fields above. required_facts is ORDERED (MD-order preserved per ADR-025
   *  canonical_state_question_required_facts_v2). */
  required_facts?: string[] | null;
}

// Default-options for new questions (the multiple-choice card needs at
// least one option even when the MD didn't supply one). Plain yes/no/skip
// is the safe initial set; advisors revise via upsertConcernQuestionOptions
// or future MD format extensions.
const DEFAULT_OPTIONS_VALUE: Array<{ label: string; value: string }> = [
  { label: "Yes", value: "yes" },
  { label: "No", value: "no" },
  { label: "Sometimes / Not sure", value: "sometimes" },
];

/** Order-sensitive deep-equal for option arrays. */
function optionsEqualOrder(
  a: unknown,
  b: Array<{ label: string; value: string }>,
): boolean {
  if (!Array.isArray(a)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const aEntry = a[i];
    const bEntry = b[i];
    if (!aEntry || typeof aEntry !== "object" || !bEntry) return false;
    const ao = aEntry as Record<string, unknown>;
    if (ao.label !== bEntry.label || ao.value !== bEntry.value) return false;
  }
  return true;
}

export async function uploadConcernCategoryMd(
  sb: SupabaseClient,
  shopId: number,
  args: {
    category_slug: string;
    md_content: string;
    audit: AdminAudit;
    dry_run?: boolean;
    expected_confirm_token?: string;
  },
): Promise<UploadResult> {
  const tableName = "concern_questions";
  const { md_content, audit, dry_run = true, expected_confirm_token } = args;

  if (!CONCERN_CATEGORY_SLUGS.includes(args.category_slug as ConcernCategorySlug)) {
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: "",
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: `category_slug must be one of: ${CONCERN_CATEGORY_SLUGS.join(", ")}`,
    };
  }
  const categorySlug = args.category_slug as ConcernCategorySlug;

  const hash = await sha256Hex(md_content);
  if (await checkDuplicate(sb, tableName, hash)) {
    return {
      ok: true,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      duplicate_upload: true,
      dry_run,
    };
  }

  // ── 1. Parse the MD doc
  let parsed;
  try {
    parsed = parseConcernCategoryMd(md_content);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: msg,
    };
  }

  const totalQuestions = parsed.subcategories.reduce(
    (sum, s) => sum + s.questions.length,
    0,
  );

  // ── 2. Fetch current state for this (shop_id, category)
  // Select ALL descriptive columns so MODIFIED rows can preserve them — the
  // apply RPC's UPDATE sets every column; omitting one would NULL it out.
  const { data: subRowsData, error: subFetchErr } = await sb
    .from("concern_subcategories")
    .select(
      "id, slug, display_label, display_order, active, description, positive_examples, negative_examples, synonyms, eligible_testing_service_keys",
    )
    .eq("shop_id", shopId)
    .eq("category", categorySlug);
  if (subFetchErr) {
    const msg = `concern_subcategories fetch failed: ${subFetchErr.message}`;
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: totalQuestions,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: msg,
    };
  }
  const currentSubs = (subRowsData ?? []) as unknown as SubcategoryRow[];

  const { data: qRowsData, error: qFetchErr } = await sb
    .from("concern_questions")
    .select(
      "id, subcategory_id, question_text, display_order, active, options, multi_select, required_facts",
    )
    .eq("shop_id", shopId)
    .eq("category", categorySlug);
  if (qFetchErr) {
    const msg = `concern_questions fetch failed: ${qFetchErr.message}`;
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: totalQuestions,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: msg,
    };
  }
  const currentQuestions = (qRowsData ?? []) as unknown as ConcernQuestionRow[];

  // ── 3. Build the NESTED diff (no writes)
  // currentSubBySlug: existing subcategories for this category, keyed by slug
  // mdSubBySlug:      parsed MD subcategories, keyed by slug
  const currentSubBySlug = new Map<string, SubcategoryRow>();
  for (const s of currentSubs) currentSubBySlug.set(s.slug, s);
  const mdSubBySlug = new Map<string, ParsedConcernSubcategory>();
  for (const s of parsed.subcategories) mdSubBySlug.set(s.slug, s);

  // Existing question lookup by (subcategory_id, question_text)
  const currentQByKey = new Map<string, ConcernQuestionRow>();
  for (const q of currentQuestions) {
    if (q.subcategory_id !== null) {
      currentQByKey.set(`${q.subcategory_id}::${q.question_text}`, q);
    }
  }

  // ── 3a. Subcategory diff
  const subAdded: Array<Record<string, unknown>> = [];
  const subModified: Array<Record<string, unknown>> = [];
  const subDeactivated: number[] = [];
  const subcategoriesBefore: Record<string, SubcategoryRow> = {};

  for (const mdSub of parsed.subcategories) {
    const existing = currentSubBySlug.get(mdSub.slug);
    if (existing) {
      const needsUpdate =
        existing.display_label !== mdSub.display_label ||
        existing.display_order !== mdSub.display_order ||
        existing.active !== true;
      if (needsUpdate) {
        // Apply RPC SETs every column — preserve descriptive fields by passing
        // existing values through unchanged (MD format doesn't carry them).
        subModified.push({
          id: existing.id,
          slug: mdSub.slug,
          display_label: mdSub.display_label,
          display_order: mdSub.display_order,
          active: true,
          description: existing.description ?? null,
          positive_examples: existing.positive_examples ?? null,
          negative_examples: existing.negative_examples ?? null,
          synonyms: existing.synonyms ?? null,
          eligible_testing_service_keys: existing.eligible_testing_service_keys ?? null,
        });
        subcategoriesBefore[String(existing.id)] = existing;
      }
    } else {
      // New subcategory — apply RPC INSERTs + resolves id by slug for any
      // questions referencing it via slug_of_sub. Descriptive fields default
      // to NULL on insert (matches legacy uploader behavior).
      subAdded.push({
        slug: mdSub.slug,
        display_label: mdSub.display_label,
        display_order: mdSub.display_order,
        active: true,
      });
    }
  }
  for (const existing of currentSubs) {
    if (!mdSubBySlug.has(existing.slug) && existing.active) {
      subDeactivated.push(existing.id);
      subcategoriesBefore[String(existing.id)] = existing;
    }
  }

  // ── 3b. Question diff (per-sub, identified by slug_of_sub)
  // For modified questions: they live under an EXISTING sub, so subcategory_id
  // is known. For added questions: they may live under either an existing OR
  // newly-INSERTed sub — we carry slug_of_sub so apply RPC resolves.
  const qAdded: Array<Record<string, unknown>> = [];
  const qModified: Array<Record<string, unknown>> = [];
  const qDeactivated: number[] = [];
  const questionsBefore: Record<string, ConcernQuestionRow> = {};

  // Build slug→existing-sub-id lookup (existing subs only — added subs have
  // no id yet, but the apply RPC resolves those at insert time via the
  // v_sub_id_by_slug JSONB).
  const existingSubIdBySlug = new Map<string, number>();
  for (const s of currentSubs) existingSubIdBySlug.set(s.slug, s.id);

  const seenExistingQIds = new Set<number>();

  for (const mdSub of parsed.subcategories) {
    const existingSubId = existingSubIdBySlug.get(mdSub.slug);
    for (const q of mdSub.questions) {
      // Default options when MD didn't supply any (legacy MDs).
      const effectiveOptions =
        q.options !== undefined ? q.options : DEFAULT_OPTIONS_VALUE;
      const effectiveMultiSelect = q.multi_select === true;

      // Existing question? Only possible when the sub already exists (and
      // has an id we can match against).
      let existingQ: ConcernQuestionRow | undefined;
      if (existingSubId !== undefined) {
        existingQ = currentQByKey.get(`${existingSubId}::${q.question_text}`);
      }

      if (existingQ) {
        seenExistingQIds.add(existingQ.id);
        // Determine if any field changed
        const needsUpdate =
          existingQ.display_order !== q.display_order ||
          existingQ.active !== true ||
          (q.options !== undefined &&
            !optionsEqualOrder(existingQ.options, q.options)) ||
          (q.multi_select !== undefined &&
            existingQ.multi_select !== q.multi_select);
        if (needsUpdate) {
          // For modified questions we have a known subcategory_id (existing
          // sub). Include slug_of_sub for symmetry + future-proofing (apply
          // RPC uses it as a defensive resolver). Preserve required_facts
          // by passing the existing value — apply RPC SETs every column.
          qModified.push({
            id: existingQ.id,
            slug_of_sub: mdSub.slug,
            subcategory_id: existingSubId,
            question_text: q.question_text,
            options:
              q.options !== undefined ? q.options : (existingQ.options ?? DEFAULT_OPTIONS_VALUE),
            multi_select:
              q.multi_select !== undefined
                ? q.multi_select
                : (existingQ.multi_select ?? false),
            display_order: q.display_order,
            active: true,
            required_facts: existingQ.required_facts ?? null,
          });
          questionsBefore[String(existingQ.id)] = existingQ;
        }
      } else {
        // New question — apply RPC resolves subcategory_id via slug_of_sub.
        qAdded.push({
          slug_of_sub: mdSub.slug,
          question_text: q.question_text,
          options: effectiveOptions,
          multi_select: effectiveMultiSelect,
          display_order: q.display_order,
          active: true,
        });
      }
    }
  }

  // Soft-delete questions no longer in MD (only consider questions tied to
  // a known subcategory).
  for (const q of currentQuestions) {
    if (q.subcategory_id !== null && !seenExistingQIds.has(q.id) && q.active) {
      qDeactivated.push(q.id);
      questionsBefore[String(q.id)] = q;
    }
  }

  // ── 4. Build snapshot per E1b-N1 EXACT field names
  // (subcategories_before, added_subcategory_ids, questions_before,
  //  added_question_ids). category_slug is also injected so canonical_state
  // can derive the per-category scope without grovelling row data.
  const snapshotBase: Record<string, unknown> = {
    snapshot_kind: "concern_questions_per_category",
    category_slug: categorySlug,
    subcategories_before: subcategoriesBefore,
    added_subcategory_ids: [] as number[],
    questions_before: questionsBefore,
    added_question_ids: [] as number[],
  };

  // ── 5. Canonical-current + hash (requires category_slug — see R6-B3)
  let expectedCurrentHash: string;
  try {
    const canonicalCurrent = await computeCanonicalAfterState({
      kind: "concern_questions_per_category",
      supabase: sb,
      shopId,
      snapshot: snapshotBase,
    });
    expectedCurrentHash = await sha256Hex(canonicalCurrent);
  } catch (e) {
    const msg = `canonical_state_concern_category_upload compute failed: ${e instanceof Error ? e.message : String(e)}`;
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: totalQuestions,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: msg,
    };
  }

  // ── 6. confirm_token via E2 helper (per-category kind REQUIRES categorySlug)
  const confirm_token = await computeConfirmToken({
    shopId,
    kind: "concern_questions_per_category",
    expectedCurrentHash,
    mdContentHash: hash,
    actorEmail: audit.display_name,
    categorySlug,
  });

  // ── 7. Build diff_summary (surfaces[] = BOTH physical tables per E1f apply RPC)
  // Surface advisor-visible warning about DEFAULT_OPTIONS injection for new
  // questions whose MD didn't carry options.
  const defaultedQuestionKeys: string[] = [];
  for (const mdSub of parsed.subcategories) {
    for (const q of mdSub.questions) {
      if (q.options === undefined) {
        // Only counts as "defaulted" if it would be an INSERT (not an
        // existing row preserving its options).
        const subId = existingSubIdBySlug.get(mdSub.slug);
        const existing = subId !== undefined
          ? currentQByKey.get(`${subId}::${q.question_text}`)
          : undefined;
        if (!existing) {
          defaultedQuestionKeys.push(`${mdSub.slug}::${q.question_text}`);
        }
      }
    }
  }
  const validationWarnings: ValidationFinding[] = [];
  for (const key of defaultedQuestionKeys) {
    validationWarnings.push({
      key,
      field: "options",
      level: "warning",
      message:
        "MD did not supply options — apply will inject default [Yes / No / Sometimes-Not-sure]. Add an options line in the MD to override.",
    });
  }

  const diffSummary: Record<string, unknown> = {
    surfaces: ["concern_subcategories", "concern_questions"],
    category_slug: categorySlug,
    display_label: parsed.display_label,
    subcategories: {
      added: subAdded.map((s) => s.slug),
      modified: subModified.map((s) => s.slug),
      deactivated_ids: subDeactivated,
      total_in_md: parsed.subcategories.length,
    },
    questions: {
      added: qAdded.map((q) => `${q.slug_of_sub}::${q.question_text}`),
      modified: qModified.map((q) => `${q.slug_of_sub}::${q.question_text}`),
      deactivated_ids: qDeactivated,
      total_in_md: totalQuestions,
    },
  };

  // ── 8. Dry-run path
  if (dry_run) {
    return {
      ok: true,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: totalQuestions,
      rows_added: subAdded.length + qAdded.length,
      rows_modified: subModified.length + qModified.length,
      rows_deactivated: subDeactivated.length + qDeactivated.length,
      validation_warnings: validationWarnings.length > 0 ? validationWarnings : undefined,
      diff_summary: diffSummary,
      dry_run: true,
      confirm_token,
    };
  }

  // ── 9. Apply mode — call apply_concern_category_upload RPC
  const pAudit: Record<string, unknown> = {
    actor_email: audit.display_name,
    oauth_client_id: audit.oauth_client_id,
    md_content_hash: hash,
    expected_current_hash: expectedCurrentHash,
    expected_confirm_token: expected_confirm_token ?? null,
    dry_run: false,
  };
  // Per E1cf-N4 the apply RPC expects nested shape with slug_of_sub on
  // every question (added + modified).
  const pDiff: Record<string, unknown> = {
    subcategories: {
      added: subAdded,
      modified: subModified,
      deactivated: subDeactivated.map((id) => String(id)),
    },
    questions: {
      added: qAdded,
      modified: qModified,
      deactivated: qDeactivated.map((id) => String(id)),
    },
  };

  const { data: auditLogId, error: rpcErr } = await sb.rpc(
    "apply_concern_category_upload",
    {
      p_shop_id: shopId,
      p_snapshot: snapshotBase,
      p_diff: pDiff,
      p_audit: pAudit,
      p_category_slug: categorySlug,
    },
  );

  if (rpcErr) {
    const { reason_code, sanitized } = classifyApplyRpcError(rpcErr.message);
    console.warn(JSON.stringify({
      level: "warning",
      msg: "apply_concern_category_upload_failed",
      shop_id: shopId,
      category_slug: categorySlug,
      reason_code,
      detail: rpcErr.message,
    }));
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: totalQuestions,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      validation_warnings: validationWarnings.length > 0 ? validationWarnings : undefined,
      diff_summary: diffSummary,
      dry_run: false,
      confirm_token,
      reason_code,
      attempt_id: null,
      error_message: sanitized,
    };
  }

  return {
    ok: true,
    table_name: tableName,
    md_content_hash: hash,
    rows_parsed: totalQuestions,
    rows_added: subAdded.length + qAdded.length,
    rows_modified: subModified.length + qModified.length,
    rows_deactivated: subDeactivated.length + qDeactivated.length,
    validation_warnings: validationWarnings.length > 0 ? validationWarnings : undefined,
    diff_summary: diffSummary,
    dry_run: false,
    confirm_token,
    audit_log_id: (auditLogId as number | null) ?? undefined,
  };
}

// ─── exportConcernCategoryMd (E6 — 2026-05-26) ──────────────────────────────
//
// Per PLAN §5.2 + research-02 §Q6. Pure UI-facing serializer for the admin-app
// download → edit → re-upload round trip. Reads `concern_subcategories` +
// `concern_questions` (ACTIVE only) for one (shop_id, category) and emits the
// hierarchical MD format `parseConcernCategoryMd` consumes.
//
// IMPORTANT — round-trip contract:
//   parseConcernCategoryMd(serializeConcernCategoryMd(subs, qs, label)) ===
//     { display_label: label,
//       subcategories: [ { slug, display_label, display_order, questions: [...] }, ... ] }
//
// Stable round-trip rules:
//   - Question numbers come from INDEX POSITION (idx + 1) within the sub-cat,
//     NOT from the DB `display_order` column. Two questions with the same DB
//     display_order would otherwise re-number across export/upload (research-02
//     §Open #5).
//   - Options always emit `Label=value` form (no shorthand), for unambiguous
//     reparse (research-02 §Open #2).
//   - Sub-category headers emit `display_label` so the parser regenerates the
//     same slug via `slugifyForConcernSubcategory(label)`.
//   - `[multi]` prefix is emitted iff `multi_select === true`.
//   - Trailing HTML comment + `---` HR are parser-ignored — informational only.
//
// CRITICAL — per ADR-025 this exporter is for the admin-app UI ONLY. It is
// NOT the byte-parity source for the staleness check. The canonical-state
// byte-parity contract is between `canonical_state_concern_category_upload`
// (plpgsql, E1b) and `computeCanonicalAfterState({kind: 'concern_questions_per_category'})`
// (TS, E2). The two formats are intentionally divergent (UI vs staleness).

export interface ExportConcernCategorySubRow {
  /** id is unused by the serializer but kept in the type so the DB-reading
   *  exporter can pass the raw row through without restructuring. */
  id: number;
  slug: string;
  display_label: string;
  display_order: number;
}

export interface ExportConcernCategoryQuestionRow {
  subcategory_id: number;
  question_text: string;
  display_order: number;
  options: Array<{ label: string; value: string }> | null;
  multi_select: boolean | null;
}

/**
 * Pure serializer — does NOT touch the SupabaseClient. Unit-testable per
 * PLAN §5 + research-02 §Q8. Subs MUST already be in the desired display
 * order; questions MUST already be in the desired display order within their
 * subcategory_id. The serializer groups by subcategory_id and numbers
 * questions by index position (NOT DB display_order).
 */
export function serializeConcernCategoryMd(
  subs: ExportConcernCategorySubRow[],
  questions: ExportConcernCategoryQuestionRow[],
  categoryLabel: string,
): string {
  const lines: string[] = [];
  lines.push(`# ${categoryLabel}`);
  lines.push("");

  const qBySubId = new Map<number, ExportConcernCategoryQuestionRow[]>();
  for (const q of questions) {
    const arr = qBySubId.get(q.subcategory_id) ?? [];
    arr.push(q);
    qBySubId.set(q.subcategory_id, arr);
  }

  for (const s of subs) {
    lines.push(`-- ${s.display_label} Checklist --`);
    const qs = qBySubId.get(s.id) ?? [];
    qs.forEach((q, idx) => {
      const prefix = q.multi_select ? "[multi] " : "";
      lines.push(`${idx + 1}. ${prefix}${q.question_text}`);
      if (q.options && q.options.length > 0) {
        // Always emit Label=value form (no shorthand) for unambiguous reparse.
        // The parser tolerates either form, but emitting both shapes from the
        // same input would create export/upload non-determinism.
        const optStr = q.options
          .map((o) => `${o.label}=${o.value}`)
          .join(" | ");
        lines.push(`   - ${optStr}`);
      }
    });
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * DB-reading exporter for one (shop_id, category). Resolves the H1 display
 * label from `concern_category_guidelines.display_label` (canonical), falling
 * back to a title-cased slug when no guideline row exists yet. Reads only
 * ACTIVE rows from both tables (matches the uploader's diff semantics —
 * soft-deleted rows are excluded from the round-trip surface).
 *
 * @returns { md_content, row_count } — row_count is the SUM of sub-categories
 *   + questions returned. row_count === 0 means no active rows for this
 *   (shop, category); the UI may surface an empty-state.
 */
export async function exportConcernCategoryMd(
  sb: SupabaseClient,
  shopId: number,
  args: { category_slug: string },
): Promise<{ md_content: string; row_count: number }> {
  if (!CONCERN_CATEGORY_SLUGS.includes(args.category_slug as ConcernCategorySlug)) {
    throw new Error(
      `category_slug must be one of: ${CONCERN_CATEGORY_SLUGS.join(", ")}`,
    );
  }
  const categorySlug = args.category_slug as ConcernCategorySlug;

  // Sub-categories (ACTIVE only) for this (shop, category).
  const { data: subRows, error: subErr } = await sb
    .from("concern_subcategories")
    .select("id, slug, display_label, display_order")
    .eq("shop_id", shopId)
    .eq("category", categorySlug)
    .eq("active", true)
    .order("display_order", { ascending: true });
  if (subErr) {
    throw new Error(`concern_subcategories export failed: ${subErr.message}`);
  }
  const subs = (subRows ?? []) as ExportConcernCategorySubRow[];

  // Questions (ACTIVE only) for this (shop, category). Grouped by
  // subcategory_id at serialize time.
  const { data: qRows, error: qErr } = await sb
    .from("concern_questions")
    .select("subcategory_id, question_text, display_order, options, multi_select")
    .eq("shop_id", shopId)
    .eq("category", categorySlug)
    .eq("active", true)
    .order("display_order", { ascending: true });
  if (qErr) {
    throw new Error(`concern_questions export failed: ${qErr.message}`);
  }
  const questions = (qRows ?? []) as ExportConcernCategoryQuestionRow[];

  // Resolve H1 label: prefer the guideline row's display_label (canonical),
  // fall back to a title-cased slug ("warning_light" → "Warning light").
  const { data: guide } = await sb
    .from("concern_category_guidelines")
    .select("display_label")
    .eq("shop_id", shopId)
    .eq("category", categorySlug)
    .maybeSingle();
  const categoryLabel = (guide?.display_label as string | undefined) ??
    (categorySlug.charAt(0).toUpperCase() +
      categorySlug.slice(1).replace(/_/g, " "));

  const body = serializeConcernCategoryMd(subs, questions, categoryLabel);

  // Trailing HR + HTML comment are parser-ignored — informational only so
  // a downstream human reader can see what shop/category the file is from.
  const md = [
    body,
    "---",
    "",
    `<!-- exported from concern_subcategories + concern_questions (shop_id=${shopId}, category=${categorySlug}) -->`,
    "",
  ].join("\n");

  return { md_content: md, row_count: subs.length + questions.length };
}

// ─── Concern category guidelines (Pattern S — E5a) ──────────────────────────
//
// Refactored 2026-05-26 per PLAN §4.3 — snapshot_kind = 'concern_category_guidelines'.
// Apply RPC: apply_concern_category_guideline_upload (migration 20260526000500).
// Composite PK (shop_id, category) — single row per category.
// Snapshot shape: {before: {<category>: existing|null}, added_keys: existing ? [] : [category]}.
// Revert handles BOTH update-back AND hard-DELETE (when original was INSERT).

export async function uploadConcernCategoryGuidelineMd(
  sb: SupabaseClient,
  shopId: number,
  args: {
    category_slug: string;
    md_content: string;
    audit: AdminAudit;
    dry_run?: boolean;
    expected_confirm_token?: string;
  },
): Promise<UploadResult> {
  const tableName = "concern_category_guidelines";
  const { md_content, audit, dry_run = true, expected_confirm_token } = args;

  if (!CONCERN_CATEGORY_SLUGS.includes(args.category_slug as ConcernCategorySlug)) {
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: "",
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: `category_slug must be one of: ${CONCERN_CATEGORY_SLUGS.join(", ")}`,
    };
  }
  const categorySlug = args.category_slug as ConcernCategorySlug;

  const hash = await sha256Hex(md_content);
  if (await checkDuplicate(sb, tableName, hash)) {
    return {
      ok: true,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      duplicate_upload: true,
      dry_run,
    };
  }

  // ── 1. Parse
  let parsed;
  try {
    parsed = parseConcernCategoryGuidelineMd(md_content);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: msg,
    };
  }

  // ── 2. Fetch existing row
  const { data: existing, error: fetchErr } = await sb
    .from("concern_category_guidelines")
    .select("display_label, guideline_prose")
    .eq("shop_id", shopId)
    .eq("category", categorySlug)
    .maybeSingle();
  if (fetchErr) {
    const msg = `concern_category_guidelines fetch failed: ${fetchErr.message}`;
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 1,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: msg,
    };
  }

  const priorExisted = !!existing;
  const willChange =
    !priorExisted ||
    (existing!.display_label !== parsed.display_label ||
      existing!.guideline_prose !== parsed.guideline_prose);

  // ── 3. Build snapshot per PLAN §4.3
  // before[<category>] = existing row | null (insert case)
  // added_keys = [category] if insert, [] if update.
  const beforeRow = priorExisted
    ? { ...existing!, shop_id: shopId, category: categorySlug }
    : null;
  const snapshotBase: Record<string, unknown> = {
    snapshot_kind: "concern_category_guidelines",
    before: { [categorySlug]: beforeRow },
    added_keys: priorExisted ? ([] as string[]) : [categorySlug],
  };

  // ── 4. Canonical-current + hash
  let expectedCurrentHash: string;
  try {
    const canonicalCurrent = await computeCanonicalAfterState({
      kind: "concern_category_guidelines",
      supabase: sb,
      shopId,
      snapshot: snapshotBase,
    });
    expectedCurrentHash = await sha256Hex(canonicalCurrent);
  } catch (e) {
    const msg = `canonical_state_concern_category_guideline compute failed: ${e instanceof Error ? e.message : String(e)}`;
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 1,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: msg,
    };
  }

  // ── 5. confirm_token via E2 helper (guideline kind REQUIRES categorySlug)
  const confirm_token = await computeConfirmToken({
    shopId,
    kind: "concern_category_guidelines",
    expectedCurrentHash,
    mdContentHash: hash,
    actorEmail: audit.display_name,
    categorySlug,
  });

  const action = !priorExisted ? "inserted" : willChange ? "updated" : "no-op";
  const diffSummary: Record<string, unknown> = {
    surfaces: ["concern_category_guidelines"],
    category_slug: categorySlug,
    display_label: parsed.display_label,
    prose_length: parsed.guideline_prose.length,
    action,
  };

  // ── 6. Dry-run path
  if (dry_run) {
    return {
      ok: true,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 1,
      rows_added: !priorExisted ? 1 : 0,
      rows_modified: priorExisted && willChange ? 1 : 0,
      rows_deactivated: 0,
      diff_summary: diffSummary,
      dry_run: true,
      confirm_token,
    };
  }

  // ── 7. Apply mode — call apply_concern_category_guideline_upload RPC
  const pAudit: Record<string, unknown> = {
    actor_email: audit.display_name,
    oauth_client_id: audit.oauth_client_id,
    md_content_hash: hash,
    expected_current_hash: expectedCurrentHash,
    expected_confirm_token: expected_confirm_token ?? null,
    dry_run: false,
  };
  // Per apply RPC contract: p_diff carries display_label, guideline_prose,
  // prior_existed. The RPC uses prior_existed to decide INSERT vs UPDATE
  // semantics for revert (insert → revert hard-DELETEs; update → revert
  // restores prior row).
  const pDiff: Record<string, unknown> = {
    display_label: parsed.display_label,
    guideline_prose: parsed.guideline_prose,
    prior_existed: priorExisted,
  };

  const { data: auditLogId, error: rpcErr } = await sb.rpc(
    "apply_concern_category_guideline_upload",
    {
      p_shop_id: shopId,
      p_snapshot: snapshotBase,
      p_diff: pDiff,
      p_audit: pAudit,
      p_category_slug: categorySlug,
    },
  );

  if (rpcErr) {
    const { reason_code, sanitized } = classifyApplyRpcError(rpcErr.message);
    console.warn(JSON.stringify({
      level: "warning",
      msg: "apply_concern_category_guideline_upload_failed",
      shop_id: shopId,
      category_slug: categorySlug,
      reason_code,
      detail: rpcErr.message,
    }));
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 1,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      diff_summary: diffSummary,
      dry_run: false,
      confirm_token,
      reason_code,
      attempt_id: null,
      error_message: sanitized,
    };
  }

  return {
    ok: true,
    table_name: tableName,
    md_content_hash: hash,
    rows_parsed: 1,
    rows_added: !priorExisted ? 1 : 0,
    rows_modified: priorExisted && willChange ? 1 : 0,
    rows_deactivated: 0,
    diff_summary: diffSummary,
    dry_run: false,
    confirm_token,
    audit_log_id: (auditLogId as number | null) ?? undefined,
  };
}

// ─── exportConcernCategoryGuidelineMd (E6 — 2026-05-26) ─────────────────────
//
// Per PLAN §5.1 + research-02 §Q5. Pure UI-facing serializer for the admin-app
// download → edit → re-upload round trip. Reads `concern_category_guidelines`
// for one (shop_id, category) and emits the MD format that
// `parseConcernCategoryGuidelineMd` consumes.
//
// IMPORTANT — round-trip contract:
//   parseConcernCategoryGuidelineMd(
//     serializeConcernCategoryGuidelineMd(state, shop_id, slug)
//   ) === { display_label: state.display_label,
//           guideline_prose: state.guideline_prose }
//
// Stable round-trip rules:
//   - H1 emits `# {display_label} — Diagnostic Guideline`; the parser
//     strips the trailing ` — Diagnostic Guideline` suffix so display_label
//     round-trips literally.
//   - Prose body is emitted verbatim (no normalization). The parser's
//     blank-line collapse is a no-op when there are no consecutive blanks.
//   - Trailing `---` HR terminates the parser; the HTML comment after is
//     informational only and parser-ignored.
//
// EMPTY-STATE BEHAVIOR (research-02 §Open #1):
// When no row exists yet for (shop, category), this exporter returns
// `{ md_content: "", row_count: 0 }` — the UI uses row_count===0 as a sentinel
// to seed a new doc rather than render invalid (parser-rejecting) MD.
// Emitting a placeholder scaffold was considered + deferred (UI concern, not
// exporter concern).
//
// CRITICAL — per ADR-025 this exporter is for the admin-app UI ONLY. It is
// NOT the byte-parity source for the staleness check. The canonical-state
// byte-parity contract is between `canonical_state_concern_category_guideline`
// (plpgsql, E1b) and `computeCanonicalAfterState({kind: 'concern_category_guidelines'})`
// (TS, E2). The two formats are intentionally divergent (UI vs staleness).

export interface ExportConcernCategoryGuidelineState {
  display_label: string;
  guideline_prose: string;
}

/**
 * Pure serializer — does NOT touch the SupabaseClient. Unit-testable per
 * PLAN §5 + research-02 §Q8. Emits an MD doc that round-trips through
 * `parseConcernCategoryGuidelineMd`. The shopId + categorySlug are folded
 * into the trailing HTML comment only (parser-ignored) for debugging.
 */
export function serializeConcernCategoryGuidelineMd(
  state: ExportConcernCategoryGuidelineState,
  shopId: number,
  categorySlug: string,
): string {
  return [
    `# ${state.display_label} — Diagnostic Guideline`,
    "",
    state.guideline_prose,
    "",
    "---",
    "",
    `<!-- exported from concern_category_guidelines (shop_id=${shopId}, category=${categorySlug}) -->`,
    "",
  ].join("\n");
}

/**
 * DB-reading exporter for one (shop_id, category) guideline row. When no
 * row exists yet (UI hasn't seeded one), returns
 * `{ md_content: "", row_count: 0 }` — the empty md_content is a sentinel
 * for "no guideline yet" so the UI can switch into a seed-new flow rather
 * than render parser-rejecting MD.
 */
export async function exportConcernCategoryGuidelineMd(
  sb: SupabaseClient,
  shopId: number,
  args: { category_slug: string },
): Promise<{ md_content: string; row_count: number }> {
  if (!CONCERN_CATEGORY_SLUGS.includes(args.category_slug as ConcernCategorySlug)) {
    throw new Error(
      `category_slug must be one of: ${CONCERN_CATEGORY_SLUGS.join(", ")}`,
    );
  }
  const categorySlug = args.category_slug as ConcernCategorySlug;

  const { data, error } = await sb
    .from("concern_category_guidelines")
    .select("display_label, guideline_prose")
    .eq("shop_id", shopId)
    .eq("category", categorySlug)
    .maybeSingle();
  if (error) {
    throw new Error(
      `concern_category_guidelines export failed: ${error.message}`,
    );
  }
  if (!data) {
    // No row yet — return the empty sentinel. UI uses row_count===0 to seed
    // a new doc rather than render invalid MD.
    return { md_content: "", row_count: 0 };
  }

  const state: ExportConcernCategoryGuidelineState = {
    display_label: data.display_label as string,
    guideline_prose: data.guideline_prose as string,
  };
  return {
    md_content: serializeConcernCategoryGuidelineMd(state, shopId, categorySlug),
    row_count: 1,
  };
}

// ─── listSchedulerAdminAuditLog (E7 — 2026-05-26) ────────────────────────────
//
// Per ADR-021 + PLAN §6. Returns up to `limit` (default 10, max 50) recent
// scheduler_admin_audit_log rows for the caller shop, with a per-row
// `revert_eligibility` hint computed TS-side from cheap predicates (9 reasons
// — STRICT SUBSET of the ADR-007 canonical reason_code enum). The eligibility
// hint is NON-AUTHORITATIVE: the UI uses it to enable/disable a Revert button,
// but the authoritative eligibility answer always comes from invoking
// revert_md_upload_attempt directly (which surfaces drift / token-mismatch /
// attempt-time rejections via ADR-008's classifier).
//
// SQL surface filter lives in the SECURITY DEFINER RPC
// `list_scheduler_admin_audit_log_filtered` (migration 20260526000600). The
// RPC handles the ADR-021 conditional COALESCE fallback + JSONB `?` existence
// operator with positional binding the PostgREST builder can't easily express.

/** ADR-021 §"Part 2 — reasons union (9 values, STRICT SUBSET of ADR-007)". */
export type RevertEligibilityReason =
  | "not_upload_md"
  | "snapshot_pruned"
  | "no_snapshot"
  | "table_not_supported"
  | "upload_failed"
  | "successor_revert_exists"
  | "over_30_day_cutoff"
  | "shop_id_unknown_pre_migration_backfill"
  | "cannot_safely_verify";

export interface RevertEligibility {
  is_revertable: boolean;
  reasons: RevertEligibilityReason[];
}

/** Output shape per ADR-021 §6.3. `occurred_at` matches the DB column name. */
export interface AuditLogEntry {
  id: number;
  occurred_at: string;
  table_name: string;
  operation: string;
  shop_id: number | null;
  user_label: string | null;
  oauth_client_id: string | null;
  md_content_hash: string | null;
  rows_added: number;
  rows_modified: number;
  rows_deactivated: number;
  error_message: string | null;
  diff_summary: Record<string, unknown> | null;
  successor_revert_id: number | null;
  reverts_upload_id: number | null;
  revert_eligibility: RevertEligibility;
}

export interface ListSchedulerAdminAuditLogResult {
  rows: AuditLogEntry[];
  total_returned: number;
}

/**
 * Logical surface → physical table_name mapping per ADR-021. Five logical
 * surfaces (subcategory_descriptions, subcategory_service_map, concern_
 * subcategories share concern_subcategories; question_required_facts +
 * concern_questions share concern_questions). The wrapper passes BOTH the
 * logical surface (matched by modern rows via diff_summary->surfaces) AND
 * the physical table (legacy-row fallback) so the conditional SQL clause
 * can disambiguate.
 */
type SurfaceFilter =
  | "routine_services"
  | "testing_services"
  | "subcategory_descriptions"
  | "subcategory_service_map"
  | "question_required_facts"
  | "concern_questions"
  | "concern_subcategories"
  | "concern_category_guidelines"
  | "appointment_default_limits"
  | "closed_dates";

const SURFACE_TO_TABLE: Record<SurfaceFilter, string> = {
  routine_services: "routine_services",
  testing_services: "testing_services",
  subcategory_descriptions: "concern_subcategories",
  subcategory_service_map: "concern_subcategories",
  question_required_facts: "concern_questions",
  concern_questions: "concern_questions",
  concern_subcategories: "concern_subcategories",
  concern_category_guidelines: "concern_category_guidelines",
  appointment_default_limits: "appointment_default_limits",
  closed_dates: "closed_dates",
};

/**
 * The 10 snapshot kinds the revert dispatch (E1b-e) knows how to handle.
 * Mirror of `SnapshotKind` in scheduler-admin-md.ts — kept locally for the
 * cheap eligibility predicate's `table_not_supported` check. Drift between
 * this set and the dispatch's CASE branches surfaces at attempt-time as
 * `snapshot_kind_unknown` (ADR-011 reclassifies to `crashed`); the list-tool
 * surfaces it pre-flight as `table_not_supported`.
 */
const KNOWN_SNAPSHOT_KINDS: ReadonlySet<string> = new Set<string>([
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

/**
 * Resolve snapshot_kind from a raw audit row. Modern rows carry
 * `diff_summary.kind` explicitly (added with the v2 dispatch). Legacy rows
 * lack it; fall back to a table_name-based heuristic for the two legacy
 * V1 tables that still write audit rows (testing_services + routine_services
 * per the revert-of-V2 path); everything else returns null → caller surfaces
 * `table_not_supported`.
 */
function resolveSnapshotKind(
  diffSummary: Record<string, unknown> | null,
  tableName: string,
): string | null {
  // Prefer explicit kind on modern rows.
  if (
    diffSummary &&
    typeof (diffSummary as { kind?: unknown }).kind === "string"
  ) {
    const k = (diffSummary as { kind: string }).kind;
    return KNOWN_SNAPSHOT_KINDS.has(k) ? k : null;
  }
  // Legacy fallback for the two pre-v2 catalog tables (the only ones whose
  // historical rows have no diff_summary.kind but DO have a valid snapshot
  // shape — testing_services + routine_services). Everything else without
  // diff_summary.kind returns null → `table_not_supported`.
  if (tableName === "testing_services") return "testing_services_v2";
  if (tableName === "routine_services") return "routine_services_v2";
  return null;
}

/** Shape of `pre_state_snapshot` we care about for the cannot_safely_verify
 *  cheap check. We never deserialize the full snapshot here — only inspect
 *  the two hash-related fields. */
interface SnapshotShape {
  after_hash?: unknown;
  expected_after_state_canonical?: unknown;
  // … (other fields irrelevant to the cheap predicate)
}

/**
 * Compute per-row revert eligibility from cheap predicates per ADR-021.
 * ALL predicates are O(1) audit-row column reads except `successor_revert_exists`
 * which we batch resolve in a single follow-up query (passed in via
 * `successorRevertExists`).
 */
function computeRevertEligibility(args: {
  operation: string;
  preStateSnapshot: SnapshotShape | null;
  snapshotPrunedAt: string | null;
  errorMessage: string | null;
  occurredAt: string;
  shopId: number | null;
  diffSummary: Record<string, unknown> | null;
  tableName: string;
  successorRevertExists: boolean;
}): RevertEligibility {
  const reasons: RevertEligibilityReason[] = [];

  // 1. operation !== 'upload_md' → not_upload_md (blocks revert-of-revert chains)
  if (args.operation !== "upload_md") {
    reasons.push("not_upload_md");
  }

  // 2. snapshot_pruned_at IS NOT NULL → snapshot_pruned (30-day retention)
  if (args.snapshotPrunedAt !== null) {
    reasons.push("snapshot_pruned");
  }

  // 3. pre_state_snapshot IS NULL → no_snapshot (apply failed before snapshot,
  //    or pre-2026-05-19 legacy row)
  if (args.preStateSnapshot === null) {
    reasons.push("no_snapshot");
  }

  // 4. error_message IS NOT NULL on the upload row → upload_failed
  //    (NOT the v0.5-removed 'failed' revert-attempt outcome — this is the
  //     original upload's partial-write failure)
  if (args.errorMessage !== null) {
    reasons.push("upload_failed");
  }

  // 5. occurred_at < now() - INTERVAL '30 days' → over_30_day_cutoff
  //    (per ADR-007 naming: no leading digits)
  const occurredMs = Date.parse(args.occurredAt);
  const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  if (!Number.isNaN(occurredMs) && occurredMs < cutoffMs) {
    reasons.push("over_30_day_cutoff");
  }

  // 6. shop_id IS NULL OR shop_id <= 0 → shop_id_unknown_pre_migration_backfill
  //    (Migration A leaves shop_id NULL on historical rows; backfill PHASE 2
  //     sets sentinel -1 for rows whose shop_id couldn't be derived;
  //     Migration B then flips to NOT NULL + CHECK (shop_id > 0 OR shop_id = -1).
  //     This check covers both intermediate states.)
  if (args.shopId === null || args.shopId <= 0) {
    reasons.push("shop_id_unknown_pre_migration_backfill");
  }

  // 7. snapshot_kind unresolvable → table_not_supported
  //    (The 10 known kinds match the dispatch CASE branches; anything else
  //     is a pre-v2 row for a table the revert system never learned about.)
  const snapshotKind = resolveSnapshotKind(args.diffSummary, args.tableName);
  if (snapshotKind === null) {
    reasons.push("table_not_supported");
  }

  // 8. successor_revert_exists (batched O(1) lookup) — caller has already
  //    queried reverts_upload_id IN (...) for the result set.
  if (args.successorRevertExists) {
    reasons.push("successor_revert_exists");
  }

  // 9. snapshot present but missing BOTH after_hash AND
  //    expected_after_state_canonical → cannot_safely_verify
  //    (Same enum the inner revert RPC surfaces at attempt time when
  //     force_no_after_hash was NOT passed — drift-detection impossible.)
  if (args.preStateSnapshot !== null) {
    const hasAfterHash = args.preStateSnapshot.after_hash != null;
    const hasCanonical =
      args.preStateSnapshot.expected_after_state_canonical != null;
    if (!hasAfterHash && !hasCanonical) {
      reasons.push("cannot_safely_verify");
    }
  }

  return {
    is_revertable: reasons.length === 0,
    reasons,
  };
}

export interface ListSchedulerAdminAuditLogArgs {
  surface_filter?: SurfaceFilter;
  limit?: number;
  only_successful?: boolean;
  only_revertable?: boolean;
}

/**
 * Edge-callable list tool. Fetches up to `limit` recent audit rows for the
 * caller shop via the SECURITY DEFINER RPC, then computes per-row
 * revert_eligibility from cheap predicates. The `only_revertable` filter
 * runs TS-side AFTER eligibility computation so the full 9-reason union is
 * available — the SQL layer cannot express the same logic without per-row
 * canonical reads (deferred to the authoritative revert_md_upload_attempt
 * call per ADR-021).
 */
export async function listSchedulerAdminAuditLog(
  sb: SupabaseClient,
  shopId: number,
  args: ListSchedulerAdminAuditLogArgs,
): Promise<ListSchedulerAdminAuditLogResult> {
  const limit = args.limit ?? 10;
  const onlySuccessful = args.only_successful ?? false;
  const onlyRevertable = args.only_revertable ?? false;
  const surfaceFilter = args.surface_filter ?? null;
  const tableFilter =
    surfaceFilter !== null ? SURFACE_TO_TABLE[surfaceFilter] : null;

  const { data: rawRows, error: rpcError } = await sb.rpc(
    "list_scheduler_admin_audit_log_filtered",
    {
      p_shop_id: shopId,
      p_surface_filter: surfaceFilter,
      p_table_filter: tableFilter,
      p_only_successful: onlySuccessful,
      p_limit: limit,
    },
  );
  if (rpcError) {
    throw new Error(
      `list_scheduler_admin_audit_log RPC failed: ${rpcError.message}`,
    );
  }
  const rowsRaw = (rawRows ?? []) as Array<{
    id: number;
    occurred_at: string;
    table_name: string;
    operation: string;
    shop_id: number | null;
    user_label: string | null;
    oauth_client_id: string | null;
    md_content_hash: string | null;
    rows_added: number;
    rows_modified: number;
    rows_deactivated: number;
    error_message: string | null;
    diff_summary: Record<string, unknown> | null;
    pre_state_snapshot: SnapshotShape | null;
    snapshot_pruned_at: string | null;
    successor_revert_id: number | null;
    reverts_upload_id: number | null;
  }>;

  // ─── Successor-revert existence: one O(1) batched IN-list query ──────
  // For each upload row in the result set, check whether any audit row
  // with operation='revert_upload' AND reverts_upload_id = this.id exists.
  // We only care about upload_md rows (revert rows can't be re-reverted),
  // so scope the IN-list to those. Also bound to the same shop_id for
  // multi-tenant safety even though RLS would already filter.
  const uploadIds = rowsRaw
    .filter((r) => r.operation === "upload_md")
    .map((r) => r.id);
  const successorSet = new Set<number>();
  if (uploadIds.length > 0) {
    const { data: successorRows, error: successorErr } = await sb
      .from("scheduler_admin_audit_log")
      .select("reverts_upload_id")
      .eq("shop_id", shopId)
      .eq("operation", "revert_upload")
      .is("error_message", null)
      .in("reverts_upload_id", uploadIds);
    if (successorErr) {
      throw new Error(
        `successor-revert lookup failed: ${successorErr.message}`,
      );
    }
    for (const row of (successorRows ?? []) as Array<{
      reverts_upload_id: number | null;
    }>) {
      if (row.reverts_upload_id !== null) {
        successorSet.add(row.reverts_upload_id);
      }
    }
  }

  // ─── Compute eligibility per row ─────────────────────────────────────
  const enriched: AuditLogEntry[] = rowsRaw.map((r) => {
    const revert_eligibility = computeRevertEligibility({
      operation: r.operation,
      preStateSnapshot: r.pre_state_snapshot,
      snapshotPrunedAt: r.snapshot_pruned_at,
      errorMessage: r.error_message,
      occurredAt: r.occurred_at,
      shopId: r.shop_id,
      diffSummary: r.diff_summary,
      tableName: r.table_name,
      successorRevertExists: successorSet.has(r.id),
    });
    return {
      id: r.id,
      occurred_at: r.occurred_at,
      table_name: r.table_name,
      operation: r.operation,
      shop_id: r.shop_id,
      user_label: r.user_label,
      oauth_client_id: r.oauth_client_id,
      md_content_hash: r.md_content_hash,
      rows_added: r.rows_added,
      rows_modified: r.rows_modified,
      rows_deactivated: r.rows_deactivated,
      error_message: r.error_message,
      diff_summary: r.diff_summary,
      successor_revert_id: r.successor_revert_id,
      reverts_upload_id: r.reverts_upload_id,
      revert_eligibility,
    };
  });

  // ─── TS-side only_revertable filter (uses the full reasons union) ────
  // Cannot push this into the SQL layer per ADR-021 — successor-revert is
  // a follow-up query, snapshot_kind resolution is JS-side, and the
  // cannot_safely_verify predicate inspects snapshot internals.
  const filtered = onlyRevertable
    ? enriched.filter((r) => r.revert_eligibility.is_revertable)
    : enriched;

  return {
    rows: filtered,
    total_returned: filtered.length,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// E5 (2026-05-26): the prior local `logAdminAudit()` helper has been REMOVED.
// All 36 prior inline `logAdminAudit(...)` call sites in this file now route
// through the E2 `logAuditEntry()` helper (which REQUIRES shopId — closes the
// historical "may forget shop_id" footgun documented in scheduler-admin-md.ts
// comments + Migration A/B hardening). Error-path inserts go through the local
// `_logAuditError()` shorthand (above); happy-path inserts inline the full call
// so the snapshot + diff_summary + counts stay adjacent to the data they
// describe. See ROUND-6-RESIDUALS E2-N2 + this E5 refactor for the migration
// audit. The 5 LEGACY uploaders (uploadConcernQuestionsMd, uploadConcernCategoryMd,
// uploadConcernCategoryGuidelineMd, uploadAppointmentDefaultLimitsMd,
// uploadClosedDatesMd) write their happy-path audit row INSIDE the apply RPC
// (atomic with mutations) per PLAN §4 + E1f migration 20260526000500.
// ════════════════════════════════════════════════════════════════════════════
