/**
 * Shared multi-tenant primitive: resolve the QBO realm BOUND to a shop.
 *
 * Every QTekLink DAL (COA, mappings, posting) keys off the realm that is bound
 * to the shop's connection — NEVER a global "most recent connection" lookup
 * (that would let a 2nd shop's realm leak in). Resolved server-side via the
 * SECURITY DEFINER `qbo_resolve_realm_for_shop` RPC (service_role only).
 *
 * Returns null when the shop has no QBO connection. Throws on RPC error
 * (FAIL CLOSED — a resolution failure must never silently fall through).
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function resolveRealmForShop(shopId: number): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qbo_resolve_realm_for_shop", {
    p_shop_id: shopId,
  });
  if (error) {
    throw new Error(`qbo_resolve_realm_for_shop failed: ${error.message}`);
  }
  return typeof data === "string" && data.length > 0 ? data : null;
}
