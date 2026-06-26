// Manual-review TYPES only — decoupled from the Deno email leaf.
//
// COPY for the @jeffs/keytag-core read package (Phase 0 build-seam spike,
// 2026-06-26). The source `supabase/functions/_shared/manual-review.ts`
// statically imports `manual-review-email.ts` (which reads `Deno.env`), so it
// CANNOT be carried into a Node-importable package. `manual-review-list.ts`
// only needs three *type* declarations from it (`ManualReviewCategory`,
// `ManualReviewContext`, `ManualReviewOption`) — copied here verbatim so the
// read closure stays self-contained and Deno-env-free. Keep in sync with the
// source types if those ever change.

export type ManualReviewCategory =
  | "orphan_release"
  | "work_approved_drift"
  | "ar_regression"
  | "ar_no_prior_tag"
  | "tekmetric_patch_fail";

export const CATEGORY_PREFIX: Record<ManualReviewCategory, string> = {
  orphan_release: "ORP",
  work_approved_drift: "DRF",
  ar_regression: "REG",
  ar_no_prior_tag: "ARN",
  tekmetric_patch_fail: "PAF",
};

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
