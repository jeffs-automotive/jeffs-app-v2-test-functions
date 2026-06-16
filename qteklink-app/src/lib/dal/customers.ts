/**
 * Customer-name cache DAL — resolves a Tekmetric customerId → display name for the daily
 * JE line descriptions, read-through a small cache (`qteklink_customers`).
 *
 * The JE BUILD reads names from the cache only, so the line description (and thus the daily
 * source-state hash) is DETERMINISTIC — it never depends on live API timing. This module is
 * the seam that POPULATES the cache best-effort from Tekmetric.
 *
 * MULTI-TENANT: shopId is server-derived; `qteklink_customers` is service_role-only
 * (service_role bypasses RLS) and writes go through the SECURITY DEFINER
 * `qteklink_upsert_customers` RPC. No silent failures: a DB error THROWS; a per-customer
 * Tekmetric fetch failure is captured to Sentry and SKIPPED (the id stays uncached → retried
 * on the next build) — a name lookup must never abort the money build.
 */
import * as Sentry from "@sentry/nextjs";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCustomerById, customerDisplayName } from "@/lib/tekmetric/client";

/** Sanitize to a deduped list of safe positive customer ids. */
function cleanIds(ids: number[]): number[] {
  return [...new Set(ids.filter((n) => Number.isSafeInteger(n) && n > 0))];
}

/** display_name per id for the ids already resolvable in the cache. Throws on DB error. */
export async function getCachedCustomerNames(shopId: number, ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const unique = cleanIds(ids);
  if (unique.length === 0) return out;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_customers")
    .select("tekmetric_customer_id, display_name")
    .eq("shop_id", shopId)
    .in("tekmetric_customer_id", unique);
  if (error) throw new Error(`getCachedCustomerNames failed: ${error.message}`);
  for (const r of (data ?? []) as { tekmetric_customer_id: number | string; display_name: string | null }[]) {
    const id = Number(r.tekmetric_customer_id);
    if (Number.isSafeInteger(id) && r.display_name) out.set(id, r.display_name);
  }
  return out;
}

interface UpsertCustomer {
  tekmetric_customer_id: number;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
}

/**
 * Resolve names for `ids`: read the cache, fetch any MISSING ids from Tekmetric
 * (best-effort, resilient), upsert the newly-resolved ones, and return the full id → name
 * map. A 404 customer caches as `Customer #<id>` (stable); a transient fetch failure leaves
 * the id uncached (retried next build). Throws only on a DB error.
 */
export async function resolveCustomerNames(shopId: number, ids: number[]): Promise<Map<number, string>> {
  const unique = cleanIds(ids);
  const names = await getCachedCustomerNames(shopId, unique);
  const missing = unique.filter((id) => !names.has(id));
  if (missing.length === 0) return names;

  const resolved: UpsertCustomer[] = [];
  for (const id of missing) {
    try {
      const c = await getCustomerById(shopId, id); // null on 404
      const name = customerDisplayName(c, id); // "Customer #id" fallback
      resolved.push({ tekmetric_customer_id: id, display_name: name, first_name: c?.firstName ?? null, last_name: c?.lastName ?? null });
      names.set(id, name);
    } catch (e) {
      // Transient (network / 5xx / auth) — NEVER fail the money build; retry next build.
      Sentry.captureException(e, {
        tags: { qteklink_action: "resolveCustomerNames", shop_id: String(shopId) },
        extra: { customerId: id },
      });
    }
  }

  if (resolved.length > 0) {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.rpc("qteklink_upsert_customers", { p_shop_id: shopId, p_customers: resolved });
    if (error) throw new Error(`qteklink_upsert_customers failed: ${error.message}`);
  }
  return names;
}
