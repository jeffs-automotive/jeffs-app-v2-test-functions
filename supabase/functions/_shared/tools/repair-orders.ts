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
      "tag_color, tag_number, status, ro_id, ro_number, customer_id, vehicle_id, last_activity_at",
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
