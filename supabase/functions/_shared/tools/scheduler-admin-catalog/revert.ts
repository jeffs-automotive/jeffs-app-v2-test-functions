// revert MD-upload surface.
// Extracted from scheduler-admin-catalog.ts (file-size-refactor). Mechanical
// split — no logic changes. Public API preserved via the ./index.ts barrel +
// the scheduler-admin-catalog.ts re-export shim.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { AdminAudit } from "../scheduler-admin.ts";

export interface RevertArgs {
  /** ID returned in audit_log_id from a prior upload. */
  upload_id: number;
  audit: AdminAudit;
  /** Default TRUE — must explicitly pass false to apply the revert. */
  dry_run?: boolean;
  /** Required for apply (dry_run=false) — token from a prior dry-run response. */
  expected_confirm_token?: string;
  /**
   * ADR-014 escape hatch — operator override for snapshots that lack BOTH
   * `after_hash` AND `expected_after_state_canonical`. When false (default),
   * such snapshots reject with `reason_code='cannot_safely_verify'`. When true,
   * the inner RPC skips the staleness check entirely — operator accepts the
   * "we cannot verify what we're reverting OVER" risk. Use sparingly.
   */
  force_no_after_hash?: boolean;
}

/**
 * Structured outcome shape — mirrors the outer RPC's `RETURNS TABLE` 10
 * columns (per ADR-001) plus a derived `ok` boolean + `dry_run` echo. The
 * outer RPC NEVER re-RAISEs from its EXCEPTION block (per ADR-001 + ADR-008);
 * inner-path failures surface as `outcome IN ('rejected', 'crashed')` with
 * the classified `reason_code` per ADR-007 + sanitized `error_message` per
 * ADR-009. Verbose `error_detail` lives in `scheduler_admin_revert_attempts.error_detail`
 * (DB-only per ADR-010) and is NOT returned here; operators pivot from the
 * `attempt_id` to the row for full debug context.
 */
export interface RevertResult {
  /** True iff outcome IN ('success', 'dry_run_success'). */
  ok: boolean;
  upload_id: number;
  /** One of: success, dry_run_success, rejected, crashed. */
  outcome: "success" | "dry_run_success" | "rejected" | "crashed";
  /** Canonical reason_code per ADR-007 — null on success outcomes. */
  reason_code: string | null;
  /** Sanitized public-facing error_message per ADR-009 — safe to log/display. */
  error_message: string | null;
  /** Pivot key into scheduler_admin_revert_attempts for full debug context. */
  attempt_id: number | null;
  dry_run: boolean;
  /** Set when outcome=success — the revert's own audit_log_id (NOT the upload's). */
  audit_log_id: number | null;
  /** Set when outcome=dry_run_success — pass this back as expected_confirm_token to apply. */
  confirm_token: string | null;
  restored: number;
  deactivated: number;
  deleted: number;
}

/** Raw row shape returned by the outer RPC per ADR-001 RETURNS TABLE clause. */
interface RevertRpcRow {
  audit_log_id: number | null;
  confirm_token: string | null;
  restored: number;
  deactivated: number;
  deleted: number;
  dry_run: boolean;
  outcome: string;
  reason_code: string | null;
  error_message: string | null;
  attempt_id: number | null;
}

/**
 * E8 (2026-05-26) — REPLACED 145-line legacy TS-side dispatcher with this
 * thin wrapper around the outer plpgsql RPC `revert_md_upload_attempt`.
 * The RPC handles:
 *   - STEP 0a/b/c/d guards + attempt-row pre-INSERT (ADR-002)
 *   - Dispatch across all 10 snapshot_kinds (ADR-024)
 *   - 12-step inner RPC: lock-targets → canonical-compute → staleness check
 *     → token verify → per-kind handler → revert audit row INSERT (ADR-012)
 *   - EXCEPTION classifier producing structured outcome (ADR-008 + ADR-009)
 *
 * TS-side responsibilities (~55 lines):
 *   1. Pass through args (incl. dry_run + expected_confirm_token + force_no_after_hash)
 *   2. Call sb.rpc('revert_md_upload_attempt').single()
 *   3. Classify on data.outcome (NOT error_message)
 *   4. Emit Sentry per ADR-010 redaction policy on rejected/crashed outcomes
 *   5. Return structured RevertResult
 *
 * The OLD wrapper only handled testing_services + routine_services (2 of 10
 * surfaces) with TS-side dispatch. This wrapper covers all 10 via the outer
 * RPC's dispatch helper (lock_targets_for_kind → 10 CASE branches).
 */
