import "server-only";

/**
 * Cached keytag dashboard snapshot.
 *
 * The snapshot (counts / stale tags with customer names / A-R-without-tags /
 * 180-tag grid) is now a DIRECT IN-PROCESS DB read (Phase 1 of the keytag
 * orchestrator-removal plan): `getDashboard()` builds a service-role Supabase
 * client and calls the shared `@jeffs/keytag-core` read package in-process —
 * NO orchestrator-mcp HTTP hop, and NO per-advisor Tekmetric pulls (customer
 * names come from the denormalized `keytags.customer_name`, not a Tekmetric
 * walk — see `keytag-dashboard-data.ts`, fixed 2026-06-25 when that 45s walk
 * turned out to be the board's "spin" root). We still wrap it in
 * `unstable_cache` (60s TTL) to dedupe concurrent renders, and the read keeps
 * a tight 10s seatbelt (see `read-dal.ts`).
 *
 * `actorEmail` is no longer used by the read (the direct DB read resolves
 * shop_id server-side and carries no per-actor header). It's kept as the cache
 * key + public-signature arg so no caller changes — dropping it is a separate
 * Phase-3 cleanup. `unstable_cache` folds function arguments into the cache
 * key, so this stays a per-advisor cache (each advisor shares their own 60s
 * snapshot); that's harmless since the data is read-only and shop-global.
 */
import { unstable_cache } from "next/cache";
import { getDashboard } from "@/lib/keytag/read-dal";
import type { KeytagDashboardResult } from "@/lib/orchestrator/types";

export const DASHBOARD_TTL_SECONDS = 60;
export const DASHBOARD_CACHE_TAG = "keytag-dashboard";

const cachedDashboard = unstable_cache(
  // `_actorEmail` is retained as the unstable_cache key arg (see header) so the
  // per-advisor cache + the public getCachedDashboard signature are unchanged.
  // The direct in-process read no longer uses it (`_` prefix per the repo's
  // no-unused-vars argsIgnorePattern); dropping it is a Phase-3 cleanup.
  async (_actorEmail: string): Promise<KeytagDashboardResult> => {
    return await getDashboard();
  },
  ["keytag-dashboard-snapshot"],
  { revalidate: DASHBOARD_TTL_SECONDS, tags: [DASHBOARD_CACHE_TAG] },
);

export function getCachedDashboard(
  actorEmail: string,
): Promise<KeytagDashboardResult> {
  return cachedDashboard(actorEmail);
}
