// audit-log — scheduler admin surface.
// Extracted from scheduler-admin.ts (file-size-refactor). Mechanical split —
// no logic changes. Public API preserved via ./index.ts + the re-export shim.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  logAuditEntry,
  type SnapshotKind,
} from "../../scheduler-admin-md.ts";
import { _logAuditError } from "./_shared.ts";
import { uploadConcernQuestionsMd } from "./concern-questions.ts";
import { uploadAppointmentDefaultLimitsMd } from "./appointment-default-limits.ts";
import { uploadClosedDatesMd } from "./closed-dates.ts";
import { uploadConcernCategoryMd } from "./concern-category.ts";
import { uploadConcernCategoryGuidelineMd } from "./concern-category-guidelines.ts";

// ─── listSchedulerAdminAuditLog (E7 — 2026-05-26) ────────────────────────────
//
// Per ADR-021 + PLAN §6. Returns up to `limit` (default 10, max 50) recent
// scheduler_admin_audit_log rows for the caller shop, with a per-row
// `revert_eligibility` hint computed TS-side from cheap predicates (9 reasons
// — STRICT SUBSET of the ADR-007 canonical reason_code enum). The eligibility
// hint is NON-AUTHORITATIVE: the UI uses it to enable/disable a Revert button,
// but the authoritative eligibility answer always comes from invoking
// revert_md_upload_attempt directly (which surfaces drift / token-mismatch /
// attempt-time rejections via ADR-008's classifier).
//
// SQL surface filter lives in the SECURITY DEFINER RPC
// `list_scheduler_admin_audit_log_filtered` (migration 20260526000600). The
// RPC handles the ADR-021 conditional COALESCE fallback + JSONB `?` existence
// operator with positional binding the PostgREST builder can't easily express.

/** ADR-021 §"Part 2 — reasons union (9 values, STRICT SUBSET of ADR-007)". */
export type RevertEligibilityReason =
  | "not_upload_md"
  | "snapshot_pruned"
  | "no_snapshot"
  | "table_not_supported"
  | "upload_failed"
  | "successor_revert_exists"
  | "over_30_day_cutoff"
  | "shop_id_unknown_pre_migration_backfill"
  | "cannot_safely_verify";

export interface RevertEligibility {
  is_revertable: boolean;
  reasons: RevertEligibilityReason[];
}

/** Output shape per ADR-021 §6.3. `occurred_at` matches the DB column name. */
export interface AuditLogEntry {
  id: number;
  occurred_at: string;
  table_name: string;
  operation: string;
  shop_id: number | null;
  user_label: string | null;
  oauth_client_id: string | null;
  md_content_hash: string | null;
  rows_added: number;
  rows_modified: number;
  rows_deactivated: number;
  error_message: string | null;
  diff_summary: Record<string, unknown> | null;
  successor_revert_id: number | null;
  reverts_upload_id: number | null;
  revert_eligibility: RevertEligibility;
}

export interface ListSchedulerAdminAuditLogResult {
  rows: AuditLogEntry[];
  total_returned: number;
}

/**
 * Logical surface → physical table_name mapping per ADR-021. Five logical
 * surfaces (subcategory_descriptions, subcategory_service_map, concern_
 * subcategories share concern_subcategories; question_required_facts +
 * concern_questions share concern_questions). The wrapper passes BOTH the
 * logical surface (matched by modern rows via diff_summary->surfaces) AND
 * the physical table (legacy-row fallback) so the conditional SQL clause
 * can disambiguate.
 */
type SurfaceFilter =
  | "routine_services"
  | "testing_services"
  | "subcategory_descriptions"
  | "subcategory_service_map"
  | "question_required_facts"
  | "concern_questions"
  | "concern_subcategories"
  | "concern_category_guidelines"
  | "appointment_default_limits"
  | "closed_dates";

const SURFACE_TO_TABLE: Record<SurfaceFilter, string> = {
  routine_services: "routine_services",
  testing_services: "testing_services",
  subcategory_descriptions: "concern_subcategories",
  subcategory_service_map: "concern_subcategories",
  question_required_facts: "concern_questions",
  concern_questions: "concern_questions",
  concern_subcategories: "concern_subcategories",
  concern_category_guidelines: "concern_category_guidelines",
  appointment_default_limits: "appointment_default_limits",
  closed_dates: "closed_dates",
};

