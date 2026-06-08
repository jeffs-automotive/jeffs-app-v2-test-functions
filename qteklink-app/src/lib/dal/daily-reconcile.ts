/**
 * Daily reconciliation job (C7 §8/§9) — the orchestration that, for one business day
 * (shop-local), builds every SALE + PAYMENT draft, runs the §8 gates, persists a §9
 * review item for each non-postable draft, and returns the day's roll-up (the QTL side
 * of the QTL-vs-AccountingLink comparison). The daily-approvals UI + a future cron call it.
 *
 * Fat-DAL: the gates + roll-up are PURE (`@/lib/reconcile/*`); this is the thin DB seam
 * — fetch the day's drafts, call the pure roll-up, persist. MULTI-TENANT: shopId
 * server-derived; realmId from the bound connection; every query scopes shop_id+realm_id.
 * No silent failures: every DB error throws.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { RO_POSTING_EVENT_KINDS } from "@/lib/events/kinds";
import { parseSnapshot, resolveMappings, type MappingRow } from "@/lib/dal/sale-je";
import { resolvePaymentMappings, stateRowToPayment, type PaymentStateRow } from "@/lib/dal/payment-je";
import { listManualPayments } from "@/lib/dal/manual-payments";
import { getShopSettings } from "@/lib/dal/settings";
import { enqueuePostingForDraft } from "@/lib/dal/postings";
import { upsertReviewItem, type UpsertReviewItemInput } from "@/lib/dal/review-items";
import { buildSaleJournalEntry, toShopLocalDate, type SaleSettings } from "@/lib/sales/sale-builder";
import {
  buildPaymentJournalEntry, type PaymentForBuild, type PaymentJournalEntry, type PaymentSettings,
} from "@/lib/payments/payment-je-builder";
import { rollupDay, type SaleDraft } from "@/lib/reconcile/daily-rollup";
import type { SaleGateSettings } from "@/lib/reconcile/sale-gate";

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
 * A GENEROUS UTC window [businessDate−1 00:00Z, businessDate+2 00:00Z) that is
 * guaranteed to contain every event whose shop-local posted date is `businessDate`
 * (any tz offset is < 24h, even across DST). The exact local-date match is done in JS.
 * Pure + deterministic (no `Date.now()`).
 */
export function utcWindowForLocalDay(businessDate: string): { startIso: string; endIso: string } {
  const midnightUtcMs = Date.parse(`${businessDate}T00:00:00Z`);
  const DAY = 24 * 60 * 60 * 1000;
  return {
    startIso: new Date(midnightUtcMs - DAY).toISOString(),
    endIso: new Date(midnightUtcMs + 2 * DAY).toISOString(),
  };
}

