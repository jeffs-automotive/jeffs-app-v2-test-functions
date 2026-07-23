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
 * The snapshot now reads DIRECTLY in-process via the keytag read-DAL
 * (`getDashboard()` → service-role client + server-resolved shop_id), dropping
 * the orchestrator HTTP hop. The data is read-only + shop-global, so the
 * cache key carries no per-advisor identity — one shared 60s snapshot across all
 * advisors (shop_id is resolved server-side inside getDashboard()).
 */
import { unstable_cache } from "next/cache";
import { getDashboard } from "@/lib/keytag/read-dal";
import type { KeytagDashboardResult } from "@/lib/orchestrator/types";

export const DASHBOARD_TTL_SECONDS = 60;
export const DASHBOARD_CACHE_TAG = "keytag-dashboard";

const cachedDashboard = unstable_cache(
  // Shop-global snapshot — getDashboard() resolves shop_id server-side and its
  // own 10s seatbelt replaces the old per-call timeoutMs.
  async (): Promise<KeytagDashboardResult> => {
    return await getDashboard();
  },
  ["keytag-dashboard-snapshot"],
  { revalidate: DASHBOARD_TTL_SECONDS, tags: [DASHBOARD_CACHE_TAG] },
);

export function getCachedDashboard(): Promise<KeytagDashboardResult> {
  return cachedDashboard();
}
