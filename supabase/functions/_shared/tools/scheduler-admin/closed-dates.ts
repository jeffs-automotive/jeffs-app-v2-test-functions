// closed-dates — scheduler admin surface.
// Extracted from scheduler-admin.ts (file-size-refactor). Mechanical split —
// no logic changes. Public API preserved via ./index.ts + the re-export shim.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  coerceDate,
  computeCanonicalAfterState,
  computeConfirmToken,
  mdTableFromRows,
  parseMdTable,
  sha256Hex,
} from "../../scheduler-admin-md.ts";
import { _logAuditError, classifyApplyRpcError, checkDuplicate, type AdminAudit, type UploadResult } from "./_shared.ts";

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
