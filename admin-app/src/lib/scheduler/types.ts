/**
 * TypeScript shapes for the scheduler-admin orchestrator MCP tools.
 *
 * Source-of-truth references:
 * - `supabase/functions/_shared/scheduler-tools.ts` — orchestrator tool
 *   registry (Zod inputSchema per tool)
 * - `supabase/functions/_shared/tools/scheduler-admin.ts` — `UploadResult`,
 *   `AdminAudit`, `ValidationFinding`, `AuditLogEntry`, `RevertEligibility`,
 *   `RevertEligibilityReason`, `ListSchedulerAdminAuditLogResult`
 * - `supabase/functions/_shared/tools/scheduler-admin-catalog.ts` —
 *   `RevertResult` for the universal `revert_md_upload` tool
 * - `docs/scheduler/edge-parity/PLAN.md` §7 — canonical 10-kind ↔ surface_filter
 *   ↔ table mapping
 * - `docs/scheduler/edge-parity/decisions/ADR-007-canonical-reason-code-enum.md`
 *   — canonical `RevertReasonCode` enum (≥15 values)
 * - `docs/scheduler/edge-parity/decisions/ADR-021-audit-log-read-tool-surface-filter-reasons-union.md`
 *   — surface_filter enum + 9 cheap-eligibility reasons (STRICT SUBSET of ADR-007)
 *
 * Why redeclare instead of importing the edge types: Deno `npm:` imports
 * cannot cross into Next.js (Node bundler). Same pattern as
 * `src/lib/orchestrator/types.ts` for the keytag types. If you change a
 * tool's input/output shape on the edge fn side, mirror it here.
 */

// ─── Canonical enums (mirror ADR-007 + ADR-021) ──────────────────────────

/**
 * The 10 logical surfaces — passed as `surface_filter` to
 * `list_scheduler_admin_audit_log` AND used as the per-tab key in
 * `<RecentUploadsList>`. Three of the 10 share `concern_subcategories`
 * (subcategory_descriptions + subcategory_service_map + concern_subcategories);
 * two share `concern_questions` (question_required_facts + concern_questions).
 * The edge RPC disambiguates via `diff_summary.surfaces` for modern rows +
 * `table_name` fallback for legacy rows.
 */
export type SchedulerAdminSurface =
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

/**
 * The 10 snapshot_kind values per PLAN.md §7. Stored in
 * `scheduler_admin_audit_log.pre_state_snapshot.snapshot_kind`. Different
 * shape than `SchedulerAdminSurface` because (a) one surface can have multiple
 * kinds (`concern_subcategories` → `concern_questions_per_category` OR
 * `concern_subcategories_descriptions_v2`), and (b) kind names carry the V1/V2
 * vintage suffix.
 */
export type SnapshotKind =
  | "testing_services_v2"
  | "routine_services_v2"
  | "concern_subcategories_descriptions_v2"
  | "concern_subcategories_map_v2"
  | "concern_questions_required_facts_v2"
  | "concern_questions_flat"
  | "concern_questions_per_category"
  | "concern_category_guidelines"
  | "appointment_default_limits"
  | "closed_dates_future";

/** ADR-007 canonical reason_code enum — full universe. UI maps this to the
 * recovery-copy table in `docs/chat-instructions/scheduler/revert-upload.md`. */
export type RevertReasonCode =
  | "not_found"
  | "not_upload_md"
  | "snapshot_pruned"
  | "no_snapshot"
  | "over_30_day_cutoff"
  | "successor_revert_exists"
  | "table_not_supported"
  | "current_state_drift"
  | "cannot_safely_verify"
  | "confirm_token_mismatch"
  | "another_revert_in_progress"
  | "cross_shop_hijack_attempt"
  | "fk_broken"
  | "snapshot_invalid"
  | "unique_violation"
  | "unclassified_revert_blocked"
  | "rpc_failed";

/** ADR-021 §"Part 2 — reasons union (STRICT SUBSET of ADR-007)". The 9
 * cheap-eligibility predicates the list RPC can compute server-side. The
 * authoritative answer comes from invoking `revert_md_upload` directly. */
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

export type RevertOutcome = "success" | "dry_run_success" | "rejected" | "crashed";

// ─── Pattern S upload shape (universal across all 10 catalog uploaders) ──

