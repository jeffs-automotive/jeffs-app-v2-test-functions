/**
 * TypeScript shapes for the 10 keytag orchestrator MCP tools.
 *
 * IMPORTANT — KEEP IN SYNC with the source-of-truth Zod schemas at
 * `supabase/functions/_shared/orchestrator-tools.ts` (per-tool input
 * schemas) and the per-tool return types at:
 *   - `_shared/tools/repair-orders.ts` (WipKeyTagsResult)
 *   - `_shared/tools/keytag-extras.ts` (WhoIsOnTagResult,
 *     RevertKeytagResult, MarkKeytagPostedResult,
 *     RunBulkReconcileResult, AuditHistoryEntry)
 *   - `_shared/tools/keytag-management.ts` (AssignKeytagResult,
 *     ReleaseKeytagResult)
 *   - `_shared/manual-review.ts` (LookupManualReviewResult,
 *     ManualReviewContext, ManualReviewOption)
 *   - `_shared/tools/manual-review-tools.ts`
 *     (ResolveManualReviewToolResult)
 *   - `_shared/keytag-confirmation.ts` (ConfirmationRequiredResult)
 *
 * Why redeclare instead of import: the source files live under
 * `supabase/functions/` and use Deno's `npm:` imports. Importing them
 * from Next.js (Node bundler) doesn't work. This redeclaration is the
 * same pattern as `src/lib/supabase/resolve-keys.ts` (copied verbatim
 * from scheduler-app).
 *
 * If you change a tool's input/output shape on the edge fn side,
 * mirror it here.
 */

// ─── Pattern A confirmation envelope (4 tools use this) ─────────────────

export interface ConfirmationRequiredResult {
  ok: false;
  needs_confirmation: true;
  confirmation: {
    token_id: string;
    expires_at: string;
    action_kind:
      | "release_ar_tag"
      | "release_wip_tag"
      | "revert_to_assigned"
      | "mark_posted"
      | "force_assign"
      | "bulk_release"
      | "bulk_mark_posted"
      | "bulk_revert"
      | "bulk_force_assign";
    scope_summary: string;
  };
  message: string;
}

export type TagColor = "red" | "yellow";

// ─── Tool 1: listWipKeyTags ─────────────────────────────────────────────

// No arguments — empty object is the wire shape.
export type ListWipKeyTagsArgs = Record<string, never>;

export interface WipKeyTagEntry {
  ro_number: number;
  ro_id: number;
  tag: string; // "R4" | "Y45"
  tag_color: TagColor;
  tag_number: number;
  status: "assigned" | "posted_ar";
  customer_id: number | null;
  vehicle_id: number | null;
  ro_url: string;
  last_activity_at: string | null;
}

export interface WipKeyTagsResult {
  ok: true;
  count: number;
  shop_id: number;
  results: WipKeyTagEntry[];
}

// ─── Tool 2: whoIsOnTag ─────────────────────────────────────────────────

export interface WhoIsOnTagArgs {
  color: TagColor;
  tag_number: number;
}

export type WhoIsOnTagResult =
  | {
      ok: true;
      found: true;
      tag: string;
      tag_color: TagColor;
      tag_number: number;
      ro_number: number;
      ro_id: number;
      ro_url: string;
      status: "assigned" | "posted_ar";
      customer_name: string | null;
      vehicle_year: number | null;
      vehicle_make: string | null;
      vehicle_model: string | null;
      vehicle_display: string | null;
      last_activity_at: string | null;
    }
  | {
      ok: true;
      found: false;
      tag: string;
      tag_color: TagColor;
      tag_number: number;
      message: string;
    };

// ─── Tool 3: assignKeytagToRo (Pattern A confirmation when forced) ──────

export interface AssignKeytagToRoArgs {
  ro_number: number;
  color?: TagColor;
  tag_number?: number;
  confirmation_token?: string;
}

export type AssignKeytagResult =
  | {
      ok: true;
      ro_number: number;
      ro_id: number;
      tag: { color: TagColor; number: number; label: string; wire: string };
      tekmetric_patched: boolean;
      tekmetric_patch_error?: string;
      ro_url: string;
      auto_assigned: boolean;
    }
  | {
      ok: false;
      error_code:
        | "ro_not_found"
        | "ro_already_has_tag"
        | "tag_in_use_by_other_ro"
        | "tag_not_found"
        | "pool_exhausted"
        | "rpc_error"
        | "confirmation_failed";
      message: string;
      ro_number: number;
      requested_tag?: { color: TagColor; number: number; label: string };
      current_tag?: { color: TagColor; number: number; label: string };
    }
  | ConfirmationRequiredResult;

// ─── Tool 4: releaseKeytagFromRo (Pattern A confirmation when posted_ar) ─

export interface ReleaseKeytagFromRoArgs {
  ro_number: number;
  confirmation_token?: string;
}

