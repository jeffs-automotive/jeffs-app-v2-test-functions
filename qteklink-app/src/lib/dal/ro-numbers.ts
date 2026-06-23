/**
 * RO-number cache DAL — resolves a Tekmetric repairOrderId → human repairOrderNumber for the
 * breakdown Payments tab (and the daily JE line descriptions), read-through a small cache
 * (`qteklink_ros`).
 *
 * WHY: fleet / A-R-account CHECK payments ("Payment made by Carmax", Kleen Tech, Flexicon, …)
 * arrive as payment-only webhooks that carry the RO id but NO RO object, and their sale predates
 * our event capture — so `repairOrderNumber` is absent from BOTH event ledgers (qteklink_events
 * ro_* events + the keytag firehose) and the Payments-tab row shows "—". Tekmetric is the only
 * source; this cache holds it.
 *
 * The view/post path reads names from the cache ONLY (`getCachedRoNumbers`), so RO# resolution
 * (and the daily source-state hash) stays DETERMINISTIC — never dependent on live API timing.
 * This module is the seam that POPULATES the cache best-effort from Tekmetric (nightly warm).
 *
 * MULTI-TENANT: shopId is server-derived; `qteklink_ros` is service_role-only (service_role
 * bypasses RLS) and writes go through the SECURITY DEFINER `qteklink_upsert_ros` RPC. No silent
 * failures: a DB error THROWS; a per-RO Tekmetric fetch failure is captured to Sentry and SKIPPED
 * (the id stays uncached → retried next warm) — an RO# lookup must never abort the money build.
 *
 * Mirrors the customer-name cache (`src/lib/dal/customers.ts`, 2026-06-16). The RO number, like
 * the customer name, is a SHOP-level fact (not realm-scoped).
 */
import * as Sentry from "@sentry/nextjs";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getRepairOrderNumberById } from "@/lib/tekmetric/client";

/** Sanitize to a deduped list of safe positive RO ids. */
function cleanIds(ids: number[]): number[] {
  return [...new Set(ids.filter((n) => Number.isSafeInteger(n) && n > 0))];
}

/** repair_order_number per id for the ids already resolvable in the cache. Throws on DB error. */
export async function getCachedRoNumbers(shopId: number, ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const unique = cleanIds(ids);
  if (unique.length === 0) return out;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_ros")
    .select("tekmetric_ro_id, repair_order_number")
    .eq("shop_id", shopId)
    .in("tekmetric_ro_id", unique);
  if (error) throw new Error(`getCachedRoNumbers failed: ${error.message}`);
  for (const r of (data ?? []) as { tekmetric_ro_id: number | string; repair_order_number: string | null }[]) {
    const id = Number(r.tekmetric_ro_id);
    if (Number.isSafeInteger(id) && r.repair_order_number) out.set(id, r.repair_order_number);
  }
  return out;
}

interface UpsertRo {
  tekmetric_ro_id: number;
  repair_order_number: string;
}

/**
 * Resolve numbers for `ids`: read the cache, fetch any MISSING ids from Tekmetric (best-effort,
 * resilient), upsert the newly-resolved ones, and return the full id → number map. A 404 RO (or a
 * response with no number) is SKIPPED (left uncached — there's no honest synthetic RO number);
 * a transient fetch failure is also left uncached (retried next warm). Throws only on a DB error.
 */
export async function resolveRoNumbers(shopId: number, ids: number[]): Promise<Map<number, string>> {
  const unique = cleanIds(ids);
  const numbers = await getCachedRoNumbers(shopId, unique);
  const missing = unique.filter((id) => !numbers.has(id));
  if (missing.length === 0) return numbers;

  const resolved: UpsertRo[] = [];
  for (const id of missing) {
    try {
      const num = await getRepairOrderNumberById(shopId, id); // null on 404 / no number
      if (num) {
        resolved.push({ tekmetric_ro_id: id, repair_order_number: num });
        numbers.set(id, num);
      }
    } catch (e) {
      // Transient (network / 5xx / auth) — NEVER fail the money build; retry next warm.
      Sentry.captureException(e, {
        tags: { qteklink_action: "resolveRoNumbers", shop_id: String(shopId) },
        extra: { repairOrderId: id },
      });
    }
  }

  if (resolved.length > 0) {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.rpc("qteklink_upsert_ros", { p_shop_id: shopId, p_ros: resolved });
    if (error) throw new Error(`qteklink_upsert_ros failed: ${error.message}`);
  }
  return numbers;
}

/**
 * NIGHTLY cache-warming (called by the daily-sync cron). Resolve + cache the RO number for every
 * payment's repair_order_id (the whole payment history for the shop+realm) so the view/JE build
 * reads numbers from the cache only — the view/post path NEVER calls Tekmetric. Only MISSING ids
 * are fetched (near-zero after the first run; the first run backfills the fleet/A-R backlog
 * regardless of how old the underlying sale is, because the PAYMENT — and thus the row — is what
 * needs the number). Resilient (resolveRoNumbers Sentry-captures + skips a per-RO failure). Throws
 * only on a DB error. Mirrors warmCustomerNamesForRecentDays, minus the lookupRoMeta hop
 * (repair_order_id is already on the payment row).
 */
export async function warmRoNumbers(shopId: number, realmId: string): Promise<{ ros: number }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_payment_state")
    .select("repair_order_id")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .not("repair_order_id", "is", null);
  if (error) throw new Error(`warmRoNumbers (payment_state) failed: ${error.message}`);

  const roIds = [...new Set(
    ((data ?? []) as { repair_order_id: number | string }[])
      .map((r) => Number(r.repair_order_id))
      .filter((n) => Number.isSafeInteger(n)),
  )];
  if (roIds.length === 0) return { ros: 0 };

  const numbers = await resolveRoNumbers(shopId, roIds);
  return { ros: numbers.size };
}
