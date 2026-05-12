// Pure tool functions for service-advisor-driven keytag management.
//
// Two operations exposed to the orchestrator:
//   - assignKeytagToRo:    "Put red 5 on RO 152222" or "Give RO 152222 a key tag"
//                          (specific tag or auto-pick via round-robin)
//   - releaseKeytagFromRo: "The keys are off RO 152222" / "Free up RO 152300's tag"
//                          (typical use: fleet vehicles like Carmax that stay in
//                          A/R for ~30 days but the keys leave the shop sooner)
//
// Both operations:
//   1. Look up the RO via Tekmetric (by repair order number — what advisors say)
//   2. Mutate our keytags table via the migration's RPCs
//   3. PATCH Tekmetric's keyTag field to keep their record in sync
//   4. Log the result via record_keytag_patched for audit
//
// Loop-safety: PATCHing Tekmetric will trigger a status_updated webhook back
// at us. Our webhook's existing guards (already-assigned check + self-authored
// detection) handle this — no additional safeguards needed here.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  TEKMETRIC_API_BASE,
  buildTekmetricRoUrl,
} from "../tekmetric.ts";
import {
  describeKeytag,
  formatKeytag,
  type TagColor,
} from "../keytag-format.ts";
import {
  getRepairOrderByNumber,
  type TekmetricRepairOrder,
} from "./repair-orders.ts";
import { getTekmetricAccessToken } from "../tekmetric-client.ts";
import {
  type ConfirmationRequiredResult,
  confirmationRequiredResponse,
  consumeConfirmationToken,
  issueConfirmationToken,
} from "../keytag-confirmation.ts";

// ─── PATCH helper ───────────────────────────────────────────────────────────

/**
 * PATCHes the Tekmetric repair-order's keyTag field. `keyTagValue=null` clears
 * the field. We try `null` first (per OAS conventions); some Tekmetric
 * deployments interpret null as "no change" and require empty string instead,
 * so the helper falls back to "" on a 4xx.
 */
async function patchKeytag(
  sb: SupabaseClient,
  shopId: number,
  roId: number,
  keyTagValue: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const token = await getTekmetricAccessToken(sb);
  const url = `${TEKMETRIC_API_BASE}/repair-orders/${roId}?shop=${shopId}`;
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  // First attempt
  const body1 = JSON.stringify({ keyTag: keyTagValue });
  const res1 = await fetch(url, { method: "PATCH", headers, body: body1 });
  if (res1.ok) return { ok: true };

  // For null clears, fall back to empty string if the first attempt 4xx'd
  if (keyTagValue === null && res1.status >= 400 && res1.status < 500) {
    const body2 = JSON.stringify({ keyTag: "" });
    const res2 = await fetch(url, { method: "PATCH", headers, body: body2 });
    if (res2.ok) return { ok: true };
    const text = await res2.text();
    return { ok: false, error: `clear failed (null then ""): HTTP ${res2.status}: ${text.slice(0, 300)}` };
  }

  const text = await res1.text();
  return { ok: false, error: `HTTP ${res1.status}: ${text.slice(0, 300)}` };
}

// ─── Tool 1: assignKeytagToRo ───────────────────────────────────────────────

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
      error_code: "ro_not_found" | "ro_already_has_tag" | "tag_in_use_by_other_ro" | "tag_not_found" | "pool_exhausted" | "rpc_error" | "confirmation_failed";
      message: string;
      ro_number: number;
      requested_tag?: { color: TagColor; number: number; label: string };
      current_tag?: { color: TagColor; number: number; label: string };
    }
  | ConfirmationRequiredResult;

