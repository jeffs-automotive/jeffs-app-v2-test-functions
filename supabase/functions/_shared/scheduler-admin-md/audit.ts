// audit — scheduler admin MD module.
// Extracted from scheduler-admin-md.ts (file-size-refactor). Mechanical split
// — no logic changes. Public API preserved via ./index.ts + the re-export shim.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// ─── 4. logAuditEntry (consolidated) ───────────────────────────────────────

/**
 * Arguments for `logAuditEntry()`. `shopId` is REQUIRED (replaces the
 * historical "may forget shop_id" footgun the inline insert sites suffer).
 */
export interface LogAuditEntryArgs {
  supabase: SupabaseClient;
  /** REQUIRED. Throws if missing. Tenant scope per Migration A column. */
  shopId: number;
  oauthClientId?: string | null;
  /** Operator-readable label per ADR-010 actor_email semantic. */
  userLabel?: string | null;
  /** 'routine_services' | 'testing_services' | 'concern_questions' | etc. */
  tableName: string;
  operation: "upload_md" | "manual_change" | "export_md" | "revert_upload";
  rowsAdded?: number;
  rowsModified?: number;
  rowsDeactivated?: number;
  mdContentHash?: string | null;
  diffSummary?: Record<string, unknown> | null;
  errorMessage?: string | null;
  preStateSnapshot?: Record<string, unknown> | null;
  successorRevertId?: number | null;
  revertsUploadId?: number | null;
}

/**
 * MIGRATION NOTE: this helper REPLACES inline insert sites in
 * scheduler-admin.ts + scheduler-admin-catalog.ts. E4 + E5 builders MUST
 * refactor those sites to call this helper instead of inline-inserting;
 * the existing inline sites have a known bug where shop_id can be NULL
 * (fixed in Migration A + B).
 *
 * Call sites to migrate (audit before changing):
 *   - supabase/functions/_shared/tools/scheduler-admin.ts:
 *       logAdminAudit() helper at L108 + 33 inline call sites
 *       (L216, L241, L317, L347, L426, L533, L557, L622, L651, L729,
 *        L821, L845, L920, L949, L1067, L1157, L1181, L1247, L1275,
 *        L1335, L1418, L1442, L1481, L1514, L1580, L1837, L1869, L1898,
 *        L1962, L2000, L2169, L2254, L2283, L2321, L2358, L2387)
 *   - supabase/functions/_shared/tools/scheduler-admin-catalog.ts:
 *       _logAudit() helper at L641 + 24 inline call sites
 *       (L381, L404, L429, L591, L934, L1062, L1080, L1138, L1170, L1197,
 *        L1238, L1368, L1742, L1785, L1810, L1853, L2004, L2250, L2262,
 *        L2319, L2347, L2385, L2491)
 *
 * Refactor scope for E4/E5: replace each inline insert with a
 * `logAuditEntry()` call that EXPLICITLY threads through the caller's
 * `shopId`. The existing helpers `logAdminAudit` + `_logAudit` should be
 * deleted in the same PR.
 *
 * Logs Sentry-style structured warnings on insert failure (matches the
 * inline sites' current log shape so dashboards keep working).
 *
 * @returns `{ id }` on success or `{ error }` on insert failure. Caller
 *          can ignore the result if it only needs side-effect logging.
 *
 * @throws if `shopId` is missing/null/non-positive (sentinel `-1` is
 *         BLOCKED on new writes — Migration A's sentinel handling is for
 *         backfill ONLY).
 */
export async function logAuditEntry(
  args: LogAuditEntryArgs,
): Promise<{ id: number } | { error: string }> {
  // REQUIRED-shopId guard. Sentinel `-1` is only for backfill; new writes
  // MUST carry a real positive shop_id.
  if (
    args.shopId === undefined ||
    args.shopId === null ||
    typeof args.shopId !== "number" ||
    !Number.isFinite(args.shopId) ||
    args.shopId <= 0
  ) {
    throw new Error(
      `logAuditEntry: shopId is REQUIRED and must be a positive integer (got ${JSON.stringify(args.shopId)}). Sentinel -1 is reserved for backfill PHASE 2 only — new writes always carry a real shop_id.`,
    );
  }

  const { data, error } = await args.supabase
    .from("scheduler_admin_audit_log")
    .insert({
      shop_id: args.shopId,
      oauth_client_id: args.oauthClientId ?? null,
      user_label: args.userLabel ?? null,
      table_name: args.tableName,
      operation: args.operation,
      rows_added: args.rowsAdded ?? 0,
      rows_modified: args.rowsModified ?? 0,
      rows_deactivated: args.rowsDeactivated ?? 0,
      md_content_hash: args.mdContentHash ?? null,
      diff_summary: args.diffSummary ?? null,
      pre_state_snapshot: args.preStateSnapshot ?? null,
      error_message: args.errorMessage ?? null,
      successor_revert_id: args.successorRevertId ?? null,
      reverts_upload_id: args.revertsUploadId ?? null,
    })
    .select("id")
    .single();

  if (error) {
    console.warn(
      JSON.stringify({
        level: "warning",
        msg: "scheduler_admin_audit_log_insert_failed",
        detail: error.message,
        shop_id: args.shopId,
        table_name: args.tableName,
        operation: args.operation,
      }),
    );
    return { error: error.message };
  }

  return { id: data?.id as number };
}
