// Extended keytag tools for the orchestrator (added 2026-05-11).
//
// Companions to keytag-management.ts (assign/release). These cover the rest
// of the keytag lifecycle so an advisor can do everything from Claude Desktop
// without touching SQL Studio or curl:
//
//   - whoIsOnTag           : richer findRoByKeyTag (customer name + vehicle)
//   - revertKeytagToAssigned : manual A/R → WIP regression (calls revert RPC)
//   - markKeytagPosted     : manual "sent to A/R" override
//   - runBulkReconcile     : on-demand keytag-bulk-reconcile invocation
//   - getKeytagAuditHistory: query keytag_audit_log with filters; default 24h
//
// All write paths emit a row to keytag_audit_log via log_keytag_audit, with
// source='claude_desktop' and the OAuth user_label of the advisor.

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
  getRepairOrderById,
  type TekmetricRepairOrder,
} from "./repair-orders.ts";
import {
  getTekmetricAccessToken,
  tekmetricGetJson,
} from "../tekmetric-client.ts";
import {
  type ConfirmationRequiredResult,
  confirmationRequiredResponse,
  consumeConfirmationToken,
  issueConfirmationToken,
} from "../keytag-confirmation.ts";

// ─── Shared helper: parse customer name from Tekmetric customer payload ─────

interface TekmetricCustomerSubset {
  firstName?: string | null;
  lastName?: string | null;
  contactFirstName?: string | null;
  contactLastName?: string | null;
}

/**
 * Coalesces a Tekmetric customer record into a display name. Business
 * customers store the company in firstName ("Carmax"), people store
 * person fields normally. Falls back to contactFirstName/contactLastName
 * when both firstName and lastName are blank (rare edge case).
 */
function customerDisplayName(c: TekmetricCustomerSubset | null | undefined): string | null {
  if (!c) return null;
  const first = (c.firstName ?? "").trim();
  const last = (c.lastName ?? "").trim();
  if (first || last) return `${first} ${last}`.trim();
  const cFirst = (c.contactFirstName ?? "").trim();
  const cLast = (c.contactLastName ?? "").trim();
  if (cFirst || cLast) return `${cFirst} ${cLast}`.trim();
  return null;
}

// ─── Tool: whoIsOnTag ───────────────────────────────────────────────────────

export type WhoIsOnTagResult =
  | {
      ok: true;
      found: true;
      tag: string;
      tag_color: TagColor;
      tag_number: number;
      ro_number: number;
      ro_id: number;
      ro_url: string;
      status: "assigned" | "posted_ar";
      customer_name: string | null;
      vehicle_year: number | null;
      vehicle_make: string | null;
      vehicle_model: string | null;
      vehicle_display: string | null;
      last_activity_at: string | null;
    }
  | {
      ok: true;
      found: false;
      tag: string;
      tag_color: TagColor;
      tag_number: number;
      message: string;
    };

/**
 * Like findRoByKeyTag but enriched with customer name + vehicle Year/Make/Model
 * via one extra Tekmetric GET. Use this when the advisor wants a complete
 * picture ("who's on Red 5?") rather than just an RO link.
 */