/**
 * The 10 snapshot kinds the revert dispatch (E1b-e) knows how to handle.
 * Mirror of `SnapshotKind` in scheduler-admin-md.ts — kept locally for the
 * cheap eligibility predicate's `table_not_supported` check. Drift between
 * this set and the dispatch's CASE branches surfaces at attempt-time as
 * `snapshot_kind_unknown` (ADR-011 reclassifies to `crashed`); the list-tool
 * surfaces it pre-flight as `table_not_supported`.
 */
const KNOWN_SNAPSHOT_KINDS: ReadonlySet<string> = new Set<string>([
  "testing_services_v2",
  "routine_services_v2",
  "concern_subcategories_descriptions_v2",
  "concern_subcategories_map_v2",
  "concern_questions_required_facts_v2",
  "concern_questions_flat",
  "concern_questions_per_category",
  "concern_category_guidelines",
  "appointment_default_limits",
  "closed_dates_future",
]);

/**
 * Resolve snapshot_kind from a raw audit row. Modern rows carry
 * `diff_summary.kind` explicitly (added with the v2 dispatch). Legacy rows
 * lack it; fall back to a table_name-based heuristic for the two legacy
 * V1 tables that still write audit rows (testing_services + routine_services
 * per the revert-of-V2 path); everything else returns null → caller surfaces
 * `table_not_supported`.
 */
function resolveSnapshotKind(
  diffSummary: Record<string, unknown> | null,
  tableName: string,
): string | null {
  // Prefer explicit kind on modern rows.
  if (
    diffSummary &&
    typeof (diffSummary as { kind?: unknown }).kind === "string"
  ) {
    const k = (diffSummary as { kind: string }).kind;
    return KNOWN_SNAPSHOT_KINDS.has(k) ? k : null;
  }
  // Legacy fallback for the two pre-v2 catalog tables (the only ones whose
  // historical rows have no diff_summary.kind but DO have a valid snapshot
  // shape — testing_services + routine_services). Everything else without
  // diff_summary.kind returns null → `table_not_supported`.
  if (tableName === "testing_services") return "testing_services_v2";
  if (tableName === "routine_services") return "routine_services_v2";
  return null;
}

/** Shape of `pre_state_snapshot` we care about for the cannot_safely_verify
 *  cheap check. We never deserialize the full snapshot here — only inspect
 *  the two hash-related fields. */
interface SnapshotShape {
  after_hash?: unknown;
  expected_after_state_canonical?: unknown;
  // … (other fields irrelevant to the cheap predicate)
}

/**
 * Compute per-row revert eligibility from cheap predicates per ADR-021.
 * ALL predicates are O(1) audit-row column reads except `successor_revert_exists`
 * which we batch resolve in a single follow-up query (passed in via
 * `successorRevertExists`).
 */
