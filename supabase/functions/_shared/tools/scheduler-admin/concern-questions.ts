// concern-questions — scheduler admin surface.
// Extracted from scheduler-admin.ts (file-size-refactor). Mechanical split —
// no logic changes. Public API preserved via ./index.ts + the re-export shim.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  coerceBool,
  coerceInt,
  coerceOptions,
  computeCanonicalAfterState,
  computeConfirmToken,
  mdTableFromRows,
  parseMdTable,
  sha256Hex,
} from "../../scheduler-admin-md.ts";
import { _logAuditError, classifyApplyRpcError, checkDuplicate, type AdminAudit, type UploadResult } from "./_shared.ts";

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