export async function whoIsOnTag(
  sb: SupabaseClient,
  shopId: number,
  args: { color: TagColor; number: number },
): Promise<WhoIsOnTagResult> {
  const { color, number } = args;
  const tag = formatKeytag(color, number);

  if (!Number.isInteger(number) || number < 1 || number > 90) {
    return {
      ok: true,
      found: false,
      tag,
      tag_color: color,
      tag_number: number,
      message: `Tag ${tag} is out of range. Valid tag numbers are 1-90.`,
    };
  }

  const { data, error } = await sb
    .from("keytags")
    .select("status, ro_id, ro_number, last_activity_at")
    .eq("tag_color", color)
    .eq("tag_number", number)
    .maybeSingle();
  if (error) throw new Error(`keytags query failed: ${error.message}`);
  if (!data || data.status === "available" || data.ro_id === null) {
    return {
      ok: true,
      found: false,
      tag,
      tag_color: color,
      tag_number: number,
      message: `${describeKeytag(color, number)} is not currently assigned to any repair order.`,
    };
  }

  // Enrichment: customer name + vehicle Y/M/M.
  // Tekmetric's GET /repair-orders/{id} does NOT reliably include inline
  // `customer` or `vehicle` objects (verified 2026-05-11 — RO 327990564
  // returned both as null). Strategy:
  //   1. Fetch the RO to get customerId + vehicleId (also catches inline if present)
  //   2. If inline missing, fetch /customers/{id} and /vehicles/{id} separately
  //   3. Failures at any step degrade gracefully — return whatever did resolve
  let customerName: string | null = null;
  let vyear: number | null = null;
  let vmake: string | null = null;
  let vmodel: string | null = null;
  let customerId: number | null = null;
  let vehicleId: number | null = null;

  try {
    const ro = (await getRepairOrderById(
      sb,
      shopId,
      data.ro_id as number,
    )) as TekmetricRepairOrder & {
      customer?: TekmetricCustomerSubset | null;
      vehicle?: {
        year?: number | null;
        make?: string | null;
        model?: string | null;
      } | null;
    } | null;
    if (ro) {
      customerId = (ro.customerId as number | null) ?? null;
      vehicleId = (ro.vehicleId as number | null) ?? null;
      // Try inline first (some Tekmetric responses include it)
      if (ro.customer) {
        customerName = customerDisplayName(ro.customer);
      }
      if (ro.vehicle) {
        vyear = (ro.vehicle.year as number | null) ?? null;
        vmake = (ro.vehicle.make as string | null) ?? null;
        vmodel = (ro.vehicle.model as string | null) ?? null;
      }
    }
  } catch {
    // RO fetch failed — leave enrichment fields null
  }

  // Fallback: separate /customers/{id} fetch when inline missing
  if (!customerName && customerId !== null) {
    try {
      const cust = await tekmetricGetJson<TekmetricCustomerSubset>(
        sb,
        `/customers/${customerId}`,
        { shop: shopId },
      );
      if (cust) customerName = customerDisplayName(cust);
    } catch {
      // 404 / network — keep null
    }
  }

  // Fallback: separate /vehicles/{id} fetch when inline missing
  if ((vyear === null && vmake === null && vmodel === null) && vehicleId !== null) {
    try {
      const veh = await tekmetricGetJson<{
        year?: number | null;
        make?: string | null;
        model?: string | null;
      }>(
        sb,
        `/vehicles/${vehicleId}`,
        { shop: shopId },
      );
      if (veh) {
        vyear = (veh.year as number | null) ?? null;
        vmake = (veh.make as string | null) ?? null;
        vmodel = (veh.model as string | null) ?? null;
      }
    } catch {
      // 404 / network — keep nulls
    }
  }

  const vehicleDisplay = [vyear, vmake, vmodel]
    .filter((v): v is string | number => v !== null && v !== "")
    .map(String)
    .join(" ") || null;

  return {
    ok: true,
    found: true,
    tag,
    tag_color: color,
    tag_number: number,
    ro_number: data.ro_number as number,
    ro_id: data.ro_id as number,
    ro_url: buildTekmetricRoUrl({ roId: data.ro_id as number, shopId }),
    status: data.status as "assigned" | "posted_ar",
    customer_name: customerName,
    vehicle_year: vyear,
    vehicle_make: vmake,
    vehicle_model: vmodel,
    vehicle_display: vehicleDisplay,
    last_activity_at: (data.last_activity_at as string | null) ?? null,
  };
}

// ─── Tool: revertKeytagToAssigned ───────────────────────────────────────────

export type RevertKeytagResult =
  | {
      ok: true;
      ro_number: number;
      ro_id: number;
      tag_color: TagColor;
      tag_number: number;
      tag_label: string;
      prior_status: "assigned" | "posted_ar";
      already_assigned: boolean;
      ro_url: string;
      message: string;
    }
  | {
      ok: false;
      error_code: "ro_not_found_in_keytags" | "rpc_error" | "confirmation_failed";
      message: string;
      ro_number: number;
    }
  | ConfirmationRequiredResult;

/**
 * Reverts a tag from status='posted_ar' back to status='assigned' for the
 * given RO. Used when an advisor un-posts an A/R balance and the RO is
 * really back in WIP. Idempotent (no-op if tag is already 'assigned').
 *
 * A/R lockdown applies: if the tag is in posted_ar status (the typical case
 * for revert), two-step confirmation is required.
 */
