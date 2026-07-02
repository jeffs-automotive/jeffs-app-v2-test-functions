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
import {
  upsertReviewItem,
  listOpenReviewItems,
  autoResolveReviewItems,
  type UpsertReviewItemInput,
} from "@/lib/dal/review-items";
import { rollupDay } from "@/lib/reconcile/daily-rollup";
import { buildDayDrafts, type DayPaymentDraft } from "@/lib/dal/day-drafts";
import { syncPaymentRedates } from "@/lib/dal/payment-redates";
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
  /** Late-payment redate sync (Part A): detections + auto-resolutions this run. */
  paymentRedates: { detected: number; autoResolved: number; held: number };
  /** Review items SYSTEM-closed this run because their condition provably cleared (Part E). */
  autoResolvedReviewItems: number;
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
      paymentRedates: { detected: 0, autoResolved: 0, held: 0 },
      autoResolvedReviewItems: 0,
    };
  }

  const built = await buildDayDrafts(shopId, realmId, businessDate, opts);
  const { sales, extraReviewItems, gateSettings } = built;

  // ── Late-payment redates (Part A, Chris 2026-07-01): detect + auto-resolve for
  // this day, THEN drop just-detected payments from the desired set — the hold must
  // apply from THIS build (a late payment onto a posted day never stages a
  // correction, not even once; the office gets the void+re-date email instead).
  const redateSync = await syncPaymentRedates(shopId, realmId, businessDate, built.payments, built.heldRedatePayments);
  const newlyHeld: DayPaymentDraft[] = [];
  const payments: DayPaymentDraft[] = [];
  for (const p of built.payments) {
    const id = Number(p.input.paymentId);
    const held = p.input.manual !== true && Number.isSafeInteger(id) && redateSync.newlyHeldPaymentIds.has(id);
    (held ? newlyHeld : payments).push(p);
  }
  const drafts = {
    ...built,
    payments,
    heldRedatePayments: [...built.heldRedatePayments, ...newlyHeld],
  };

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
  const dayGuardItems: UpsertReviewItemInput[] = [];
  const dailyEnqueue = { sales: "noop", payments: "noop", fees: "noop" } as Record<DailyCategory, DailyEnqueueAction>;
  for (const category of ["sales", "payments", "fees"] as const) {
    const je = bundle[category];
    // Belt-and-suspenders day-level guards (gate-postable constituents make these
    // unreachable in practice; surfacing them beats silently not enqueueing).
    if (je && !je.balanced) {
      dayGuardItems.push({
        kind: "daily_unbalanced", subjectKind: "day", subjectRef: `${businessDate}:${category}`,
        detail: { totalDebitsCents: je.totalDebitsCents, totalCreditsCents: je.totalCreditsCents },
      });
    } else if (je && je.overLineCap) {
      dayGuardItems.push({
        kind: "daily_line_cap", subjectKind: "day", subjectRef: `${businessDate}:${category}`,
        detail: { lines: je.lines.length, cap: DAILY_LINE_CAP },
      });
    }
    const result = await enqueueDailyPosting(shopId, realmId, businessDate, category, je);
    dailyEnqueue[category] = result.enqueueAction;
    if (result.enqueueAction === "new" || result.enqueueAction === "refreshed") enqueuedPostings++;
  }
  for (const item of dayGuardItems) {
    await upsertReviewItem(shopId, item);
    persisted++;
  }

  // ── Review-item CONVERGENCE (resolution-workflow Part E) ──
  // Close open items whose condition PROVABLY cleared, so the fix-it list never
  // lies (the 2026-06-29 incident: resolved queue + locked day, or the inverse —
  // fixed cause + lingering item). Two proofs:
  //   GATE kinds — re-emitted on every reconcile: an open item for THIS day's
  //   subjects that was NOT re-emitted this run is cleared (the mapping landed,
  //   the RO/payment was fixed in Tekmetric…).
  //   POSTER kinds — day-scoped: cleared when the category's LATEST version is no
  //   longer 'failed' (retried, accepted, or obsoleted as moot).
  // NEVER auto-closed here: redates (their own sync), and anything whose proof the
  // reconcile can't see (safety-net kinds close on the nightly net's own re-check).
  const autoResolvedItems = await convergeReviewItems(
    shopId, realmId, businessDate,
    [...allReviewItems, ...dayGuardItems],
    drafts,
  );

  return {
    autoResolvedReviewItems: autoResolvedItems,
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
    paymentRedates: {
      detected: redateSync.detected,
      autoResolved: redateSync.autoResolved,
      held: drafts.heldRedatePayments.length,
    },
    ...(opts.withBuild ? { build: { drafts, rollup } } : {}),
  };
}

