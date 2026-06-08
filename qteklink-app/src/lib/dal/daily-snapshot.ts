/**
 * Daily-snapshot read model (approval-dashboard upgrade, plan §5) — the per-day, per-
 * transaction-type roll-up the main approval dashboard renders. Combines the LIVE day
 * drafts (`buildDayDrafts` → `rollupDay`, the same path the reconcile enqueues) with the
 * PERSISTED postings, applying the §3a source-of-truth precedence:
 *
 *   a persisted posting WINS (its status → the column; its proposed-JE debit total → the $)
 *   else a postable live draft → Unapproved (its debit total)
 *   else a blocked transaction → Needs attention (the SOURCE gross — known even when the
 *     JE can't fully build, e.g. an unmapped account)
 *
 * "Payment Fee" is a DERIVED row: the CC fee follows its PARENT payment's column. Read-only,
 * shop+realm server-derived, integer cents, fail-closed. No mutation, no QBO write.
 */
import { resolveRealmForShop } from "@/lib/dal/realm";
import { buildDayDrafts } from "@/lib/dal/day-drafts";
import { listPostingsForDay, type PostingRow } from "@/lib/dal/postings";
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

function debitTotal(lines: { postingType: "Debit" | "Credit"; amountCents: number }[]): number {
  return lines
    .filter((l) => l.postingType === "Debit")
    .reduce((a, l) => a + (Number.isSafeInteger(l.amountCents) ? l.amountCents : 0), 0);
}

/** Keep the highest-version posting per subject (the authoritative current state). */
function keepLatest<K>(m: Map<K, PostingRow>, k: K, p: PostingRow): void {
  const cur = m.get(k);
  if (!cur || p.postingVersion > cur.postingVersion) m.set(k, p);
}

export async function getDailySnapshot(
  shopId: number,
  businessDate: string,
  opts: { shopTimezone?: string; tireFeeCentsPerTire?: number; salesTaxRateBps?: number } = {},
): Promise<DailySnapshot> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) {
    return {
      realmId: null,
      businessDate,
      kpis: { salesCents: 0, paymentsCents: 0, ccFeesCents: 0 },
      rows: [emptyRow("Repair Order"), emptyRow("Customer Payment"), emptyRow("Payment Fee")],
      needsAttentionCount: 0,
    };
  }

  const { sales, payments, gateSettings } = await buildDayDrafts(shopId, realmId, businessDate, opts);
  const rollup = rollupDay(businessDate, sales, payments.map((p) => p.je), gateSettings);
  const { postings } = await listPostingsForDay(shopId, businessDate);

  // Persisted postings indexed by subject (latest version wins).
  const salePostingByRo = new Map<number, PostingRow>();
  const paymentPostingByKey = new Map<string, PostingRow>();
  for (const p of postings) {
    if (p.kind === "sale") keepLatest(salePostingByRo, p.tekmetricRoId, p);
    else if (p.kind === "payment" && p.paymentId != null) keepLatest(paymentPostingByKey, `${p.tekmetricRoId}:${p.paymentId}`, p);
  }

  const postableSaleRos = new Set(rollup.postableSaleDrafts.map((d) => d.snapshot.repairOrderId));
  const postablePaymentIds = new Set(rollup.postablePaymentDrafts.map((j) => j.paymentId));

  const roRow = emptyRow("Repair Order");
  const payRow = emptyRow("Customer Payment");
  const feeRow = emptyRow("Payment Fee");
  let needsAttentionCount = 0;

  // ── SALES (Repair Order) — every parseable RO for the day ──
  for (const s of sales) {
    const ro = s.snapshot.repairOrderId;
    const posting = salePostingByRo.get(ro);
    let col: SnapshotColumn;
    let cents: number;
    if (posting) {
      col = statusToColumn(posting.status);
      cents = posting.totalCents ?? debitTotal(s.je.lines);
    } else if (postableSaleRos.has(ro)) {
      col = "unapproved";
      cents = debitTotal(s.je.lines);
    } else {
      col = "needsAttention";
      cents = s.snapshot.totalSales; // SOURCE gross — known even when the JE can't fully build
    }
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

    const ro = je.repairOrderId;
    const payIdNum = Number(je.paymentId);
    const posting = ro != null && Number.isSafeInteger(payIdNum) ? paymentPostingByKey.get(`${ro}:${payIdNum}`) : undefined;

    let col: SnapshotColumn;
    if (posting) col = statusToColumn(posting.status);
    else if (postablePaymentIds.has(je.paymentId)) col = "unapproved";
    else col = "needsAttention";

    const gross = Math.abs(p.input.signedAmountCents);
    addToColumn(payRow, col, gross);
    if (col === "needsAttention") needsAttentionCount += 1;

    // Derived fee — same column as the PARENT payment (no separate attention count).
    const fee = Math.abs(p.input.signedProcessingFeeCents);
    if (fee > 0) addToColumn(feeRow, col, fee);
  }

  return {
    realmId,
    businessDate,
    kpis: { salesCents: roRow.totalCents, paymentsCents: payRow.totalCents, ccFeesCents: feeRow.totalCents },
    rows: [roRow, payRow, feeRow],
    needsAttentionCount,
  };
}