export async function revertKeytagToAssigned(
  sb: SupabaseClient,
  args: { roNumber: number; userLabel?: string; confirmationToken?: string },
): Promise<RevertKeytagResult> {
  const { roNumber, userLabel, confirmationToken } = args;

  // Look up the RO id from our keytags table (no Tekmetric round-trip needed)
  const { data: dbRow } = await sb
    .from("keytags")
    .select("ro_id, status, tag_color, tag_number")
    .eq("ro_number", roNumber)
    .maybeSingle();
  if (!dbRow || dbRow.ro_id === null) {
    return {
      ok: false,
      error_code: "ro_not_found_in_keytags",
      message: `RO #${roNumber} does not have a tag in our keytag table. Nothing to revert.`,
      ro_number: roNumber,
    };
  }
  const roId = dbRow.ro_id as number;
  const priorStatus = dbRow.status as "assigned" | "posted_ar";
  const dbTagColor = dbRow.tag_color as TagColor;
  const dbTagNumber = dbRow.tag_number as number;

  // ── A/R LOCKDOWN GATE ────────────────────────────────────────────────────
  // Revert is by definition an A/R-state operation (only posted_ar tags
  // benefit from being reverted to assigned). Require two-step confirmation
  // unless the tag is already in assigned state (no-op).
  if (priorStatus === "posted_ar") {
    if (!userLabel) {
      return {
        ok: false,
        error_code: "confirmation_failed",
        message: `Revert blocked: RO #${roNumber} is in A/R status. A/R reverts require an authenticated user.`,
        ro_number: roNumber,
      };
    }
    const scope = {
      ro_numbers: [roNumber],
      tag_color: dbTagColor,
      tag_number: dbTagNumber,
      reason: "manual_revert_ar",
    };
    if (!confirmationToken) {
      const issued = await issueConfirmationToken(sb, {
        actionKind: "revert_to_assigned",
        scope,
        userLabel,
      });
      return confirmationRequiredResponse(issued);
    }
    const consumed = await consumeConfirmationToken(sb, {
      tokenId: confirmationToken,
      actionKind: "revert_to_assigned",
      scope,
      userLabel,
    });
    if (!consumed.ok) {
      return {
        ok: false,
        error_code: "confirmation_failed",
        message: `Confirmation token rejected for revert of RO #${roNumber}: ${consumed.failure_reason ?? "unknown"}. The advisor must re-request and re-confirm.`,
        ro_number: roNumber,
      };
    }
  }

  const { data: rpcRows, error } = await sb.rpc("revert_keytag_to_assigned", {
    p_ro_id: roId,
    p_last_activity_at: new Date().toISOString(),
  });
  if (error) {
    return {
      ok: false,
      error_code: "rpc_error",
      message: `revert_keytag_to_assigned failed: ${error.message}`,
      ro_number: roNumber,
    };
  }
  const reverted = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
  if (!reverted) {
    // No row matched — defensive; should be caught by the lookup above
    return {
      ok: false,
      error_code: "ro_not_found_in_keytags",
      message: `RO #${roNumber} did not have a tag at revert time. Nothing to revert.`,
      ro_number: roNumber,
    };
  }

  const tagColor = reverted.tag_color as TagColor;
  const tagNumber = reverted.tag_number as number;
  const alreadyAssigned = priorStatus === "assigned";

  // Audit log entry
  await sb.rpc("log_keytag_audit", {
    p_tag_color: tagColor,
    p_tag_number: tagNumber,
    p_action: "reverted",
    p_source: "claude_desktop",
    p_ro_id: roId,
    p_ro_number: roNumber,
    p_prior_status: priorStatus,
    p_new_status: "assigned",
    p_user_label: userLabel ?? null,
    p_reason: alreadyAssigned
      ? "orchestrator_revert_idempotent_noop"
      : "orchestrator_revert_posted_ar_to_assigned",
  });

  return {
    ok: true,
    ro_number: roNumber,
    ro_id: roId,
    tag_color: tagColor,
    tag_number: tagNumber,
    tag_label: describeKeytag(tagColor, tagNumber),
    prior_status: priorStatus,
    already_assigned: alreadyAssigned,
    ro_url: buildTekmetricRoUrl({ roId, shopId: 0 }), // shopId comes from caller's context; orchestrator will fix
    message: alreadyAssigned
      ? `${describeKeytag(tagColor, tagNumber)} was already in 'assigned' state — refreshed activity timestamp.`
      : `Reverted ${describeKeytag(tagColor, tagNumber)} on RO #${roNumber} from A/R back to assigned.`,
  };
}

