// reconcile — keytag-bulk-reconcile module.
// Extracted from keytag-bulk-reconcile/index.ts (file-size-refactor). Mechanical split.

import { TEKMETRIC_RO_STATUS } from "../_shared/tekmetric.ts";
import { formatKeytag, parseKeytag, type TagColor } from "../_shared/keytag-format.ts";
import { logEdgeError } from "../_shared/log-edge-error.ts";
import { Sentry } from "../_shared/sentry-edge.ts";
import { issueManualReview } from "../_shared/manual-review.ts";
import { sb } from "./config.ts";
import { type RepairOrderWithUpdated, type ReconcileResult } from "./types.ts";
import { arnOptions, driftOptions, patchFailOptions } from "./manual-review-options.ts";
import { patchKeytagToTekmetric, surfaceRpcError } from "./tekmetric-fetchers.ts";
import { type ExistingTag } from "./db-helpers.ts";

// ── Per-RO reconciliation ───────────────────────────────────────────────────

export async function reconcileOne(
  ro: RepairOrderWithUpdated,
  existing: ExistingTag | undefined,
  overwrite: boolean,
  dryRun: boolean,
): Promise<ReconcileResult> {
  const statusId = ro.repairOrderStatus.id;
  const statusName = ro.repairOrderStatus.name;
  const updatedDate = ro.updatedDate ?? null;
  const postedDate = ro.postedDate ?? null;

  const isAR = statusId === TEKMETRIC_RO_STATUS.POSTED_AR;
  const isWIP = statusId === TEKMETRIC_RO_STATUS.WIP;

  // For staleness math: WIP uses updatedDate; A/R uses postedDate (when set)
  // and falls back to updatedDate.
  const lastActivityAt = isAR
    ? (postedDate ?? updatedDate)
    : updatedDate;

  const base: ReconcileResult = {
    ro_id: ro.id,
    ro_number: ro.repairOrderNumber,
    tekmetric_status_id: statusId,
    tekmetric_status_name: statusName,
    action: "noop",
  };

  try {
    // ── Branch A: RO has no tag in our DB → assign + (mark_posted if A/R) + PATCH ──
    if (!existing) {
      // ── A/R WITHOUT PRIOR TAG (ARN manual review) ──
      // Tekmetric platform constraint: A/R repair orders refuse PATCH
      // ("Repair Order must be active to update data"). Per Chris's
      // 2026-05-11 directive, we DON'T just skip these — the keys may
      // physically have a tag on them. Issue an ARN manual review so the
      // service team can record what's on the keys (system-only, no
      // Tekmetric PATCH).
      if (isAR) {
        // Dedup is now enforced inside issueManualReview() per Chris's
        // 2026-05-13 directive — any prior review for this ro_id (any
        // category, resolved or pending) short-circuits with created=false.
        // The prior local ARN-only dedup was a subset of that and removed
        // with this commit.
        if (!dryRun) {
          // 2026-05-23 (refinement): skip ARN issuance entirely when the
          // most-recent `released` action in keytag_audit_log was a
          // manual release by a service advisor (source='claude_desktop').
          // The advisor explicitly released the tag — typically because
          // the keys left the shop while the RO sat in A/R — and doesn't
          // need a daily reminder.
          //
          // Defensive guard: same Number.isSafeInteger pattern as the
          // PostgREST .or() injection fix in Plan 03 Phase 3A. Skip the
          // lookup on malformed ro_id / ro_number and let the ARN issue
          // (fail-open on the manual-release check is safer than
          // accidentally skipping a real warning).
          const roIdSafeForRelLookup =
            Number.isInteger(ro.id) && Number.isSafeInteger(ro.id);
          const roNumberSafeForRelLookup =
            Number.isInteger(ro.repairOrderNumber) &&
            Number.isSafeInteger(ro.repairOrderNumber);

          if (roIdSafeForRelLookup || roNumberSafeForRelLookup) {
            const orClauses: string[] = [];
            if (roIdSafeForRelLookup) orClauses.push(`ro_id.eq.${ro.id}`);
            if (roNumberSafeForRelLookup) {
              orClauses.push(`ro_number.eq.${ro.repairOrderNumber}`);
            }
            const { data: relRows, error: relErr } = await sb
              .from("keytag_audit_log")
              .select("source, occurred_at")
              .or(orClauses.join(","))
              .eq("action", "released")
              .order("occurred_at", { ascending: false })
              .limit(1);

            if (relErr) {
              // Log + continue (fail open — better to issue a possibly-
              // unnecessary ARN than silently swallow a real anomaly).
              await logEdgeError(sb, {
                surface: "keytag-bulk-reconcile/manual_release_lookup",
                origin_id: "keytag-bulk-reconcile",
                level: "warning",
                error_code: "audit_lookup_failed",
                message: relErr.message,
                context: { ro_id: ro.id, ro_number: ro.repairOrderNumber },
              });
            } else if (
              relRows &&
              relRows.length > 0 &&
              // H4 fix: recognize BOTH human-release surfaces. Pre 2026-06-24
              // every manual release was 'claude_desktop'; the admin-app /keytags
              // dashboard now stamps 'admin_app'. Without this, dashboard-released
              // A/R tags get a fresh ARN re-issued every night.
              ["claude_desktop", "admin_app"].includes(
                (relRows[0] as { source: string | null }).source ?? "",
              )
            ) {
              return {
                ...base,
                action: "noop",
                detail: "skipped: prior manual human release in audit log",
              };
            }
          }

          // 2026-05-23: sendEmail:false — ARN reviews are consolidated
          // into the 7 AM keytag-daily-report's "Repair Orders Without
          // Key Tags" section. The review row + audit log entry are still
          // written; only the per-issue Resend email is suppressed.
          //
          // Why: after the user manually released ~100 A/R keytags in a
          // single day, the per-issue email path produced 100 individual
          // emails the next morning. The daily-digest surface gives one
          // table with RO# / status / prior tag / released-when context,
          // which is what the service team actually needs at triage time.
          const issued = await issueManualReview({
            sb,
            category: "ar_no_prior_tag",
            context: {
              ro_id: ro.id,
              ro_number: ro.repairOrderNumber,
              tekmetric_status_name: statusName,
            },
            options: arnOptions(ro.repairOrderNumber),
            issueSummary: `A/R RO #${ro.repairOrderNumber} has no key tag tracked in our system. The keys may or may not have a physical tag.`,
            auditSource: "cron",
            sendEmail: false,
          });
          if (!issued.created) {
            return {
              ...base,
              action: "noop",
              detail: `existing review ${issued.code} kept (${issued.existing_resolved_at ? "already resolved" : "still pending"}) — no new ARN issued`,
            };
          }
          return {
            ...base,
            action: "manual_review_issued",
            detail: `ARN ${issued.code} (A/R no prior tag — email suppressed, included in daily-report)`,
            manual_review_code: issued.code,
          };
        }
        return {
          ...base,
          action: "noop",
          detail: "(dry run) would issue ARN manual review",
        };
      }

      // ── DRIFT-PREVENTION GATE (manual review variant) ──
      // If THIS RO has prior keytag history, we don't silently auto-assign.
      // Issue a DRF or REG manual review so the service team can record what
      // tag is on the physical keys.
      //
      // PLAN-03 Phase 3A (I-SEC-5) — PostgREST .or() takes a raw string
      // interpolation. ro.id + ro.repairOrderNumber come from a Tekmetric
      // API listing; if Tekmetric ever ships malformed types we'd inject
      // garbage into the PostgREST parser. Guard with Number.isSafeInteger
      // before interpolation; skip lookup (= "no prior history found")
      // when invalid. See keytag-tekmetric-webhook for the canonical pattern.
      const roIdSafe = Number.isInteger(ro.id) && Number.isSafeInteger(ro.id);
      const roNumberSafe =
        Number.isInteger(ro.repairOrderNumber) &&
        Number.isSafeInteger(ro.repairOrderNumber);
      if (!roIdSafe || !roNumberSafe) {
        Sentry.withScope((scope) => {
          scope.setTag("event", "invalid_ro_id_or_number");
          scope.setContext("invalid_ids", {
            ro_id_type: typeof ro.id,
            ro_id_safe: roIdSafe,
            ro_number_type: typeof ro.repairOrderNumber,
            ro_number_safe: roNumberSafe,
          });
          Sentry.captureMessage(
            "Tekmetric WIP listing has invalid ro_id or ro_number type",
            "warning",
          );
        });
        return {
          ...base,
          action: "noop",
          detail: "skipped: invalid ro_id or ro_number type in Tekmetric response",
        };
      }
      const { data: priorHistoryRows, error: priorHistoryErr } = await sb
        .from("keytag_audit_log")
        .select("id, action, occurred_at, tag_color, tag_number, reason")
        .or(`ro_id.eq.${ro.id},ro_number.eq.${ro.repairOrderNumber}`)
        .neq("action", "manual_review_issued") // skip prior review-issuance rows
        .order("occurred_at", { ascending: false })
        .limit(3);
      if (
        await surfaceRpcError(priorHistoryErr, {
          op: "prior_history_lookup",
          ro_id: ro.id,
          ro_number: ro.repairOrderNumber,
        })
      ) {
        // Fail safe: could not read prior history, so we must NOT auto-assign
        // (would clobber a real prior tag). Skip this RO this run.
        return { ...base, action: "error", error: "prior_history_lookup_failed" };
      }
      const priorHistory = priorHistoryRows?.[0];
      if (priorHistory) {
        // Dedup is enforced canonically inside issueManualReview() by the
        // (category, ro_id) gate (manual-review.ts; arch doc §6). A previous
        // local pre-dedup here scoped to the CATEGORY SET
        // [work_approved_drift, ar_regression] over-suppressed across runs (a
        // prior REG could block a later-run DRF for the same RO — the REG/DRF
        // classification below is a heuristic that can flip between nightly
        // runs) and was pending-only. Removed as redundant + mis-scoped; the
        // created:false path below handles the exact (category, ro_id)
        // duplicate correctly. (obs-hardening 2026-06-01)

        // Distinguish REG vs DRF: REG = the prior history shows the RO was in
        // A/R recently (marked_posted somewhere in last few entries) AND
        // last action was released.
        const wasInAR = priorHistoryRows!.some(
          (h) =>
            h.action === "marked_posted" ||
            (h.action === "released" && /ar_balance|posted_ar|ar_paid|payment_made/i.test(h.reason ?? "")),
        );
        const category =
          priorHistory.action === "released" && wasInAR
            ? "ar_regression"
            : "work_approved_drift";

        if (!dryRun) {
          const priorTag = priorHistory.tag_color && priorHistory.tag_number
            ? `${priorHistory.tag_color === "red" ? "Red" : "Yellow"} ${priorHistory.tag_number}`
            : "the previous tag";
          const issued = await issueManualReview({
            sb,
            category,
            context: {
              ro_id: ro.id,
              ro_number: ro.repairOrderNumber,
              tag_color: priorHistory.tag_color,
              tag_number: priorHistory.tag_number,
              prior_action: priorHistory.action,
              prior_action_at: priorHistory.occurred_at,
            },
            options: driftOptions(ro.repairOrderNumber, priorTag),
            issueSummary:
              category === "ar_regression"
                ? `RO #${ro.repairOrderNumber} came back from A/R into WIP, but ${priorTag} was already released earlier.`
                : `RO #${ro.repairOrderNumber} is in WIP but has prior key-tag history (last: ${priorHistory.action}).`,
            auditSource: "cron",
          });
          if (!issued.created) {
            return {
              ...base,
              action: "noop",
              detail: `existing review ${issued.code} kept (${issued.existing_resolved_at ? "already resolved" : "still pending"}) — no new ${category === "ar_regression" ? "REG" : "DRF"} issued`,
            };
          }
          return {
            ...base,
            action: "manual_review_issued",
            detail: `${category === "ar_regression" ? "REG" : "DRF"} ${issued.code} — email ${issued.email_sent ? "sent" : "failed"}`,
            manual_review_code: issued.code,
          };
        }
        return {
          ...base,
          action: "noop",
          detail: `(dry run) would issue ${category} manual review`,
        };
      }

      if (dryRun) {
        return { ...base, action: "assigned_new", detail: "(dry run)" };
      }
      const { data: assignRows, error: assignErr } = await sb.rpc(
        "assign_next_keytag",
        {
          p_ro_id: ro.id,
          p_ro_number: ro.repairOrderNumber,
          p_customer_id: ro.customerId,
          p_vehicle_id: ro.vehicleId,
          p_advisor_id: ro.serviceWriterId,
          p_technician_id: ro.technicianId,
          p_last_activity_at: lastActivityAt,
        },
      );
      if (assignErr) {
        return { ...base, action: "error", error: `assign_rpc: ${assignErr.message}` };
      }
      const assigned = Array.isArray(assignRows) ? assignRows[0] : assignRows;
      if (!assigned?.tag_color) {
        return { ...base, action: "error", error: "pool_exhausted" };
      }
      const color = assigned.tag_color as TagColor;
      const number = assigned.tag_number as number;
      const wire = formatKeytag(color, number);

      // For A/R, also mark posted with the real postedDate
      if (isAR) {
        const { error: postErr } = await sb.rpc("mark_keytag_posted", {
          p_ro_id: ro.id,
          p_posted_at: postedDate,
          p_last_activity_at: lastActivityAt,
        });
        if (postErr) {
          // Roll back — DB ended up inconsistent
          const { error: rollbackErr } = await sb.rpc("release_keytag_for_ro", {
            p_ro_id: ro.id,
            p_reason: "rollback_mark_posted_failed",
          });
          await surfaceRpcError(rollbackErr, {
            op: "release_keytag_for_ro_rollback",
            ro_id: ro.id,
            ro_number: ro.repairOrderNumber,
          });
          return {
            ...base,
            action: "error",
            error: rollbackErr
              ? `mark_posted_after_assign: ${postErr.message}; ROLLBACK ALSO FAILED: ${rollbackErr.message}`
              : `mark_posted_after_assign: ${postErr.message}`,
          };
        }
      }

      const patch = await patchKeytagToTekmetric(ro.id, wire);
      // Record the PATCH result on the keytag row for audit + future cleanup.
      // (Webhook handler already does this; reconcile must too for parity.)
      const { error: recordPatchedErr } = await sb.rpc("record_keytag_patched", {
        p_ro_id: ro.id,
        p_success: patch.ok,
        p_error: patch.error ?? null,
      });
      await surfaceRpcError(recordPatchedErr, {
        op: "record_keytag_patched",
        ro_id: ro.id,
        ro_number: ro.repairOrderNumber,
      });

      // Tekmetric PATCH failed → issue PAF manual review (keep DB assignment).
      if (!patch.ok) {
        const priorTag = `${color === "red" ? "Red" : "Yellow"} ${number}`;
        const issued = await issueManualReview({
          sb,
          category: "tekmetric_patch_fail",
          context: {
            ro_id: ro.id,
            ro_number: ro.repairOrderNumber,
            tag_color: color,
            tag_number: number,
            patch_error: patch.error,
          },
          options: patchFailOptions(),
          issueSummary: `Nightly reconcile assigned ${priorTag} to RO #${ro.repairOrderNumber} but Tekmetric refused our write to its Key Tag field.`,
          auditSource: "cron",
        });
        if (!issued.created) {
          return {
            ...base,
            action: "noop",
            tag_color: color,
            tag_number: number,
            tag_string: wire,
            patch_ok: false,
            patch_error: patch.error,
            detail: `existing review ${issued.code} kept (${issued.existing_resolved_at ? "already resolved" : "still pending"}) — no new PAF issued`,
          };
        }
        return {
          ...base,
          action: "manual_review_issued",
          tag_color: color,
          tag_number: number,
          tag_string: wire,
          patch_ok: false,
          patch_error: patch.error,
          manual_review_code: issued.code,
          detail: `PAF ${issued.code} — email ${issued.email_sent ? "sent" : "failed"}`,
        };
      }

      // Audit-log entry for successful reconcile assignment
      const { error: auditAssignedErr } = await sb.rpc("log_keytag_audit", {
        p_tag_color: color,
        p_tag_number: number,
        p_action: "assigned",
        p_source: "cron",
        p_ro_id: ro.id,
        p_ro_number: ro.repairOrderNumber,
        p_prior_status: "available",
        p_new_status: isAR ? "posted_ar" : "assigned",
        p_user_label: null,
        p_reason: isAR
          ? "reconcile:wip_or_ar_no_tag_first_time_ar"
          : "reconcile:wip_no_tag_first_time",
        p_tekmetric_patch_ok: patch.ok,
        p_tekmetric_patch_error: patch.error ?? null,
      });
      await surfaceRpcError(auditAssignedErr, {
        op: "log_keytag_audit_assigned",
        ro_id: ro.id,
        ro_number: ro.repairOrderNumber,
      });

      return {
        ...base,
        action: "assigned_new",
        tag_color: color,
        tag_number: number,
        tag_string: wire,
        patch_ok: patch.ok,
        patch_error: patch.error,
        detail: isAR ? "assigned+marked_posted" : "assigned",
      };
    }

    // ── Branch B: RO has tag, refresh last_activity_at + maybe flip ──
    const wire = formatKeytag(existing.tag_color, existing.tag_number);

    // Forward-pass regression: tag is posted_ar but Tekmetric shows WIP
    // → un-posted from A/R back to WIP. Revert the tag.
    const needsRevertToAssigned =
      isWIP && existing.status === "posted_ar";
    // Forward-pass forward-direction: tag is assigned but Tekmetric shows
    // A/R → webhook for "Sent to A/R" was missed.
    const needsFlipToPosted = isAR && existing.status === "assigned";

    let flippedAction: "marked_posted" | "reverted" | null = null;

    if (!dryRun && needsRevertToAssigned) {
      const { error: revertErr } = await sb.rpc(
        "revert_keytag_to_assigned",
        {
          p_ro_id: ro.id,
          p_last_activity_at: lastActivityAt,
        },
      );
      if (revertErr) {
        return {
          ...base,
          action: "error",
          error: `revert_to_assigned: ${revertErr.message}`,
          tag_color: existing.tag_color,
          tag_number: existing.tag_number,
          tag_string: wire,
        };
      }
      // Audit-log entry for forward-pass revert
      const { error: auditRevertedFwdErr } = await sb.rpc("log_keytag_audit", {
        p_tag_color: existing.tag_color,
        p_tag_number: existing.tag_number,
        p_action: "reverted",
        p_source: "cron",
        p_ro_id: ro.id,
        p_ro_number: ro.repairOrderNumber,
        p_prior_status: "posted_ar",
        p_new_status: "assigned",
        p_user_label: null,
        p_reason: "reconcile:forward_pass_ar_unposted_back_to_wip",
      });
      await surfaceRpcError(auditRevertedFwdErr, {
        op: "log_keytag_audit_reverted_forward",
        ro_id: ro.id,
        ro_number: ro.repairOrderNumber,
      });
      flippedAction = "reverted";
    } else if (!dryRun && needsFlipToPosted) {
      const { error: postErr } = await sb.rpc("mark_keytag_posted", {
        p_ro_id: ro.id,
        p_posted_at: postedDate,
        p_last_activity_at: lastActivityAt,
      });
      if (postErr) {
        return {
          ...base,
          action: "error",
          error: `mark_posted_flip: ${postErr.message}`,
          tag_color: existing.tag_color,
          tag_number: existing.tag_number,
          tag_string: wire,
        };
      }
      // Audit-log entry for forward-pass flip-to-posted
      const { error: auditPostedFwdErr } = await sb.rpc("log_keytag_audit", {
        p_tag_color: existing.tag_color,
        p_tag_number: existing.tag_number,
        p_action: "marked_posted",
        p_source: "cron",
        p_ro_id: ro.id,
        p_ro_number: ro.repairOrderNumber,
        p_prior_status: "assigned",
        p_new_status: "posted_ar",
        p_user_label: null,
        p_reason: "reconcile:forward_pass_assigned_seen_as_ar_in_tekmetric",
      });
      await surfaceRpcError(auditPostedFwdErr, {
        op: "log_keytag_audit_marked_posted_forward",
        ro_id: ro.id,
        ro_number: ro.repairOrderNumber,
      });
      flippedAction = "marked_posted";
    } else if (!dryRun && lastActivityAt) {
      // Just refresh the activity clock
      const { error: touchFwdErr } = await sb.rpc("touch_keytag_activity", {
        p_ro_id: ro.id,
        p_last_activity_at: lastActivityAt,
      });
      await surfaceRpcError(touchFwdErr, {
        op: "touch_keytag_activity_forward",
        ro_id: ro.id,
        ro_number: ro.repairOrderNumber,
      });
    }

    // Determine whether Tekmetric's keyTag field matches our DB
    const tekParsed = parseKeytag(ro.keytag);
    const tekMatches =
      tekParsed !== null &&
      tekParsed.color === existing.tag_color &&
      tekParsed.number === existing.tag_number &&
      !tekParsed.legacy; // legacy = bare-number format; needs rewrite

    const shouldPatch = overwrite || !tekMatches;
    let patch: { ok: boolean; error?: string } | null = null;
    if (!dryRun && shouldPatch) {
      patch = await patchKeytagToTekmetric(ro.id, wire);
    }

    let action: ReconcileResult["action"];
    let detail: string;
    if (flippedAction === "reverted") {
      action = "reverted";
      detail = shouldPatch
        ? "reverted_posted_ar_to_assigned+re_patched"
        : "reverted_posted_ar_to_assigned";
    } else if (flippedAction === "marked_posted") {
      action = "marked_posted";
      detail = shouldPatch
        ? "flipped_to_posted_ar+re_patched"
        : "flipped_to_posted_ar";
    } else if (shouldPatch) {
      action = "repatched";
      detail = overwrite
        ? "overwrite_tekmetric_keytag"
        : "tekmetric_keytag_mismatch";
    } else {
      action = "touched";
      detail = "last_activity_at_refreshed";
    }

    return {
      ...base,
      action,
      tag_color: existing.tag_color,
      tag_number: existing.tag_number,
      tag_string: wire,
      patch_ok: patch?.ok,
      patch_error: patch?.error,
      detail,
    };
  } catch (e) {
    return {
      ...base,
      action: "error",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
