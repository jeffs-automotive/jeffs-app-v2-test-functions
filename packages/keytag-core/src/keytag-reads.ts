// keytag-reads.ts — HOISTED pure-DB keytag reads.
//
// COPY for the @jeffs/keytag-core read package (Phase 0 build-seam spike,
// 2026-06-26). `listWipKeyTags` + `findRoByKeyTag` are lifted out of the Deno
// `supabase/functions/_shared/tools/repair-orders.ts` (lines 127+) so they can
// be carried into a Node-importable package WITHOUT dragging in the Deno HTTP
// client. The source `repair-orders.ts` statically imports the *runtime value*
// `tekmetricGetJson` from `tekmetric-client.ts` (Deno-only fetch client +
// module-scope token cache); these two functions are PURE `.from().select()`
// reads that never touch Tekmetric, so they import ONLY the pure
// `buildTekmetricRoUrl` (and `TEKMETRIC_RO_STATUS`, kept for parity) from the
// local `./tekmetric.ts` copy.
//
// LEFT ON THE GATEWAY (out of scope — they need the Deno HTTP client):
//   - getRepairOrderByNumber / getRepairOrderById  (call tekmetricGetJson)

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTekmetricRoUrl } from "./tekmetric.ts";

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
 * Pure DB read from the keytags table (the source of truth post-reconcile).
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
 * Pure DB read from the keytags table.
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
    .select("status, ro_id, ro_number, customer_id, vehicle_id, last_activity_at")
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