// ─── Tool: markKeytagPosted ─────────────────────────────────────────────────

export type MarkKeytagPostedResult =
  | {
      ok: true;
      ro_number: number;
      ro_id: number;
      tag_color: TagColor;
      tag_number: number;
      tag_label: string;
      posted_at: string;
      ro_url: string;
      message: string;
    }
  | {
      ok: false;
      error_code: "ro_not_found_in_keytags" | "rpc_error" | "confirmation_failed";
      message: string;
      ro_number: number;
    }
  | ConfirmationRequiredResult;

/**
 * Marks a tag posted_ar with the given (or now) timestamp. Manual override
 * for when the "sent to A/R" webhook was missed; rare but useful.
 *
 * Always requires two-step confirmation: flipping a tag into posted_ar
 * locks it (Tekmetric won't accept PATCH on the RO) so this is irreversible
 * without a counter-revert. Treated as a sensitive operation.
 */
export async function markKeytagPosted(
  sb: SupabaseClient,
  args: { roNumber: number; postedAt?: string; userLabel?: string; confirmationToken?: string },
): Promise<MarkKeytagPostedResult> {
  const { roNumber, postedAt, userLabel, confirmationToken } = args;
  const effectivePostedAt = postedAt ?? new Date().toISOString();

  const { data: dbRow } = await sb
    .from("keytags")
    .select("ro_id, status, tag_color, tag_number")
    .eq("ro_number", roNumber)
    .maybeSingle();
  if (!dbRow || dbRow.ro_id === null) {
    return {
      ok: false,
      error_code: "ro_not_found_in_keytags",
      message: `RO #${roNumber} does not have a tag in our keytag table.`,
      ro_number: roNumber,
    };
  }
  const roId = dbRow.ro_id as number;
  const priorStatus = dbRow.status as "assigned" | "posted_ar";
  const dbTagColor = dbRow.tag_color as TagColor;
  const dbTagNumber = dbRow.tag_number as number;

  // ── A/R LOCKDOWN GATE ────────────────────────────────────────────────────
  // mark_posted flips a tag into the locked posted_ar state, which Tekmetric
  // blocks PATCHes against. Always require two-step confirmation.
  if (priorStatus !== "posted_ar") {
    if (!userLabel) {
      return {
        ok: false,
        error_code: "confirmation_failed",
        message: `mark_posted blocked: requires an authenticated user.`,
        ro_number: roNumber,
      };
    }
    const scope = {
      ro_numbers: [roNumber],
      tag_color: dbTagColor,
      tag_number: dbTagNumber,
      reason: "manual_mark_posted",
    };
    if (!confirmationToken) {
      const issued = await issueConfirmationToken(sb, {
        actionKind: "mark_posted",
        scope,
        userLabel,
      });
      return confirmationRequiredResponse(issued);
    }
    const consumed = await consumeConfirmationToken(sb, {
      tokenId: confirmationToken,
      actionKind: "mark_posted",
      scope,
      userLabel,
    });
    if (!consumed.ok) {
      return {
        ok: false,
        error_code: "confirmation_failed",
        message: `Confirmation token rejected for mark_posted on RO #${roNumber}: ${consumed.failure_reason ?? "unknown"}. The advisor must re-request and re-confirm.`,
        ro_number: roNumber,
      };
    }
  }

  const { data: rpcRows, error } = await sb.rpc("mark_keytag_posted", {
    p_ro_id: roId,
    p_posted_at: effectivePostedAt,
    p_last_activity_at: effectivePostedAt,
  });
  if (error) {
    return {
      ok: false,
      error_code: "rpc_error",
      message: `mark_keytag_posted failed: ${error.message}`,
      ro_number: roNumber,
    };
  }
  const posted = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
  if (!posted) {
    return {
      ok: false,
      error_code: "ro_not_found_in_keytags",
      message: `mark_keytag_posted returned no row for RO #${roNumber}.`,
      ro_number: roNumber,
    };
  }

  const tagColor = posted.tag_color as TagColor;
  const tagNumber = posted.tag_number as number;

  await sb.rpc("log_keytag_audit", {
    p_tag_color: tagColor,
    p_tag_number: tagNumber,
    p_action: "marked_posted",
    p_source: "claude_desktop",
    p_ro_id: roId,
    p_ro_number: roNumber,
    p_prior_status: priorStatus,
    p_new_status: "posted_ar",
    p_user_label: userLabel ?? null,
    p_reason: "orchestrator_manual_mark_posted",
  });

  return {
    ok: true,
    ro_number: roNumber,
    ro_id: roId,
    tag_color: tagColor,
    tag_number: tagNumber,
    tag_label: describeKeytag(tagColor, tagNumber),
    posted_at: effectivePostedAt,
    ro_url: buildTekmetricRoUrl({ roId, shopId: 0 }),
    message: `Marked ${describeKeytag(tagColor, tagNumber)} on RO #${roNumber} as A/R (posted ${effectivePostedAt}).`,
  };
}

