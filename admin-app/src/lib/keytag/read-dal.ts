import "server-only";

/**
 * read-dal.ts — direct in-process keytag READ DAL (Phase 1 of the keytag
 * orchestrator-removal plan, docs/keytag/orchestrator-removal-plan.md §10).
 *
 * The dashboard snapshot read no longer hops through the orchestrator-mcp HTTP
 * gateway. Instead we build a service-role Supabase client in-process and call
 * the shared @jeffs/keytag-core read package directly. This removes the gateway
 * round-trip from the /keytags dashboard render + 60s poll path (the B1 latency
 * fix). READS ONLY — no mutation, no audit write, no defense surface; mutations
 * stay byte-for-byte on the gateway (plan §6, §8).
 *
 * `server-only` is load-bearing: createSupabaseAdminClient() resolves the
 * SUPABASE_SECRET_KEY (service-role) which must NEVER reach a client bundle.
 *
 * SHAPE NOTE — why getKeytagDashboardTool and not buildKeytagDashboardData:
 * the orchestrator's `getKeytagDashboard` tool returned the reshaped
 * `KeytagDashboardResult` (counts / stale / ros_without_tags / grid), which is
 * what DashboardTab consumes. The package's `getKeytagDashboardTool` is the
 * verbatim copy of that edge-side transformer — it calls
 * buildKeytagDashboardData internally and reshapes to exactly that result. So
 * calling it preserves the wire shape the gateway produced, byte-for-byte
 * (proven by tests/unit/keytag-core-parity.test.ts).
 */
import {
  getKeytagDashboardTool,
  type KeytagDashboardResult as CoreDashboardResult,
} from "@jeffs/keytag-core";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveAdminShopId } from "@/lib/scheduler/shop-id";
import type { KeytagDashboardResult } from "@/lib/orchestrator/types";

/**
 * The 10s seatbelt, carried over verbatim from the prior orchestrator call
 * (`callKeytagTool("getKeytagDashboard", …, { timeoutMs: 10_000 })`). A pure DB
 * read should finish in well under a second; the timeout is a backstop so a
 * hung connection surfaces the error card rather than wedging the render.
 */
const DASHBOARD_READ_TIMEOUT_MS = 10_000;

/**
 * Build the keytag dashboard snapshot directly from Postgres (no orchestrator
 * hop). Resolves the shop id server-side (never from client input) and reads
 * via the shared read package against a service-role client.
 *
 * @throws on the 10s timeout OR any underlying DB error — DashboardTab's
 *   generic catch renders the error card. We deliberately do NOT swallow to a
 *   blank/empty dashboard (no silent failures — observability.md).
 */
export async function getDashboard(): Promise<KeytagDashboardResult> {
  const sb = createSupabaseAdminClient();
  const shopId = resolveAdminShopId();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new Error("keytag dashboard read timed out after 10s")),
      DASHBOARD_READ_TIMEOUT_MS,
    );
  });

  try {
    // getKeytagDashboardTool throws if the underlying keytags query fails
    // (see buildKeytagDashboardData) — we let that propagate.
    const result: CoreDashboardResult = await Promise.race([
      getKeytagDashboardTool(sb, shopId),
      timeout,
    ]);
    // CoreDashboardResult is structurally identical to the admin-app's
    // KeytagDashboardResult (the package type uses StaleTagDetail/
    // RoWithoutKeytagDetail; the admin type uses the field-identical
    // DashboardStaleTag/DashboardRoWithoutTag). The Phase-0 parity test proves
    // shape-equality; one well-scoped cast bridges the two nominal declarations.
    return result as KeytagDashboardResult;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
