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
  /**
   * When `false`, the per-issuance Resend email is skipped. The review row
   * + audit log entry are still written so `code XXX-YYYYYY` lookup keeps
   * working in Claude Desktop.
   *
   * Default: `true` — preserves existing behavior for ORP/DRF/REG/PAF.
   *
   * 2026-05-23: `keytag-bulk-reconcile` passes `false` for the ARN
   * (`ar_no_prior_tag`) category because those reviews are consolidated
   * into the 7 AM `keytag-daily-report` email instead. After the user
   * manually released ~100 A/R keytags in a single day, the per-issue
   * email path produced 100 individual emails the next morning — moving
   * them to the daily digest is both quieter and gives operational context
   * (which RO had which tag, when it was released) the per-issue email
   * lacked.
   */
  sendEmail?: boolean;
}

export interface IssuedManualReview {
  code: string;
  review_id: number;
  audit_log_id: number | null;
  email_sent: boolean;
  email_error?: string;
  /**
   * True when this call INSERTED a new row + sent a fresh email.
   * False when a prior review for the SAME category + SAME ro_id existed
   * and the call short-circuited per the dedup gate below. Caller should
   * log differently in each case (e.g. action="manual_review_issued" vs
   * action="noop").
   */
  created: boolean;
  /**
   * When `created === false`, the `resolved_at` of the prior row at the
   * time we looked it up. `null` means the prior review is still pending;
   * a timestamp means it has already been resolved. Callers can use this
   * to phrase their log message ("kept pending review X" vs "kept resolved
   * review X"). Undefined when `created === true`.
   */
  existing_resolved_at?: string | null;
}

/**
 * Atomic: insert keytag_manual_reviews row + write audit log + send email,
 * OR short-circuit (no insert, no email) if a prior review of the SAME
 * category already exists for the same `context.ro_id`.
 *
 * Dedup gate (2026-05-13, category-aware per Chris's directive):
 *
 *   1. If `context.ro_id` is provided AND any prior `keytag_manual_reviews`
 *      row exists for THIS ro_id AND THIS category (resolved or pending),
 *      this function returns the prior row's code with `created: false`
 *      and does NOT insert a new row, does NOT send an email.
 *
 *   2. The check is scoped to (ro_id, category) — cross-category anomalies
 *      for the same RO are NOT suppressed. Each of the 5 categories
 *      represents a structurally different anomaly with a different
 *      resolution semantic, so each gets its own dedup namespace:
 *        - ARN (`ar_no_prior_tag`)     : "what tag is on these A/R keys"
 *        - ORP (`orphan_release`)      : "should we release this tag"
 *        - DRF (`work_approved_drift`) : "what tag for this WIP re-entry"
 *        - REG (`ar_regression`)       : "RO went A/R → WIP, what tag"
 *        - PAF (`tekmetric_patch_fail`): "DB↔Tekmetric sync drift"
 *      An RO that's had its ARN resolved can still legitimately need a
 *      DRF or PAF review later — those represent NEW anomalies, not
 *      duplicates of the resolved one.
 *
 *   3. Within a category, "resolved" means permanent — no auto re-issuance
 *      for the same RO + same category, regardless of how long ago the
 *      resolution happened. To re-open, an operator must either UPDATE
 *      resolved_at back to NULL or insert a new row manually.
 *
 *   4. Callers that need to know "was this a fresh issuance or a kept
 *      existing one?" check `result.created`. The existing 7 call sites
 *      log `manual_review_issued` when created=true and `noop` (or a
 *      "kept existing review" detail string) when created=false.
 *
 * Bypassing the dedup: if the context has no `ro_id` (rare — only
 * categories that don't bind to a specific RO), the dedup is skipped and
 * a fresh row is always created. There are no such categories today, but
 * the gate is defensively conditional.
 *
 * Performance: the dedup query is supported by the composite functional
 * index `keytag_manual_reviews_category_ro_id_idx` on
 * `(category, (context->>'ro_id'), issued_at DESC)` — see migration
 * `20260513XXXXXX_keytag_manual_reviews_category_ro_id_index.sql`.
 *
 * Known limitation (not addressed here): between the INSERT (step 2) and
 * the Resend send (step 3), the row exists with `email_sent_at = NULL`.
 * If an advisor manages to resolve the row in that ~ms window via Claude
 * Desktop, the email still sends. Practically impossible in normal ops;
 * a bulletproof fix would re-query resolved_at right before the Resend
 * POST. Not worth the extra roundtrip today.
 */
export async function issueManualReview(args: IssueManualReviewArgs): Promise<IssuedManualReview> {
  const { sb, category, context, options, issueSummary, auditSource } = args;
  const sendEmail = args.sendEmail ?? true;
  const prefix = CATEGORY_PREFIX[category];

  // ── Dedup gate by (category, ro_id) ────────────────────────────────────
  const roId = context.ro_id ?? null;
  if (roId !== null) {
    const { data: existing, error: dedupErr } = await sb
      .from("keytag_manual_reviews")
      .select("id, code, resolved_at, resolution_audit_log_id, category")
      .eq("category", category)
      .filter("context->>ro_id", "eq", String(roId))
      .order("issued_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (dedupErr) {
      throw new Error(`keytag_manual_reviews dedup lookup failed: ${dedupErr.message}`);
    }
    if (existing) {
      // Prior review for this (category, ro_id) exists. Short-circuit: no
      // INSERT, no email. The original row's email was sent at its issuance
      // time; the team already has it in their inbox or has resolved it.
      return {
        code: existing.code as string,
        review_id: existing.id as number,
        audit_log_id: (existing.resolution_audit_log_id as number | null) ?? null,
        email_sent: false,
        email_error: undefined,
        created: false,
        existing_resolved_at: (existing.resolved_at as string | null) ?? null,
      };
    }
  }

  // ── No prior review — proceed with create + email ─────────────────────
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

  // Send the email (unless suppressed by caller). Don't throw on email
  // failure — the review is already persisted, and the service team's
  // existing daily-digest surface can catch missed emails. Capture the
  // error on the row.
  //
  // 2026-05-23: ARN reviews from keytag-bulk-reconcile pass sendEmail:false
  // because they're rolled up into keytag-daily-report's "Repair Orders
  // Without Key Tags" section. mark_manual_review_email_sent is still
  // called with null error so the row's email_sent_at is set (semantically:
  // "no email was attempted, no error to record"). The lookup-via-code
  // workflow in Claude Desktop is unaffected — codes still resolve.
  if (sendEmail) {
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
      created: true,
    };
  }

  // Email suppressed — mark email_sent_at with null error to record the
  // intentional no-op (downstream queries can still distinguish "email
  // failed" from "email skipped" via the row's category + sender path).
  await sb.rpc("mark_manual_review_email_sent", {
    p_review_id: row.review_id as number,
    p_error: null,
  });

  return {
    code: row.code as string,
    review_id: row.review_id as number,
    audit_log_id: (row.audit_log_id as number | null) ?? null,
    email_sent: false,
    email_error: undefined,
    created: true,
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