/**
 * Per `UploadResult` in `supabase/functions/_shared/tools/scheduler-admin.ts`.
 * Same shape returned by both `dry_run=true` (preview) and `dry_run=false`
 * (apply). Discriminate via the `dry_run` boolean.
 */
export interface UploadDiffSummary {
  /** Kind specific. For testing_services / routine_services this is per
   * service_key; for concern_questions it's per question id. Wide-open. */
  [k: string]: unknown;
}

export interface UploadValidationError {
  row_index: number;
  field: string;
  message: string;
}

export interface UploadValidationWarning {
  key: string;
  field: string;
  level: "error" | "warning";
  message: string;
}

export interface UploadParseError {
  line_number: number;
  message: string;
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
  parse_errors?: UploadParseError[];
  validation_errors?: UploadValidationError[];
  validation_warnings?: UploadValidationWarning[];
  diff_summary?: UploadDiffSummary;
  /** True iff this call was a dry_run preview (no writes). */
  dry_run?: boolean;
  /** Returned from dry_run; must be passed back unchanged as
   * `expected_confirm_token` on the apply call. */
  confirm_token?: string;
  /** Set on a successful apply — the audit-log row id, usable with
   * `revert_md_upload`. */
  audit_log_id?: number;
  /** Set on apply-mode RPC failures — canonical reason_code per ADR-007. */
  reason_code?: string;
  /** ADR-002 attempt_id — only populated by revert paths; null for apply. */
  attempt_id?: number | null;
  error_message?: string;
}

// ─── Universal revert (Pattern S) ────────────────────────────────────────

/** Per `RevertResult` in `supabase/functions/_shared/tools/scheduler-admin-catalog.ts`.
 * Covers all 10 surfaces via the universal `revert_md_upload` wrapper.
 * Edge inner-RPC enforces all 4 eligibility conditions (`too_old`,
 * `revert_of_revert`, `already_reverted`, `current_state_drift`) per ADR-014. */
export interface RevertResult {
  /** True iff outcome IN ('success', 'dry_run_success'). */
  ok: boolean;
  upload_id: number;
  outcome: RevertOutcome;
  /** Canonical reason_code per ADR-007 — null on success outcomes. */
  reason_code: RevertReasonCode | null;
  /** Sanitized public-facing message per ADR-009 — safe to log/display. */
  error_message: string | null;
  /** Pivot key into scheduler_admin_revert_attempts for debug. */
  attempt_id: number | null;
  dry_run: boolean;
  /** Set when outcome=success — the REVERT's own audit_log_id (NOT the
   * original upload's). */
  audit_log_id: number | null;
  /** Set when outcome=dry_run_success — pass back as expected_confirm_token
   * to apply. */
  confirm_token: string | null;
  restored: number;
  deactivated: number;
  deleted: number;
}

// ─── Audit log read tool (ADR-021) ───────────────────────────────────────

export interface RevertEligibility {
  is_revertable: boolean;
  reasons: RevertEligibilityReason[];
}

/** Per `AuditLogEntry` in `supabase/functions/_shared/tools/scheduler-admin.ts`.
 * Output shape from `list_scheduler_admin_audit_log`. The `revert_eligibility`
 * field is the server-computed hint that drives the UI's Revert-button
 * enabled/disabled state. */
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

// ─── Export tool (universal across all 10 surfaces) ──────────────────────

export interface ExportMdResult {
  ok?: boolean;
  md_content: string;
  row_count: number;
  exported_at?: string;
}

// ─── Per-tool arg + result shapes (4 in scope for D.2-D.7) ───────────────

// Pattern S upload args — universal shape for the 10 catalog uploaders.
export interface UploadMdArgs {
  md_content?: string;
  dry_run?: boolean;
  expected_confirm_token?: string;
  source_branch?: string;
}

// `upload_concern_category_md` + `upload_concern_category_guideline_md`
// require an extra `category_slug` arg.
export interface UploadConcernCategoryArgs extends UploadMdArgs {
  category_slug:
    | "noise"
    | "vibration"
    | "pulling"
    | "smell"
    | "smoke"
    | "leak"
    | "warning_light"
    | "performance"
    | "electrical"
    | "hvac"
    | "brakes"
    | "steering"
    | "tires"
    | "other";
}

