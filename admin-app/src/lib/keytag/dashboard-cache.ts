import "server-only";

/**
 * Cached keytag dashboard snapshot.
 *
 * The snapshot (counts / stale tags with customer names / A-R-without-tags /
 * 180-tag grid) is expensive to build — the customer-name resolution inside it
 * hits Tekmetric serially. So we wrap the `getKeytagDashboard` call in
 * `unstable_cache` with a 60s TTL: a viewer reloading the page or the 60s
 * `router.refresh()` poll reads the cached snapshot instead of re-pulling
 * everything each time.
 *
 * `actorEmail` is passed for the orchestrator's X-Actor-Email auth/audit
 * header. Note `unstable_cache` folds function arguments into the cache key, so
 * this is effectively a per-advisor cache (each advisor shares their own 60s
 * snapshot). That's fine — the data is read-only and shop-global, and the few
 * advisors on at once means at most a handful of Tekmetric pulls per minute.
 */
import { unstable_cache } from "next/cache";
import { callKeytagTool } from "@/lib/orchestrator/client";
import type { KeytagDashboardResult } from "@/lib/orchestrator/types";

export const DASHBOARD_TTL_SECONDS = 60;
export const DASHBOARD_CACHE_TAG = "keytag-dashboard";

const cachedDashboard = unstable_cache(
  async (actorEmail: string): Promise<KeytagDashboardResult> => {
    return await callKeytagTool("getKeytagDashboard", {}, actorEmail, {
      timeoutMs: 45_000,
    });
  },
  ["keytag-dashboard-snapshot"],
  { revalidate: DASHBOARD_TTL_SECONDS, tags: [DASHBOARD_CACHE_TAG] },
);

export function getCachedDashboard(
  actorEmail: string,
): Promise<KeytagDashboardResult> {
  return cachedDashboard(actorEmail);
}
