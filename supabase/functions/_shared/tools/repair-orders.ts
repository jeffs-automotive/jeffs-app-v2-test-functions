// Pure tool functions for repair-order lookups.
//
// These are designed to be reused two ways:
//   1. Today: imported by thin HTTP edge-function wrappers (one per tool) so the
//      team can hit them via curl/Claude Desktop while the orchestrator is being built.
//   2. Tomorrow: imported by the orchestrator (Vercel AI SDK) and registered as
//      `tool({ description, parameters, execute })` definitions. The execute
//      function will be a one-liner that just calls into here.
//
// "Fuzzy language" handling: tool DESCRIPTIONS in the orchestrator should make clear
// that any user question about "what is on key tag N" / "who has key tag N" / "which
// car has key tag N" / "which work order has key tag N" maps to findRoByKeyTag.
// The TOOL itself just returns RO data; the orchestrator does the routing.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  tekmetricGetJson,
  type TekmetricPage,
  type TekmetricRepairOrder,
} from "../tekmetric-client.ts";
import { TEKMETRIC_RO_STATUS, buildTekmetricRoUrl } from "../tekmetric.ts";

// Re-export TekmetricRepairOrder so callers that already import other names
// from this module can grab the type from one place.
export type { TekmetricRepairOrder };

// ─── Helper: GET a single repair order by RO number (what users say) ────────

/**
 * Fetches a single repair order from Tekmetric by its repairOrderNumber (the
 * shop-facing number users actually use, e.g. "RO 152222"). Tekmetric's list
 * endpoint supports `?repairOrderNumber=N` as a filter; we expect exactly one
 * match (RO numbers are unique per shop).
 *
 * Returns null if the RO is not found OR if multiple results come back (which
 * shouldn't happen but is treated as a lookup failure rather than a guess).
 */
