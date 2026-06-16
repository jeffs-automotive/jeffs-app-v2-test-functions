/**
 * Daily-snapshot read model (approval-dashboard upgrade §5 + daily-JE rework step 4) —
 * the per-day, per-transaction-type roll-up the main approval dashboard renders.
 * Combines the LIVE day drafts (`buildDayDrafts` → `rollupDay`, the same path the
 * reconcile enqueues) with the DAY-CATEGORY posting ledger (`qteklink_daily_postings`),
 * applying the §3a precedence at the day grain:
 *
 *   a constituent of the live POSTED category JE → Posted
 *   else a constituent of the latest staged category version → that version's column
 *   else a postable live draft → Unapproved (its debit total)
 *   else a blocked transaction → Needs attention (the SOURCE gross — known even when
 *     the JE can't fully build, e.g. an unmapped account)
 *
 * "Payment Fee" is a DERIVED row: a fee follows the FEES category's status for its
 * payment (fees post as their own daily JE), falling back to the parent payment's
 * column.
 *
 * LIVE-ON-VIEW (Chris 2026-06-12): opening the page makes the day CURRENT — the
 * payment-state projection refreshes first (reduceShopPaymentState), then the viewed
 * day is re-reconciled (runDailyReconciliation: stages the ledger + syncs review
 * items) — so a webhook that landed a minute ago is already reflected. Fully-
 * acknowledged days (Accounting Link's history) are NOT reconciled — terminal, must
 * not grow review items. The nightly sync stays as the verification net. Failures
 * THROW — a money view is never knowingly stale.
 */
import { reduceShopPaymentState } from "@/lib/dal/payment-state";
import { reconcileDayForView } from "@/lib/dal/daily-reconcile";
import { buildDayDrafts } from "@/lib/dal/day-drafts";
import { listDailyPostingsForDay, buildDailyStatusIndex, type DailyStatusIndex } from "@/lib/dal/daily-postings";
import { rollupDay } from "@/lib/reconcile/daily-rollup";
import { gatePaymentDraft } from "@/lib/reconcile/payment-gate";

export type SnapshotColumn = "needsAttention" | "unapproved" | "inProgress" | "posted";
export type SnapshotType = "Repair Order" | "Customer Payment" | "Payment Fee";

export interface TypeRow {
  type: SnapshotType;
  count: number;
  needsAttentionCents: number;
  unapprovedCents: number;
  inProgressCents: number;
  postedCents: number;
  totalCents: number;
}

export interface DailySnapshot {
  realmId: string | null;
  businessDate: string;
  kpis: { salesCents: number; paymentsCents: number; ccFeesCents: number };
  rows: TypeRow[]; // [Repair Order, Customer Payment, Payment Fee]
  needsAttentionCount: number;
}

/**
 * §3a — the EXHAUSTIVE posting-status → snapshot column map. `posting` is "In progress"
 * (locked, never bulk-re-posted); `rejected`/`failed`/`needs_resolution` are "Needs
 * attention" (never re-swept into a bulk approve); an unknown status fails safe to Needs
 * attention rather than silently into a postable column.
 */
export function statusToColumn(status: string): SnapshotColumn {
  switch (status) {
    case "pending":
      return "unapproved";
    case "approved":
    case "posting":
      return "inProgress";
    case "posted":
    // acknowledged = approved WITHOUT posting (Accounting Link's day) — done.
    case "acknowledged":
      return "posted";
    case "failed":
    case "rejected":
    case "needs_resolution":
      return "needsAttention";
    default:
      return "needsAttention";
  }
}

function emptyRow(type: SnapshotType): TypeRow {
  return { type, count: 0, needsAttentionCents: 0, unapprovedCents: 0, inProgressCents: 0, postedCents: 0, totalCents: 0 };
}

function addToColumn(row: TypeRow, col: SnapshotColumn, cents: number): void {
  if (col === "needsAttention") row.needsAttentionCents += cents;
  else if (col === "unapproved") row.unapprovedCents += cents;
  else if (col === "inProgress") row.inProgressCents += cents;
  else row.postedCents += cents;
  row.totalCents += cents;
  row.count += 1;
}

function debitTotal(lines: { postingType: "Debit" | "Credit"; amountCents: number; part?: string }[]): number {
  // The sale JE can carry a sales-tax OFFSET debit (PTAL owed but not charged) —
  // exclude it so the RO row + "Total sales" KPI tie to Tekmetric's totalSales
  // (audit 2026-06-12: an offset RO displayed totalSales + shortfall).
  return lines
    .filter((l) => l.postingType === "Debit" && l.part !== "tax_offset")
    .reduce((a, l) => a + (Number.isSafeInteger(l.amountCents) ? l.amountCents : 0), 0);
}

/** The day-grain §3a resolution: live-posted constituent → posted; staged constituent →
 *  its version's column; else postable/blocked. */
