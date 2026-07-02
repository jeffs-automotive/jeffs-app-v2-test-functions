/**
 * Shared day-draft builder — the single read path that turns one shop-local business
 * day's source data (`qteklink_events` postings + `qteklink_payment_state` + manual
 * picks) into the built SALE + PAYMENT JE drafts. Used by BOTH the reconcile job
 * (`runDailyReconciliation` — gates/persists/enqueues) and the live-on-view read models
 * (`getDailySnapshot` / `getDayBreakdown`, which re-reconcile the viewed day first, then
 * build these drafts to render it). Factoring it here guarantees the read models' view of
 * "postable vs blocked" can NEVER drift from what the reconcile actually enqueues.
 *
 * Fat-DAL: the JE builders + gates are pure; this is the thin DB seam. MULTI-TENANT: the
 * caller has already resolved + verified `realmId`; every query scopes shop_id + realm_id.
 * No silent failures: every DB error throws.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { RO_SALE_SCAN_EVENT_KINDS, RO_UNPOST_EVENT_KIND } from "@/lib/events/kinds";
import { sortByReceivedAtDesc } from "@/lib/events/ordering";
import { listPendingDateMoves } from "@/lib/dal/date-moves";
import { listPendingRedatePaymentIds } from "@/lib/dal/payment-redates";
import { parseSnapshot, resolveMappings, type MappingRow } from "@/lib/dal/sale-je";
import { resolvePaymentMappings, stateRowToPayment, type PaymentStateRow } from "@/lib/dal/payment-je";
import { listManualPayments } from "@/lib/dal/manual-payments";
import { getShopSettings } from "@/lib/dal/settings";
import type { UpsertReviewItemInput } from "@/lib/dal/review-items";
import { buildSaleJournalEntry, toShopLocalDate, type SaleSettings } from "@/lib/sales/sale-builder";
import {
  buildPaymentJournalEntry, type PaymentForBuild, type PaymentJournalEntry, type PaymentSettings,
} from "@/lib/payments/payment-je-builder";
import type { SaleDraft } from "@/lib/reconcile/daily-rollup";
import type { SaleGateSettings } from "@/lib/reconcile/sale-gate";
import { lookupRoMeta } from "@/lib/dal/ro-lookup";
import { getCachedCustomerNames } from "@/lib/dal/customers";

/** A built payment draft + the normalized input it came from (gross/fee/status, which
 *  the JE itself only carries embedded in its lines). */
export interface DayPaymentDraft {
  input: PaymentForBuild;
  je: PaymentJournalEntry;
}

export interface DayDrafts {
  tz: string;
  gateSettings: SaleGateSettings;
  sales: SaleDraft[];
  payments: DayPaymentDraft[];
  /** Late payments HELD OUT of this (already-posted) day by a PENDING redate
   *  (resolution-workflow Part A): built for detection/resolution sync + display,
   *  but excluded from `payments` so no correction ever stages for them. */
  heldRedatePayments: DayPaymentDraft[];
  /** Pre-gate review items (unparseable snapshots + manual-pick conflicts). */
  extraReviewItems: UpsertReviewItemInput[];
}

/**
 * A GENEROUS UTC window [businessDate−1 00:00Z, businessDate+2 00:00Z) guaranteed to
 * contain every event whose shop-local date is `businessDate` (any offset < 24h, even
 * across DST). The exact local-date match is done in JS. Pure (no `Date.now()`).
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
 * Build every SALE + PAYMENT draft for one shop-local business day. The caller resolves
 * `realmId` first (fail-closed on no connection). `opts` override the shop's configured
 * settings (tests / one-offs).
 */