// Empty arg objects for read-only tools.
export type ExportMdArgs = Record<string, never>;
export interface ExportConcernCategoryArgs {
  category_slug: UploadConcernCategoryArgs["category_slug"];
}

export interface RevertMdUploadArgs {
  upload_id: number;
  dry_run?: boolean;
  expected_confirm_token?: string;
  force_no_after_hash?: boolean;
}

export interface ListSchedulerAdminAuditLogArgs {
  surface_filter?: SchedulerAdminSurface;
  limit?: number;
  only_successful?: boolean;
  only_revertable?: boolean;
}

// ─── Operations tools (D.7 — NOT Pattern S; one-shot soft-confirm) ──────

/** Args for the appointments-sync trigger. Optional `full_backfill` re-pulls
 * the entire 7-day window vs incremental delta. */
export interface RunAppointmentsSyncArgs {
  full_backfill?: boolean;
}

/** Per plan §7.5 — wide-open shape since the edge response evolves; cards
 * type-narrow at the consumer. Common fields documented. */
export interface RunAppointmentsSyncResult {
  ok: boolean;
  status?: string;
  /** Total rows synced this run. */
  summary?: {
    appointments_upserted?: number;
    appointments_soft_deleted?: number;
    duration_ms?: number;
    [k: string]: unknown;
  };
  /** Edge fn may surface its own message string. */
  message?: string;
  [k: string]: unknown;
}

export interface FindOrphanCustomersArgs {
  /** Default 30 days, max 180. */
  lookback_days?: number;
}

export interface OrphanCustomerEntry {
  customer_id?: number | string | null;
  tekmetric_id?: number | string | null;
  name?: string | null;
  last_seen_at?: string | null;
  last_synced_at?: string | null;
  [k: string]: unknown;
}

export interface FindOrphanCustomersResult {
  orphans: OrphanCustomerEntry[];
  count: number;
  lookback_days?: number;
  [k: string]: unknown;
}

// ─── Tool-name to arg/return mapping (typed dispatch) ────────────────────
//
// Keys are the SNAKE_CASE wire names per scheduler-tools.ts registry. NOT
// camelCase like the keytag map. The orchestrator-mcp's tools/call dispatch
// matches by exact tool name string.

export interface SchedulerToolMap {
  upload_subcategory_descriptions_md: {
    args: UploadMdArgs;
    result: UploadResult;
  };
  export_subcategory_descriptions_md: {
    args: ExportMdArgs;
    result: ExportMdResult;
  };
  upload_routine_services_md: { args: UploadMdArgs; result: UploadResult };
  export_routine_services_md: { args: ExportMdArgs; result: ExportMdResult };
  upload_testing_services_md: { args: UploadMdArgs; result: UploadResult };
  export_testing_services_md: { args: ExportMdArgs; result: ExportMdResult };
  upload_subcategory_service_map_md: {
    args: UploadMdArgs;
    result: UploadResult;
  };
  export_subcategory_service_map_md: {
    args: ExportMdArgs;
    result: ExportMdResult;
  };
  upload_question_required_facts_md: {
    args: UploadMdArgs;
    result: UploadResult;
  };
  export_question_required_facts_md: {
    args: ExportMdArgs;
    result: ExportMdResult;
  };
  upload_concern_questions_md: { args: UploadMdArgs; result: UploadResult };
  export_concern_questions_md: {
    args: ExportMdArgs;
    result: ExportMdResult;
  };
  upload_concern_category_md: {
    args: UploadConcernCategoryArgs;
    result: UploadResult;
  };
  export_concern_category_md: {
    args: ExportConcernCategoryArgs;
    result: ExportMdResult;
  };
  upload_concern_category_guideline_md: {
    args: UploadConcernCategoryArgs;
    result: UploadResult;
  };
  export_concern_category_guideline_md: {
    args: ExportConcernCategoryArgs;
    result: ExportMdResult;
  };
  upload_appointment_default_limits_md: {
    args: UploadMdArgs;
    result: UploadResult;
  };
  export_appointment_default_limits_md: {
    args: ExportMdArgs;
    result: ExportMdResult;
  };
  upload_closed_dates_md: { args: UploadMdArgs; result: UploadResult };
  export_closed_dates_md: { args: ExportMdArgs; result: ExportMdResult };
  revert_md_upload: { args: RevertMdUploadArgs; result: RevertResult };
  list_scheduler_admin_audit_log: {
    args: ListSchedulerAdminAuditLogArgs;
    result: ListSchedulerAdminAuditLogResult;
  };
  run_appointments_sync: {
    args: RunAppointmentsSyncArgs;
    result: RunAppointmentsSyncResult;
  };
  find_orphan_customers: {
    args: FindOrphanCustomersArgs;
    result: FindOrphanCustomersResult;
  };
}

