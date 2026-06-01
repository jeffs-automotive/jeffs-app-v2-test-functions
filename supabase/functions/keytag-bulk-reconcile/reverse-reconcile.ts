// reverse-reconcile — keytag-bulk-reconcile module.
// Extracted from keytag-bulk-reconcile/index.ts (file-size-refactor). Mechanical split.

import { TEKMETRIC_RO_STATUS } from "../_shared/tekmetric.ts";
import { formatKeytag } from "../_shared/keytag-format.ts";
import { issueManualReview } from "../_shared/manual-review.ts";
import { sb } from "./config.ts";
import { type RepairOrderWithUpdated, type ReconcileResult, type OrphanReleaseDetail } from "./types.ts";
import { orphanOptions } from "./manual-review-options.ts";
import { fetchRoOrNull, surfaceRpcError } from "./tekmetric-fetchers.ts";
import { type InUseTagRow } from "./db-helpers.ts";

// ── Reverse pass — for tags in our DB whose RO didn't appear in WIP/AR ──────

export async function reverseReconcileOne(
  tag: InUseTagRow,
  dryRun: boolean,
  orphans: OrphanReleaseDetail[],
): Promise<ReconcileResult> {
  const base: Omit<ReconcileResult, "action"> = {
    ro_id: tag.ro_id,
    ro_number: tag.ro_number ?? 0,
    tekmetric_status_id: 0,
    tekmetric_status_name: "(not yet fetched)",
    tag_color: tag.tag_color,
    tag_number: tag.tag_number,
    tag_string: formatKeytag(tag.tag_color, tag.tag_number),
    reverse_pass: true,
  };

  try {
    let ro: RepairOrderWithUpdated | null;
    try {
      ro = await fetchRoOrNull(tag.ro_id);
    } catch (e) {
      return {
        ...base,
        action: "error",
        error: `reverse_get_ro: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    // 404 — RO deleted in Tekmetric → ORP manual review (don't auto-release)
    if (ro === null) {
      if (dryRun) {
        return {
          ...base,
          action: "manual_review_issued",
          tekmetric_status_id: 0,
          tekmetric_status_name: "(deleted)",
          detail: "(dry run) would issue ORP manual review (RO 404)",
        };
      }
      // Dedup is now in issueManualReview (any prior review for this ro_id,
      // any category, resolved or pending, short-circuits).
      const priorTag = `${tag.tag_color === "red" ? "Red" : "Yellow"} ${tag.tag_number}`;
      const issued = await issueManualReview({
        sb,
        category: "orphan_release",
        context: {
          ro_id: tag.ro_id,
          ro_number: tag.ro_number,
          tag_color: tag.tag_color,
          tag_number: tag.tag_number,
          tekmetric_status_at_release: "(deleted)",
          reason: "ro_404_tekmetric_deleted",
          prior_status: tag.status,
        },
        options: orphanOptions(tag.ro_number ?? 0, priorTag),
        issueSummary: `${priorTag} is on RO #${tag.ro_number} in our records, but Tekmetric says the RO doesn't exist anymore.`,
        auditSource: "cron",
      });
      if (!issued.created) {
        return {
          ...base,
          action: "noop",
          tekmetric_status_id: 0,
          tekmetric_status_name: "(deleted)",
          detail: `existing review ${issued.code} kept (${issued.existing_resolved_at ? "already resolved" : "still pending"}) — no new ORP issued`,
        };
      }
      return {
        ...base,
        action: "manual_review_issued",
        tekmetric_status_id: 0,
        tekmetric_status_name: "(deleted)",
        detail: `ORP ${issued.code} — email ${issued.email_sent ? "sent" : "failed"}`,
        manual_review_code: issued.code,
      };
    }

    base.tekmetric_status_id = ro.repairOrderStatus.id;
    base.tekmetric_status_name = ro.repairOrderStatus.name;

    const statusId = ro.repairOrderStatus.id;
    const statusName = ro.repairOrderStatus.name;
    const updatedDate = ro.updatedDate ?? null;
    const postedDate = ro.postedDate ?? null;

    // Status 5 = POSTED_PAID → ORP manual review (don't auto-release; ask the team)
    if (statusId === TEKMETRIC_RO_STATUS.POSTED_PAID) {
      if (dryRun) {
        return {
          ...base,
          action: "manual_review_issued",
          detail: "(dry run) would issue ORP manual review (posted_paid)",
        };
      }
      // Dedup lives in issueManualReview (universal by ro_id).
      const priorTag = `${tag.tag_color === "red" ? "Red" : "Yellow"} ${tag.tag_number}`;
      const issued = await issueManualReview({
        sb,
        category: "orphan_release",
        context: {
          ro_id: tag.ro_id,
          ro_number: tag.ro_number,
          tag_color: tag.tag_color,
          tag_number: tag.tag_number,
          tekmetric_status_at_release: statusName,
          reason: "posted_paid_missed_release_webhook",
          prior_status: tag.status,
        },
        options: orphanOptions(tag.ro_number ?? 0, priorTag),
        issueSummary: `${priorTag} is on RO #${tag.ro_number} in our records, but Tekmetric shows the RO as posted & paid (the payment notification never reached us).`,
        auditSource: "cron",
      });
      if (!issued.created) {
        return {
          ...base,
          action: "noop",
          detail: `existing review ${issued.code} kept (${issued.existing_resolved_at ? "already resolved" : "still pending"}) — no new ORP issued`,
        };
      }
      return {
        ...base,
        action: "manual_review_issued",
        detail: `ORP ${issued.code} — email ${issued.email_sent ? "sent" : "failed"}`,
        manual_review_code: issued.code,
      };
    }

    // Estimate / Completed / WIP / A/R fallback paths: keep tag, but
    // reconcile status + activity timestamp.
    if (statusId === TEKMETRIC_RO_STATUS.WIP) {
      // Tag is held but RO is WIP — should've been caught by forward pass.
      // Either the WIP list was cut off (>100 in a single page would be
      // unusual) or there's a race. Touch activity.
      if (!dryRun && updatedDate) {
        if (tag.status === "posted_ar") {
          const { error: revRevertErr } = await sb.rpc("revert_keytag_to_assigned", {
            p_ro_id: tag.ro_id,
            p_last_activity_at: updatedDate,
          });
          if (
            await surfaceRpcError(revRevertErr, {
              op: "revert_keytag_to_assigned_reverse",
              ro_id: tag.ro_id,
              ro_number: tag.ro_number,
            })
          ) {
            return { ...base, action: "error", error: `reverse_revert_to_assigned: ${revRevertErr!.message}` };
          }
          const { error: auditRevertedRevErr } = await sb.rpc("log_keytag_audit", {
            p_tag_color: tag.tag_color,
            p_tag_number: tag.tag_number,
            p_action: "reverted",
            p_source: "reconcile",
            p_ro_id: tag.ro_id,
            p_ro_number: tag.ro_number,
            p_prior_status: "posted_ar",
            p_new_status: "assigned",
            p_user_label: null,
            p_reason: "reconcile:reverse_pass_ar_unposted_back_to_wip",
          });
          await surfaceRpcError(auditRevertedRevErr, {
            op: "log_keytag_audit_reverted_reverse",
            ro_id: tag.ro_id,
            ro_number: tag.ro_number,
          });
          return {
            ...base,
            action: "reverted",
            detail: "reverse_pass_revert_to_assigned (RO is WIP)",
          };
        }
        const { error: touchRevWipErr } = await sb.rpc("touch_keytag_activity", {
          p_ro_id: tag.ro_id,
          p_last_activity_at: updatedDate,
        });
        await surfaceRpcError(touchRevWipErr, {
          op: "touch_keytag_activity_reverse_wip",
          ro_id: tag.ro_id,
          ro_number: tag.ro_number,
        });
      }
      return {
        ...base,
        action: "touched",
        detail: "reverse_pass_wip_refresh",
      };
    }

    if (statusId === TEKMETRIC_RO_STATUS.POSTED_AR) {
      // Tag held, RO is A/R. Forward pass should've caught — refresh anyway.
      if (!dryRun) {
        if (tag.status === "assigned") {
          const { error: revPostErr } = await sb.rpc("mark_keytag_posted", {
            p_ro_id: tag.ro_id,
            p_posted_at: postedDate,
            p_last_activity_at: postedDate ?? updatedDate,
          });
          if (
            await surfaceRpcError(revPostErr, {
              op: "mark_keytag_posted_reverse",
              ro_id: tag.ro_id,
              ro_number: tag.ro_number,
            })
          ) {
            return { ...base, action: "error", error: `reverse_mark_posted_flip: ${revPostErr!.message}` };
          }
          const { error: auditPostedRevErr } = await sb.rpc("log_keytag_audit", {
            p_tag_color: tag.tag_color,
            p_tag_number: tag.tag_number,
            p_action: "marked_posted",
            p_source: "reconcile",
            p_ro_id: tag.ro_id,
            p_ro_number: tag.ro_number,
            p_prior_status: "assigned",
            p_new_status: "posted_ar",
            p_user_label: null,
            p_reason: "reconcile:reverse_pass_assigned_seen_as_ar",
          });
          await surfaceRpcError(auditPostedRevErr, {
            op: "log_keytag_audit_marked_posted_reverse",
            ro_id: tag.ro_id,
            ro_number: tag.ro_number,
          });
          return {
            ...base,
            action: "marked_posted",
            detail: "reverse_pass_flip_to_posted_ar (RO is A/R)",
          };
        }
        if (postedDate ?? updatedDate) {
          const { error: touchRevArErr } = await sb.rpc("touch_keytag_activity", {
            p_ro_id: tag.ro_id,
            p_last_activity_at: postedDate ?? updatedDate,
          });
          await surfaceRpcError(touchRevArErr, {
            op: "touch_keytag_activity_reverse_ar",
            ro_id: tag.ro_id,
            ro_number: tag.ro_number,
          });
        }
      }
      return {
        ...base,
        action: "touched",
        detail: "reverse_pass_ar_refresh",
      };
    }

    // Status 1 (Estimate) or 3 (Completed): keep tag — keys still in shop
    // or work done awaiting post. Just refresh activity from updatedDate.
    if (!dryRun && updatedDate) {
      const { error: touchRevKeepErr } = await sb.rpc("touch_keytag_activity", {
        p_ro_id: tag.ro_id,
        p_last_activity_at: updatedDate,
      });
      await surfaceRpcError(touchRevKeepErr, {
        op: "touch_keytag_activity_reverse_keep",
        ro_id: tag.ro_id,
        ro_number: tag.ro_number,
      });
    }
    return {
      ...base,
      action: "touched",
      detail: `reverse_pass_${statusName.toLowerCase().replace(/\s+/g, "_")}_keep_tag`,
    };
  } catch (e) {
    return {
      ...base,
      action: "error",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
