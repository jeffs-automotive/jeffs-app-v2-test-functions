/**
 * PLAN-03 Phase 1B — extract the calling client's IP from Server Action
 * request headers. Used to key the per-IP OTP rate limit.
 *
 * Vercel's edge sets `x-forwarded-for` to a comma-separated list of IPs
 * (left-most is the original client; intermediates are proxies). We pull
 * the first value and trim it. Falls back to "unknown" so the rate
 * limiter still has a key to bucket on — N requests with `key="unknown"`
 * end up rate-limited together, which is the desired behavior (we'd
 * rather over-limit unknown sources than skip rate limiting).
 *
 * Why a helper (vs inlining): three actions need this, and we want the
 * fallback behavior consistent across them.
 */
import { headers } from "next/headers";

export async function getRequestIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (!xff) return "unknown";
  const first = xff.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "unknown";
}
