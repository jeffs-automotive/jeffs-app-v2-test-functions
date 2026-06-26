// Manual-review type subset used by the ported manual-reviews list query.
//
// Ported (Node idiom) from the type declarations in
// supabase/functions/_shared/manual-review.ts so the closure under queries/ is
// self-contained (no import from supabase/functions/**). Field-identical to the
// edge source; the admin-app boundary (read-dal.ts) casts these to the
// nominally-equivalent `@/lib/orchestrator/types` shapes.

export type ManualReviewCategory =
  | "orphan_release"
  | "work_approved_drift"
  | "ar_regression"
  | "ar_no_prior_tag"
  | "tekmetric_patch_fail";

export interface ManualReviewOption {
  /** Stable identifier the advisor types (e.g., "release", "keep_tag", "escalate"). */
  key: string;
  /** Short label shown next to the letter in the email ("Release Red 5"). */
  label: string;
  /** Plain-English description of what choosing this option will do. */
  description: string;
  /**
   * When true, the advisor must also supply color + tag_number when
   * resolving. Used for choices like "assign a specific tag" where
   * the system can't predetermine which tag the user means.
   */
  needs_tag_input?: boolean;
}

export interface ManualReviewContext {
  ro_id?: number | null;
  ro_number?: number | null;
  tag_color?: "red" | "yellow" | null;
  tag_number?: number | null;
  /** Free-form category-specific context (e.g., tekmetric_status_name, patch_error). */
  [key: string]: unknown;
}