export type ReleaseKeytagResult =
  | {
      ok: true;
      ro_number: number;
      ro_id: number | null;
      released_tag: { color: TagColor; number: number; label: string } | null;
      tekmetric_cleared: boolean;
      tekmetric_clear_error?: string;
      message: string;
    }
  | {
      ok: false;
      error_code: "ro_not_found" | "rpc_error" | "confirmation_failed";
      message: string;
      ro_number: number;
    }
  | ConfirmationRequiredResult;

// ─── Tool 5: revertKeytagToAssigned (Pattern A confirmation when posted_ar) ─

export interface RevertKeytagToAssignedArgs {
  ro_number: number;
  confirmation_token?: string;
}

export type RevertKeytagResult =
  | {
      ok: true;
      ro_number: number;
      ro_id: number;
      tag_color: TagColor;
      tag_number: number;
      tag_label: string;
      prior_status: "assigned" | "posted_ar";
      already_assigned: boolean;
      ro_url: string;
      message: string;
    }
  | {
      ok: false;
      error_code:
        | "ro_not_found_in_keytags"
        | "rpc_error"
        | "confirmation_failed";
      message: string;
      ro_number: number;
    }
  | ConfirmationRequiredResult;

// ─── Tool 6: markKeytagPosted (Pattern A confirmation always) ───────────

export interface MarkKeytagPostedArgs {
  ro_number: number;
  posted_at?: string; // ISO 8601
  confirmation_token?: string;
}

export type MarkKeytagPostedResult =
  | {
      ok: true;
      ro_number: number;
      ro_id: number;
      tag_color: TagColor;
      tag_number: number;
      tag_label: string;
      posted_at: string;
      ro_url: string;
      message: string;
    }
  | {
      ok: false;
      error_code:
        | "ro_not_found_in_keytags"
        | "rpc_error"
        | "confirmation_failed";
      message: string;
      ro_number: number;
    }
  | ConfirmationRequiredResult;

// ─── Tool 7: runBulkReconcile (no Pattern A) ────────────────────────────

export interface RunBulkReconcileArgs {
  dry_run?: boolean;
  overwrite?: boolean;
}

export interface RunBulkReconcileResult {
  ok: boolean;
  duration_ms: number;
  tekmetric_wip_count: number;
  tekmetric_ar_count: number;
  actions: {
    assigned_new: number;
    marked_posted: number;
    reverted: number;
    touched: number;
    repatched: number;
    released_orphan: number;
    noop: number;
    error: number;
  };
  pool: {
    in_use: number;
    available: number;
  };
  orphan_email: {
    attempted: boolean;
    sent: boolean;
    error?: string;
    orphan_count: number;
  };
  message: string;
}

// ─── Tools 8 + 9: manual reviews ────────────────────────────────────────

export interface ManualReviewOption {
  key: string;
  label: string;
  description: string;
  needs_tag_input?: boolean;
}

export interface ManualReviewContext {
  // Loose shape — per-category JSONB. Common fields:
  ro_number?: number;
  ro_url?: string;
  tag_color?: TagColor;
  tag_number?: number;
  customer_name?: string;
  vehicle_display?: string;
  [key: string]: unknown;
}

export type ManualReviewCategory =
  | "orphan_release"
  | "work_approved_drift"
  | "ar_regression"
  | "ar_no_prior_tag"
  | "tekmetric_patch_fail"
  // Forward-compat for AVM (appointment verification mismatch) — added P1.7
  | "appointment_verification_mismatch";

export interface LookupManualReviewArgs {
  code: string; // PFX-XXXXXX format
}

export type LookupManualReviewResult =
  | {
      ok: true;
      code: string;
      category: ManualReviewCategory;
      issue_summary: string;
      context: ManualReviewContext;
      options: ManualReviewOption[];
      issued_at: string;
      resolved_at: string | null;
      resolved_choice: string | null;
    }
  | {
      ok: false;
      code: string;
      failure_reason:
        | "user_label_required"
        | "lockout_active"
        | "code_not_found";
      message: string;
    };

export interface ResolveManualReviewArgs {
  code: string;
  choice: string; // varies by category — see options[].key
  color?: TagColor;
  tag_number?: number;
  notes?: string;
}

export type ResolveManualReviewToolResult =
  | {
      ok: true;
      code: string;
      category: ManualReviewCategory;
      action_taken: string;
      details: Record<string, unknown>;
      message: string;
    }
  | {
      ok: false;
      code: string;
      failure_reason: string;
      message: string;
    };

// ─── Tool 10: getKeytagAuditHistory ─────────────────────────────────────

export interface GetKeytagAuditHistoryArgs {
  since?: string;
  until?: string;
  user_label?: string;
  tag_color?: TagColor;
  tag_number?: number;
  ro_number?: number;
  action?:
    | "assigned"
    | "force_assigned"
    | "marked_posted"
    | "reverted"
    | "released"
    | "released_orphan";
  source?: "claude_desktop" | "webhook" | "cron" | "manual_sql";
  limit?: number;
}