function computeRevertEligibility(args: {
  operation: string;
  preStateSnapshot: SnapshotShape | null;
  snapshotPrunedAt: string | null;
  errorMessage: string | null;
  occurredAt: string;
  shopId: number | null;
  diffSummary: Record<string, unknown> | null;
  tableName: string;
  successorRevertExists: boolean;
}): RevertEligibility {
  const reasons: RevertEligibilityReason[] = [];

  // 1. operation !== 'upload_md' → not_upload_md (blocks revert-of-revert chains)
  if (args.operation !== "upload_md") {
    reasons.push("not_upload_md");
  }

  // 2. snapshot_pruned_at IS NOT NULL → snapshot_pruned (30-day retention)
  if (args.snapshotPrunedAt !== null) {
    reasons.push("snapshot_pruned");
  }

  // 3. pre_state_snapshot IS NULL → no_snapshot (apply failed before snapshot,
  //    or pre-2026-05-19 legacy row)
  if (args.preStateSnapshot === null) {
    reasons.push("no_snapshot");
  }

  // 4. error_message IS NOT NULL on the upload row → upload_failed
  //    (NOT the v0.5-removed 'failed' revert-attempt outcome — this is the
  //     original upload's partial-write failure)
  if (args.errorMessage !== null) {
    reasons.push("upload_failed");
  }

  // 5. occurred_at < now() - INTERVAL '30 days' → over_30_day_cutoff
  //    (per ADR-007 naming: no leading digits)
  const occurredMs = Date.parse(args.occurredAt);
  const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  if (!Number.isNaN(occurredMs) && occurredMs < cutoffMs) {
    reasons.push("over_30_day_cutoff");
  }

  // 6. shop_id IS NULL OR shop_id <= 0 → shop_id_unknown_pre_migration_backfill
  //    (Migration A leaves shop_id NULL on historical rows; backfill PHASE 2
  //     sets sentinel -1 for rows whose shop_id couldn't be derived;
  //     Migration B then flips to NOT NULL + CHECK (shop_id > 0 OR shop_id = -1).
  //     This check covers both intermediate states.)
  if (args.shopId === null || args.shopId <= 0) {
    reasons.push("shop_id_unknown_pre_migration_backfill");
  }

  // 7. snapshot_kind unresolvable → table_not_supported
  //    (The 10 known kinds match the dispatch CASE branches; anything else
  //     is a pre-v2 row for a table the revert system never learned about.)
  const snapshotKind = resolveSnapshotKind(args.diffSummary, args.tableName);
  if (snapshotKind === null) {
    reasons.push("table_not_supported");
  }

  // 8. successor_revert_exists (batched O(1) lookup) — caller has already
  //    queried reverts_upload_id IN (...) for the result set.
  if (args.successorRevertExists) {
    reasons.push("successor_revert_exists");
  }

  // 9. snapshot present but missing BOTH after_hash AND
  //    expected_after_state_canonical → cannot_safely_verify
  //    (Same enum the inner revert RPC surfaces at attempt time when
  //     force_no_after_hash was NOT passed — drift-detection impossible.)
  if (args.preStateSnapshot !== null) {
    const hasAfterHash = args.preStateSnapshot.after_hash != null;
    const hasCanonical =
      args.preStateSnapshot.expected_after_state_canonical != null;
    if (!hasAfterHash && !hasCanonical) {
      reasons.push("cannot_safely_verify");
    }
  }

  return {
    is_revertable: reasons.length === 0,
    reasons,
  };
}

export interface ListSchedulerAdminAuditLogArgs {
  surface_filter?: SurfaceFilter;
  limit?: number;
  only_successful?: boolean;
  only_revertable?: boolean;
}

/**
 * Edge-callable list tool. Fetches up to `limit` recent audit rows for the
 * caller shop via the SECURITY DEFINER RPC, then computes per-row
 * revert_eligibility from cheap predicates. The `only_revertable` filter
 * runs TS-side AFTER eligibility computation so the full 9-reason union is
 * available — the SQL layer cannot express the same logic without per-row
 * canonical reads (deferred to the authoritative revert_md_upload_attempt
 * call per ADR-021).
 */