// ─── Tool: runBulkReconcile ─────────────────────────────────────────────────

export interface RunBulkReconcileResult {
  ok: boolean;
  duration_ms: number;
  tekmetric_wip_count: number;
  tekmetric_ar_count: number;
  actions: {
    assigned_new: number;
    marked_posted: number;
    reverted: number;
    touched: number;
    repatched: number;
    released_orphan: number;
    noop: number;
    error: number;
  };
  pool: { in_use: number; available: number };
  orphan_email: {
    attempted: boolean;
    sent: boolean;
    error?: string;
    orphan_count: number;
  };
  message: string;
}

/**
 * Invokes the keytag-bulk-reconcile Edge Function via HTTPS using the
 * service-role bearer the orchestrator already has. Used when an advisor
 * wants to trigger reconcile mid-day instead of waiting for the 6 AM cron.
 */
export async function runBulkReconcile(args: {
  supabaseUrl: string;
  serviceRoleKey: string;
  dryRun?: boolean;
  overwrite?: boolean;
}): Promise<RunBulkReconcileResult> {
  const { supabaseUrl, serviceRoleKey, dryRun, overwrite } = args;
  const url = new URL(`${supabaseUrl.replace(/\/+$/, "")}/functions/v1/keytag-bulk-reconcile`);
  if (dryRun) url.searchParams.set("dry_run", "true");
  if (overwrite) url.searchParams.set("overwrite", "true");

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    return {
      ok: false,
      duration_ms: 0,
      tekmetric_wip_count: 0,
      tekmetric_ar_count: 0,
      actions: {
        assigned_new: 0, marked_posted: 0, reverted: 0, touched: 0,
        repatched: 0, released_orphan: 0, noop: 0, error: 0,
      },
      pool: { in_use: 0, available: 0 },
      orphan_email: { attempted: false, sent: false, orphan_count: 0 },
      message: `keytag-bulk-reconcile HTTP ${res.status}: ${text.slice(0, 200)}`,
    };
  }
  const summary = (await res.json()) as {
    duration_ms: number;
    tekmetric_wip_count: number;
    tekmetric_ar_count: number;
    actions: RunBulkReconcileResult["actions"];
    pool: RunBulkReconcileResult["pool"];
    orphan_email: { attempted: boolean; sent: boolean; error?: string; orphans: unknown[] };
  };

  const totalActions =
    summary.actions.assigned_new +
    summary.actions.marked_posted +
    summary.actions.reverted +
    summary.actions.released_orphan +
    summary.actions.repatched;

  return {
    ok: true,
    duration_ms: summary.duration_ms,
    tekmetric_wip_count: summary.tekmetric_wip_count,
    tekmetric_ar_count: summary.tekmetric_ar_count,
    actions: summary.actions,
    pool: summary.pool,
    orphan_email: {
      attempted: summary.orphan_email.attempted,
      sent: summary.orphan_email.sent,
      error: summary.orphan_email.error,
      orphan_count: Array.isArray(summary.orphan_email.orphans)
        ? summary.orphan_email.orphans.length
        : 0,
    },
    message:
      `Reconcile done in ${(summary.duration_ms / 1000).toFixed(1)}s. ` +
      `Pool: ${summary.pool.in_use} in use, ${summary.pool.available} available. ` +
      `${totalActions === 0 ? "No state changes." : `Mutations: ${totalActions}.`}`,
  };
}