export type SchedulerToolName = keyof SchedulerToolMap;

// ─── Server Action discriminated union (plan §5 adapter contract) ───────
//
// Each scheduler upload action returns this shape to the React layer. Maps
// the tool's wire shape onto a UI-friendly discriminated union for
// `useActionState`.

export interface SchedulerUploadConfirmation {
  confirm_token: string;
  diff_summary: UploadDiffSummary | undefined;
  rows_added: number;
  rows_modified: number;
  rows_deactivated: number;
  /** Soft warnings to surface in the diff preview (e.g., >50% price moves). */
  validation_warnings: UploadValidationWarning[] | undefined;
}

export interface SchedulerUploadSuccess {
  audit_log_id: number;
  rows_added: number;
  rows_modified: number;
  rows_deactivated: number;
  duplicate_upload?: boolean;
  table_name: string;
}

export type SchedulerUploadState =
  | { kind: "idle" }
  | { kind: "validation_error"; message: string; field?: string }
  | {
      kind: "needs_confirmation";
      args: { md_content: string };
      confirmation: SchedulerUploadConfirmation;
      timestamp: number;
    }
  | { kind: "success"; data: SchedulerUploadSuccess; timestamp: number }
  | {
      kind: "tool_error";
      data: { message: string; reason_code?: string };
      timestamp: number;
    }
  | { kind: "transport_error"; message: string; timestamp: number };

// Revert state — same shape pattern but maps the revert outcomes.
export interface SchedulerRevertConfirmation {
  confirm_token: string;
  restored: number;
  deactivated: number;
  deleted: number;
  attempt_id: number | null;
}

export interface SchedulerRevertSuccess {
  audit_log_id: number;
  restored: number;
  deactivated: number;
  deleted: number;
  attempt_id: number | null;
}

export type SchedulerRevertState =
  | { kind: "idle" }
  | { kind: "validation_error"; message: string }
  | {
      kind: "needs_confirmation";
      args: { upload_id: number };
      confirmation: SchedulerRevertConfirmation;
      timestamp: number;
    }
  | { kind: "success"; data: SchedulerRevertSuccess; timestamp: number }
  | {
      kind: "tool_error";
      data: {
        message: string;
        reason_code: RevertReasonCode | null;
        attempt_id: number | null;
      };
      timestamp: number;
    }
  | { kind: "transport_error"; message: string; timestamp: number };

// Export action — simpler shape (no Pattern S, just success/error).
export type SchedulerExportState =
  | { kind: "idle" }
  | { kind: "success"; data: ExportMdResult; timestamp: number }
  | { kind: "tool_error"; data: { message: string }; timestamp: number }
  | { kind: "transport_error"; message: string; timestamp: number };

// List-audit action — no useActionState; consumed by the Server Component
// directly. Re-exported for component prop typing.
export type ListAuditLogState = ListSchedulerAdminAuditLogResult;

// ─── Operations action state (D.7) — NOT Pattern S ─────────────────────
//
// Per plan v0.5 §7.5 the Operations tab uses a SEPARATE state-type tree
// from CatalogUploadState — keeps the two surfaces from accidentally
// sharing plumbing (e.g. dry_run / expected_confirm_token flow that
// doesn't apply to one-shot tools).

export type RunAppointmentsSyncState =
  | { kind: "idle" }
  | { kind: "success"; data: RunAppointmentsSyncResult; timestamp: number }
  | { kind: "tool_error"; data: { message: string }; timestamp: number }
  | { kind: "transport_error"; message: string; timestamp: number };

export type FindOrphanCustomersState =
  | { kind: "idle" }
  | { kind: "success"; data: FindOrphanCustomersResult; timestamp: number }
  | { kind: "tool_error"; data: { message: string }; timestamp: number }
  | { kind: "transport_error"; message: string; timestamp: number };
