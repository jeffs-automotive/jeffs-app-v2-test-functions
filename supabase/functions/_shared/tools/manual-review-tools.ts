// Orchestrator-facing tools for the keytag manual review system.
//
// Two tools:
//   - lookupManualReview: read the situation + options for a given 6-char code
//   - resolveManualReview: apply the advisor's chosen option, mark resolved,
//                          write audit log
//
// Both subject to rate-limit lockout (3 failed code lookups in 1 hour per
// user_label). Bound to the OAuth user_label of the caller.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  buildTekmetricRoUrl,
} from "../tekmetric.ts";
import {
  describeKeytag,
  formatKeytag,
  type TagColor,
} from "../keytag-format.ts";
import { tekmetricFetch } from "../tekmetric-client.ts";
import { getRepairOrderById, type TekmetricRepairOrder } from "./repair-orders.ts";
import { stampKeytagCustomerName } from "../keytag-customer-name.ts";
import {
  attachResolutionAuditLog,
  lookupManualReview as lookupRpc,
  resolveManualReview as resolveRpc,
  type LookupManualReviewResult,
  type ManualReviewCategory,
  type ManualReviewOption,
} from "../manual-review.ts";

// ─── Tool: lookupManualReview ───────────────────────────────────────────────

export type LookupManualReviewToolResult = LookupManualReviewResult;

export async function lookupManualReviewTool(
  sb: SupabaseClient,
  args: { code: string; userLabel: string },
): Promise<LookupManualReviewToolResult> {
  return await lookupRpc({ sb, code: args.code, userLabel: args.userLabel });
}

// ─── Tool: resolveManualReview ──────────────────────────────────────────────

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

export async function resolveManualReviewTool(
  sb: SupabaseClient,
  shopId: number,
  args: {
    code: string;
    choice: string;
    userLabel: string;
    color?: TagColor;
    tagNumber?: number;
    notes?: string;
    /**
     * Channel that originated this resolution → keytag_audit_log.source. 'admin_app' for the
     * dashboard, 'claude_desktop' for the OAuth/Claude-Desktop branch. Defaults to
     * 'claude_desktop' for back-compat with existing callers.
     */
    source?: "admin_app" | "claude_desktop";
  },
): Promise<ResolveManualReviewToolResult> {
  const { sb: _, ...rest } = args as unknown as { sb?: SupabaseClient };
  void _;
  const auditSource = args.source ?? "claude_desktop";

  const resolution = await resolveRpc({
    sb,
    code: args.code,
    choice: args.choice,
    userLabel: args.userLabel,
    color: args.color,
    tagNumber: args.tagNumber,
    notes: args.notes,
  });
  if (!resolution.ok) {
    return {
      ok: false,
      code: resolution.code,
      failure_reason: resolution.failure_reason,
      message: resolution.message,
    };
  }

  // Apply the chosen action based on (category, choice). Each branch:
  //   - Calls the appropriate underlying RPC / Tekmetric write
  //   - Writes an audit-log entry referencing the code
  //   - Attaches the audit-log id back to the review row
  try {
    const dispatched = await dispatchResolution(sb, shopId, resolution, args.userLabel, auditSource);
    return dispatched;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      code: resolution.code,
      failure_reason: "action_failed",
      message: `The code resolved correctly but the chosen action failed to execute: ${msg}. The review is marked resolved in our records — Chris can manually re-run the action.`,
    };
  }
}

// ─── Action dispatcher (the heart of the resolution flow) ───────────────────

interface ResolvedRecord {
  ok: true;
  code: string;
  review_id: number;
  category: ManualReviewCategory;
  context: Record<string, unknown>;
  chosen_option: ManualReviewOption;
  color?: TagColor;
  tag_number?: number;
}