export async function buildDayDrafts(
  shopId: number,
  realmId: string,
  businessDate: string,
  opts: { shopTimezone?: string; tireFeeCentsPerTire?: number; salesTaxRateBps?: number } = {},
): Promise<DayDrafts> {
  const admin = createSupabaseAdminClient();

  const { settings: shopSettings } = await getShopSettings(shopId);
  const tz = opts.shopTimezone ?? shopSettings.shopTimezone;
  const saleSettings: SaleSettings = {
    shopTimezone: tz,
    tireFeeCentsPerTire: opts.tireFeeCentsPerTire ?? shopSettings.tireFeeCents,
    salesTaxRateBps: opts.salesTaxRateBps ?? shopSettings.salesTaxRateBps,
  };
  const gateSettings: SaleGateSettings = { salesTaxRateBps: saleSettings.salesTaxRateBps };
  const paymentSettings: PaymentSettings = { shopTimezone: tz };

  // ── mappings ONCE (resolved for both the sale builder and the payment builder) ──
  const { data: mapRows, error: mapErr } = await admin
    .from("qteklink_mappings")
    .select("kind, source_key, qbo_account_id, posting_role, pass_through")
    .eq("shop_id", shopId).eq("realm_id", realmId).eq("active", true)
    .order("effective_from", { ascending: true });
  if (mapErr) throw new Error(`buildDayDrafts (mappings) failed: ${mapErr.message}`);
  const rows = (mapRows ?? []) as MappingRow[];
  const saleMappings = resolveMappings(rows);
  const paymentMappings = resolvePaymentMappings(rows);

  // ── SALES: posting + UNPOST events in the generous UTC window → latest-per-RO →
  // exact local date. The unpost kind is in the scan so a posted-then-UNPOSTED RO's
  // newest event wins and the stale sale is dropped (a benign reversal, like a voided
  // payment — no review item; a later re-post supersedes the unpost and re-recognizes).
  //
  // DATE-MOVE HOLDS (the posting queue): while a move is PENDING (an RO unposted and
  // re-posted to a DIFFERENT day, awaiting the office manager), BOTH days hold steady:
  //   - the ORIGINAL day PINS the RO to its newest original-day snapshot (the newer
  //     other-day event is ignored), so the posted JE doesn't churn;
  //   - the NEW day EXCLUDES the RO entirely.
  // Approving / resolving the move lifts the holds and the normal diff takes over.
  const pendingMoves = await listPendingDateMoves(shopId, realmId);
  const excludeRos = new Set(pendingMoves.filter((m) => m.newBusinessDate === businessDate).map((m) => m.tekmetricRoId));
  const pinnedRos = new Set(pendingMoves.filter((m) => m.originalBusinessDate === businessDate).map((m) => m.tekmetricRoId));

  const { startIso, endIso } = utcWindowForLocalDay(businessDate);
  const { data: evRows, error: evErr } = await admin
    .from("qteklink_events")
    .select("tekmetric_ro_id, event_kind, raw_body, received_at")
    .eq("shop_id", shopId).eq("realm_id", realmId)
    .in("event_kind", [...RO_SALE_SCAN_EVENT_KINDS])
    .gte("tekmetric_event_at", startIso).lt("tekmetric_event_at", endIso)
    .order("received_at", { ascending: false });
  if (evErr) throw new Error(`buildDayDrafts (events) failed: ${evErr.message}`);

  const extraReviewItems: UpsertReviewItemInput[] = [];
  // ro_id → newest event per RO. Order by RECEIVED time, NOT business time: Tekmetric backdates
  // unpost/repost events (a corrective repost can carry an EARLIER postedDate than the unpost it
  // fixes — RO 153211 incident 2026-06-19), so the latest OBSERVED event is the RO's true current
  // state. The window above still buckets by business date; this only orders WITHIN the window.
  const latestByRo = new Map<string, { kind: string; data: unknown }>();
  const ordered = sortByReceivedAtDesc(
    (evRows ?? []) as { tekmetric_ro_id: number | string | null; event_kind: string; raw_body: { data?: unknown } | null; received_at: string }[],
  );
  for (const r of ordered) {
    const roKey = String(r.tekmetric_ro_id ?? "");
    if (!roKey || latestByRo.has(roKey)) continue;
    const roNum = Number(roKey);
    if (excludeRos.has(roNum)) continue; // held off this (new) day until the move is decided
    if (pinnedRos.has(roNum)) {
      // Pin: take the newest event that still belongs to THIS day (skip the unpost +
      // the other-day re-post; the original posting event is always in this window).
      if (r.event_kind === RO_UNPOST_EVENT_KIND) continue;
      const snap = parseSnapshot(r.raw_body?.data ?? null);
      if (!snap || toShopLocalDate(snap.postedDate, tz) !== businessDate) continue;
    }
    latestByRo.set(roKey, { kind: r.event_kind, data: r.raw_body?.data ?? null });
  }
  const sales: SaleDraft[] = [];
  for (const [roKey, ev] of latestByRo.entries()) {
    if (ev.kind === RO_UNPOST_EVENT_KIND) continue; // reversed — no sale to recognize
    const snapshot = parseSnapshot(ev.data);
    if (!snapshot) {
      // NEVER silently drop a real (but unparseable) sale — surface it (deduped by the §9 key).
      extraReviewItems.push({ kind: "snapshot_unparseable", subjectKind: "ro", subjectRef: roKey, detail: {} });
      continue;
    }
    if (toShopLocalDate(snapshot.postedDate, tz) !== businessDate) continue;
    sales.push({ snapshot, je: buildSaleJournalEntry(snapshot, saleMappings, saleSettings) });
  }

  // ── PAYMENTS: real (payment_state) + manual picks, both for this local day ──
  // Collect the normalized inputs first; enrich each with the human RO# + customer name
  // (the line-description fields), THEN build the JEs — the builder reads those fields.
  const paymentInputs: PaymentForBuild[] = [];

  const { data: psRows, error: psErr } = await admin
    .from("qteklink_payment_state")
    .select("payment_id, signed_amount_cents, signed_processing_fee_cents, status, is_refund, payment_type, other_payment_type, payment_date, repair_order_id")
    .eq("shop_id", shopId).eq("realm_id", realmId)
    .gte("payment_date", startIso).lt("payment_date", endIso);
  if (psErr) throw new Error(`buildDayDrafts (payment_state) failed: ${psErr.message}`);
  for (const row of (psRows ?? []) as PaymentStateRow[]) {
    if (!row.payment_date || toShopLocalDate(row.payment_date, tz) !== businessDate) continue;
    paymentInputs.push(stateRowToPayment(row));
  }

  // Manual method-picks for the day.
  const { manualPayments } = await listManualPayments(shopId);
  const dayManual = manualPayments.filter((mp) => toShopLocalDate(mp.paymentDate, tz) === businessDate);

  // ANTI-JOIN: a manual pick whose RO now has a REAL (non-voided) payment must NOT also
  // post — it would double-post. (The record-time anti-join can't see a payment projected
  // AFTER the pick; this reconcile-time check is the authoritative guard.)
  const manualRoIds = [...new Set(dayManual.map((mp) => mp.repairOrderId))];
  const conflictRoIds = new Set<number>();
  if (manualRoIds.length > 0) {
    const { data: confRows, error: confErr } = await admin
      .from("qteklink_payment_state")
      .select("repair_order_id")
      .eq("shop_id", shopId).eq("realm_id", realmId)
      .in("repair_order_id", manualRoIds).is("voided_at", null);
    if (confErr) throw new Error(`buildDayDrafts (manual anti-join) failed: ${confErr.message}`);
    for (const r of (confRows ?? []) as { repair_order_id: number | string }[]) conflictRoIds.add(Number(r.repair_order_id));
  }

  for (const mp of dayManual) {
    if (conflictRoIds.has(mp.repairOrderId)) {
      extraReviewItems.push({
        kind: "manual_payment_conflict", subjectKind: "ro", subjectRef: String(mp.repairOrderId),
        detail: { manualPaymentId: mp.id, reason: "a real payment exists for this RO; the manual pick is suppressed to avoid double-posting" },
      });
      continue;
    }
    paymentInputs.push({
      paymentId: mp.id, repairOrderId: mp.repairOrderId, method: mp.method, otherPaymentType: mp.otherPaymentType,
      signedAmountCents: mp.amountCents, signedProcessingFeeCents: mp.ccFeeCents, paymentDate: mp.paymentDate,
      status: "succeeded", isRefund: false, manual: true,
    });
  }

  // ── Enrich the line-description fields: human RO# + customer name ──
  // The webhook payload carries only customerId, so resolve customerId per RO from the event
  // ledger, then read the name from the cache ONLY (getCachedCustomerNames). The build NEVER
  // calls Tekmetric — the nightly cron (warmCustomerNamesForRecentDays) pre-fetches names
  // overnight, so the view/post path is fast + deterministic (posting is always >= 1 day out,
  // so names are cached by the time the office manager posts). An un-warmed customer is simply
  // omitted from the description until the next nightly warm.
  const payRoIds = [...new Set(paymentInputs.map((p) => p.repairOrderId).filter((ro): ro is number => ro != null))];
  const roMeta = await lookupRoMeta(shopId, realmId, payRoIds);
  const customerIds = [...new Set([...roMeta.values()].map((m) => m.customerId).filter((c): c is number => c != null))];
  const customerNames = await getCachedCustomerNames(shopId, customerIds);
  for (const input of paymentInputs) {
    const meta = input.repairOrderId != null ? roMeta.get(input.repairOrderId) : undefined;
    input.repairOrderNumber = meta?.repairOrderNumber ?? null;
    input.customerName = meta?.customerId != null ? (customerNames.get(meta.customerId) ?? null) : null;
  }

  // ── Payer name for store-credit ISSUANCE lines (unattached payment: no RO/customer) ──
  // The issuance description reads "Store Credit Issued · <payer>"; payerName is on the
  // payment event (not the projection), read here from the ledger (deterministic — no API).
  const issuancePaymentIds = paymentInputs
    .filter((p) => p.repairOrderId == null)
    .map((p) => Number(p.paymentId))
    .filter((n) => Number.isSafeInteger(n));
  if (issuancePaymentIds.length > 0) {
    const { data: payerRows, error: payerErr } = await admin
      .from("qteklink_events")
      .select("payment_id, raw_body")
      .eq("shop_id", shopId).eq("realm_id", realmId)
      .in("payment_id", issuancePaymentIds);
    if (payerErr) throw new Error(`buildDayDrafts (payer names) failed: ${payerErr.message}`);
    const payerById = new Map<number, string>();
    for (const r of (payerRows ?? []) as { payment_id: number | string; raw_body: { data?: { payerName?: unknown } } | null }[]) {
      const pid = Number(r.payment_id);
      const pn = r.raw_body?.data?.payerName;
      if (Number.isSafeInteger(pid) && typeof pn === "string" && pn.trim() && !payerById.has(pid)) {
        payerById.set(pid, pn.trim());
      }
    }
    for (const input of paymentInputs) {
      if (input.repairOrderId == null) input.payerName = payerById.get(Number(input.paymentId)) ?? null;
    }
  }

  const builtPayments: DayPaymentDraft[] = paymentInputs.map((input) => ({
    input,
    je: buildPaymentJournalEntry(input, paymentMappings, paymentSettings),
  }));

  // ── LATE-PAYMENT REDATE HOLD (resolution-workflow Part A) ──
  // A real payment with a PENDING redate on this day is held OUT of the desired
  // payment set (mirror of the date-move exclude above): the posted day's JE never
  // stages a correction for it while the office voids + re-dates it in Tekmetric.
  // Manual picks are app records — never held.
  const pendingRedates = await listPendingRedatePaymentIds(shopId, realmId, businessDate);
  const payments: DayPaymentDraft[] = [];
  const heldRedatePayments: DayPaymentDraft[] = [];
  for (const p of builtPayments) {
    const numericId = Number(p.input.paymentId);
    const held = p.input.manual !== true && Number.isSafeInteger(numericId) && pendingRedates.has(numericId);
    (held ? heldRedatePayments : payments).push(p);
  }

  return { tz, gateSettings, sales, payments, heldRedatePayments, extraReviewItems };
}
