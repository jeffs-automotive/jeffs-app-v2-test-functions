/**
 * Nightly qteklink-sync (C8, plan §10) — the per-shop work the daily-sync cron runs for the
 * PRIOR business day (shop-local):
 *   1. reduceShopPaymentState → refresh the C4 payment-state projection from qteklink_events so
 *      the day's payment + CC-fee drafts see the latest state. ISOLATED (own try/catch): a
 *      corrupt payment event degrades the payment side only, never blocks the SALE reconcile.
 *   2. runDailyReconciliation → enqueue postable drafts (pending) + persist review items.
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
    const reduced = await reduceShopPaymentState(shopId);
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
    sweep: null,
    safetyNet: null,
  };
  if (!recon.realmId) return result; // no connection → reconcile is a no-op; nothing to post

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
