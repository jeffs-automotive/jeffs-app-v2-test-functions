/**
 * Nightly qteklink-sync (C8, plan §10) — the per-shop work the daily-sync cron runs for the
 * PRIOR business day (shop-local):
 *   1. reduceShopPaymentState → refresh the C4 payment-state projection from qteklink_events so
 *      the day's payment + CC-fee drafts see the latest state. ISOLATED (own try/catch): a
 *      corrupt payment event degrades the payment side only, never blocks the SALE reconcile.
 *   2. runDailyReconciliation → enqueue postable drafts (pending) + persist review items.
 *   2b. runMirrorIngest (incremental) → keep the payroll tekmetric_ros* mirror fresh.
 *      Tekmetric-side only (runs even without a QBO connection). ISOLATED (own try/catch):
 *      a Tekmetric/mirror problem leaves payroll data one night stale, never blocks posting.
 *   3. AUTO-POST (only when the shop's `auto_post` setting is ON — default off): reuse the
 *      dashboard's planApproveDay → executeApproveDay to approve + LIVE-post the day's clean
 *      drafts. Default-off means nothing posts to QBO unattended unless the shop opts in.
 *   4. sweepPostedDays — re-check every ALREADY-POSTED day: detect RO date moves (→ the
 *      posting queue + office-manager/advisor emails), auto-post corrections for changed
 *      posted days (→ office-manager email per change). ISOLATED (own try/catch).
 *   5. the Tekmetric + QBO 2-API completeness safety-net.
 *
 * Reuses already-reviewed primitives; this is the thin nightly orchestration. MULTI-TENANT:
 * each shop's realm is resolved server-side inside the reused DALs. No silent failures.
 */
import * as Sentry from "@sentry/nextjs";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runDailyReconciliation } from "@/lib/dal/daily-reconcile";
import { reduceShopPaymentState } from "@/lib/dal/payment-state";
import { getShopSettings } from "@/lib/dal/settings";
import { planApproveDay, executeApproveDay } from "@/lib/dal/approve-post-day";
import { runSafetyNet, type SafetyNetResult } from "@/lib/dal/safety-net";
import { sweepPostedDays, type SweepResult } from "@/lib/dal/posted-day-sweep";
import { warmCustomerNamesForRecentDays } from "@/lib/dal/customers";
import { runMirrorIngest } from "@/lib/payroll/mirror-ingest";
import { warmRoNumbers } from "@/lib/dal/ro-numbers";
import type { QboDailyWriteClient } from "@/lib/dal/daily-poster";
import { toShopLocalDate } from "@/lib/sales/sale-builder";
import { addDaysIso } from "@/lib/format";

export interface NightlyShopResult {
  shopId: number;
  businessDate: string;
  connected: boolean;
  enqueued: number;
  reviewItems: number;
  autoPostEnabled: boolean;
  autoPosted: number;
  autoPostFailed: number;
  /** The C4 payment-state projection refresh (events read / payments upserted), or null if it
   *  errored — isolated so a corrupt payment event can't block the SALE reconcile. */
  paymentStateReduced: { events: number; payments: number } | null;
  /** The payroll Tekmetric RO-mirror incremental ingest (alerts = count; full alert rows are
   *  persisted to tekmetric_ro_ingest_alerts), or null when it errored — isolated (payroll
   *  data goes one night stale; the QBO money path is never blocked). */
  mirrorIngest: { rosUpserted: number; pagesFetched: number; alerts: number; watermark: string | null } | null;
  /** Tekmetric customer names resolved into the cache for the JE-line descriptions (recent
   *  window), or null if it errored — isolated (a name lookup never blocks posting). */
  customersWarmed: number | null;
  /** Tekmetric RO numbers resolved into the qteklink_ros cache so fleet/A-R check payments
   *  resolve their RO# on the Payments tab, or null if it errored — isolated (never blocks
   *  posting; the row just shows "—" until the next warm). */
  roNumbersWarmed: number | null;
  /** The posted-day correction sweep (date moves + auto-posted corrections), or null
   *  when it errored — isolated (see Sentry). */
  sweep: SweepResult | null;
  /** The 2-API completeness net result (null when it errored — see Sentry). */
  safetyNet: SafetyNetResult | null;
}

/** Shops with a NON-EXPIRED QBO connection (a soft-disconnect expires the row). */
export async function listConnectedShops(): Promise<number[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qbo_connections")
    .select("shop_id")
    .gt("refresh_token_expires_at", new Date().toISOString());
  if (error) throw new Error(`listConnectedShops failed: ${error.message}`);
  return [...new Set(((data ?? []) as { shop_id: number }[]).map((r) => Number(r.shop_id)))];
}

/**
 * Run the nightly sync for ONE shop. `businessDate` defaults to the shop-local PRIOR day
 * (computed from the shop's tz). `deps.client` injects a QBO client for tests (defaults to
 * the real client at post time). Throws (FAIL CLOSED) on a DB error in the reconcile/post path.
 */