export async function assignKeytagToRo(
  sb: SupabaseClient,
  shopId: number,
  args: {
    roNumber: number;
    color?: TagColor;
    tagNumber?: number;
    /**
     * The MCP OAuth user_label of the human invoking this tool. Written
     * into keytags.changed_by_user_label + keytag_audit_log so we can
     * answer "who assigned R5 to RO 152222" queries.
     */
    userLabel?: string;
    /** Two-step confirmation token (returned by a prior call). Required for force-assign overrides. */
    confirmationToken?: string;
  },
): Promise<AssignKeytagResult> {
  const { roNumber, color, tagNumber, userLabel, confirmationToken } = args;
  const specific = color !== undefined && tagNumber !== undefined;

  // 1. Look up the RO
  const ro = await getRepairOrderByNumber(sb, shopId, roNumber);
  if (!ro) {
    return {
      ok: false,
      error_code: "ro_not_found",
      message: `Could not find repair order #${roNumber} in Tekmetric.`,
      ro_number: roNumber,
    };
  }

  // ── FORCE-ASSIGN CONFIRMATION GATE ───────────────────────────────────────
  // Force-assign (specific color+number) overrides round-robin selection.
  // This is the path advisors take when they're re-tagging an RO whose
  // physical keys still bear a specific tag (post-drift recovery), or when
  // they want a particular color for visibility. Both legitimate, both
  // sensitive — require two-step confirmation. Auto-assign (no color/number
  // specified) follows round-robin and is the standard path; no
  // confirmation required.
  if (specific) {
    if (!userLabel) {
      return {
        ok: false,
        error_code: "confirmation_failed",
        message:
          `Force-assign blocked: specifying a tag color+number requires an authenticated user (user_label missing).`,
        ro_number: roNumber,
        requested_tag: { color: color as TagColor, number: tagNumber as number, label: describeKeytag(color as TagColor, tagNumber as number) },
      };
    }
    const scope = {
      ro_numbers: [roNumber],
      tag_color: color as TagColor,
      tag_number: tagNumber as number,
      reason: "force_assign",
    };
    if (!confirmationToken) {
      const issued = await issueConfirmationToken(sb, {
        actionKind: "force_assign",
        scope,
        userLabel,
      });
      return confirmationRequiredResponse(issued);
    }
    const consumed = await consumeConfirmationToken(sb, {
      tokenId: confirmationToken,
      actionKind: "force_assign",
      scope,
      userLabel,
    });
    if (!consumed.ok) {
      return {
        ok: false,
        error_code: "confirmation_failed",
        message:
          `Confirmation token rejected for force-assign of ${describeKeytag(color as TagColor, tagNumber as number)} to RO #${roNumber}: ${consumed.failure_reason ?? "unknown"}. The advisor must re-request and re-confirm.`,
        ro_number: roNumber,
        requested_tag: { color: color as TagColor, number: tagNumber as number, label: describeKeytag(color as TagColor, tagNumber as number) },
      };
    }
  }

  // 2. Reserve the tag
  let assignedColor: TagColor;
  let assignedNumber: number;
  let autoAssigned = false;

  if (specific) {
    if (!Number.isInteger(tagNumber) || (tagNumber as number) < 1 || (tagNumber as number) > 90) {
      return {
        ok: false,
        error_code: "tag_not_found",
        message: `Tag number must be between 1 and 90, got ${tagNumber}.`,
        ro_number: roNumber,
        requested_tag: { color: color as TagColor, number: tagNumber as number, label: describeKeytag(color as TagColor, tagNumber as number) },
      };
    }
    const { data, error } = await sb.rpc("force_assign_keytag", {
      p_ro_id: ro.id,
      p_ro_number: ro.repairOrderNumber,
      p_tag_color: color,
      p_tag_number: tagNumber,
      p_customer_id: ro.customerId,
      p_vehicle_id: ro.vehicleId,
      p_advisor_id: ro.serviceWriterId,
      p_technician_id: ro.technicianId,
    });
    if (error) {
      return {
        ok: false,
        error_code: "rpc_error",
        message: `force_assign_keytag failed: ${error.message}`,
        ro_number: roNumber,
        requested_tag: { color: color as TagColor, number: tagNumber as number, label: describeKeytag(color as TagColor, tagNumber as number) },
      };
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return {
        ok: false,
        error_code: "rpc_error",
        message: "force_assign_keytag returned no row",
        ro_number: roNumber,
        requested_tag: { color: color as TagColor, number: tagNumber as number, label: describeKeytag(color as TagColor, tagNumber as number) },
      };
    }
    if (row.error_code) {
      return {
        ok: false,
        error_code: row.error_code,
        message: assignErrorMessage(row.error_code, color as TagColor, tagNumber as number, row.tag_color, row.tag_number, roNumber),
        ro_number: roNumber,
        requested_tag: { color: color as TagColor, number: tagNumber as number, label: describeKeytag(color as TagColor, tagNumber as number) },
        ...(row.error_code === "ro_already_has_tag"
          ? { current_tag: { color: row.tag_color, number: row.tag_number, label: describeKeytag(row.tag_color, row.tag_number) } }
          : {}),
      };
    }
    assignedColor = row.tag_color as TagColor;
    assignedNumber = row.tag_number as number;
  } else {
    autoAssigned = true;
    const { data, error } = await sb.rpc("assign_next_keytag", {
      p_ro_id: ro.id,
      p_ro_number: ro.repairOrderNumber,
      p_customer_id: ro.customerId,
      p_vehicle_id: ro.vehicleId,
      p_advisor_id: ro.serviceWriterId,
      p_technician_id: ro.technicianId,
    });
    if (error) {
      return {
        ok: false,
        error_code: "rpc_error",
        message: `assign_next_keytag failed: ${error.message}`,
        ro_number: roNumber,
      };
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || !row.tag_color) {
      return {
        ok: false,
        error_code: "pool_exhausted",
        message: "All 180 key tags are currently in use.",
        ro_number: roNumber,
      };
    }
    assignedColor = row.tag_color as TagColor;
    assignedNumber = row.tag_number as number;
  }

  // 3. PATCH Tekmetric with the encoded wire value
  const wire = formatKeytag(assignedColor, assignedNumber);
  const patchResult = await patchKeytag(sb, shopId, ro.id, wire);

  await sb.rpc("record_keytag_patched", {
    p_ro_id: ro.id,
    p_success: patchResult.ok,
    p_error: patchResult.error ?? null,
  });

  // 4. Stamp the keytag row with who-did-it + write the audit-log entry
  if (userLabel) {
    await sb
      .from("keytags")
      .update({ changed_by_user_label: userLabel })
      .eq("tag_color", assignedColor)
      .eq("tag_number", assignedNumber);
  }
  await sb.rpc("log_keytag_audit", {
    p_tag_color: assignedColor,
    p_tag_number: assignedNumber,
    p_action: autoAssigned ? "assigned" : "force_assigned",
    p_source: "claude_desktop",
    p_ro_id: ro.id,
    p_ro_number: ro.repairOrderNumber,
    p_prior_status: "available",
    p_new_status: "assigned",
    p_user_label: userLabel ?? null,
    p_reason: autoAssigned
      ? "orchestrator_auto_assign"
      : `orchestrator_force_assign:${assignedColor}${assignedNumber}`,
    p_tekmetric_patch_ok: patchResult.ok,
    p_tekmetric_patch_error: patchResult.error ?? null,
  });

  return {
    ok: true,
    ro_number: ro.repairOrderNumber,
    ro_id: ro.id,
    tag: { color: assignedColor, number: assignedNumber, label: describeKeytag(assignedColor, assignedNumber), wire },
    tekmetric_patched: patchResult.ok,
    ...(patchResult.error ? { tekmetric_patch_error: patchResult.error } : {}),
    ro_url: buildTekmetricRoUrl({ roId: ro.id, shopId: ro.shopId }),
    auto_assigned: autoAssigned,
  };
}