async function dispatchResolution(
  sb: SupabaseClient,
  shopId: number,
  res: ResolvedRecord,
  resolverLabel: string,
  auditSource: "admin_app" | "claude_desktop",
): Promise<ResolveManualReviewToolResult> {
  const ctx = res.context as {
    ro_id?: number;
    ro_number?: number;
    tag_color?: TagColor;
    tag_number?: number;
    [k: string]: unknown;
  };
  const choiceKey = res.chosen_option.key;
  const code = res.code;
  const cat = res.category;

  // Universal escalation path
  if (choiceKey === "escalate_chris") {
    // No action — just leave a note. Chris notification could be wired here
    // (Sentry alert, Resend email, etc.) but for now the review row + audit
    // log are the surface.
    await writeAuditLog(sb, {
      tagColor: (ctx.tag_color as TagColor | null | undefined) ?? null,
      tagNumber: (ctx.tag_number as number | null | undefined) ?? null,
      action: "manual_review_resolved",
      source: auditSource,
      roId: (ctx.ro_id as number | undefined) ?? null,
      roNumber: (ctx.ro_number as number | undefined) ?? null,
      userLabel: resolverLabel,
      reason: `manual_review_resolved:${cat}:escalate_chris`,
      manualReviewCode: code,
      reviewId: res.review_id,
    });
    return {
      ok: true,
      code,
      category: cat,
      action_taken: "escalated_to_chris",
      details: { ro_number: ctx.ro_number },
      message: `Code ${code} resolved as 'escalate to Chris'. No automatic action taken — Chris will be notified to handle this manually.`,
    };
  }

  // ── Category-specific dispatch ──
  switch (cat) {
    case "orphan_release":
      return await dispatchOrphan(sb, shopId, res, ctx, resolverLabel, auditSource);
    case "ar_no_prior_tag":
      return await dispatchArn(sb, shopId, res, ctx, resolverLabel, auditSource);
    case "work_approved_drift":
    case "ar_regression":
      return await dispatchDrift(sb, shopId, res, ctx, resolverLabel, auditSource);
    case "tekmetric_patch_fail":
      return await dispatchPatchFail(sb, shopId, res, ctx, resolverLabel, auditSource);
  }
}

// ── ORP: orphan release ─────────────────────────────────────────────────────
async function dispatchOrphan(
  sb: SupabaseClient,
  _shopId: number,
  res: ResolvedRecord,
  ctx: { ro_id?: number; ro_number?: number; tag_color?: TagColor; tag_number?: number },
  resolverLabel: string,
  auditSource: "admin_app" | "claude_desktop",
): Promise<ResolveManualReviewToolResult> {
  const tagColor = ctx.tag_color as TagColor;
  const tagNumber = ctx.tag_number as number;
  const code = res.code;
  const choice = res.chosen_option.key;

  if (choice === "release") {
    // Call release_keytag_as_orphan (sets GUC, Layer 4 lockdown bypass)
    const { error } = await sb.rpc("release_keytag_as_orphan", {
      p_ro_id: ctx.ro_id,
      p_reason: `manual_review_${code}_release`,
    });
    if (error) {
      return {
        ok: false,
        code,
        failure_reason: "release_failed",
        message: `Could not release ${describeKeytag(tagColor, tagNumber)}: ${error.message}`,
      };
    }
    const auditId = await writeAuditLog(sb, {
      tagColor,
      tagNumber,
      action: "released",
      source: auditSource,
      roId: ctx.ro_id ?? null,
      roNumber: ctx.ro_number ?? null,
      userLabel: resolverLabel,
      reason: `manual_review_${code}_release`,
      manualReviewCode: code,
      reviewId: res.review_id,
    });
    return {
      ok: true,
      code,
      category: "orphan_release",
      action_taken: "released",
      details: { tag: describeKeytag(tagColor, tagNumber), ro_number: ctx.ro_number, audit_log_id: auditId },
      message: `Released ${describeKeytag(tagColor, tagNumber)} from RO #${ctx.ro_number}. The tag is back in the pool.`,
    };
  }

  if (choice === "keep_tag") {
    // No state change; just record the decision.
    const auditId = await writeAuditLog(sb, {
      tagColor,
      tagNumber,
      action: "manual_review_resolved",
      source: auditSource,
      roId: ctx.ro_id ?? null,
      roNumber: ctx.ro_number ?? null,
      userLabel: resolverLabel,
      reason: `manual_review_${code}_keep_tag`,
      manualReviewCode: code,
      reviewId: res.review_id,
    });
    return {
      ok: true,
      code,
      category: "orphan_release",
      action_taken: "kept_tag",
      details: { tag: describeKeytag(tagColor, tagNumber), ro_number: ctx.ro_number, audit_log_id: auditId },
      message: `Kept ${describeKeytag(tagColor, tagNumber)} held on RO #${ctx.ro_number}. No state change.`,
    };
  }

  return unknownChoice(code, "orphan_release", choice);
}