// ─── Review-item convergence (Part E) ───────────────────────────────────────────

/** Gate-emitted kinds — re-emitted deterministically on every reconcile of the day,
 *  so "not re-emitted for a subject we can see" PROVES the condition cleared. */
const GATE_AUTORESOLVE_KINDS = new Set([
  "unmapped", "tax_identity", "tax_high", "negative_component", "unbalanced",
  "payment_corrupt", "snapshot_unparseable", "manual_payment_conflict",
  "daily_unbalanced", "daily_line_cap",
]);

/** Poster-emitted kinds — day-scoped (`${date}:${category}`); cleared when the
 *  category's LATEST version is no longer 'failed' (retried/accepted/obsoleted). */
const POSTER_AUTORESOLVE_KINDS = new Set([
  "qbo_deposit_locked", "qbo_error", "ar_entity_rejected", "reconnect_required",
]);

async function convergeReviewItems(
  shopId: number,
  realmId: string,
  businessDate: string,
  emittedThisRun: UpsertReviewItemInput[],
  drafts: { sales: { snapshot: { repairOrderId: number } }[]; payments: { input: { paymentId: number | string; repairOrderId: number | null } }[]; heldRedatePayments: { input: { paymentId: number | string; repairOrderId: number | null } }[] },
): Promise<number> {
  const { items: openItems } = await listOpenReviewItems(shopId);
  if (openItems.length === 0) return 0;

  const emitted = new Set(emittedThisRun.map((i) => `${i.kind}|${i.subjectKind}|${i.subjectRef}`));
  const dayPrefix = `${businessDate}:`;

  // The subjects THIS day's build can vouch for. An item whose subject we cannot see
  // is never touched (a different day's reconcile owns it).
  const dayRoRefs = new Set<string>();
  const dayPaymentRefs = new Set<string>();
  for (const s of drafts.sales) dayRoRefs.add(String(s.snapshot.repairOrderId));
  for (const p of [...drafts.payments, ...drafts.heldRedatePayments]) {
    dayPaymentRefs.add(String(p.input.paymentId));
    if (p.input.repairOrderId != null) dayRoRefs.add(String(p.input.repairOrderId));
  }

  // Latest status per category (for the poster kinds). listDailyPostingsForDay
  // orders by category then posting_version ASC, so the last row per category in
  // iteration order is the latest version.
  const { postings } = await listDailyPostingsForDay(shopId, businessDate);
  const latestStatusByCategory = new Map<string, string>();
  for (const p of postings) latestStatusByCategory.set(p.category, p.status);

  const toClose = openItems.filter((item) => {
    if (emitted.has(`${item.kind}|${item.subjectKind}|${item.subjectRef}`)) return false;
    if (GATE_AUTORESOLVE_KINDS.has(item.kind)) {
      if (item.subjectKind === "ro") return dayRoRefs.has(item.subjectRef);
      if (item.subjectKind === "payment") return dayPaymentRefs.has(item.subjectRef);
      if (item.subjectKind === "day") return item.subjectRef.startsWith(dayPrefix);
      return false;
    }
    if (POSTER_AUTORESOLVE_KINDS.has(item.kind) && item.subjectKind === "day" && item.subjectRef.startsWith(dayPrefix)) {
      const category = item.subjectRef.slice(dayPrefix.length);
      const latest = latestStatusByCategory.get(category);
      return latest !== undefined && latest !== "failed";
    }
    return false;
  });

  const { resolved } = await autoResolveReviewItems(
    shopId, realmId,
    toClose.map((i) => i.id),
    "system (condition cleared)",
    { auto: true, clearedBy: "reconcile", businessDate },
  );
  return resolved;
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
