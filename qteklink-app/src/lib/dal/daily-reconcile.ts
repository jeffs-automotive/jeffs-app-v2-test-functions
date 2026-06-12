/**
 * Daily reconciliation job (C7 §8/§9 + daily-JE rework step 4) — for one business day
 * (shop-local): build every SALE + PAYMENT draft (the shared `buildDayDrafts`), run the
 * §8 gates (`rollupDay`), persist a §9 review item for each non-postable draft, combine
 * the postable drafts into the DAY-CATEGORY JE bundle (up to 3: sales / payments / fees),
 * and enqueue each category into `qteklink_daily_postings` via the desired-vs-posted
 * diff (create / update / delete; pending slots refresh in place). Returns the day's
 * roll-up. The daily-approvals UI + the nightly cron call it. NO QBO write happens here.
 *
 * Also home to two orchestrations that belong with reconcile (cycle-safe — this module
 * already imports daily-postings and owns `runDailyReconciliation`, so the reverse
 * import would cycle): `reconcileDayForView` (the shared live-on-view preamble both read
 * models use) + `acknowledgeDay` (the admin "covered by Accounting Link" flow).
 *
 * Fat-DAL: the build + gates + roll-up + bundle are factored (`buildDayDrafts` + the
 * pure `@/lib/reconcile/*` + `@/lib/daily/*`); this is the thin persist/enqueue seam.
 * MULTI-TENANT: shopId server-derived; realmId from the bound connection. No silent
 * failures: errors throw; an unbalanced or over-cap category raises a `day` review item.
 */
import { resolveRealmForShop } from "@/lib/dal/realm";
import {
  enqueueDailyPosting,
  listDailyPostingsForDay,
  acknowledgeDailyPosting,
  type DailyEnqueueAction,
  type DailyPostingRow,
} from "@/lib/dal/daily-postings";
import { upsertReviewItem } from "@/lib/dal/review-items";
import { rollupDay } from "@/lib/reconcile/daily-rollup";
import { buildDayDrafts } from "@/lib/dal/day-drafts";
import { buildDailyJournalEntries, DAILY_LINE_CAP, type DailyCategory } from "@/lib/daily/daily-je-builder";

/** The day's built drafts + gate roll-up — returned (on request) so a read model can
 *  render from the SAME build the reconcile just persisted, instead of building the
 *  whole day twice per page view (live-page performance, Chris 2026-06-12). */
export type DayBuild = {
  drafts: Awaited<ReturnType<typeof buildDayDrafts>>;
  rollup: ReturnType<typeof rollupDay>;
};

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
  /** Present only when opts.withBuild was set (the live-on-view read models) — NOT
   *  serialized back through the reconcile action (it stays slim). */
  build?: DayBuild;
}

/**
 * Reconcile one shop-local business day. Returns an empty summary (realmId:null) when
 * the shop has no connection. Persists a §9 review item per non-postable draft + enqueues
 * every postable draft (idempotent via the C8a logical-identity conflict).
 */
export async function runDailyReconciliation(
  shopId: number,
  businessDate: string,
  opts: { shopTimezone?: string; tireFeeCentsPerTire?: number; salesTaxRateBps?: number; withBuild?: boolean } = {},
): Promise<DailyReconcileSummary> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) {
    return {
      realmId: null, businessDate, saleCount: 0, paymentCount: 0, postableSales: 0, postablePayments: 0,
      reviewCount: 0, persistedReviewItems: 0, enqueuedPostings: 0,
      dailyEnqueue: { sales: "noop", payments: "noop", fees: "noop" },
    };
  }

  const drafts = await buildDayDrafts(shopId, realmId, businessDate, opts);
  const { sales, payments, extraReviewItems, gateSettings } = drafts;
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
    ...(opts.withBuild ? { build: { drafts, rollup } } : {}),
  };
}

// ─── Live-on-view preamble (shared by the snapshot + breakdown read models) ─────

/**
 * True when every staged row is terminal (acknowledged/rejected) — Accounting
 * Link's history; such a day must never be re-reconciled or grow review items.
 */
export function isDayTerminal(postings: DailyPostingRow[]): boolean {
  return postings.length > 0 && postings.every((p) => p.status === "acknowledged" || p.status === "rejected");
}

/**
 * The live-on-view preamble (Chris 2026-06-12): re-reconcile the viewed day so a
 * webhook that landed a minute ago is already reflected — UNLESS the day is terminal
 * (fully acknowledged/rejected: Accounting Link's history, which must not grow review
 * items). Returns the reconcile's OWN day build so the caller renders from the same
 * drafts instead of building the day a second time; null = no reconcile ran (terminal
 * day — the caller builds for display only). The caller has already resolved the
 * realm. Throws on a DB error (a money view is never knowingly stale).
 */
export async function reconcileDayForView(shopId: number, businessDate: string): Promise<DayBuild | null> {
  const { postings } = await listDailyPostingsForDay(shopId, businessDate);
  if (isDayTerminal(postings)) return null;
  const summary = await runDailyReconciliation(shopId, businessDate, { withBuild: true });
  return summary.build ?? null;
}

// ─── Acknowledge-day orchestration (the admin "covered by Accounting Link" flow) ─

/**
 * Mark a whole business day "approved WITHOUT posting" — the day is already in
 * QuickBooks via Accounting Link, so QTekLink records it done and never posts or
 * corrects it. Reconcile first so the ≤3 category rows exist, refuse if the day has
 * any entry QTekLink already posted/is posting (acknowledging would orphan real QBO
 * entries), then flip every PENDING row to `acknowledged` (terminal).
 *
 * Home note: this orchestration lives HERE (daily-reconcile) rather than in
 * daily-postings to stay cycle-safe — daily-reconcile already imports daily-postings
 * (enqueue) and owns `runDailyReconciliation`; the reverse import (daily-postings →
 * daily-reconcile) would create an import cycle.
 */
export async function acknowledgeDay(
  shopId: number,
  businessDate: string,
  acknowledgedBy: string,
): Promise<{ ok: true; acknowledged: number } | { ok: false; reason: "reconnect_required" | "already_posted" }> {
  // Stage the day's rows (no QBO write), then acknowledge every pending one.
  const recon = await runDailyReconciliation(shopId, businessDate);
  if (!recon.realmId) return { ok: false, reason: "reconnect_required" };

  const { postings } = await listDailyPostingsForDay(shopId, businessDate);
  if (postings.some((p) => p.status === "posted" || p.status === "posting" || p.status === "approved")) {
    return { ok: false, reason: "already_posted" };
  }

  let acknowledged = 0;
  for (const p of postings.filter((p) => p.status === "pending")) {
    const r = await acknowledgeDailyPosting(shopId, p.id, acknowledgedBy);
    if (r.acknowledged) acknowledged++;
  }
  return { ok: true, acknowledged };
}
