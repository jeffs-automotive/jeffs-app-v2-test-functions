// Shared helpers for the keytag manual-review system.
//
// The system surfaces anomalies it can't safely auto-resolve to the
// service team via 6-char codes + email. Service advisors resolve them
// in Claude Desktop with "code ORP-X4B72C option a" style intents.
//
// This module wraps the DB RPCs + the email-send call so the webhook
// handler, bulk-reconcile, and orchestrator tools all use the same
// canonical issuance + resolution path.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendManualReviewEmail } from "./manual-review-email.ts";

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

export interface IssueManualReviewArgs {
  sb: SupabaseClient;
  category: ManualReviewCategory;
  context: ManualReviewContext;
  options: ManualReviewOption[];
  issueSummary: string;
  /** 'webhook' | 'cron' — for the paired audit-log entry */
  auditSource: "webhook" | "cron";
}

export interface IssuedManualReview {
  code: string;
  review_id: number;
  audit_log_id: number | null;
  email_sent: boolean;
  email_error?: string;
}

/**
 * Atomic: insert keytag_manual_reviews row + write audit log + send email.
 * Returns the code + IDs + email status. Idempotency: each call generates
 * a fresh code, so callers should de-dupe at the detection layer (e.g.,
 * bulk-reconcile shouldn't fire two ORPs for the same orphan in one run).
 */
