// appointment-default-limits — scheduler admin surface.
// Extracted from scheduler-admin.ts (file-size-refactor). Mechanical split —
// no logic changes. Public API preserved via ./index.ts + the re-export shim.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  coerceBool,
  coerceInt,
  computeCanonicalAfterState,
  computeConfirmToken,
  mdTableFromRows,
  parseMdTable,
  sha256Hex,
} from "../../scheduler-admin-md.ts";
import { _logAuditError, classifyApplyRpcError, checkDuplicate, type AdminAudit, type UploadResult } from "./_shared.ts";

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
