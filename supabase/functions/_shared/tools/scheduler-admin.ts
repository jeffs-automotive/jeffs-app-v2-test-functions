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

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import {
  coerceBool,
  coerceCsvArray,
  coerceDate,
  coerceInt,
  coerceOptions,
  mdTableFromRows,
  parseMdTable,
  sha256Hex,
} from "../scheduler-admin-md.ts";

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
  diff_summary?: Record<string, unknown>;
  error_message?: string;
}

// ─── Audit log helper ───────────────────────────────────────────────────────

async function logAdminAudit(
  sb: SupabaseClient,
  args: {
    audit: AdminAudit;
    table_name: string;
    operation: "upload_md" | "manual_change" | "export_md";
    rows_added?: number;
    rows_modified?: number;
    rows_deactivated?: number;
    md_content_hash?: string;
    diff_summary?: Record<string, unknown>;
    error_message?: string;
  },
): Promise<void> {
  await sb.from("scheduler_admin_audit_log").insert({
    oauth_client_id: args.audit.oauth_client_id,
    user_label: args.audit.display_name,
    table_name: args.table_name,
    operation: args.operation,
    rows_added: args.rows_added ?? 0,
    rows_modified: args.rows_modified ?? 0,
    rows_deactivated: args.rows_deactivated ?? 0,
    md_content_hash: args.md_content_hash ?? null,
    diff_summary: args.diff_summary ?? null,
    error_message: args.error_message ?? null,
  });
}

// ─── Duplicate-upload short-circuit ─────────────────────────────────────────

