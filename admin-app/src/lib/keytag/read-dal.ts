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
  listWipKeyTags,
  listManualReviewsTool,
  getKeytagAuditHistory,
  type KeytagDashboardResult as CoreDashboardResult,
  type WipKeyTagsResult as CoreWipKeyTagsResult,
  type ListManualReviewsResult as CoreManualReviewsResult,
  type ListManualReviewsArgs as CoreManualReviewsArgs,
  type GetKeytagAuditHistoryResult as CoreAuditHistoryResult,
} from "@jeffs/keytag-core";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveAdminShopId } from "@/lib/scheduler/shop-id";
import type {
  KeytagDashboardResult,
  WipKeyTagsResult,
  ListManualReviewsResult,
  ListManualReviewsArgs,
  GetKeytagAuditHistoryResult,
  GetKeytagAuditHistoryArgs,
} from "@/lib/orchestrator/types";

/**
 * Shared 10s seatbelt — the same Promise.race backstop getDashboard uses,
 * lifted into a helper so the three Phase-2 board/tab reads carry the EXACT
 * same timeout/throw contract. A pure DB read finishes in well under a second;
 * the timeout exists so a hung connection surfaces the caller's error card
 * rather than wedging the render. NEVER swallow to empty results — the
 * loaders/tabs catch the throw and render the error card (observability.md).
 *
 * @throws the `<label> timed out after 10s` error if `read` doesn't settle
 *   first, OR re-throws whatever DB error `read` rejects with.
 */
async function withReadSeatbelt<T>(
  label: string,
  read: Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after 10s`)),
      DASHBOARD_READ_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([read, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

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

/**
 * List every in-use keytag (WIP `assigned` + A/R `posted_ar`) directly from
 * Postgres — the `tagged` half of the Live board (Phase 2). Mirrors
 * getDashboard: service-role client + server-resolved shop_id + the shared
 * 10s seatbelt. Pure DB read; no Tekmetric, no orchestrator hop.
 *
 * @throws on the 10s timeout OR any underlying DB error (listWipKeyTags throws
 *   on a failed keytags query) — loadBoardState's catch renders the error card.
 *   We never swallow to an empty board (no silent failures — observability.md).
 */
export async function getWipKeyTags(): Promise<WipKeyTagsResult> {
  const sb = createSupabaseAdminClient();
  const shopId = resolveAdminShopId();
  const result: CoreWipKeyTagsResult = await withReadSeatbelt(
    "keytag WIP-keytags read",
    listWipKeyTags(sb, shopId),
  );
  // CoreWipKeyTagsResult is field-identical to the admin-app WipKeyTagsResult
  // (same ok/count/shop_id/results<WipKeyTagEntry> shape); one well-scoped cast
  // bridges the two nominal declarations, matching the getDashboard boundary.
  return result as WipKeyTagsResult;
}

/**
 * List keytag manual reviews directly from Postgres (Phase 2) — the data the
 * board's untagged list + the Manual Reviews tab read. Mirrors getDashboard:
 * service-role client + the shared 10s seatbelt. Pure DB read; the shop is
 * single-tenant so the package's review query is shop-global (matches the
 * orchestrator tool it replaces).
 *
 * @throws on the 10s timeout OR any underlying DB error — callers render their
 *   error card. We never swallow to empty results (observability.md).
 */
export async function getManualReviews(
  args: ListManualReviewsArgs,
): Promise<ListManualReviewsResult> {
  const sb = createSupabaseAdminClient();
  // The admin-app ListManualReviewsArgs is structurally the package's
  // CoreManualReviewsArgs ({ only_open?, search?, limit? }).
  const result: CoreManualReviewsResult = await withReadSeatbelt(
    "keytag manual-reviews read",
    listManualReviewsTool(sb, args as CoreManualReviewsArgs),
  );
  // The package's ManualReviewCategory is a subset of the admin-app union
  // (admin adds the forward-compat `appointment_verification_mismatch`), so the
  // result widens cleanly; one boundary cast bridges the nominal declarations,
  // matching the getDashboard pattern.
  return result as ListManualReviewsResult;
}

/**
 * Read the keytag audit log directly from Postgres (Phase 2) — the Audit
 * History tab's data. Mirrors getDashboard: service-role client + the shared
 * 10s seatbelt. Pure DB read; no orchestrator hop.
 *
 * @throws on the 10s timeout OR any underlying DB error — the tab renders its
 *   error card. We never swallow to empty results (observability.md).
 */
export async function getAuditHistory(
  args: GetKeytagAuditHistoryArgs,
): Promise<GetKeytagAuditHistoryResult> {
  const sb = createSupabaseAdminClient();
  // The admin-app GetKeytagAuditHistoryArgs (action/source as unions) is
  // structurally assignable to the package's looser arg type (string fields).
  const result: CoreAuditHistoryResult = await withReadSeatbelt(
    "keytag audit-history read",
    getKeytagAuditHistory(sb, args),
  );
  // Field-identical results except the package types `filters` concretely while
  // the admin-app type is `Record<string, unknown>`; one boundary cast bridges
  // the two, matching the getDashboard pattern.
  return result as GetKeytagAuditHistoryResult;
}