// ── ARN: A/R RO with no prior tag ──────────────────────────────────────────
async function dispatchArn(
  sb: SupabaseClient,
  shopId: number,
  res: ResolvedRecord,
  ctx: { ro_id?: number; ro_number?: number },
  resolverLabel: string,
  auditSource: "admin_app" | "claude_desktop",
): Promise<ResolveManualReviewToolResult> {
  const code = res.code;
  const choice = res.chosen_option.key;
  const color = res.color;
  const tagNumber = res.tag_number;

  if (choice === "track_tag") {
    if (!color || tagNumber === undefined) {
      return {
        ok: false,
        code,
        failure_reason: "missing_tag_input",
        message: "track_tag requires color + tag_number.",
      };
    }
    // Best-effort RO fetch → real customer/vehicle ids + customer_name stamp so
    // the A/R board row isn't blank. Falls back to null ids on fetch failure;
    // never blocks the DB-only force-assign. (No Tekmetric PATCH — A/R blocks it.)
    const ro = await fetchRoForReassign(sb, shopId, ctx.ro_id, ctx.ro_number);
    const { data: assignData, error: assignErr } = await sb.rpc("force_assign_keytag", {
      p_ro_id: ctx.ro_id,
      p_ro_number: ctx.ro_number,
      p_tag_color: color,
      p_tag_number: tagNumber,
      p_customer_id: ro?.customerId ?? null,
      p_vehicle_id: ro?.vehicleId ?? null,
      p_advisor_id: null,
      p_technician_id: null,
    });
    if (assignErr) {
      return {
        ok: false,
        code,
        failure_reason: "force_assign_failed",
        message: `Could not record ${describeKeytag(color, tagNumber)}: ${assignErr.message}`,
      };
    }
    const row = Array.isArray(assignData) ? assignData[0] : assignData;
    if (row?.error_code) {
      return {
        ok: false,
        code,
        failure_reason: row.error_code,
        message: `Could not record ${describeKeytag(color, tagNumber)}: ${row.error_code}`,
      };
    }
    // Stamp customer_name off the critical path (errors swallowed inside).
    if (ro && ctx.ro_id !== undefined) {
      await stampKeytagCustomerName(sb, shopId, ctx.ro_id, ro.customerId);
    }
    // Immediately mark it posted_ar (the RO is in A/R) so the staleness clock is right
    await sb.rpc("mark_keytag_posted", {
      p_ro_id: ctx.ro_id,
      p_posted_at: new Date().toISOString(),
      p_last_activity_at: new Date().toISOString(),
    });
    const auditId = await writeAuditLog(sb, {
      tagColor: color,
      tagNumber,
      action: "force_assigned",
      source: auditSource,
      roId: ctx.ro_id ?? null,
      roNumber: ctx.ro_number ?? null,
      userLabel: resolverLabel,
      reason: `manual_review_${code}_track_tag_ar`,
      manualReviewCode: code,
      reviewId: res.review_id,
    });
    return {
      ok: true,
      code,
      category: "ar_no_prior_tag",
      action_taken: "tracked_tag_db_only",
      details: { tag: describeKeytag(color, tagNumber), ro_number: ctx.ro_number, audit_log_id: auditId },
      message: `Recorded ${describeKeytag(color, tagNumber)} on RO #${ctx.ro_number} in our system. Tekmetric was NOT updated (the RO is in A/R, which Tekmetric locks). When the RO is paid, our system will release the tag normally.`,
    };
  }

  if (choice === "no_tag") {
    const auditId = await writeAuditLog(sb, {
      tagColor: null, // no real tag involved (policy decision)
      tagNumber: null,
      action: "manual_review_resolved",
      source: auditSource,
      roId: ctx.ro_id ?? null,
      roNumber: ctx.ro_number ?? null,
      userLabel: resolverLabel,
      reason: `manual_review_${code}_no_tag_ar`,
      manualReviewCode: code,
      reviewId: res.review_id,
    });
    return {
      ok: true,
      code,
      category: "ar_no_prior_tag",
      action_taken: "no_tag",
      details: { ro_number: ctx.ro_number, audit_log_id: auditId },
      message: `Recorded that RO #${ctx.ro_number} has no key tag. We won't track this RO further.`,
    };
  }

  return unknownChoice(code, "ar_no_prior_tag", choice);
}