function resolveColumn(
  idx: DailyStatusIndex,
  kind: "sale" | "payment",
  key: number | string,
  postable: boolean,
): SnapshotColumn {
  if (kind === "sale" ? idx.postedSaleRos.has(key as number) : idx.postedPaymentIds.has(key as string)) return "posted";
  const staged = kind === "sale" ? idx.latestSaleStatusByRo.get(key as number) : idx.latestPaymentStatusById.get(key as string);
  if (staged) return statusToColumn(staged);
  return postable ? "unapproved" : "needsAttention";
}

export async function getDailySnapshot(
  shopId: number,
  businessDate: string,
  opts: { shopTimezone?: string; tireFeeCentsPerTire?: number; salesTaxRateBps?: number } = {},
): Promise<DailySnapshot> {
  // Refresh the payment projection so today's webhooks are visible NOW (also
  // resolves the realm — null = no QBO connection).
  const { realmId } = await reduceShopPaymentState(shopId);
  if (!realmId) {
    return {
      realmId: null,
      businessDate,
      kpis: { salesCents: 0, paymentsCents: 0, ccFeesCents: 0 },
      rows: [emptyRow("Repair Order"), emptyRow("Customer Payment"), emptyRow("Payment Fee")],
      needsAttentionCount: 0,
    };
  }

  // LIVE-ON-VIEW: re-reconcile the viewed day (stages the ledger + syncs review
  // items) unless it's fully acknowledged (Accounting Link's terminal history).
  // The reconcile hands back its OWN build — render from it instead of building
  // the day a second time (live-page performance, Chris 2026-06-12). A terminal
  // day (null — no reconcile ran) or a caller with explicit setting overrides
  // (the build must honor them) falls back to building locally.
  const viewBuild = await reconcileDayForView(shopId, businessDate);
  const useShared = viewBuild != null && Object.keys(opts).length === 0;

  const { sales, payments, gateSettings } = useShared
    ? viewBuild.drafts
    : await buildDayDrafts(shopId, realmId, businessDate, opts);
  const rollup = useShared
    ? viewBuild.rollup
    : rollupDay(businessDate, sales, payments.map((p) => p.je), gateSettings);
  const { postings } = await listDailyPostingsForDay(shopId, businessDate);
  const idx = buildDailyStatusIndex(postings);

  const postableSaleRos = new Set(rollup.postableSaleDrafts.map((d) => d.snapshot.repairOrderId));
  const postablePaymentIds = new Set(rollup.postablePaymentDrafts.map((j) => j.paymentId));

  const roRow = emptyRow("Repair Order");
  const payRow = emptyRow("Customer Payment");
  const feeRow = emptyRow("Payment Fee");
  let needsAttentionCount = 0;

  // ── SALES (Repair Order) — every parseable RO for the day ──
  for (const s of sales) {
    const ro = s.snapshot.repairOrderId;
    const col = resolveColumn(idx, "sale", ro, postableSaleRos.has(ro));
    // A posted/staged RO's $ is its draft debit total (the daily JE itemizes the same
    // per-RO A/R amounts); a blocked RO falls back to the SOURCE gross.
    const cents = col === "needsAttention" ? s.snapshot.totalSales : debitTotal(s.je.lines);
    addToColumn(roRow, col, cents);
    if (col === "needsAttention") needsAttentionCount += 1;
  }

  // ── PAYMENTS (Customer Payment) + the derived Payment Fee row ──
  for (const p of payments) {
    const je = p.je;
    const g = gatePaymentDraft(je);
    // A benign-suppressed payment (voided / zero) raises no review item — not a transaction
    // to post; exclude it from the counts (mirrors rollupDay).
    if (je.suppressed && g.reviewItems.length === 0) continue;

    const col = resolveColumn(idx, "payment", je.paymentId, postablePaymentIds.has(je.paymentId));
    // SIGNED, not abs: a refund (negative signed_amount_cents) must SUBTRACT from the day's
    // net payments — it nets within its own status column, so the "Total payments" KPI ties to
    // the real money collected. Voids never reach here (the suppressed/zero skip above keeps
    // their positive face value out of the totals), so dropping abs only affects refunds.
    const gross = p.input.signedAmountCents;
    addToColumn(payRow, col, gross);
    if (col === "needsAttention") needsAttentionCount += 1;

    // Derived fee — fees post as their OWN daily JE: use the fees category's status for
    // this payment when present, else follow the parent payment's column. Kept as a
    // magnitude: a refund carries no fee (its applicationFee is null/0, and a refund-with-fee
    // is flagged unsupported by the JE builder), so "Total CC fees" stays a positive sum.
    const fee = Math.abs(p.input.signedProcessingFeeCents);
    if (fee > 0) {
      const feeCol: SnapshotColumn = idx.postedFeePaymentIds.has(je.paymentId)
        ? "posted"
        : idx.latestFeeStatusById.has(je.paymentId)
          ? statusToColumn(idx.latestFeeStatusById.get(je.paymentId)!)
          : col;
      addToColumn(feeRow, feeCol, fee);
    }
  }

  return {
    realmId,
    businessDate,
    kpis: { salesCents: roRow.totalCents, paymentsCents: payRow.totalCents, ccFeesCents: feeRow.totalCents },
    rows: [roRow, payRow, feeRow],
    needsAttentionCount,
  };
}