function assignErrorMessage(
  code: string,
  reqColor: TagColor,
  reqNumber: number,
  currentColor: TagColor | null,
  currentNumber: number | null,
  roNumber: number,
): string {
  switch (code) {
    case "tag_in_use_by_other_ro":
      return `${describeKeytag(reqColor, reqNumber)} is already on another repair order. Pick a different tag or release the current holder first.`;
    case "ro_already_has_tag":
      return `Repair order #${roNumber} already has ${
        currentColor && currentNumber ? describeKeytag(currentColor, currentNumber) : "a different tag"
      }. Release the current tag first if you want to assign a different one.`;
    case "tag_not_found":
      return `${describeKeytag(reqColor, reqNumber)} is not in the keytag pool (must be Red 1-90 or Yellow 1-90).`;
    default:
      return `Could not assign ${describeKeytag(reqColor, reqNumber)}: ${code}.`;
  }
}

// ─── Tool 2: releaseKeytagFromRo ────────────────────────────────────────────

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

export async function releaseKeytagFromRo(
  sb: SupabaseClient,
  shopId: number,
  args: {
    roNumber: number;
    /** MCP OAuth user_label of the human invoking this tool (for audit). */
    userLabel?: string;
    /** Two-step confirmation token (returned by a prior call). Required for A/R-status releases. */
    confirmationToken?: string;
  },
): Promise<ReleaseKeytagResult> {
  const { roNumber, userLabel, confirmationToken } = args;

  // 1. Find the RO id + current tag status. We try our keytags table first
  //    (fast, avoids a Tekmetric GET for the common case where we know about
  //    this RO). If not found, fall back to Tekmetric.
  let roId: number | null = null;
  let ro: TekmetricRepairOrder | null = null;
  let dbTagColor: TagColor | null = null;
  let dbTagNumber: number | null = null;
  let dbTagStatus: "assigned" | "posted_ar" | "available" | null = null;

  const { data: dbRow } = await sb
    .from("keytags")
    .select("ro_id, tag_color, tag_number, status")
    .eq("ro_number", roNumber)
    .maybeSingle();
  if (dbRow?.ro_id) {
    roId = dbRow.ro_id as number;
    dbTagColor = dbRow.tag_color as TagColor;
    dbTagNumber = dbRow.tag_number as number;
    dbTagStatus = dbRow.status as "assigned" | "posted_ar" | "available";
  } else {
    ro = await getRepairOrderByNumber(sb, shopId, roNumber);
    if (!ro) {
      return {
        ok: false,
        error_code: "ro_not_found",
        message: `Could not find repair order #${roNumber} in Tekmetric or in our keytag table.`,
        ro_number: roNumber,
      };
    }
    roId = ro.id;
  }

  // ── A/R LOCKDOWN GATE ────────────────────────────────────────────────────
  // If the tag is currently in posted_ar status, the vehicle is in A/R and
  // the customer hasn't paid. Tekmetric blocks PATCH on A/R ROs so any
  // release here would silently desync DB from Tekmetric. Require explicit
  // two-step confirmation from the same user_label that initiated the call.
  const requiresConfirmation = dbTagStatus === "posted_ar";

  if (requiresConfirmation) {
    if (!userLabel) {
      return {
        ok: false,
        error_code: "confirmation_failed",
        message:
          `Release blocked: RO #${roNumber} is in A/R status. A/R releases require an authenticated user (user_label missing from caller).`,
        ro_number: roNumber,
      };
    }
    const scope = {
      ro_numbers: [roNumber],
      tag_color: dbTagColor,
      tag_number: dbTagNumber,
      reason: "manual_release_ar",
    };
    if (!confirmationToken) {
      // First-step: issue a fresh token, return ConfirmationRequiredResult
      const issued = await issueConfirmationToken(sb, {
        actionKind: "release_ar_tag",
        scope,
        userLabel,
      });
      return confirmationRequiredResponse(issued);
    }
    // Second-step: consume the token
    const consumed = await consumeConfirmationToken(sb, {
      tokenId: confirmationToken,
      actionKind: "release_ar_tag",
      scope,
      userLabel,
    });
    if (!consumed.ok) {
      return {
        ok: false,
        error_code: "confirmation_failed",
        message:
          `Confirmation token rejected for A/R release of RO #${roNumber}: ${consumed.failure_reason ?? "unknown"}. The advisor must re-request and re-confirm.`,
        ro_number: roNumber,
      };
    }
  }

  // 2. Release in our DB
  const { data: releasedRows, error } = await sb.rpc("release_keytag_for_ro", {
    p_ro_id: roId,
    p_reason: requiresConfirmation
      ? "manual_release_via_orchestrator_ar_confirmed"
      : "manual_release_via_orchestrator",
  });
  if (error) {
    return {
      ok: false,
      error_code: "rpc_error",
      message: `release_keytag_for_ro failed: ${error.message}`,
      ro_number: roNumber,
    };
  }
  const released = Array.isArray(releasedRows) ? releasedRows[0] : releasedRows;

  if (!released) {
    return {
      ok: true,
      ro_number: roNumber,
      ro_id: roId,
      released_tag: null,
      tekmetric_cleared: false,
      message: `RO #${roNumber} did not have a key tag assigned in our records. Nothing to release.`,
    };
  }

  // 3. PATCH Tekmetric to clear the keyTag field
  const patchResult = await patchKeytag(sb, shopId, roId, null);
  await sb.rpc("record_keytag_patched", {
    p_ro_id: roId,
    p_success: patchResult.ok,
    p_error: patchResult.error ?? null,
  });

  const tagColor = released.tag_color as TagColor;
  const tagNumber = released.tag_number as number;

  // 4. Audit log entry for the release
  await sb.rpc("log_keytag_audit", {
    p_tag_color: tagColor,
    p_tag_number: tagNumber,
    p_action: "released",
    p_source: "claude_desktop",
    p_ro_id: roId,
    p_ro_number: roNumber,
    p_prior_status: dbTagStatus,
    p_new_status: "available",
    p_user_label: userLabel ?? null,
    p_reason: requiresConfirmation
      ? "orchestrator_manual_release_ar_confirmed"
      : "orchestrator_manual_release",
    p_tekmetric_patch_ok: patchResult.ok,
    p_tekmetric_patch_error: patchResult.error ?? null,
  });

  return {
    ok: true,
    ro_number: roNumber,
    ro_id: roId,
    released_tag: { color: tagColor, number: tagNumber, label: describeKeytag(tagColor, tagNumber) },
    tekmetric_cleared: patchResult.ok,
    ...(patchResult.error ? { tekmetric_clear_error: patchResult.error } : {}),
    message: patchResult.ok
      ? `${describeKeytag(tagColor, tagNumber)} released from RO #${roNumber} and cleared in Tekmetric.`
      : `${describeKeytag(tagColor, tagNumber)} released from our records, but clearing Tekmetric failed: ${patchResult.error}`,
  };
}