// ─── Tool: getKeytagAuditHistory ────────────────────────────────────────────

export interface AuditHistoryEntry {
  id: number;
  occurred_at: string;
  tag: string;
  tag_color: TagColor;
  tag_number: number;
  ro_number: number | null;
  action: string;
  prior_status: string | null;
  new_status: string | null;
  source: string;
  user_label: string | null;
  reason: string | null;
  tekmetric_patch_ok: boolean | null;
}

export interface GetKeytagAuditHistoryResult {
  ok: true;
  filters: {
    since: string;
    until: string;
    user_label: string | null;
    tag_color: TagColor | null;
    tag_number: number | null;
    ro_number: number | null;
    action: string | null;
    source: string | null;
  };
  count: number;
  results: AuditHistoryEntry[];
  truncated: boolean;
  message: string;
}

/**
 * Queries the keytag_audit_log with optional filters. Defaults to the last
 * 24 hours, capped at 50 rows. The orchestrator can ask the advisor for a
 * narrower time window if the result set is too noisy.
 */
export async function getKeytagAuditHistory(
  sb: SupabaseClient,
  args: {
    since?: string;
    until?: string;
    user_label?: string;
    tag_color?: TagColor;
    tag_number?: number;
    ro_number?: number;
    action?: string;
    source?: string;
    limit?: number;
  },
): Promise<GetKeytagAuditHistoryResult> {
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  const since = args.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const until = args.until ?? new Date().toISOString();

  let query = sb
    .from("keytag_audit_log")
    .select(
      "id, occurred_at, tag_color, tag_number, ro_number, action, prior_status, new_status, source, user_label, reason, tekmetric_patch_ok",
    )
    .gte("occurred_at", since)
    .lte("occurred_at", until)
    .order("occurred_at", { ascending: false })
    .limit(limit + 1); // fetch +1 to detect truncation

  if (args.user_label) query = query.eq("user_label", args.user_label);
  if (args.tag_color) query = query.eq("tag_color", args.tag_color);
  if (args.tag_number !== undefined) query = query.eq("tag_number", args.tag_number);
  if (args.ro_number !== undefined) query = query.eq("ro_number", args.ro_number);
  if (args.action) query = query.eq("action", args.action);
  if (args.source) query = query.eq("source", args.source);

  const { data, error } = await query;
  if (error) {
    throw new Error(`keytag_audit_log query failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{
    id: number;
    occurred_at: string;
    tag_color: string;
    tag_number: number;
    ro_number: number | null;
    action: string;
    prior_status: string | null;
    new_status: string | null;
    source: string;
    user_label: string | null;
    reason: string | null;
    tekmetric_patch_ok: boolean | null;
  }>;
  const truncated = rows.length > limit;
  const trimmed = truncated ? rows.slice(0, limit) : rows;

  const results: AuditHistoryEntry[] = trimmed.map((r) => ({
    id: r.id,
    occurred_at: r.occurred_at,
    tag: `${r.tag_color === "red" ? "R" : "Y"}${r.tag_number}`,
    tag_color: r.tag_color as TagColor,
    tag_number: r.tag_number,
    ro_number: r.ro_number,
    action: r.action,
    prior_status: r.prior_status,
    new_status: r.new_status,
    source: r.source,
    user_label: r.user_label,
    reason: r.reason,
    tekmetric_patch_ok: r.tekmetric_patch_ok,
  }));

  return {
    ok: true,
    filters: {
      since,
      until,
      user_label: args.user_label ?? null,
      tag_color: args.tag_color ?? null,
      tag_number: args.tag_number ?? null,
      ro_number: args.ro_number ?? null,
      action: args.action ?? null,
      source: args.source ?? null,
    },
    count: results.length,
    results,
    truncated,
    message: truncated
      ? `Showing ${results.length} most recent entries. There are MORE — narrow the time window or add filters to see them.`
      : results.length === 0
        ? "No audit entries matched the filters."
        : `Found ${results.length} entries.`,
  };
}