// ── DRF / REG: drift after work_approved or A/R regression ─────────────────
async function dispatchDrift(
  sb: SupabaseClient,
  shopId: number,
  res: ResolvedRecord,
  ctx: { ro_id?: number; ro_number?: number; tag_color?: TagColor; tag_number?: number },
  resolverLabel: string,
  auditSource: "admin_app" | "claude_desktop",
): Promise<ResolveManualReviewToolResult> {
  const code = res.code;
  const choice = res.chosen_option.key;
  const cat = res.category;
  const priorColor = ctx.tag_color as TagColor | undefined;
  const priorNumber = ctx.tag_number as number | undefined;

  // use_prior_tag: re-attach the historic tag + PATCH Tekmetric
  // use_different_tag: force-assign the advisor's specified tag + PATCH
  // assign_new: round-robin assign + PATCH
  if (choice === "use_prior_tag") {
    if (!priorColor || !priorNumber) {
      return unknownChoice(code, cat, choice, "no prior tag in context");
    }
    return await forceAssignAndPatch(sb, shopId, res, ctx, priorColor, priorNumber, "use_prior_tag", resolverLabel, auditSource);
  }
  if (choice === "use_different_tag") {
    const color = res.color;
    const tagNumber = res.tag_number;
    if (!color || tagNumber === undefined) {
      return {
        ok: false,
        code,
        failure_reason: "missing_tag_input",
        message: "use_different_tag requires color + tag_number.",
      };
    }
    return await forceAssignAndPatch(sb, shopId, res, ctx, color, tagNumber, "use_different_tag", resolverLabel, auditSource);
  }
  if (choice === "assign_new") {
    return await roundRobinAssignAndPatch(sb, shopId, res, ctx, resolverLabel, auditSource);
  }
  if (choice === "no_tag") {
    const auditId = await writeAuditLog(sb, {
      // M2 fix: a tag-less DRF/REG resolution has no real tag. (red,0) violated
      // the keytag_audit_log tag-consistency CHECK (number must be 1-90) → the
      // INSERT silently failed and the resolution lost its audit row. null/null
      // matches the ARN no_tag branch (the nullable-tag columns permit it).
      tagColor: null,
      tagNumber: null,
      action: "manual_review_resolved",
      source: auditSource,
      roId: ctx.ro_id ?? null,
      roNumber: ctx.ro_number ?? null,
      userLabel: resolverLabel,
      reason: `manual_review_${code}_no_tag_${cat}`,
      manualReviewCode: code,
      reviewId: res.review_id,
    });
    return {
      ok: true,
      code,
      category: cat,
      action_taken: "no_tag",
      details: { ro_number: ctx.ro_number, audit_log_id: auditId },
      message: `Recorded that RO #${ctx.ro_number} won't be tagged. The RO will run without a key tag in our system.`,
    };
  }
  return unknownChoice(code, cat, choice);
}

