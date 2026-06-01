// types — keytag-bulk-reconcile module.
// Extracted from keytag-bulk-reconcile/index.ts (file-size-refactor). Mechanical split.

import { type TekmetricRepairOrder } from "../_shared/tekmetric-client.ts";
import { type TagColor } from "../_shared/keytag-format.ts";

// ── Types ───────────────────────────────────────────────────────────────────

// The shared TekmetricRepairOrder interface doesn't include updatedDate, so
// extend it here. (Field is present in the API response; just not declared
// upstream because no other caller needed it yet.)
export interface RepairOrderWithUpdated extends TekmetricRepairOrder {
  updatedDate?: string | null;
}

export interface ReconcileResult {
  ro_id: number;
  ro_number: number;
  tekmetric_status_id: number;
  tekmetric_status_name: string;
  action:
    | "assigned_new"           // forward pass — RO seen in WIP/AR, no tag yet
    | "marked_posted"          // forward pass — flipped assigned → posted_ar
    | "reverted"               // forward OR reverse pass — flipped posted_ar → assigned
    | "touched"                // forward OR reverse pass — refreshed last_activity_at only
    | "repatched"              // forward pass — re-PATCHed Tekmetric to match DB
    | "released_orphan"        // reverse pass — RO is gone or paid; tag released (LEGACY)
    | "manual_review_issued"   // ORP / ARN / DRF / REG / PAF — review code generated, email sent
    | "noop"
    | "error";
  tag_color?: TagColor;
  tag_number?: number;
  tag_string?: string;
  patch_ok?: boolean;
  patch_error?: string;
  detail?: string;
  error?: string;
  /** When a manual review code was issued for this RO during this reconcile. */
  manual_review_code?: string;
  /** True when the result came from the reverse pass (DB-driven, GETs the RO individually). */
  reverse_pass?: boolean;
}

export interface OrphanReleaseDetail {
  ro_id: number;
  ro_number: number;
  tag_color: TagColor;
  tag_number: number;
  prior_status: "assigned" | "posted_ar";
  reason: string;
  tekmetric_status_at_release: string;
}

export interface ReconcileSummary {
  started_at: string;
  completed_at: string;
  duration_ms: number;
  shop_id: number;
  dry_run: boolean;
  overwrite: boolean;
  tekmetric_wip_count: number;
  tekmetric_ar_count: number;
  reverse_pass_count: number;
  actions: {
    assigned_new: number;
    marked_posted: number;
    reverted: number;
    touched: number;
    repatched: number;
    released_orphan: number;
    manual_review_issued: number;
    noop: number;
    error: number;
  };
  pool: { in_use: number; available: number };
  /** 6-char codes issued during this run (ORP / DRF / REG / ARN / PAF). */
  manual_review_codes: string[];
  /** LEGACY: pre-manual-review orphan-email path. Now always empty; kept for backwards compatibility. */
  orphan_email: {
    attempted: boolean;
    sent: boolean;
    error?: string;
    orphans: OrphanReleaseDetail[];
  };
  results: ReconcileResult[];
}