export async function getRepairOrderByNumber(
  sb: SupabaseClient,
  shopId: number,
  roNumber: number,
): Promise<TekmetricRepairOrder | null> {
  try {
    const page = await tekmetricGetJson<TekmetricPage<TekmetricRepairOrder>>(
      sb,
      "/repair-orders",
      { shop: shopId, repairOrderNumber: roNumber, size: 5 },
    );
    if (page.content.length === 0) return null;
    if (page.content.length > 1) {
      // Defensive — RO numbers should be unique per shop. If we get more than
      // one, something is off; refuse to guess which to use.
      console.warn(
        `getRepairOrderByNumber: ${page.content.length} ROs matched repairOrderNumber=${roNumber}; refusing to pick one.`,
      );
      return null;
    }
    return page.content[0];
  } catch (e) {
    console.error("getRepairOrderByNumber failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

// ─── Helper: GET a single repair order by Tekmetric ID ──────────────────────

/**
 * Fetches a single repair order from Tekmetric by ID. Used by the keytag webhook
 * handler to defensively re-verify status before assigning a tag (rather than
 * trusting the webhook payload's status field).
 */
export async function getRepairOrderById(
  sb: SupabaseClient,
  shopId: number,
  roId: number,
): Promise<TekmetricRepairOrder | null> {
  try {
    return await tekmetricGetJson<TekmetricRepairOrder>(
      sb,
      `/repair-orders/${roId}`,
      { shop: shopId },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Tekmetric returns 404 when the RO doesn't exist (or isn't in our shop's scope).
    if (msg.includes("HTTP 404")) return null;
    throw e;
  }
}

// ─── Tool 1: list all in-use keytags (WIP + A/R) ────────────────────────────

export interface WipKeyTagsResult {
  ok: true;
  count: number;
  shop_id: number;
  results: Array<{
    ro_number: number;
    ro_id: number;
    /** Wire format (e.g. "R4", "Y45") for display in chat. */
    tag: string;
    tag_color: "red" | "yellow";
    tag_number: number;
    status: "assigned" | "posted_ar";
    customer_id: number | null;
    /** Denormalized Tekmetric customer display name (captured at assign). Null when unresolved. */
    customer_name: string | null;
    vehicle_id: number | null;
    ro_url: string;
    last_activity_at: string | null;
  }>;
}

/**
 * Lists every in-use keytag (status='assigned' for WIP, status='posted_ar' for A/R).
 *
 * Refactored 2026-05-11 to read from our keytags table instead of Tekmetric's
 * `/repair-orders?status=WIP` list endpoint. Reasons:
 *   1. Tekmetric stores R/Y format keytag strings ("R4", "Y45") after the color-
 *      coded migration; the prior parseKeyTag helper used parseInt which returned
 *      NaN for those, silently dropping every row.
 *   2. Our keytags table is the source of truth post-reconcile — has color/number,
 *      status, last_activity_at, customer_id, vehicle_id all in one query.
 *   3. WIP-only is too narrow — fleet A/R tags are legitimate keytags the advisor
 *      may want to see. Now returns both, with status distinguishing them.
 */
export async function listWipKeyTags(
  sb: SupabaseClient,
  shopId: number,
): Promise<WipKeyTagsResult> {
  const { data, error } = await sb
    .from("keytags")
    .select(
      "tag_color, tag_number, status, ro_id, ro_number, customer_id, customer_name, vehicle_id, last_activity_at",
    )
    .in("status", ["assigned", "posted_ar"])
    .order("tag_color")
    .order("tag_number");
  if (error) throw new Error(`keytags query failed: ${error.message}`);

  const results = (data ?? [])
    .filter((r) => r.ro_id !== null)
    .map((r) => ({
      ro_number: r.ro_number as number,
      ro_id: r.ro_id as number,
      tag: `${(r.tag_color as string) === "red" ? "R" : "Y"}${r.tag_number}`,
      tag_color: r.tag_color as "red" | "yellow",
      tag_number: r.tag_number as number,
      status: r.status as "assigned" | "posted_ar",
      customer_id: (r.customer_id as number | null) ?? null,
      customer_name: (r.customer_name as string | null) ?? null,
      vehicle_id: (r.vehicle_id as number | null) ?? null,
      ro_url: buildTekmetricRoUrl({ roId: r.ro_id as number, shopId }),
      last_activity_at: (r.last_activity_at as string | null) ?? null,
    }));

  return {
    ok: true,
    count: results.length,
    shop_id: shopId,
    results,
  };
}

// ─── Tool 2: find the repair order that holds a specific key tag ─────────────

export type FindRoByKeyTagResult =
  | {
      ok: true;
      found: true;
      tag: string;
      tag_color: "red" | "yellow";
      tag_number: number;
      ro_number: number;
      ro_id: number;
      ro_url: string;
      customer_id: number | null;
      vehicle_id: number | null;
      status: "assigned" | "posted_ar";
      last_activity_at: string | null;
    }
  | {
      ok: true;
      found: false;
      tag: string;
      tag_color: "red" | "yellow";
      tag_number: number;
      message: string;
    };

/**
 * Looks up the repair order currently holding a specific (color, number) tag.
 *
 * Refactored 2026-05-11 to query our keytags table (not Tekmetric). The prior
 * implementation was effectively broken once Tekmetric started storing R/Y
 * format strings.
 *
 * Requires color to disambiguate Red N from Yellow N — call site (orchestrator
 * tool description in keytag.md) must extract color from the user's utterance
 * before calling.
 */
export async function findRoByKeyTag(
  sb: SupabaseClient,
  shopId: number,
  tagColor: "red" | "yellow",
  tagNumber: number,
): Promise<FindRoByKeyTagResult> {
  const tagLabel = `${tagColor === "red" ? "R" : "Y"}${tagNumber}`;

  if (!Number.isInteger(tagNumber) || tagNumber < 1 || tagNumber > 90) {
    return {
      ok: true,
      found: false,
      tag: tagLabel,
      tag_color: tagColor,
      tag_number: tagNumber,
      message: `Tag ${tagLabel} is out of range. Valid tag numbers are 1-90.`,
    };
  }

  const { data, error } = await sb
    .from("keytags")
    .select(
      "status, ro_id, ro_number, customer_id, vehicle_id, last_activity_at",
    )
    .eq("tag_color", tagColor)
    .eq("tag_number", tagNumber)
    .maybeSingle();
  if (error) throw new Error(`keytags query failed: ${error.message}`);

  if (!data || data.status === "available" || data.ro_id === null) {
    return {
      ok: true,
      found: false,
      tag: tagLabel,
      tag_color: tagColor,
      tag_number: tagNumber,
      message: `${tagLabel} is not currently assigned to any repair order.`,
    };
  }

  return {
    ok: true,
    found: true,
    tag: tagLabel,
    tag_color: tagColor,
    tag_number: tagNumber,
    ro_number: data.ro_number as number,
    ro_id: data.ro_id as number,
    ro_url: buildTekmetricRoUrl({ roId: data.ro_id as number, shopId }),
    customer_id: (data.customer_id as number | null) ?? null,
    vehicle_id: (data.vehicle_id as number | null) ?? null,
    status: data.status as "assigned" | "posted_ar",
    last_activity_at: (data.last_activity_at as string | null) ?? null,
  };
}

// ─── Tool 3: released-while-WIP ROs that still need a tag ────────────────────

export interface ReleasedWipNeedingTagResult {
  ok: true;
  count: number;
  window_days: number;
  results: Array<{
    ro_id: number;
    ro_number: number;
    /** The tag that was released, wire format (e.g. "R75"). */
    released_tag: string;
    released_color: "red" | "yellow";
    released_number: number;
    /** When the tag was released (keytag_audit_log.occurred_at). */
    released_at: string;
    /** Who released it (audit user_label), if known. */
    released_by: string | null;
    ro_url: string;
  }>;
}

/** Default look-back window for released-from-WIP events. Bounds staleness: a tag
 *  released from a WIP RO that was actually completed (not re-tagged) drops off the
 *  board after this many days even without a Tekmetric status check. Tunable. */
export const DEFAULT_RELEASED_WIP_WINDOW_DAYS = 3;

/**
 * Lists repair orders whose key tag was RELEASED while the RO was still in WIP
 * (keytag_audit_log.action='released' AND prior_status='assigned') within the
 * recency window, and that currently have NO tag (not re-tagged, not in A/R).
 *
 * Powers the admin board's "keep released-but-still-WIP ROs visible" behavior so
 * an advisor who releases a tag (keys went home) can re-tag the RO in place
 * instead of it vanishing from the board (2026-06-24 board-release-fix).
 *
 * Pure DB read (audit log + keytags) — no Tekmetric. "Still WIP" is approximated
 * by the release-from-assigned signal + the window; the nightly reconcile is the
 * backstop that turns genuinely-stale ones into manual reviews. A/R-status
 * releases (prior_status='posted_ar') are intentionally excluded — terminal.
 */
export async function listReleasedWipNeedingTag(
  sb: SupabaseClient,
  shopId: number,
  windowDays: number = DEFAULT_RELEASED_WIP_WINDOW_DAYS,
): Promise<ReleasedWipNeedingTagResult> {
  const cutoff = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  // 1. Recent releases from WIP, newest first.
  const { data: events, error: evErr } = await sb
    .from("keytag_audit_log")
    .select("ro_id, ro_number, tag_color, tag_number, occurred_at, user_label")
    .eq("action", "released")
    .eq("prior_status", "assigned")
    .gte("occurred_at", cutoff)
    .not("ro_id", "is", null)
    .order("occurred_at", { ascending: false });
  if (evErr) throw new Error(`keytag_audit_log query failed: ${evErr.message}`);

  // 2. ROs that currently hold a tag (re-tagged since, or never released) → exclude.
  const { data: tagged, error: tagErr } = await sb
    .from("keytags")
    .select("ro_number")
    .in("status", ["assigned", "posted_ar"])
    .not("ro_number", "is", null);
  if (tagErr) throw new Error(`keytags query failed: ${tagErr.message}`);
  const taggedRos = new Set((tagged ?? []).map((t) => t.ro_number as number));

  // 3. De-dupe by RO (keep the most recent release), drop ROs that have a tag now.
  const seen = new Set<number>();
  const results: ReleasedWipNeedingTagResult["results"] = [];
  for (const e of events ?? []) {
    const roNumber = e.ro_number as number | null;
    const roId = e.ro_id as number | null;
    if (roNumber === null || roId === null) continue;
    if (seen.has(roNumber)) continue; // an older release for the same RO
    seen.add(roNumber);
    if (taggedRos.has(roNumber)) continue; // already has a tag again
    const color = e.tag_color as "red" | "yellow";
    const number = e.tag_number as number;
    results.push({
      ro_id: roId,
      ro_number: roNumber,
      released_tag: `${color === "red" ? "R" : "Y"}${number}`,
      released_color: color,
      released_number: number,
      released_at: e.occurred_at as string,
      released_by: (e.user_label as string | null) ?? null,
      ro_url: buildTekmetricRoUrl({ roId, shopId }),
    });
  }

  return { ok: true, count: results.length, window_days: windowDays, results };
}
