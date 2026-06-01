// _shared — scheduler admin surface.
// Extracted from scheduler-admin.ts (file-size-refactor). Mechanical split —
// no logic changes. Public API preserved via ./index.ts + the re-export shim.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  logAuditEntry,
} from "../../scheduler-admin-md.ts";

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

// ─── Apply-RPC error classifier (mirrors ADR-008 outer classifier) ─────────
//
// The 5 apply RPCs RAISE EXCEPTION with one of the canonical prefixes per
// ADR-007. Parse the SQLERRM and classify into a reason_code. NEVER throws —
// returns an opaque "rpc_failed" fallback so the audit trail still surfaces.

export function classifyApplyRpcError(
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
export async function checkDuplicate(
  sb: SupabaseClient,
  tableName: string,
  hash: string,
): Promise<boolean> {
  const { data, error } = await sb
    .from("scheduler_admin_audit_log")
    .select("id")
    .eq("table_name", tableName)
    .eq("operation", "upload_md")
    .eq("md_content_hash", hash)
    .is("error_message", null)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    // Surface (don't swallow) the read error; treat as "not a duplicate" so a
    // transient read failure doesn't silently block a legitimate upload.
    console.warn(
      JSON.stringify({
        level: "warning",
        msg: "checkDuplicate query failed",
        table_name: tableName,
        detail: error.message,
      }),
    );
  }
  return !!data;
}