export interface AuditHistoryEntry {
  id: number;
  occurred_at: string;
  tag: string;
  tag_color: TagColor;
  tag_number: number;
  ro_number: number | null;
  action: string;
  prior_status: string | null;
  new_status: string | null;
  source: string;
  user_label: string | null;
  reason: string | null;
  tekmetric_patch_ok: boolean | null;
}

export interface GetKeytagAuditHistoryResult {
  ok: true;
  filters: Record<string, unknown>;
  count: number;
  results: AuditHistoryEntry[];
  truncated: boolean;
  message: string;
}

// ─── Tool 11: listManualReviews ─────────────────────────────────────────
// Mirrors `_shared/tools/manual-review-list.ts`.

export interface ListManualReviewsArgs {
  only_open?: boolean;
  search?: string;
  limit?: number;
}

export interface ManualReviewListItem {
  code: string;
  category: ManualReviewCategory;
  issue_summary: string;
  ro_id: number | null;
  ro_number: number | null;
  tag_color: TagColor | null;
  tag_number: number | null;
  options: ManualReviewOption[];
  context: ManualReviewContext;
  issued_at: string;
  resolved_at: string | null;
  resolved_choice: string | null;
  resolved_by_user_label: string | null;
}

export interface ListManualReviewsResult {
  ok: true;
  count: number;
  open_count: number;
  results: ManualReviewListItem[];
}

// ─── Tool 12: getKeytagDashboard ────────────────────────────────────────
// Mirrors `_shared/tools/keytag-dashboard-tool.ts` + `keytag-dashboard-data.ts`.

export type GetKeytagDashboardArgs = Record<string, never>;

export interface DashboardStaleTag {
  tag_color: TagColor;
  tag_number: number;
  ro_id: number;
  ro_number: number;
  customer_name: string;
  days_stale: number;
  ro_url: string;
  category: "wip" | "ar";
}

export interface DashboardRoWithoutTag {
  arn_code: string;
  ro_id: number | null;
  ro_number: number | null;
  ro_url: string;
  status_label: string;
  prior_tag_color: TagColor | null;
  prior_tag_number: number | null;
  released_at: string | null;
  released_source: string | null;
  days_open: number;
}

export interface KeytagGridTile {
  tag_color: TagColor;
  tag_number: number;
  in_use: boolean;
  status: string;
  ro_number: number | null;
}

export interface KeytagDashboardResult {
  ok: true;
  generated_at: string;
  counts: {
    in_use: number;
    available: number;
    stale: number;
    total: number;
  };
  stale: DashboardStaleTag[];
  ros_without_tags: DashboardRoWithoutTag[];
  grid: KeytagGridTile[];
}

// ─── Tool-name to arg/return mapping (typed dispatch) ───────────────────

export interface KeytagToolMap {
  listWipKeyTags: { args: ListWipKeyTagsArgs; result: WipKeyTagsResult };
  whoIsOnTag: { args: WhoIsOnTagArgs; result: WhoIsOnTagResult };
  assignKeytagToRo: {
    args: AssignKeytagToRoArgs;
    result: AssignKeytagResult;
  };
  releaseKeytagFromRo: {
    args: ReleaseKeytagFromRoArgs;
    result: ReleaseKeytagResult;
  };
  revertKeytagToAssigned: {
    args: RevertKeytagToAssignedArgs;
    result: RevertKeytagResult;
  };
  markKeytagPosted: {
    args: MarkKeytagPostedArgs;
    result: MarkKeytagPostedResult;
  };
  runBulkReconcile: {
    args: RunBulkReconcileArgs;
    result: RunBulkReconcileResult;
  };
  lookupManualReview: {
    args: LookupManualReviewArgs;
    result: LookupManualReviewResult;
  };
  resolveManualReview: {
    args: ResolveManualReviewArgs;
    result: ResolveManualReviewToolResult;
  };
  getKeytagAuditHistory: {
    args: GetKeytagAuditHistoryArgs;
    result: GetKeytagAuditHistoryResult;
  };
  listManualReviews: {
    args: ListManualReviewsArgs;
    result: ListManualReviewsResult;
  };
  getKeytagDashboard: {
    args: GetKeytagDashboardArgs;
    result: KeytagDashboardResult;
  };
}

export type KeytagToolName = keyof KeytagToolMap;

/**
 * Type-narrow helper to detect the Pattern A confirmation envelope.
 * Useful at the UI layer to switch into the confirmation-modal flow.
 */
export function isConfirmationRequired(
  v: unknown,
): v is ConfirmationRequiredResult {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { ok?: unknown }).ok === false &&
    (v as { needs_confirmation?: unknown }).needs_confirmation === true
  );
}