export async function issueManualReview(args: IssueManualReviewArgs): Promise<IssuedManualReview> {
  const { sb, category, context, options, issueSummary, auditSource } = args;
  const prefix = CATEGORY_PREFIX[category];

  const { data, error } = await sb.rpc("create_manual_review", {
    p_category: category,
    p_prefix: prefix,
    p_context: context,
    p_options: options,
    p_issue_summary: issueSummary,
    p_tag_color: context.tag_color ?? null,
    p_tag_number: context.tag_number ?? null,
    p_ro_id: context.ro_id ?? null,
    p_ro_number: context.ro_number ?? null,
    p_audit_source: auditSource,
  });
  if (error) {
    throw new Error(`create_manual_review failed: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.code) {
    throw new Error("create_manual_review returned no row");
  }

  // Send the email. Don't throw on email failure — the review is
  // already persisted, and the service team's existing daily-digest
  // surface can catch missed emails. Capture the error on the row.
  const emailResult = await sendManualReviewEmail({
    code: row.code as string,
    category,
    issueSummary,
    options,
    context,
  });

  await sb.rpc("mark_manual_review_email_sent", {
    p_review_id: row.review_id as number,
    p_error: emailResult.error ?? null,
  });

  return {
    code: row.code as string,
    review_id: row.review_id as number,
    audit_log_id: (row.audit_log_id as number | null) ?? null,
    email_sent: !emailResult.error,
    email_error: emailResult.error,
  };
}

// ─── Lookup + resolve (called by orchestrator tools) ────────────────────────

export interface LookupManualReviewArgs {
  sb: SupabaseClient;
  code: string;
  userLabel: string;
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

export async function lookupManualReview(
  args: LookupManualReviewArgs,
): Promise<LookupManualReviewResult> {
  const { sb, code, userLabel } = args;
  const normalized = normalizeCode(code);

  const { data, error } = await sb.rpc("lookup_manual_review", {
    p_code: normalized,
    p_user_label: userLabel,
  });
  if (error) {
    return {
      ok: false,
      code: normalized,
      failure_reason: "code_not_found",
      message: `lookup_manual_review RPC error: ${error.message}`,
    };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok) {
    return {
      ok: false,
      code: normalized,
      failure_reason: row?.failure_reason ?? "code_not_found",
      message: failureMessage(row?.failure_reason ?? "code_not_found", normalized),
    };
  }
  return {
    ok: true,
    code: normalized,
    category: row.category as ManualReviewCategory,
    issue_summary: row.issue_summary as string,
    context: row.context as ManualReviewContext,
    options: row.options as ManualReviewOption[],
    issued_at: row.issued_at as string,
    resolved_at: (row.resolved_at as string | null) ?? null,
    resolved_choice: (row.resolved_choice as string | null) ?? null,
  };
}

export interface ResolveManualReviewArgs {
  sb: SupabaseClient;
  code: string;
  choice: string;
  userLabel: string;
  color?: "red" | "yellow";
  tagNumber?: number;
  notes?: string;
}

export type ResolveManualReviewResult =
  | {
      ok: true;
      code: string;
      review_id: number;
      category: ManualReviewCategory;
      context: ManualReviewContext;
      chosen_option: ManualReviewOption;
      color?: "red" | "yellow";
      tag_number?: number;
    }
  | {
      ok: false;
      code: string;
      failure_reason:
        | "user_label_required"
        | "lockout_active"
        | "code_not_found"
        | "already_resolved"
        | "invalid_choice"
        | "choice_requires_tag_input"
        | "invalid_color"
        | "invalid_tag_number";
      chosen_option?: ManualReviewOption;
      message: string;
    };

export async function resolveManualReview(
  args: ResolveManualReviewArgs,
): Promise<ResolveManualReviewResult> {
  const { sb, code, choice, userLabel, color, tagNumber, notes } = args;
  const normalized = normalizeCode(code);

  const { data, error } = await sb.rpc("resolve_manual_review", {
    p_code: normalized,
    p_choice: choice,
    p_user_label: userLabel,
    p_color: color ?? null,
    p_tag_number: tagNumber ?? null,
    p_notes: notes ?? null,
  });
  if (error) {
    return {
      ok: false,
      code: normalized,
      failure_reason: "code_not_found",
      message: `resolve_manual_review RPC error: ${error.message}`,
    };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok) {
    return {
      ok: false,
      code: normalized,
      failure_reason: row?.failure_reason ?? "code_not_found",
      chosen_option: row?.chosen_option as ManualReviewOption | undefined,
      message: failureMessage(row?.failure_reason ?? "code_not_found", normalized),
    };
  }
  return {
    ok: true,
    code: normalized,
    review_id: row.review_id as number,
    category: row.category as ManualReviewCategory,
    context: row.context as ManualReviewContext,
    chosen_option: row.chosen_option as ManualReviewOption,
    color,
    tag_number: tagNumber,
  };
}

/**
 * Attach the audit-log entry that captured the resolution action to the
 * review row, for forward-tracing. Called by the orchestrator tool after
 * it writes its log_keytag_audit entry.
 */
export async function attachResolutionAuditLog(
  sb: SupabaseClient,
  reviewId: number,
  auditLogId: number,
): Promise<void> {
  await sb.rpc("attach_resolution_audit_log", {
    p_review_id: reviewId,
    p_audit_log_id: auditLogId,
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Lenient code normalization. Advisors may type with/without dashes, in
 * mixed case, with stray whitespace. Reject anything that doesn't match
 * the canonical PFX-XXXXXX shape after normalization.
 */
export function normalizeCode(raw: string): string {
  const trimmed = raw.trim().toUpperCase();
  // Insert dash after the 3-letter prefix if missing
  if (/^[A-Z]{3}[A-Z0-9]{6}$/.test(trimmed)) {
    return `${trimmed.slice(0, 3)}-${trimmed.slice(3)}`;
  }
  return trimmed;
}

function failureMessage(reason: string, code: string): string {
  switch (reason) {
    case "user_label_required":
      return `Cannot resolve ${code}: caller is not authenticated. The advisor must be signed in.`;
    case "lockout_active":
      return `Cannot resolve ${code}: too many failed code attempts in the last hour. Wait an hour and try again, or ask Chris.`;
    case "code_not_found":
      return `Code ${code} not found. Double-check the email — codes are 3 letters + 6 alphanumeric characters (no 0, O, 1, I, L to avoid confusion).`;
    case "already_resolved":
      return `Code ${code} has already been resolved. Each code is single-use; if the issue still needs work, ask Chris to issue a new review.`;
    case "invalid_choice":
      return `That choice isn't on the options list for ${code}. Check the email or ask Claude to look up the code again.`;
    case "choice_requires_tag_input":
      return `That choice requires a specific color + tag number. Re-state your answer with the color and number (e.g., "code ${code} option assign red 5").`;
    case "invalid_color":
      return `Tag color must be "red" or "yellow".`;
    case "invalid_tag_number":
      return `Tag number must be between 1 and 90.`;
    default:
      return `Could not resolve ${code}: ${reason}.`;
  }
}
