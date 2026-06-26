import "server-only";

/**
 * Cached keytag dashboard snapshot.
 *
 * The snapshot (counts / stale tags with customer names / A-R-without-tags /
 * 180-tag grid) is now a PURE DB read (customer names come from the denormalized
 * `keytags.customer_name`, not a Tekmetric walk — see `keytag-dashboard-data.ts`,
 * fixed 2026-06-25 when that 45s walk turned out to be the board's "spin" root).
 * We still wrap it in `unstable_cache` (60s TTL) to dedupe concurrent renders,
 * and the timeout is now a tight 10s seatbelt instead of 45s.
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
      timeoutMs: 10_000,
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
