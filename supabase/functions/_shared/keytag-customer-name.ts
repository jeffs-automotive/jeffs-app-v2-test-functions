// resolveCustomerName — best-effort Tekmetric customer-name resolution for the
// keytags.customer_name denormalization (captured at assign time).
//
// Reuses the SAME single-customer fetch + display-name coalescing the daily
// report / dashboard already use (customerDisplayName + buildCustomerNameMap in
// keytag-dashboard-data.ts), factored to one id. STRICTLY best-effort: returns
// null on a null id or ANY Tekmetric failure — callers must never let this
// throw or block/fail an assign. The nightly reconcile backfills any null.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { tekmetricGetJson } from "./tekmetric-client.ts";
import {
  customerDisplayName,
  type TekmetricCustomerSubset,
} from "./keytag-dashboard-data.ts";

/**
 * Resolve a single customer's display name from Tekmetric. Returns null when
 * `customerId` is null/undefined or the GET fails for any reason (4xx/5xx/
 * network/timeout) — same swallow semantics as buildCustomerNameMap's catch.
 */
export async function resolveCustomerName(
  sb: SupabaseClient,
  shopId: number,
  customerId: number | null | undefined,
): Promise<string | null> {
  if (customerId === null || customerId === undefined) return null;
  try {
    const cust = await tekmetricGetJson<TekmetricCustomerSubset>(
      sb,
      `/customers/${customerId}`,
      { shop: shopId },
    );
    return cust ? customerDisplayName(cust) : null;
  } catch {
    return null;
  }
}

/**
 * Stamp `customer_name` onto the just-(re)tagged keytag row, keyed on `ro_id`.
 * Mirrors the best-effort stamp in keytag-management.ts (assignKeytagToRo): one
 * Tekmetric `/customers/{id}` GET via resolveCustomerName, then an UPDATE keyed
 * on the unambiguous ro_id. STRICTLY best-effort — resolves to a no-op on a null
 * name or any UPDATE error (logged, never thrown). MUST NOT block or fail the
 * re-tag (a Tekmetric hiccup must not strand a manual-review resolution).
 *
 * Used by the manual-review reassign helpers (force_assign / round-robin /
 * track_tag) so they land on the board with a populated customer_name instead of
 * blank — the one assign surface that historically forked away from this stamp.
 */
export async function stampKeytagCustomerName(
  sb: SupabaseClient,
  shopId: number,
  roId: number,
  customerId: number | null | undefined,
): Promise<void> {
  const name = await resolveCustomerName(sb, shopId, customerId);
  if (name === null) return;
  const { error } = await sb
    .from("keytags")
    .update({ customer_name: name })
    .eq("ro_id", roId);
  if (error) {
    console.error(
      JSON.stringify({
        level: "warning",
        msg: "stamp_keytag_customer_name_failed",
        ro_id: roId,
        detail: error.message,
      }),
    );
  }
}

/**
 * Fill `customer_name` for every in-use keytag that's still missing it but has
 * a `customer_id`. Serves BOTH the one-time backfill of the existing in-use
 * tags AND steady-state self-heal of any assign-time miss (failed Tekmetric
 * fetch, or the manual-review assign sites that didn't carry a customerId).
 * Dedups Tekmetric lookups by customer_id (Carmax appears many times) and paces
 * the GETs. Best-effort: every failure is logged + skipped, never thrown.
 * Intended to run at the end of the nightly keytag-bulk-reconcile.
 */
export async function backfillCustomerNames(
  sb: SupabaseClient,
  shopId: number,
  opts: { delayMs?: number; limit?: number } = {},
): Promise<{ scanned: number; filled: number }> {
  const delayMs = opts.delayMs ?? 125;
  const { data, error } = await sb
    .from("keytags")
    .select("tag_color, tag_number, ro_id, customer_id")
    .in("status", ["assigned", "posted_ar"])
    .is("customer_name", null)
    .not("customer_id", "is", null)
    .limit(opts.limit ?? 300);
  if (error) {
    console.error(
      JSON.stringify({
        level: "warning",
        msg: "backfill_customer_names_query_failed",
        detail: error.message,
      }),
    );
    return { scanned: 0, filled: 0 };
  }

  const rows = (data ?? []) as Array<{ ro_id: number | null; customer_id: number | null }>;
  const nameCache = new Map<number, string | null>();
  let filled = 0;

  for (const r of rows) {
    const cid = r.customer_id;
    if (cid === null || r.ro_id === null) continue;

    let name: string | null;
    if (nameCache.has(cid)) {
      name = nameCache.get(cid) ?? null;
    } else {
      name = await resolveCustomerName(sb, shopId, cid);
      nameCache.set(cid, name);
      if (delayMs > 0) await new Promise((res) => setTimeout(res, delayMs));
    }
    if (name === null) continue;

    // Key on ro_id — if the tag was released between the SELECT and now, its
    // ro_id is NULL so this matches nothing (we never stamp a freed tag).
    const { error: upErr } = await sb
      .from("keytags")
      .update({ customer_name: name })
      .eq("ro_id", r.ro_id);
    if (upErr) {
      console.error(
        JSON.stringify({
          level: "warning",
          msg: "backfill_customer_name_update_failed",
          ro_id: r.ro_id,
          detail: upErr.message,
        }),
      );
      continue;
    }
    filled++;
  }

  return { scanned: rows.length, filled };
}