export async function revertMdUpload(
  sb: SupabaseClient,
  shopId: number,
  args: RevertArgs,
): Promise<RevertResult> {
  const {
    upload_id,
    audit,
    dry_run = true,
    expected_confirm_token,
    force_no_after_hash = false,
  } = args;

  // Call outer RPC. Per ADR-001, the outer ALWAYS returns a structured row
  // and NEVER re-RAISEs from its EXCEPTION block — inner-path failures
  // surface as data.outcome IN ('rejected', 'crashed'). The `error` field
  // only fires for STEP 0a/b/c RAISEs (Branch 3 per ADR-002 — malformed
  // params before the EXCEPTION block opens) or PostgREST transport errors.
  const { data, error } = await sb
    .rpc("revert_md_upload_attempt", {
      p_upload_id: upload_id,
      p_shop_id: shopId,
      p_actor_email: audit.display_name,
      p_oauth_client_id: audit.oauth_client_id,
      p_dry_run: dry_run,
      p_expected_confirm_token: expected_confirm_token ?? null,
      p_force_no_after_hash: force_no_after_hash,
    })
    .single<RevertRpcRow>();

  if (error || !data) {
    const errMsg = error?.message ?? "no row returned from revert_md_upload_attempt";
    console.warn(JSON.stringify({
      level: "error",
      msg: "revert_md_upload_attempt_rpc_error",
      shop_id: shopId,
      upload_id,
      dry_run,
      detail: errMsg,
    }));
    return {
      ok: false,
      upload_id,
      outcome: "crashed",
      reason_code: null,
      error_message: `RPC error (likely malformed params or transport failure): ${errMsg}`,
      attempt_id: null,
      dry_run,
      audit_log_id: null,
      confirm_token: null,
      restored: 0,
      deactivated: 0,
      deleted: 0,
    };
  }

  const OK_OUTCOMES = new Set(["success", "dry_run_success"]);
  const isOk = OK_OUTCOMES.has(data.outcome);

  if (!isOk) {
    // Per ADR-010 redaction tier-1 (Sentry payload): include reason_code +
    // outcome + attempt_id tags but NOT error_message detail (sanitized only)
    // or error_detail (DB-only). Verbose detail lives in
    // scheduler_admin_revert_attempts.error_detail; operators pivot from
    // attempt_id to the row for full debug context.
    console.warn(JSON.stringify({
      level: data.outcome === "crashed" ? "error" : "warning",
      msg: `revert_attempt:${data.outcome}`,
      shop_id: shopId,
      upload_id,
      outcome: data.outcome,
      reason_code: data.reason_code ?? "<none>",
      attempt_id: data.attempt_id,
      actor_email: audit.display_name,
      oauth_client_id: audit.oauth_client_id,
      dry_run,
    }));
  }

  return {
    ok: isOk,
    upload_id,
    outcome: data.outcome as RevertResult["outcome"],
    reason_code: data.reason_code,
    error_message: data.error_message,
    attempt_id: data.attempt_id,
    dry_run: data.dry_run,
    audit_log_id: data.audit_log_id,
    confirm_token: data.confirm_token,
    restored: data.restored,
    deactivated: data.deactivated,
    deleted: data.deleted,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// subcategory_service_map — wide-table uploader/exporter (2026-05-20)
//
// Mutates ONLY concern_subcategories.eligible_testing_service_keys (text[]).
// Does NOT create / modify / delete subcategories or testing_services
// themselves — only the mapping column.
//
// MD format (single wide markdown table):
//
//   # Subcategory → Testing Service Mappings
//
//   <!-- format guidance -->
//
//   | category | subcategory_slug | testing_service_keys |
//   | --- | --- | --- |
//   | warning_light | check_engine_light | check_engine_light_testing |
//   | warning_light | engine_temperature_light | coolant_leak_testing, check_engine_light_testing |
//   | warning_light | brake_system_red_light | brake_inspection_warning_light |
//   | warning_light | multiple_warning_lights_at_once | warning_light_general |
//   | warning_light | something_unmapped |  |     ← blank cell = CLEAR mapping
//
// Validation rules (BLOCK apply):
//   - category ∈ 14 canonical concern category slugs
//   - subcategory_slug + category must exist in concern_subcategories (active)
//   - duplicate (category, subcategory_slug) in same upload → block
//   - every testing_service_key must exist in testing_services (active)
//
// Diff semantics:
//   - Rows NOT mentioned in the MD are LEFT ALONE (no silent clear).
//   - Rows mentioned with a blank/empty/"(none)" cell are CLEARED (set to '{}').
//   - Rows mentioned with a non-empty cell get their array REPLACED with
//     the listed service_keys (in MD order, de-duped).
//
// Two-step dry_run + confirm_token apply, mirrors the V2 catalog
// uploaders. Same audit log table (scheduler_admin_audit_log) with
// table_name='concern_subcategories' + operation='upload_md'.
// ═══════════════════════════════════════════════════════════════════════
