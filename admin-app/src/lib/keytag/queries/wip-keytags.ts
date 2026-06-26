// wip-keytags.ts — list every in-use keytag (WIP + A/R) for the Live board.
//
// Ported (Node idiom) from the PURE-DB-read `listWipKeyTags` in
// supabase/functions/_shared/tools/repair-orders.ts. The edge module also
// carries Tekmetric HTTP helpers (getRepairOrderByNumber/ById via
// tekmetric-client.ts) and findRoByKeyTag; those are NOT ported — this direct
// read only needs the keytags-table read + the pure `buildTekmetricRoUrl`.
//
// The ONLY mechanical changes from the edge source are the
// `@supabase/supabase-js` import specifier and the extensionless local import of
// `buildTekmetricRoUrl`. The query (`.from('keytags').select(...).in(...)
// .order().order()`), the `ro_id !== null` filter, and the row shaping are
// IDENTICAL so the direct read matches the orchestrator path byte-for-byte.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTekmetricRoUrl } from "./tekmetric-ro-url";

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
 * Reads from our keytags table (the source of truth post-reconcile) rather than
 * Tekmetric's list endpoint — has color/number, status, last_activity_at,
 * customer_id, vehicle_id all in one query. Returns both WIP and fleet A/R tags,
 * with status distinguishing them.
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