/**
 * Reconcile one shop-local business day. Returns an empty summary (realmId:null) when
 * the shop has no connection. Persists a §9 review item per non-postable draft.
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

  const admin = createSupabaseAdminClient();
  // Read the shop's configured settings (tz / tax rate / tire fee); opts still override
  // for tests / one-offs. Replaces the old hardcoded DEFAULT_* (qteklink_settings, C8b).
  const { settings: shopSettings } = await getShopSettings(shopId);
  const tz = opts.shopTimezone ?? shopSettings.shopTimezone;
  const saleSettings: SaleSettings = {
    shopTimezone: tz,
    tireFeeCentsPerTire: opts.tireFeeCentsPerTire ?? shopSettings.tireFeeCents,
    salesTaxRateBps: opts.salesTaxRateBps ?? shopSettings.salesTaxRateBps,
  };
  const gateSettings: SaleGateSettings = { salesTaxRateBps: saleSettings.salesTaxRateBps };
  const paymentSettings: PaymentSettings = { shopTimezone: tz };

  // ── mappings ONCE (resolved both for the sale builder and the payment builder) ──
  const { data: mapRows, error: mapErr } = await admin
    .from("qteklink_mappings")
    .select("kind, source_key, qbo_account_id, posting_role, pass_through")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("active", true)
    .order("effective_from", { ascending: true });
  if (mapErr) throw new Error(`runDailyReconciliation (mappings) failed: ${mapErr.message}`);
  const rows = (mapRows ?? []) as MappingRow[];
  const saleMappings = resolveMappings(rows);
  const paymentMappings = resolvePaymentMappings(rows);

  // ── SALES: posting events in the generous UTC window → latest-per-RO → exact local date ──
  const { startIso, endIso } = utcWindowForLocalDay(businessDate);
  const { data: evRows, error: evErr } = await admin
    .from("qteklink_events")
    .select("tekmetric_ro_id, raw_body, received_at")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .in("event_kind", [...RO_POSTING_EVENT_KINDS])
    .gte("tekmetric_event_at", startIso)
    .lt("tekmetric_event_at", endIso)
    // Latest by business posted-time, tie-break received_at (matches buildShopRoSaleJe) —
    // a delayed re-delivery of an OLDER posting must not become the "latest" snapshot.
    .order("tekmetric_event_at", { ascending: false, nullsFirst: false })
    .order("received_at", { ascending: false });
  if (evErr) throw new Error(`runDailyReconciliation (events) failed: ${evErr.message}`);

  const extraReviewItems: UpsertReviewItemInput[] = [];
  const latestByRo = new Map<string, unknown>(); // ro_id → newest raw_body.data
  for (const r of (evRows ?? []) as { tekmetric_ro_id: number | string | null; raw_body: { data?: unknown } | null }[]) {
    const roKey = String(r.tekmetric_ro_id ?? "");
    if (!roKey || latestByRo.has(roKey)) continue; // ordered desc → first seen is newest
    latestByRo.set(roKey, r.raw_body?.data ?? null);
  }
  const sales: SaleDraft[] = [];
  for (const [roKey, data] of latestByRo.entries()) {
    const snapshot = parseSnapshot(data);
    if (!snapshot) {
      // A corrupt/incomplete posting snapshot could be a real sale we can't parse — NEVER
      // silently drop it (observability). Surface it for review (deduped by the §9 key).
      extraReviewItems.push({ kind: "snapshot_unparseable", subjectKind: "ro", subjectRef: roKey, detail: {} });
      continue;
    }
    if (toShopLocalDate(snapshot.postedDate, tz) !== businessDate) continue;
    sales.push({ snapshot, je: buildSaleJournalEntry(snapshot, saleMappings, saleSettings) });
  }

  // ── PAYMENTS: real (payment_state) + manual picks, both for this local day ──
  const payments: PaymentJournalEntry[] = [];

  const { data: psRows, error: psErr } = await admin
    .from("qteklink_payment_state")
    .select("payment_id, signed_amount_cents, signed_processing_fee_cents, status, is_refund, payment_type, other_payment_type, payment_date, repair_order_id")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    // Window by the same generous UTC range as the events (perf: don't scan the whole
    // projection); the exact local-day match is the JS filter below.
    .gte("payment_date", startIso)
    .lt("payment_date", endIso);
  if (psErr) throw new Error(`runDailyReconciliation (payment_state) failed: ${psErr.message}`);
  for (const row of (psRows ?? []) as PaymentStateRow[]) {
    if (!row.payment_date || toShopLocalDate(row.payment_date, tz) !== businessDate) continue;
    payments.push(buildPaymentJournalEntry(stateRowToPayment(row), paymentMappings, paymentSettings));
  }

  // Manual method-picks for the day.
  const { manualPayments } = await listManualPayments(shopId);
  const dayManual = manualPayments.filter((mp) => toShopLocalDate(mp.paymentDate, tz) === businessDate);

  // ANTI-JOIN (reconciliation-time, authoritative): a manual pick whose RO now has a REAL
  // (non-voided) payment must NOT also post — it would double-post. The record-time
  // anti-join can't see a real payment PROJECTED AFTER the pick; this is the real guard.
  const manualRoIds = [...new Set(dayManual.map((mp) => mp.repairOrderId))];
  const conflictRoIds = new Set<number>();
  if (manualRoIds.length > 0) {
    const { data: confRows, error: confErr } = await admin
      .from("qteklink_payment_state")
      .select("repair_order_id")
      .eq("shop_id", shopId)
      .eq("realm_id", realmId)
      .in("repair_order_id", manualRoIds)
      .is("voided_at", null);
    if (confErr) throw new Error(`runDailyReconciliation (manual anti-join) failed: ${confErr.message}`);
    for (const r of (confRows ?? []) as { repair_order_id: number | string }[]) {
      conflictRoIds.add(Number(r.repair_order_id));
    }
  }

  for (const mp of dayManual) {
    if (conflictRoIds.has(mp.repairOrderId)) {
      // A real payment exists for this RO → suppress the manual pick, surface the conflict.
      extraReviewItems.push({
        kind: "manual_payment_conflict",
        subjectKind: "ro",
        subjectRef: String(mp.repairOrderId),
        detail: { manualPaymentId: mp.id, reason: "a real payment exists for this RO; the manual pick is suppressed to avoid double-posting" },
      });
      continue;
    }
    const payment: PaymentForBuild = {
      paymentId: mp.id,
      repairOrderId: mp.repairOrderId,
      method: mp.method,
      otherPaymentType: mp.otherPaymentType,
      signedAmountCents: mp.amountCents,
      signedProcessingFeeCents: mp.ccFeeCents,
      paymentDate: mp.paymentDate,
      status: "succeeded",
      isRefund: false,
      manual: true,
    };
    payments.push(buildPaymentJournalEntry(payment, paymentMappings, paymentSettings));
  }

  // ── roll up + persist the §9 review items (the pre-build extras + the gates') ──
  const rollup = rollupDay(businessDate, sales, payments, gateSettings);
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