/**
 * Check whether the SAME md_content_hash was already uploaded for this
 * table. If so, return a duplicate_upload=true short-circuit result so the
 * advisor knows their file didn't change.
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
    await logAdminAudit(sb, {
      audit: args.audit,
      table_name: tableName,
      operation: "upload_md",
      md_content_hash: hash,
      error_message: msg,
    });
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
    await logAdminAudit(sb, {
      audit: args.audit,
      table_name: tableName,
      operation: "upload_md",
      md_content_hash: hash,
      error_message: msg,
    });
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
    await logAdminAudit(sb, {
      audit: args.audit,
      table_name: tableName,
      operation: "upload_md",
      md_content_hash: hash,
      error_message: msg,
    });
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
    await logAdminAudit(sb, {
      audit: args.audit,
      table_name: tableName,
      operation: "upload_md",
      md_content_hash: hash,
      error_message: msg,
    });
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

  await logAdminAudit(sb, {
    audit: args.audit,
    table_name: tableName,
    operation: "upload_md",
    rows_added: adds.length,
    rows_modified: mods.length,
    rows_deactivated: deactivates.length,
    md_content_hash: hash,
    diff_summary: diffSummary,
    error_message: applyError ?? undefined,
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
    await logAdminAudit(sb, {
      audit: args.audit,
      table_name: tableName,
      operation: "upload_md",
      md_content_hash: hash,
      error_message: msg,
    });
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
    await logAdminAudit(sb, {
      audit: args.audit,
      table_name: tableName,
      operation: "upload_md",
      md_content_hash: hash,
      error_message: msg,
    });
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
    await logAdminAudit(sb, {
      audit: args.audit,
      table_name: tableName,
      operation: "upload_md",
      md_content_hash: hash,
      error_message: msg,
    });
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
    await logAdminAudit(sb, {
      audit: args.audit,
      table_name: tableName,
      operation: "upload_md",
      md_content_hash: hash,
      error_message: msg,
    });
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

  await logAdminAudit(sb, {
    audit: args.audit,
    table_name: tableName,
    operation: "upload_md",
    rows_added: adds.length,
    rows_modified: mods.length,
    rows_deactivated: deactivates.length,
    md_content_hash: hash,
    diff_summary: diffSummary,
    error_message: applyError ?? undefined,
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

// ─── concern_questions ──────────────────────────────────────────────────────

const CONCERN_COLUMNS = [
  "category",
  "question_text",
  "options",
  "display_order",
  "active",
];

export async function uploadConcernQuestionsMd(
  sb: SupabaseClient,
  shopId: number,
  args: { md_content: string; audit: AdminAudit },
): Promise<UploadResult> {
  const tableName = "concern_questions";
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
    await logAdminAudit(sb, {
      audit: args.audit,
      table_name: tableName,
      operation: "upload_md",
      md_content_hash: hash,
      error_message: msg,
    });
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

  const missingColumns = CONCERN_COLUMNS.filter(
    (c) => !parsed.table.headers.includes(c),
  );
  if (missingColumns.length > 0) {
    const msg = `missing required columns: ${missingColumns.join(", ")}`;
    await logAdminAudit(sb, {
      audit: args.audit,
      table_name: tableName,
      operation: "upload_md",
      md_content_hash: hash,
      error_message: msg,
    });
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

  // concern_questions has no per-row natural key from the MD side; we
  // use the (shop_id, category, question_text) tuple as the upsert key.
  // The legacy id column is auto-generated.
  const VALID_CATEGORIES = [
    "noise", "vibration", "pulling", "smell", "smoke", "leak",
    "warning_light", "performance", "electrical", "hvac", "brakes",
    "steering", "tires", "other",
  ];

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
    await logAdminAudit(sb, {
      audit: args.audit,
      table_name: tableName,
      operation: "upload_md",
      md_content_hash: hash,
      error_message: msg,
    });
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

  // Fetch current state — match by (category, question_text) since question_text
  // is the stable natural key for an advisor-edited catalog.
  const { data: currentRows, error: fetchErr } = await sb
    .from("concern_questions")
    .select("id, category, question_text, options, display_order, active")
    .eq("shop_id", shopId);
  if (fetchErr) {
    const msg = `current-state fetch failed: ${fetchErr.message}`;
    await logAdminAudit(sb, {
      audit: args.audit,
      table_name: tableName,
      operation: "upload_md",
      md_content_hash: hash,
      error_message: msg,
    });
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
    currentByKey.set(
      `${row.category}::${row.question_text}`,
      row,
    );
  }
  const uploadedKeys = new Set(
    validRows.map((r) => `${r.category}::${r.question_text}`),
  );

  const adds: string[] = [];
  const mods: string[] = [];
  const deactivates: string[] = [];

  for (const row of validRows) {
    const k = `${row.category}::${row.question_text}`;
    const current = currentByKey.get(k);
    if (!current) {
      adds.push(k);
    } else if (
      JSON.stringify(current.options) !== JSON.stringify(row.options) ||
      current.display_order !== row.display_order ||
      current.active !== row.active
    ) {
      mods.push(k);
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
      // Upsert by (shop_id, category, question_text). We perform two writes
      // (insert net-new + update existing) to keep the SQL simple — Postgres
      // doesn't allow ON CONFLICT against a non-unique tuple without a
      // matching unique index, and we don't want to add one mid-flight.
      for (const row of validRows) {
        const k = `${row.category}::${row.question_text}`;
        if (adds.includes(k)) {
          const { error: insErr } = await sb
            .from("concern_questions")
            .insert({
              shop_id: shopId,
              category: row.category,
              question_text: row.question_text,
              options: row.options,
              display_order: row.display_order,
              active: row.active,
              updated_by_oauth_client_id: args.audit.oauth_client_id,
              updated_by_name: args.audit.display_name,
            });
          if (insErr) throw new Error(`concern insert failed for ${k}: ${insErr.message}`);
        } else if (mods.includes(k)) {
          const existing = currentByKey.get(k)!;
          const { error: updErr } = await sb
            .from("concern_questions")
            .update({
              options: row.options,
              display_order: row.display_order,
              active: row.active,
              updated_at: new Date().toISOString(),
              updated_by_oauth_client_id: args.audit.oauth_client_id,
              updated_by_name: args.audit.display_name,
            })
            .eq("id", existing.id);
          if (updErr) throw new Error(`concern update failed for ${k}: ${updErr.message}`);
        }
      }
    }
    if (deactivates.length > 0) {
      for (const k of deactivates) {
        const existing = currentByKey.get(k)!;
        const { error: deactErr } = await sb
          .from("concern_questions")
          .update({
            active: false,
            updated_at: new Date().toISOString(),
            updated_by_oauth_client_id: args.audit.oauth_client_id,
            updated_by_name: args.audit.display_name,
          })
          .eq("id", existing.id);
        if (deactErr) throw new Error(`concern deactivate failed for ${k}: ${deactErr.message}`);
      }
    }
  } catch (e) {
    applyError = e instanceof Error ? e.message : String(e);
  }

  const diffSummary = {
    added: adds,
    modified: mods,
    deactivated: deactivates,
  };

  await logAdminAudit(sb, {
    audit: args.audit,
    table_name: tableName,
    operation: "upload_md",
    rows_added: adds.length,
    rows_modified: mods.length,
    rows_deactivated: deactivates.length,
    md_content_hash: hash,
    diff_summary: diffSummary,
    error_message: applyError ?? undefined,
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

// ─── appointment_default_limits ────────────────────────────────────────────

const LIMITS_COLUMNS = [
  "day_of_week",
  "is_closed",
  "waiter_8am_slots",
  "waiter_9am_slots",
  "dropoff_total",
  "notes",
];

export async function uploadAppointmentDefaultLimitsMd(
  sb: SupabaseClient,
  shopId: number,
  args: { md_content: string; audit: AdminAudit },
): Promise<UploadResult> {
  const tableName = "appointment_default_limits";
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
    await logAdminAudit(sb, {
      audit: args.audit,
      table_name: tableName,
      operation: "upload_md",
      md_content_hash: hash,
      error_message: msg,
    });
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

  const missingColumns = LIMITS_COLUMNS.filter(
    (c) => !parsed.table.headers.includes(c),
  );
  if (missingColumns.length > 0) {
    const msg = `missing required columns: ${missingColumns.join(", ")}`;
    await logAdminAudit(sb, {
      audit: args.audit,
      table_name: tableName,
      operation: "upload_md",
      md_content_hash: hash,
      error_message: msg,
    });
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
    day_of_week: number;
    is_closed: boolean;
    waiter_8am_slots: number;
    waiter_9am_slots: number;
    dropoff_total: number;
    notes: string | null;
  }> = [];
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
    await logAdminAudit(sb, {
      audit: args.audit,
      table_name: tableName,
      operation: "upload_md",
      md_content_hash: hash,
      error_message: msg,
    });
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
    .from("appointment_default_limits")
    .select("day_of_week, is_closed, waiter_8am_slots, waiter_9am_slots, dropoff_total, notes")
    .eq("shop_id", shopId);
  if (fetchErr) {
    const msg = `current-state fetch failed: ${fetchErr.message}`;
    await logAdminAudit(sb, {
      audit: args.audit,
      table_name: tableName,
      operation: "upload_md",
      md_content_hash: hash,
      error_message: msg,
    });
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

  const currentByDow = new Map<number, typeof currentRows[number]>();
  for (const row of currentRows ?? []) {
    currentByDow.set(row.day_of_week as number, row);
  }

  const adds: number[] = [];
  const mods: number[] = [];
  for (const row of validRows) {
    const current = currentByDow.get(row.day_of_week);
    if (!current) {
      adds.push(row.day_of_week);
    } else if (
      current.is_closed !== row.is_closed ||
      current.waiter_8am_slots !== row.waiter_8am_slots ||
      current.waiter_9am_slots !== row.waiter_9am_slots ||
      current.dropoff_total !== row.dropoff_total ||
      (current.notes ?? null) !== row.notes
    ) {
      mods.push(row.day_of_week);
    }
  }

  let applyError: string | null = null;
  try {
    const upsertRows = validRows.map((r) => ({
      ...r,
      shop_id: shopId,
      updated_at: new Date().toISOString(),
      updated_by_oauth_client_id: args.audit.oauth_client_id,
      updated_by_name: args.audit.display_name,
    }));
    const { error: upsertErr } = await sb
      .from("appointment_default_limits")
      .upsert(upsertRows, { onConflict: "shop_id,day_of_week" });
    if (upsertErr) throw new Error(`upsert failed: ${upsertErr.message}`);
  } catch (e) {
    applyError = e instanceof Error ? e.message : String(e);
  }

  const diffSummary = { added: adds, modified: mods };

  await logAdminAudit(sb, {
    audit: args.audit,
    table_name: tableName,
    operation: "upload_md",
    rows_added: adds.length,
    rows_modified: mods.length,
    rows_deactivated: 0,
    md_content_hash: hash,
    diff_summary: diffSummary,
    error_message: applyError ?? undefined,
  });

  return {
    ok: !applyError,
    table_name: tableName,
    md_content_hash: hash,
    rows_parsed: parsed.table.rows.length,
    rows_added: adds.length,
    rows_modified: mods.length,
    rows_deactivated: 0,
    parse_errors: parsed.errors.length > 0 ? parsed.errors : undefined,
    validation_errors: validationErrors.length > 0 ? validationErrors : undefined,
    diff_summary: diffSummary,
    error_message: applyError ?? undefined,
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

// ─── closed_dates ───────────────────────────────────────────────────────────

const CLOSED_COLUMNS = ["closed_date", "reason"];

export async function uploadClosedDatesMd(
  sb: SupabaseClient,
  shopId: number,
  args: { md_content: string; audit: AdminAudit },
): Promise<UploadResult> {
  const tableName = "closed_dates";
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
    await logAdminAudit(sb, {
      audit: args.audit,
      table_name: tableName,
      operation: "upload_md",
      md_content_hash: hash,
      error_message: msg,
    });
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

  const missingColumns = CLOSED_COLUMNS.filter(
    (c) => !parsed.table.headers.includes(c),
  );
  if (missingColumns.length > 0) {
    const msg = `missing required columns: ${missingColumns.join(", ")}`;
    await logAdminAudit(sb, {
      audit: args.audit,
      table_name: tableName,
      operation: "upload_md",
      md_content_hash: hash,
      error_message: msg,
    });
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
    await logAdminAudit(sb, {
      audit: args.audit,
      table_name: tableName,
      operation: "upload_md",
      md_content_hash: hash,
      error_message: msg,
    });
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

  // closed_dates is a complete-replace table. We replace FUTURE-only rows
  // (past closed_dates are immutable history). The uploader's MD file is
  // assumed to be the canonical list of future closures.
  const today = new Date().toISOString().slice(0, 10);

  const { data: currentRows, error: fetchErr } = await sb
    .from("closed_dates")
    .select("closed_date, reason")
    .eq("shop_id", shopId)
    .gte("closed_date", today);
  if (fetchErr) {
    const msg = `current-state fetch failed: ${fetchErr.message}`;
    await logAdminAudit(sb, {
      audit: args.audit,
      table_name: tableName,
      operation: "upload_md",
      md_content_hash: hash,
      error_message: msg,
    });
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

  const currentByDate = new Map<string, string | null>();
  for (const row of currentRows ?? []) {
    currentByDate.set(row.closed_date as string, (row.reason ?? null) as string | null);
  }
  const uploadedDates = new Set(validRows.map((r) => r.closed_date));

  const adds: string[] = [];
  const mods: string[] = [];
  const deactivates: string[] = [];

  for (const row of validRows) {
    if (!currentByDate.has(row.closed_date)) {
      adds.push(row.closed_date);
    } else if (currentByDate.get(row.closed_date) !== row.reason) {
      mods.push(row.closed_date);
    }
  }
  for (const [date] of currentByDate) {
    if (!uploadedDates.has(date)) {
      deactivates.push(date); // future closed_date dropped from MD = remove
    }
  }

  let applyError: string | null = null;
  try {
    if (adds.length > 0 || mods.length > 0) {
      const upsertRows = validRows.map((r) => ({ ...r, shop_id: shopId }));
      const { error: upsertErr } = await sb
        .from("closed_dates")
        .upsert(upsertRows, { onConflict: "shop_id,closed_date" });
      if (upsertErr) throw new Error(`upsert failed: ${upsertErr.message}`);
    }
    if (deactivates.length > 0) {
      const { error: delErr } = await sb
        .from("closed_dates")
        .delete()
        .eq("shop_id", shopId)
        .in("closed_date", deactivates)
        .gte("closed_date", today); // belt+suspenders — never touch past
      if (delErr) throw new Error(`delete failed: ${delErr.message}`);
    }
  } catch (e) {
    applyError = e instanceof Error ? e.message : String(e);
  }

  const diffSummary = { added: adds, modified: mods, deactivated: deactivates };

  await logAdminAudit(sb, {
    audit: args.audit,
    table_name: tableName,
    operation: "upload_md",
    rows_added: adds.length,
    rows_modified: mods.length,
    rows_deactivated: deactivates.length,
    md_content_hash: hash,
    diff_summary: diffSummary,
    error_message: applyError ?? undefined,
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
