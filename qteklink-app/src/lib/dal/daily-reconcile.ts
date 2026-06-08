/**
 * Daily reconciliation job (C7 §8/§9) — for one business day (shop-local): build every
 * SALE + PAYMENT draft (the shared `buildDayDrafts`), run the §8 gates (`rollupDay`),
 * persist a §9 review item for each non-postable draft, and enqueue every postable draft
 * into `qteklink_postings`. Returns the day's roll-up (the QTL side of QTL-vs-AccountingLink).
 * The daily-approvals UI + a future cron call it. NO QBO write happens here (the poster does).
 *
 * Fat-DAL: the build + gates + roll-up are factored (`buildDayDrafts` + the pure
 * `@/lib/reconcile/*`); this is the thin persist/enqueue seam. MULTI-TENANT: shopId
 * server-derived; realmId from the bound connection. No silent failures: errors throw.
 */
import { resolveRealmForShop } from "@/lib/dal/realm";
import { enqueuePostingForDraft } from "@/lib/dal/postings";
import { upsertReviewItem } from "@/lib/dal/review-items";
import { rollupDay } from "@/lib/reconcile/daily-rollup";
import { buildDayDrafts } from "@/lib/dal/day-drafts";

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
  /** How many review items were persisted to the §9 queue (== reviewCount). */
  persistedReviewItems: number;
  /** How many postable drafts were enqueued into qteklink_postings (sales + real payments). */
  enqueuedPostings: number;
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
    return { realmId: null, businessDate, saleCount: 0, paymentCount: 0, postableSales: 0, postablePayments: 0, reviewCount: 0, persistedReviewItems: 0, enqueuedPostings: 0, netByAccount: {} };
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

  // ── Enqueue postable drafts into qteklink_postings (the pipeline's "enqueue" step;
  // idempotent via the C8a logical-identity conflict + the desired-vs-posted diff). The
  // poster (C8c) later approves + posts them. NO QBO write happens here.
  let enqueuedPostings = 0;
  for (const draft of rollup.postableSaleDrafts) {
    const content = { lines: draft.je.lines, docNumber: draft.je.docNumber, txnDate: draft.je.txnDate };
    await enqueuePostingForDraft(shopId, realmId, {
      kind: "sale", tekmetricRoId: draft.snapshot.repairOrderId, paymentId: null,
      batchDate: businessDate, txnDate: draft.je.txnDate, je: content, sourceState: content,
    });
    enqueuedPostings++;
  }
  for (const pje of rollup.postablePaymentDrafts) {
    const numericPaymentId = Number(pje.paymentId);
    // A manual pick (UUID payment id) or a payment with no RO can't form a posting
    // identity (qteklink_postings.payment_id is BIGINT) — DEFERRED (a documented follow-up).
    if (pje.repairOrderId == null || !Number.isSafeInteger(numericPaymentId)) continue;
    const content = { lines: pje.lines, docNumber: pje.docNumber, txnDate: pje.txnDate };
    await enqueuePostingForDraft(shopId, realmId, {
      kind: "payment", tekmetricRoId: pje.repairOrderId, paymentId: numericPaymentId,
      batchDate: businessDate, txnDate: pje.txnDate, je: content, sourceState: content,
    });
    enqueuedPostings++;
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
    netByAccount: rollup.netByAccount,
  };
}