// ── PAF: Tekmetric PATCH failure ────────────────────────────────────────────
async function dispatchPatchFail(
  sb: SupabaseClient,
  shopId: number,
  res: ResolvedRecord,
  ctx: { ro_id?: number; ro_number?: number; tag_color?: TagColor; tag_number?: number },
  resolverLabel: string,
  auditSource: "admin_app" | "claude_desktop",
): Promise<ResolveManualReviewToolResult> {
  const code = res.code;
  const choice = res.chosen_option.key;
  const tagColor = ctx.tag_color as TagColor;
  const tagNumber = ctx.tag_number as number;

  if (choice === "retry_patch") {
    const wire = formatKeytag(tagColor, tagNumber);
    const patch = await patchTekmetricKeytag(sb, shopId, ctx.ro_id!, wire);
    await sb.rpc("record_keytag_patched", {
      p_ro_id: ctx.ro_id,
      p_success: patch.ok,
      p_error: patch.error ?? null,
    });
    const auditId = await writeAuditLog(sb, {
      tagColor,
      tagNumber,
      action: "manual_review_resolved",
      source: auditSource,
      roId: ctx.ro_id ?? null,
      roNumber: ctx.ro_number ?? null,
      userLabel: resolverLabel,
      reason: `manual_review_${code}_retry_patch_${patch.ok ? "ok" : "failed"}`,
      manualReviewCode: code,
      reviewId: res.review_id,
      tekmetricPatchOk: patch.ok,
      tekmetricPatchError: patch.error,
    });
    return patch.ok
      ? {
          ok: true,
          code,
          category: "tekmetric_patch_fail",
          action_taken: "patch_retried_ok",
          details: { tag: describeKeytag(tagColor, tagNumber), ro_number: ctx.ro_number, audit_log_id: auditId },
          message: `Retry succeeded. ${describeKeytag(tagColor, tagNumber)} is now written into Tekmetric on RO #${ctx.ro_number}.`,
        }
      : {
          ok: false,
          code,
          failure_reason: "retry_patch_still_failing",
          message: `Tekmetric still refused the write: ${patch.error}. Pick a different option (release & redo, or accept unsynced) when you're ready.`,
        };
  }

  if (choice === "release_and_redo") {
    // Release then auto-assign new + retry PATCH
    await sb.rpc("release_keytag_for_ro", {
      p_ro_id: ctx.ro_id,
      p_reason: `manual_review_${code}_release_and_redo`,
    });
    return await roundRobinAssignAndPatch(sb, shopId, res, ctx, resolverLabel, auditSource);
  }

  if (choice === "accept_unsynced") {
    const auditId = await writeAuditLog(sb, {
      tagColor,
      tagNumber,
      action: "manual_review_resolved",
      source: auditSource,
      roId: ctx.ro_id ?? null,
      roNumber: ctx.ro_number ?? null,
      userLabel: resolverLabel,
      reason: `manual_review_${code}_accept_unsynced`,
      manualReviewCode: code,
      reviewId: res.review_id,
    });
    return {
      ok: true,
      code,
      category: "tekmetric_patch_fail",
      action_taken: "accepted_unsynced",
      details: { tag: describeKeytag(tagColor, tagNumber), ro_number: ctx.ro_number, audit_log_id: auditId },
      message: `Kept ${describeKeytag(tagColor, tagNumber)} on RO #${ctx.ro_number} in our system without writing to Tekmetric. The Tekmetric Key Tag field stays blank for this RO.`,
    };
  }

  return unknownChoice(code, "tekmetric_patch_fail", choice);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Best-effort fetch of the Tekmetric RO so the manual-review reassign helpers can
 * pass the real customer_id/vehicle_id into the assign RPCs (which restores the
 * column the nightly backfill needs) and stamp customer_name onto the board row.
 *
 * Returns the RO on success, or null on any fetch failure — in which case the
 * caller falls back to null ids (the prior behavior). The miss is surfaced as a
 * structured console.error so a Tekmetric hiccup that drops the name is findable
 * in the edge logs rather than silent. NEVER throws — a Tekmetric outage must not
 * block resolving a manual review.
 */
async function fetchRoForReassign(
  sb: SupabaseClient,
  shopId: number,
  roId: number | undefined,
  roNumber: number | undefined,
): Promise<TekmetricRepairOrder | null> {
  if (roId === undefined || roId === null) return null;
  try {
    const ro = await getRepairOrderById(sb, shopId, roId);
    if (!ro) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "manual_review_reassign_ro_fetch_failed",
          ro_id: roId,
          ro_number: roNumber ?? null,
          detail: "RO not found in Tekmetric",
        }),
      );
    }
    return ro;
  } catch (e) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "manual_review_reassign_ro_fetch_failed",
        ro_id: roId,
        ro_number: roNumber ?? null,
        detail: e instanceof Error ? e.message : String(e),
      }),
    );
    return null;
  }
}

