// routine-services — scheduler admin surface.
// Extracted from scheduler-admin.ts (file-size-refactor). Mechanical split —
// no logic changes. Public API preserved via ./index.ts + the re-export shim.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  coerceBool,
  coerceInt,
  logAuditEntry,
  mdTableFromRows,
  parseMdTable,
  sha256Hex,
} from "../../scheduler-admin-md.ts";
import { _logAuditError, checkDuplicate, type AdminAudit, type UploadResult } from "./_shared.ts";

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
