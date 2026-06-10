/**
 * Daily reconciliation job (C7 §8/§9 + daily-JE rework step 4) — for one business day
 * (shop-local): build every SALE + PAYMENT draft (the shared `buildDayDrafts`), run the
 * §8 gates (`rollupDay`), persist a §9 review item for each non-postable draft, combine
 * the postable drafts into the DAY-CATEGORY JE bundle (up to 3: sales / payments / fees),
 * and enqueue each category into `qteklink_daily_postings` via the desired-vs-posted
 * diff (create / update / delete; pending slots refresh in place). Returns the day's
 * roll-up. The daily-approvals UI + the nightly cron call it. NO QBO write happens here.
 *
 * Fat-DAL: the build + gates + roll-up + bundle are factored (`buildDayDrafts` + the
 * pure `@/lib/reconcile/*` + `@/lib/daily/*`); this is the thin persist/enqueue seam.
 * MULTI-TENANT: shopId server-derived; realmId from the bound connection. No silent
 * failures: errors throw; an unbalanced or over-cap category raises a `day` review item.
 */
import { resolveRealmForShop } from "@/lib/dal/realm";
import { enqueueDailyPosting, type DailyEnqueueAction } from "@/lib/dal/daily-postings";
import { upsertReviewItem } from "@/lib/dal/review-items";
import { rollupDay } from "@/lib/reconcile/daily-rollup";
import { buildDayDrafts } from "@/lib/dal/day-drafts";
import { buildDailyJournalEntries, DAILY_LINE_CAP, type DailyCategory } from "@/lib/daily/daily-je-builder";

// Re-export for existing importers/tests (it moved into the shared day-drafts module).
export { utcWindowForLocalDay } from "@/lib/dal/day-drafts";

export interface DailyReconcileSummary {
  realmId: string | null;
  businessDate: string;
  saleCount: number;
  paymentCount: number;
  postableSales: number;
  postablePayments: number;
  reviewCount: number;
  /** How many review items were persisted to the §9 queue (the gate items + any
   *  day-level daily_unbalanced / daily_line_cap guards). */
  persistedReviewItems: number;
  /** How many DAY-CATEGORY postings were created or refreshed in qteklink_daily_postings
   *  (≤ 3 — the daily-JE model; was per-RO/payment before the rework). */
  enqueuedPostings: number;
  /** What the diff did per category (audit / the reconcile UI). */
  dailyEnqueue: Record<DailyCategory, DailyEnqueueAction>;
  /** accountId → signed net cents (Dr − Cr) across POSTABLE drafts (QTL vs AL). */
  netByAccount: Record<string, number>;
}

/**
 * Reconcile one shop-local business day. Returns an empty summary (realmId:null) when
 * the shop has no connection. Persists a §9 review item per non-postable draft + enqueues
 * every postable draft (idempotent via the C8a logical-identity conflict).
 */
export async function runDailyReconciliation(
  shopId: number,
  businessDate: string,
  opts: { shopTimezone?: string; tireFeeCentsPerTire?: number; salesTaxRateBps?: number } = {},
): Promise<DailyReconcileSummary> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) {
    return {
      realmId: null, businessDate, saleCount: 0, paymentCount: 0, postableSales: 0, postablePayments: 0,
      reviewCount: 0, persistedReviewItems: 0, enqueuedPostings: 0,
      dailyEnqueue: { sales: "noop", payments: "noop", fees: "noop" }, netByAccount: {},
    };
  }

  const { sales, payments, extraReviewItems, gateSettings } = await buildDayDrafts(shopId, realmId, businessDate, opts);
  const rollup = rollupDay(businessDate, sales, payments.map((p) => p.je), gateSettings);

  // ── persist the §9 review items (the pre-build extras + the gates') ──
  const allReviewItems = [...extraReviewItems, ...rollup.reviewItems];
  let persisted = 0;
  for (const item of allReviewItems) {
    await upsertReviewItem(shopId, item);
    persisted++;
  }

  // ── Combine the postable drafts into the day's category JEs (up to 3) and enqueue
  // each via the desired-vs-posted diff (daily-JE rework: create / update / delete;
  // pending slots refresh in place; manual method-picks are INCLUDED — the JE, not the
  // payment, is the posting subject now). NO QBO write happens here (the daily poster).
  const bundle = buildDailyJournalEntries(businessDate, rollup.postableSaleDrafts, rollup.postablePaymentDrafts);
  let enqueuedPostings = 0;
  const dailyEnqueue = { sales: "noop", payments: "noop", fees: "noop" } as Record<DailyCategory, DailyEnqueueAction>;
  for (const category of ["sales", "payments", "fees"] as const) {
    const je = bundle[category];
    // Belt-and-suspenders day-level guards (gate-postable constituents make these
    // unreachable in practice; surfacing them beats silently not enqueueing).
    if (je && !je.balanced) {
      await upsertReviewItem(shopId, {
        kind: "daily_unbalanced", subjectKind: "day", subjectRef: `${businessDate}:${category}`,
        detail: { totalDebitsCents: je.totalDebitsCents, totalCreditsCents: je.totalCreditsCents },
      });
      persisted++;
    } else if (je && je.overLineCap) {
      await upsertReviewItem(shopId, {
        kind: "daily_line_cap", subjectKind: "day", subjectRef: `${businessDate}:${category}`,
        detail: { lines: je.lines.length, cap: DAILY_LINE_CAP },
      });
      persisted++;
    }
    const result = await enqueueDailyPosting(shopId, realmId, businessDate, category, je);
    dailyEnqueue[category] = result.enqueueAction;
    if (result.enqueueAction === "new" || result.enqueueAction === "refreshed") enqueuedPostings++;
  }

  return {
    realmId,
    businessDate,
    saleCount: rollup.saleCount,
    paymentCount: rollup.paymentCount,
    postableSales: rollup.postableSales,
    postablePayments: rollup.postablePayments,
    reviewCount: allReviewItems.length,
    persistedReviewItems: persisted,
    enqueuedPostings,
    dailyEnqueue,
    netByAccount: rollup.netByAccount,
  };
}