async function forceAssignAndPatch(
  sb: SupabaseClient,
  shopId: number,
  res: ResolvedRecord,
  ctx: { ro_id?: number; ro_number?: number },
  color: TagColor,
  tagNumber: number,
  reasonSuffix: string,
  resolverLabel: string,
  auditSource: "admin_app" | "claude_desktop",
): Promise<ResolveManualReviewToolResult> {
  const code = res.code;
  const wire = formatKeytag(color, tagNumber);
  // Best-effort RO fetch → real customer/vehicle ids (restores the column the
  // nightly backfill needs) + customer_name stamp so the board row isn't blank.
  // On fetch failure we fall back to null ids (prior behavior); the miss is
  // logged inside fetchRoForReassign. Never blocks the re-tag.
  const ro = await fetchRoForReassign(sb, shopId, ctx.ro_id, ctx.ro_number);
  const { data, error } = await sb.rpc("force_assign_keytag", {
    p_ro_id: ctx.ro_id,
    p_ro_number: ctx.ro_number,
    p_tag_color: color,
    p_tag_number: tagNumber,
    p_customer_id: ro?.customerId ?? null,
    p_vehicle_id: ro?.vehicleId ?? null,
    p_advisor_id: null,
    p_technician_id: null,
  });
  if (error) {
    return {
      ok: false,
      code,
      failure_reason: "force_assign_failed",
      message: `Could not assign ${describeKeytag(color, tagNumber)}: ${error.message}`,
    };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (row?.error_code && row.error_code !== "ro_already_has_tag") {
    return {
      ok: false,
      code,
      failure_reason: row.error_code,
      message: `Could not assign ${describeKeytag(color, tagNumber)}: ${row.error_code}`,
    };
  }
  // Stamp customer_name off the critical path (errors swallowed inside).
  if (ro && ctx.ro_id !== undefined) {
    await stampKeytagCustomerName(sb, shopId, ctx.ro_id, ro.customerId);
  }
  const patch = await patchTekmetricKeytag(sb, shopId, ctx.ro_id!, wire);
  await sb.rpc("record_keytag_patched", {
    p_ro_id: ctx.ro_id,
    p_success: patch.ok,
    p_error: patch.error ?? null,
  });
  const auditId = await writeAuditLog(sb, {
    tagColor: color,
    tagNumber,
    action: "force_assigned",
    source: auditSource,
    roId: ctx.ro_id ?? null,
    roNumber: ctx.ro_number ?? null,
    userLabel: resolverLabel,
    reason: `manual_review_${code}_${reasonSuffix}`,
    manualReviewCode: code,
    reviewId: res.review_id,
    tekmetricPatchOk: patch.ok,
    tekmetricPatchError: patch.error,
  });
  return {
    ok: true,
    code,
    category: res.category,
    action_taken: patch.ok ? "force_assigned_and_synced" : "force_assigned_patch_failed",
    details: { tag: describeKeytag(color, tagNumber), ro_number: ctx.ro_number, patch_ok: patch.ok, audit_log_id: auditId },
    message: patch.ok
      ? `Assigned ${describeKeytag(color, tagNumber)} to RO #${ctx.ro_number} and wrote it to Tekmetric.`
      : `Assigned ${describeKeytag(color, tagNumber)} in our system, but Tekmetric refused the write (${patch.error}). The tag is saved here; the Tekmetric Key Tag field for RO #${ctx.ro_number} stays blank for now. Re-run this resolution to retry the Tekmetric write, or accept it unsynced.`,
  };
}

async function roundRobinAssignAndPatch(
  sb: SupabaseClient,
  shopId: number,
  res: ResolvedRecord,
  ctx: { ro_id?: number; ro_number?: number },
  resolverLabel: string,
  auditSource: "admin_app" | "claude_desktop",
): Promise<ResolveManualReviewToolResult> {
  const code = res.code;
  // Best-effort RO fetch → real customer/vehicle ids + customer_name stamp (see
  // forceAssignAndPatch). Falls back to null ids on fetch failure; never blocks.
  const ro = await fetchRoForReassign(sb, shopId, ctx.ro_id, ctx.ro_number);
  const { data, error } = await sb.rpc("assign_next_keytag", {
    p_ro_id: ctx.ro_id,
    p_ro_number: ctx.ro_number,
    p_customer_id: ro?.customerId ?? null,
    p_vehicle_id: ro?.vehicleId ?? null,
    p_advisor_id: null,
    p_technician_id: null,
  });
  if (error) {
    return {
      ok: false,
      code,
      failure_reason: "assign_failed",
      message: `Round-robin assign failed: ${error.message}`,
    };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.tag_color) {
    return { ok: false, code, failure_reason: "pool_exhausted", message: "All 180 key tags are in use." };
  }
  const color = row.tag_color as TagColor;
  const tagNumber = row.tag_number as number;
  const wire = formatKeytag(color, tagNumber);
  // Stamp customer_name off the critical path (errors swallowed inside).
  if (ro && ctx.ro_id !== undefined) {
    await stampKeytagCustomerName(sb, shopId, ctx.ro_id, ro.customerId);
  }
  const patch = await patchTekmetricKeytag(sb, shopId, ctx.ro_id!, wire);
  await sb.rpc("record_keytag_patched", {
    p_ro_id: ctx.ro_id,
    p_success: patch.ok,
    p_error: patch.error ?? null,
  });
  const auditId = await writeAuditLog(sb, {
    tagColor: color,
    tagNumber,
    action: "assigned",
    source: auditSource,
    roId: ctx.ro_id ?? null,
    roNumber: ctx.ro_number ?? null,
    userLabel: resolverLabel,
    reason: `manual_review_${code}_assign_new`,
    manualReviewCode: code,
    reviewId: res.review_id,
    tekmetricPatchOk: patch.ok,
    tekmetricPatchError: patch.error,
  });
  return {
    ok: true,
    code,
    category: res.category,
    action_taken: patch.ok ? "assigned_new_and_synced" : "assigned_new_patch_failed",
    details: { tag: describeKeytag(color, tagNumber), ro_number: ctx.ro_number, patch_ok: patch.ok, audit_log_id: auditId },
    message: patch.ok
      ? `Picked ${describeKeytag(color, tagNumber)} for RO #${ctx.ro_number} (round-robin) and wrote it to Tekmetric. Put ${describeKeytag(color, tagNumber)} on the keys.`
      : `Picked ${describeKeytag(color, tagNumber)} for RO #${ctx.ro_number} (round-robin) but Tekmetric refused our write (${patch.error}). The tag is saved here and is on the keys; the Tekmetric Key Tag field for RO #${ctx.ro_number} stays blank for now. Re-run this resolution to retry the Tekmetric write, or accept it unsynced.`,
  };
}

async function patchTekmetricKeytag(
  sb: SupabaseClient,
  shopId: number,
  roId: number,
  wire: string,
): Promise<{ ok: boolean; error?: string }> {
  // R4-IMPORTANT-A-2 2026-05-16: previously this helper inlined the
  // bearer + URL build via raw fetch, bypassing tekmetricFetch. Routes
  // through the shared client now so the 401-retry + auth header logic
  // is centralized.
  try {
    const res = await tekmetricFetch(sb, `/repair-orders/${roId}`, {
      method: "PATCH",
      body: { keyTag: wire },
      query: { shop: shopId },
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

interface AuditLogArgs {
  tagColor: TagColor | null;
  tagNumber: number | null;
  action: string;
  source: string;
  roId: number | null;
  roNumber: number | null;
  userLabel: string | null;
  reason: string;
  manualReviewCode: string;
  reviewId: number;
  tekmetricPatchOk?: boolean;
  tekmetricPatchError?: string;
}

async function writeAuditLog(sb: SupabaseClient, args: AuditLogArgs): Promise<number | null> {
  const { data, error } = await sb
    .from("keytag_audit_log")
    .insert({
      tag_color: args.tagColor,
      tag_number: args.tagNumber,
      action: args.action,
      source: args.source,
      ro_id: args.roId,
      ro_number: args.roNumber,
      user_label: args.userLabel,
      reason: args.reason,
      manual_review_code: args.manualReviewCode,
      tekmetric_patch_ok: args.tekmetricPatchOk ?? null,
      tekmetric_patch_error: args.tekmetricPatchError ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    // Structured so an audit-write failure (e.g. a future CHECK-constraint
    // mismatch like the M2 (red,0) bug) is findable in the edge logs instead of
    // buried. The resolution itself already committed; we never throw here.
    console.error(
      JSON.stringify({
        level: "error",
        msg: "writeAuditLog_failed",
        action: args.action,
        source: args.source,
        ro_number: args.roNumber,
        manual_review_code: args.manualReviewCode,
        detail: error?.message ?? "insert returned no row",
      }),
    );
    return null;
  }
  await attachResolutionAuditLog(sb, args.reviewId, data.id as number);
  return data.id as number;
}

function unknownChoice(
  code: string,
  category: string,
  choice: string,
  extra?: string,
): ResolveManualReviewToolResult {
  return {
    ok: false,
    code,
    failure_reason: "unknown_choice",
    message: `Choice '${choice}' is not handled for ${category}${extra ? ` (${extra})` : ""}. Use lookupManualReview to see the available options.`,
  };
}