export async function listSchedulerAdminAuditLog(
  sb: SupabaseClient,
  shopId: number,
  args: ListSchedulerAdminAuditLogArgs,
): Promise<ListSchedulerAdminAuditLogResult> {
  const limit = args.limit ?? 10;
  const onlySuccessful = args.only_successful ?? false;
  const onlyRevertable = args.only_revertable ?? false;
  const surfaceFilter = args.surface_filter ?? null;
  const tableFilter =
    surfaceFilter !== null ? SURFACE_TO_TABLE[surfaceFilter] : null;

  const { data: rawRows, error: rpcError } = await sb.rpc(
    "list_scheduler_admin_audit_log_filtered",
    {
      p_shop_id: shopId,
      p_surface_filter: surfaceFilter,
      p_table_filter: tableFilter,
      p_only_successful: onlySuccessful,
      p_limit: limit,
    },
  );
  if (rpcError) {
    throw new Error(
      `list_scheduler_admin_audit_log RPC failed: ${rpcError.message}`,
    );
  }
  const rowsRaw = (rawRows ?? []) as Array<{
    id: number;
    occurred_at: string;
    table_name: string;
    operation: string;
    shop_id: number | null;
    user_label: string | null;
    oauth_client_id: string | null;
    md_content_hash: string | null;
    rows_added: number;
    rows_modified: number;
    rows_deactivated: number;
    error_message: string | null;
    diff_summary: Record<string, unknown> | null;
    pre_state_snapshot: SnapshotShape | null;
    snapshot_pruned_at: string | null;
    successor_revert_id: number | null;
    reverts_upload_id: number | null;
  }>;

  // ─── Successor-revert existence: one O(1) batched IN-list query ──────
  // For each upload row in the result set, check whether any audit row
  // with operation='revert_upload' AND reverts_upload_id = this.id exists.
  // We only care about upload_md rows (revert rows can't be re-reverted),
  // so scope the IN-list to those. Also bound to the same shop_id for
  // multi-tenant safety even though RLS would already filter.
  const uploadIds = rowsRaw
    .filter((r) => r.operation === "upload_md")
    .map((r) => r.id);
  const successorSet = new Set<number>();
  if (uploadIds.length > 0) {
    const { data: successorRows, error: successorErr } = await sb
      .from("scheduler_admin_audit_log")
      .select("reverts_upload_id")
      .eq("shop_id", shopId)
      .eq("operation", "revert_upload")
      .is("error_message", null)
      .in("reverts_upload_id", uploadIds);
    if (successorErr) {
      throw new Error(
        `successor-revert lookup failed: ${successorErr.message}`,
      );
    }
    for (const row of (successorRows ?? []) as Array<{
      reverts_upload_id: number | null;
    }>) {
      if (row.reverts_upload_id !== null) {
        successorSet.add(row.reverts_upload_id);
      }
    }
  }

  // ─── Compute eligibility per row ─────────────────────────────────────
  const enriched: AuditLogEntry[] = rowsRaw.map((r) => {
    const revert_eligibility = computeRevertEligibility({
      operation: r.operation,
      preStateSnapshot: r.pre_state_snapshot,
      snapshotPrunedAt: r.snapshot_pruned_at,
      errorMessage: r.error_message,
      occurredAt: r.occurred_at,
      shopId: r.shop_id,
      diffSummary: r.diff_summary,
      tableName: r.table_name,
      successorRevertExists: successorSet.has(r.id),
    });
    return {
      id: r.id,
      occurred_at: r.occurred_at,
      table_name: r.table_name,
      operation: r.operation,
      shop_id: r.shop_id,
      user_label: r.user_label,
      oauth_client_id: r.oauth_client_id,
      md_content_hash: r.md_content_hash,
      rows_added: r.rows_added,
      rows_modified: r.rows_modified,
      rows_deactivated: r.rows_deactivated,
      error_message: r.error_message,
      diff_summary: r.diff_summary,
      successor_revert_id: r.successor_revert_id,
      reverts_upload_id: r.reverts_upload_id,
      revert_eligibility,
    };
  });

  // ─── TS-side only_revertable filter (uses the full reasons union) ────
  // Cannot push this into the SQL layer per ADR-021 — successor-revert is
  // a follow-up query, snapshot_kind resolution is JS-side, and the
  // cannot_safely_verify predicate inspects snapshot internals.
  const filtered = onlyRevertable
    ? enriched.filter((r) => r.revert_eligibility.is_revertable)
    : enriched;

  return {
    rows: filtered,
    total_returned: filtered.length,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// E5 (2026-05-26): the prior local `logAdminAudit()` helper has been REMOVED.
// All 36 prior inline `logAdminAudit(...)` call sites in this file now route
// through the E2 `logAuditEntry()` helper (which REQUIRES shopId — closes the
// historical "may forget shop_id" footgun documented in scheduler-admin-md.ts
// comments + Migration A/B hardening). Error-path inserts go through the local
// `_logAuditError()` shorthand (above); happy-path inserts inline the full call
// so the snapshot + diff_summary + counts stay adjacent to the data they
// describe. See ROUND-6-RESIDUALS E2-N2 + this E5 refactor for the migration
// audit. The 5 LEGACY uploaders (uploadConcernQuestionsMd, uploadConcernCategoryMd,
// uploadConcernCategoryGuidelineMd, uploadAppointmentDefaultLimitsMd,
// uploadClosedDatesMd) write their happy-path audit row INSIDE the apply RPC
// (atomic with mutations) per PLAN §4 + E1f migration 20260526000500.
// ════════════════════════════════════════════════════════════════════════════
