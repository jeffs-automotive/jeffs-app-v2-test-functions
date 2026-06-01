// Cross-surface helpers shared by the MD-upload surfaces.
// Extracted from scheduler-admin-catalog.ts (file-size-refactor). Mechanical
// split — no logic changes. Public API preserved via the ./index.ts barrel +
// the scheduler-admin-catalog.ts re-export shim.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  logAuditEntry,
} from "../../scheduler-admin-md.ts";
import type { AdminAudit, UploadResult } from "../scheduler-admin.ts";

export function _failResult(
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

/**
 * E4 (2026-05-26) — shorthand for error-path audit-log inserts (parse fail,
 * column-presence fail, validation fail, fetch fail, cross-validate fail).
 * Mirrors the prior `_logAudit` error-path shape but threads shopId through
 * the E2 `logAuditEntry` helper so audit_log.shop_id is always populated.
 *
 * Used ONLY for failure paths; the happy-path audit row is inlined in each
 * uploader (it carries the enriched snapshot + diff_summary).
 */

export async function _logAuditError(
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

// E4 (2026-05-26): the prior `_logAudit()` helper has been REMOVED. All 24
// inline audit-row insert sites in this file now route through the E2
// `logAuditEntry()` helper (which REQUIRES shopId — closes the historical
// "may forget shop_id" footgun documented in scheduler-admin-md.ts comments).
// Error-path inserts go through the local `_logAuditError()` shorthand
// (above); happy-path inserts inline the full call so the snapshot
// enrichment (kind / expected_after_state_canonical / after_hash) stays
// adjacent to the data it depends on.

// ═══════════════════════════════════════════════════════════════════════
// Exporters — round-trip-safe Option B serialization
// ═══════════════════════════════════════════════════════════════════════

export function arraysEqualAsSets(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const v of b) if (!setA.has(v)) return false;
  return true;
}