export async function runNightlySync(
  shopId: number,
  opts: { businessDate?: string; client?: QboDailyWriteClient } = {},
): Promise<NightlyShopResult> {
  const { settings } = await getShopSettings(shopId);
  const businessDate =
    opts.businessDate ?? addDaysIso(toShopLocalDate(new Date().toISOString(), settings.shopTimezone), -1);

  // 1. Refresh the C4 payment-state projection from qteklink_events BEFORE reconciling, so the
  // day's payment + CC-fee drafts read the latest state (payments come from qteklink_payment_state,
  // not the event ledger directly). reduceShopPaymentState FAILS CLOSED (throws on a corrupt
  // payment_id / unsafe RO id / DB error / pagination cap); ISOLATE it in its OWN try/catch so a
  // single bad payment event degrades ONLY the payment side and can never block the SALE reconcile
  // (which reads qteklink_events directly). Per-shop isolation also exists in the cron's outer loop;
  // this inner guard keeps the sale side alive WITHIN the shop.
  let paymentStateReduced: { events: number; payments: number } | null = null;
  try {
    // FULL reduce — the nightly is the verification net behind the incremental
    // page-view reduces (it recomputes every payment and re-anchors the watermark).
    const reduced = await reduceShopPaymentState(shopId, { full: true });
    paymentStateReduced = { events: reduced.events, payments: reduced.payments };
  } catch (e) {
    Sentry.captureException(e, { tags: { qteklink_cron: "payment-state-reduce", shop_id: String(shopId) } });
  }

  // 2. reconcile (enqueue pending + persist review items). NO QBO write.
  const recon = await runDailyReconciliation(shopId, businessDate);
  const result: NightlyShopResult = {
    shopId,
    businessDate,
    connected: recon.realmId != null,
    enqueued: recon.enqueuedPostings,
    reviewItems: recon.reviewCount,
    autoPostEnabled: settings.autoPost,
    autoPosted: 0,
    autoPostFailed: 0,
    paymentStateReduced,
    mirrorIngest: null,
    customersWarmed: null,
    roNumbersWarmed: null,
    sweep: null,
    safetyNet: null,
  };

  // 2b. Payroll Tekmetric RO-mirror ingest (incremental, watermark-derived — the port of
  // scheduler-app/scripts/tekmetric/sync-ros.mjs) keeps tekmetric_ros* fresh for the payroll
  // derivations. Tekmetric-side only (no QBO), so it runs BEFORE the no-connection early
  // return. NON-FATAL: a Tekmetric/API/mirror problem must never block the reconcile /
  // auto-post money path — capture + continue (the payroll run UI shows mirror freshness).
  try {
    const ingest = await runMirrorIngest({ shopId }, { mode: "incremental" });
    result.mirrorIngest = {
      rosUpserted: ingest.rosUpserted,
      pagesFetched: ingest.pagesFetched,
      alerts: ingest.alerts.length,
      watermark: ingest.watermark,
    };
  } catch (e) {
    Sentry.captureException(e, { tags: { qteklink_cron: "payroll-mirror-ingest", shop_id: String(shopId) } });
  }

  if (!recon.realmId) return result; // no connection → reconcile is a no-op; nothing to post

  // 2c. Warm the Tekmetric customer-name cache for a recent window so the JE-line build
  // (getCachedCustomerNames) reads names from the cache — the view/post path NEVER calls
  // Tekmetric (posting is always >= 1 day out, so the nightly cron warms first). Runs BEFORE
  // the auto-post + sweep so those see the names. ISOLATED: a name-fetch problem must not
  // discard the reconcile/auto-post result (the description just omits the customer until the
  // next warm).
  try {
    result.customersWarmed = (await warmCustomerNamesForRecentDays(shopId, recon.realmId)).customers;
  } catch (e) {
    Sentry.captureException(e, { tags: { qteklink_cron: "warm-customer-names", shop_id: String(shopId) } });
  }

  // 2d. Warm the Tekmetric RO-number cache (qteklink_ros) so fleet/A-R check payments — whose
  // "Payment made by X" webhook carries no RO object and whose sale predates our event capture —
  // resolve their RO# on the Payments tab instead of showing "—". CACHE-ONLY on the view/post
  // path; this nightly fetch is the ONLY Tekmetric call. ISOLATED: a fetch problem never blocks
  // the reconcile/auto-post (the row just shows "—" until the next warm).
  try {
    result.roNumbersWarmed = (await warmRoNumbers(shopId, recon.realmId)).ros;
  } catch (e) {
    Sentry.captureException(e, { tags: { qteklink_cron: "warm-ro-numbers", shop_id: String(shopId) } });
  }

  // 3. AUTO-POST only when the shop opted in. Reuses the SAME guarded path as the dashboard
  // (plan → execute, hash-bound), so the cron can't post a different set than it computed.
  if (settings.autoPost) {
    const plan = await planApproveDay(shopId, businessDate, "day");
    if (plan.realmId && plan.summary.jeCount > 0) {
      const res = await executeApproveDay(shopId, businessDate, "day", plan.scopeHash, "cron@qteklink", {}, { client: opts.client });
      result.autoPosted = res.posted;
      result.autoPostFailed = res.failed;
    }
  }

  // 4. Posted-day correction sweep: date-move detection (→ posting queue + emails) and
  // auto-posted corrections for changed posted days (→ office-manager email per change).
  // NON-FATAL: a sweep error must not discard the reconcile result — capture + continue.
  try {
    result.sweep = await sweepPostedDays(shopId, { client: opts.client });
  } catch (e) {
    Sentry.captureException(e, { tags: { qteklink_cron: "posted-day-sweep", shop_id: String(shopId) } });
  }

  // 5. the Tekmetric + QBO 2-API completeness safety-net. NON-FATAL: a transient external-API
  // error must not discard the reconcile / auto-post result above — capture + continue.
  try {
    result.safetyNet = await runSafetyNet(shopId, recon.realmId, businessDate, settings.shopTimezone);
  } catch (e) {
    Sentry.captureException(e, { tags: { qteklink_cron: "safety-net", shop_id: String(shopId) } });
  }

  return result;
}
