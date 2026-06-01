// testing-services — scheduler admin surface.
// Extracted from scheduler-admin.ts (file-size-refactor). Mechanical split —
// no logic changes. Public API preserved via ./index.ts + the re-export shim.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  coerceBool,
  coerceCsvArray,
  coerceInt,
  logAuditEntry,
  mdTableFromRows,
  parseMdTable,
  sha256Hex,
} from "../../scheduler-admin-md.ts";
import { _logAuditError, checkDuplicate, type AdminAudit, type UploadResult } from "./_shared.ts";

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
