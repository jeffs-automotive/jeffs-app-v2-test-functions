/**
 * Daily-breakdown read model (approval-dashboard upgrade §5 + daily-JE rework step 4) —
 * the drill-down the breakdown page renders in 3 tabs:
 *   - Summary: a PREVIEW OF EACH journal entry the day will post (sales / payments /
 *     card fees — `summary.jes`), each balanced ON ITS OWN. Sales and payments are
 *     NEVER netted together (Chris 2026-06-12: a combined net made A/R read as
 *     sales-minus-payments — "$16k of payments isn't $16k of sales").
 *   - ROs: one row per repair order → its LIVE draft JE lines (labor / parts / fees /
 *     tax — the daily JE aggregates the credit side, so the draft is the only per-RO
 *     line source) + a status resolved from the DAY-CATEGORY ledger (a constituent of
 *     the live posted sales JE is "posted") + `changedSincePosted` = the RO is in the
 *     posted JE while a staged correction supersedes it (the day needs re-approval).
 *   - Payments: human RO numbers (same-day sale snapshots, falling back to the
 *     newest posting event for ROs sold on other days), the DISPLAY payment type
 *     (Tekmetric otherPaymentType — Synchrony / Tire Protection Plan / … — when the
 *     method is Other, else the method itself), per-row amount + CC fee +
 *     net-to-Undeposited, and `summary.paymentTypes` — the adaptive per-type
 *     summary (count / gross / fees), NON-ZERO types only, matching the page's
 *     signed-net KPI convention (a refund is negative, so it subtracts from the row,
 *     the per-type card, and every total).
 *
 * LIVE-ON-VIEW (Chris 2026-06-12): opening the page makes the day CURRENT —
 * the payment-state projection refreshes first (reduceShopPaymentState), then the
 * viewed day is re-reconciled (runDailyReconciliation: stages the ledger + syncs
 * review items) — so a webhook that landed a minute ago is already reflected.
 * Fully-acknowledged days (Accounting Link's history) are NOT reconciled — they're
 * terminal and must not grow review items. The nightly sync stays as the
 * verification net. Failures THROW — a money view is never knowingly stale.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { reduceShopPaymentState } from "@/lib/dal/payment-state";
import { reconcileDayForView } from "@/lib/dal/daily-reconcile";
import { buildDayDrafts } from "@/lib/dal/day-drafts";
import { listDailyPostingsForDay, buildDailyStatusIndex } from "@/lib/dal/daily-postings";
import { rollupDay } from "@/lib/reconcile/daily-rollup";
import { gatePaymentDraft } from "@/lib/reconcile/payment-gate";
import { buildDailyJournalEntries, type DailyJournalEntry, type DailyCategory } from "@/lib/daily/daily-je-builder";
import { statusToColumn, type SnapshotColumn } from "@/lib/dal/daily-snapshot";
import { RO_SALE_SCAN_EVENT_KINDS } from "@/lib/events/kinds";

interface DraftJeLine {
  accountId: string;
  postingType: "Debit" | "Credit";
  amountCents: number;
  description: string;
  /** "tax_offset" = the sales-tax debit funding an owed-but-not-charged tire fee. */
  part?: "tax_offset";
}

export interface BreakdownLine {
  accountId: string;
  accountName: string | null;
  acctNum: string | null;
  description: string;
  debitCents: number;
  creditCents: number;
}
export interface RoBreakdown {
  tekmetricRoId: number;
  roNumber: string;
  totalCents: number;
  status: SnapshotColumn;
  changedSincePosted: boolean;
  /** Unmapped sources (a blocked RO) — what the human must resolve. */
  unmapped: string[];
  lines: BreakdownLine[];
}
export interface PaymentBreakdown {
  paymentId: string;
  tekmetricRoId: number | null;
  /** Human RO number (Tekmetric repairOrderNumber) — null when not resolvable. */
  roNumber: string | null;
  /** DISPLAY payment type: otherPaymentType (Synchrony / Tire Protection Plan / …)
   *  when the Tekmetric method is Other, else the method (Credit Card / Cash / Check). */
  method: string;
  /** SIGNED gross — a refund is NEGATIVE so the row + every total nets it out. */
  amountCents: number;
  feeCents: number;
  /** SIGNED net to Undeposited (amountCents − feeCents) — negative for a refund. */
  netCents: number;
  status: SnapshotColumn;
  /** This payment is a refund (money out) — drives the row's "refund" marker. */
  isRefund: boolean;
}
/** One adaptive payment-type summary entry — only types with non-zero money appear. */
export interface PaymentTypeSummary {
  label: string;
  count: number;
  amountCents: number;
  feeCents: number;
}
export interface SummaryRow {
  accountId: string;
  accountName: string | null;
  acctNum: string | null;
  debitCents: number;
  creditCents: number;
}
/** Preview of ONE daily journal entry (sales / payments / fees) — its lines
 *  aggregated by account, balanced on its own. Sales and payments are NEVER
 *  netted into one table (that misread A/R as sales-minus-payments). */
export interface JePreview {
  category: DailyCategory;
  docNumber: string;
  rows: SummaryRow[];
  totalDebitCents: number;
  totalCreditCents: number;
  balanced: boolean;
  /** ROs (sales) or payments (payments/fees) inside this JE. */
  constituentCount: number;
}
/** The day's SALES totals by source bucket (the RO tab's summary card) — summed
 *  over every RO shown in the tab, so the card ties to the rows. */
export interface SalesBreakdownSummary {
  roCount: number;
  laborCents: number;
  partsCents: number;
  subletCents: number;
  feesCents: number;
  discountCents: number;
  salesTaxCents: number;
  tireFeeCents: number;
  totalCents: number;
}
export interface DayBreakdown {
  realmId: string | null;
  businessDate: string;
  summary: {
    jes: JePreview[];
    salesBreakdown: SalesBreakdownSummary;
    paymentsTotalCents: number;
    feesTotalCents: number;
    depositToUndepositedCents: number;
    nonCashCents: number;
    paymentTypes: PaymentTypeSummary[];
  };
  ros: RoBreakdown[];
  payments: PaymentBreakdown[];
}

const EMPTY_SALES_BREAKDOWN: SalesBreakdownSummary = {
  roCount: 0, laborCents: 0, partsCents: 0, subletCents: 0, feesCents: 0,
  discountCents: 0, salesTaxCents: 0, tireFeeCents: 0, totalCents: 0,
};

interface AccountLabel { name: string | null; acctNum: string | null }

interface RoNumberEventRow {
  tekmetric_ro_id: number | string;
  raw_body: { data?: { repairOrderNumber?: unknown; shopId?: unknown } } | null;
}

/** Harvest repairOrderNumber from event rows (newest-first; first hit per RO wins). */
function harvestRoNumbers(rows: RoNumberEventRow[], shopId: number, out: Map<number, string>): void {
  for (const r of rows) {
    const ro = Number(r.tekmetric_ro_id);
    if (out.has(ro)) continue;
    // The keytag firehose table predates the shop_id-column convention, so the
    // body-level shopId is REQUIRED to match (every Tekmetric RO payload carries
    // it — verified 1,369/1,369 live events, audit 2026-06-12). A row without a
    // matching claim is skipped: never harvest across shops.
    if (Number(r.raw_body?.data?.shopId) !== shopId) continue;
    const n = r.raw_body?.data?.repairOrderNumber;
    if (typeof n === "string" || typeof n === "number") out.set(ro, String(n));
  }
}

/**
 * repairOrderNumber per RO id — the fallback chain for payments whose RO was sold
 * on a different business day (so it isn't among the day's sale snapshots):
 *   1. qteklink_events posting events (webhooks live since 2026-06-11), then
 *   2. the keytag webhook firehose (any RO event body — capturing since 2026-05-09;
 *      A/R checks routinely pay ROs posted weeks earlier).
 * An RO older than BOTH captures stays unresolved → the UI shows an honest "—"
 * (never the payment id). Throws on DB error (fail closed).
 */
async function lookupRoNumbers(
  shopId: number,
  realmId: string,
  roIds: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (roIds.length === 0) return out;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_events")
    .select("tekmetric_ro_id, raw_body")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .in("event_kind", [...RO_SALE_SCAN_EVENT_KINDS])
    .in("tekmetric_ro_id", roIds)
    .order("tekmetric_event_at", { ascending: false, nullsFirst: false })
    .order("received_at", { ascending: false });
  if (error) throw new Error(`getDayBreakdown (ro numbers) failed: ${error.message}`);
  harvestRoNumbers((data ?? []) as RoNumberEventRow[], shopId, out);

  const missing = roIds.filter((ro) => !out.has(ro));
  if (missing.length > 0) {
    const { data: kd, error: ke } = await admin
      .from("keytag_webhook_events")
      .select("tekmetric_ro_id, raw_body")
      .in("tekmetric_ro_id", missing)
      .order("received_at", { ascending: false })
      .limit(500);
    if (ke) throw new Error(`getDayBreakdown (ro numbers, keytag fallback) failed: ${ke.message}`);
    harvestRoNumbers((kd ?? []) as RoNumberEventRow[], shopId, out);
  }
  return out;
}

function labelLines(lines: DraftJeLine[], accts: Map<string, AccountLabel>): BreakdownLine[] {
  return lines.map((l) => ({
    accountId: l.accountId,
    accountName: accts.get(l.accountId)?.name ?? null,
    acctNum: accts.get(l.accountId)?.acctNum ?? null,
    description: l.description,
    debitCents: l.postingType === "Debit" ? l.amountCents : 0,
    creditCents: l.postingType === "Credit" ? l.amountCents : 0,
  }));
}

export async function getDayBreakdown(
  shopId: number,
  businessDate: string,
  opts: { shopTimezone?: string; tireFeeCentsPerTire?: number; salesTaxRateBps?: number } = {},
): Promise<DayBreakdown> {
  // Refresh the payment projection so today's webhooks are visible NOW (also
  // resolves the realm — null = no QBO connection).
  const { realmId } = await reduceShopPaymentState(shopId);
  if (!realmId) {
    return { realmId: null, businessDate, summary: { jes: [], salesBreakdown: EMPTY_SALES_BREAKDOWN, paymentsTotalCents: 0, feesTotalCents: 0, depositToUndepositedCents: 0, nonCashCents: 0, paymentTypes: [] }, ros: [], payments: [] };
  }

  // LIVE-ON-VIEW: re-reconcile the viewed day (stages the ledger + syncs review
  // items) unless it's fully acknowledged (Accounting Link's terminal history).
  // The reconcile hands back its OWN build — render from it instead of building
  // the day a second time (live-page performance, Chris 2026-06-12). A terminal
  // day (null) or explicit setting overrides fall back to building locally.
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

  // account-name labels (ALL accounts incl. soft-deleted, so a posted line whose account
  // was since removed still labels) — shop+realm scoped.
  const admin = createSupabaseAdminClient();
  const { data: acctData, error: acctErr } = await admin
    .from("qbo_accounts")
    .select("qbo_account_id, name, acct_num")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId);
  if (acctErr) throw new Error(`getDayBreakdown (accounts) failed: ${acctErr.message}`);
  const accts = new Map<string, AccountLabel>(
    ((acctData ?? []) as { qbo_account_id: string; name: string | null; acct_num: string | null }[]).map((a) => [a.qbo_account_id, { name: a.name, acctNum: a.acct_num }]),
  );

  const postableSaleRos = new Set(rollup.postableSaleDrafts.map((d) => d.snapshot.repairOrderId));
  const postablePaymentIds = new Set(rollup.postablePaymentDrafts.map((j) => j.paymentId));

  // ── ROs (lines = the live draft — the only per-RO line source at the day grain) ──
  const ros: RoBreakdown[] = sales.map((s) => {
    const ro = s.snapshot.repairOrderId;
    const status: SnapshotColumn = idx.postedSaleRos.has(ro)
      ? "posted"
      : idx.latestSaleStatusByRo.has(ro)
        ? statusToColumn(idx.latestSaleStatusByRo.get(ro)!)
        : postableSaleRos.has(ro)
          ? "unapproved"
          : "needsAttention";

    const lines = s.je.lines as DraftJeLine[];
    // The RO sits in the POSTED daily JE while a staged correction supersedes it — the
    // day needs re-approval (the day-grain "changed since posted").
    const changedSincePosted = idx.postedSaleRos.has(ro) && idx.correctionStaged.sales;

    // Exclude the tax-offset debit so the RO row ties to Tekmetric's totalSales
    // (audit 2026-06-12 — it inflated offset ROs by the uncharged fee).
    const totalCents = status === "needsAttention"
      ? s.snapshot.totalSales
      : lines.filter((l) => l.postingType === "Debit" && l.part !== "tax_offset").reduce((a, l) => a + l.amountCents, 0);

    return {
      tekmetricRoId: ro,
      roNumber: s.snapshot.repairOrderNumber,
      totalCents,
      status,
      changedSincePosted,
      unmapped: status === "needsAttention" ? s.je.unmapped : [],
      lines: labelLines(lines, accts),
    };
  });

  // ── Payments (two-column) ──
  // RO numbers: the day's sale snapshots cover same-day ROs; a payment on an RO
  // sold another day falls back to the newest posting event's repairOrderNumber.
  const roNumberByRoId = new Map<number, string>(
    sales.map((s) => [s.snapshot.repairOrderId, s.snapshot.repairOrderNumber]),
  );
  const missingRoIds = [
    ...new Set(
      payments
        .map((p) => p.je.repairOrderId)
        .filter((ro): ro is number => ro != null && !roNumberByRoId.has(ro)),
    ),
  ];
  for (const [ro, num] of await lookupRoNumbers(shopId, realmId, missingRoIds)) {
    roNumberByRoId.set(ro, num);
  }

  const paymentRows: PaymentBreakdown[] = [];
  // Route-split totals for the card: a payment that books to Undeposited (deposit route =
  // card/cash/check + any financing mapped "deposits like a card") vs a true non-cash contra.
  let depositToUndepositedCents = 0;
  let nonCashCents = 0;
  for (const p of payments) {
    const je = p.je;
    const g = gatePaymentDraft(je);
    if (je.suppressed && g.reviewItems.length === 0) continue; // benign void/zero — excluded
    const ro = je.repairOrderId;
    const status: SnapshotColumn = idx.postedPaymentIds.has(je.paymentId)
      ? "posted"
      : idx.latestPaymentStatusById.has(je.paymentId)
        ? statusToColumn(idx.latestPaymentStatusById.get(je.paymentId)!)
        : postablePaymentIds.has(je.paymentId)
          ? "unapproved"
          : "needsAttention";
    // SIGNED gross (a refund is negative) so the row, the per-type card, and every total
    // SUBTRACT a refund instead of abs-adding it. Fee stays a magnitude (a refund has none).
    const amountCents = p.input.signedAmountCents;
    const feeCents = Math.abs(p.input.signedProcessingFeeCents);
    // je.route reflects the MAPPING (financing flagged "deposits like a card" → "deposit";
    // a true contra type → "non_cash"). Net to Undeposited is the deposit route minus its fee;
    // a refund's signed (negative) amount correctly reduces it, matching the QBO JE.
    if (je.route === "deposit") depositToUndepositedCents += amountCents - feeCents;
    else if (je.route === "non_cash") nonCashCents += amountCents;
    paymentRows.push({
      paymentId: je.paymentId,
      tekmetricRoId: ro,
      roNumber: ro != null ? (roNumberByRoId.get(ro) ?? null) : null,
      // The DISPLAY type — "Other" payments show their real sub-type (Synchrony,
      // Tire Protection Plan, …).
      method: (p.input.otherPaymentType ?? "").trim() || p.input.method,
      amountCents,
      feeCents,
      netCents: amountCents - feeCents,
      status,
      isRefund: p.input.isRefund ?? false,
    });
  }

  // Adaptive per-type summary (the card above the payments list): count / signed-net
  // gross / fees per DISPLAY type, NON-ZERO types only, biggest first. Same signed
  // convention as the row amounts + the page KPIs, so the card reconciles exactly (a
  // refund nets its type down; a type that nets to exactly zero drops out).
  const typeAgg = new Map<string, { count: number; amountCents: number; feeCents: number }>();
  for (const r of paymentRows) {
    const t = typeAgg.get(r.method) ?? { count: 0, amountCents: 0, feeCents: 0 };
    t.count++;
    t.amountCents += r.amountCents;
    t.feeCents += r.feeCents;
    typeAgg.set(r.method, t);
  }
  const paymentTypes: PaymentTypeSummary[] = [...typeAgg.entries()]
    .map(([label, t]) => ({ label, ...t }))
    .filter((t) => t.amountCents !== 0 || t.feeCents !== 0)
    .sort((a, b) => b.amountCents - a.amountCents || a.label.localeCompare(b.label));

  // ── Summary: a PREVIEW PER JOURNAL ENTRY (sales / payments / fees) — each one's
  // lines aggregated by account and balanced on its own; never netted across JEs.
  const bundle = buildDailyJournalEntries(businessDate, rollup.postableSaleDrafts, rollup.postablePaymentDrafts);
  const toPreview = (je: DailyJournalEntry | null): JePreview | null => {
    if (!je) return null;
    const byAccount = new Map<string, { debitCents: number; creditCents: number }>();
    for (const l of je.lines) {
      const agg = byAccount.get(l.accountId) ?? { debitCents: 0, creditCents: 0 };
      if (l.postingType === "Debit") agg.debitCents += l.amountCents;
      else agg.creditCents += l.amountCents;
      byAccount.set(l.accountId, agg);
    }
    const rows: SummaryRow[] = [...byAccount.entries()]
      .map(([accountId, agg]) => ({
        accountId,
        accountName: accts.get(accountId)?.name ?? null,
        acctNum: accts.get(accountId)?.acctNum ?? null,
        ...agg,
      }))
      .sort((a, b) => (a.acctNum ?? "").localeCompare(b.acctNum ?? "") || a.accountId.localeCompare(b.accountId));
    return {
      category: je.category,
      docNumber: je.docNumber,
      rows,
      totalDebitCents: je.totalDebitsCents,
      totalCreditCents: je.totalCreditsCents,
      balanced: je.balanced,
      constituentCount: je.category === "sales" ? je.constituents.roIds.length : je.constituents.paymentIds.length,
    };
  };
  const jes = [toPreview(bundle.sales), toPreview(bundle.payments), toPreview(bundle.fees)]
    .filter((p): p is JePreview => p !== null);

  // ── The RO tab's sales-breakdown card: source-bucket totals over EVERY RO row. ──
  const salesBreakdown = sales.reduce<SalesBreakdownSummary>((acc, s) => ({
    roCount: acc.roCount + 1,
    laborCents: acc.laborCents + (s.snapshot.laborSales ?? 0),
    partsCents: acc.partsCents + (s.snapshot.partsSales ?? 0),
    subletCents: acc.subletCents + (s.snapshot.subletSales ?? 0),
    feesCents: acc.feesCents + (s.snapshot.feeTotal ?? 0),
    discountCents: acc.discountCents + (s.snapshot.discountTotal ?? 0),
    salesTaxCents: acc.salesTaxCents + (s.je.taxSplit?.salesTaxCents ?? 0),
    tireFeeCents: acc.tireFeeCents + (s.je.taxSplit?.tireFeeCents ?? 0),
    totalCents: acc.totalCents + (s.snapshot.totalSales ?? 0),
  }), { ...EMPTY_SALES_BREAKDOWN });

  // Payments-summary totals — sum the SAME payment set as the main snapshot KPIs (signed-net
  // gross + abs fee), so the breakdown card matches the /approvals "Total payments" / "Total CC
  // fees" and a refund subtracts from both.
  const paymentsTotalCents = paymentRows.reduce((a, r) => a + r.amountCents, 0);
  const feesTotalCents = paymentRows.reduce((a, r) => a + r.feeCents, 0);

  return {
    realmId,
    businessDate,
    summary: { jes, salesBreakdown, paymentsTotalCents, feesTotalCents, depositToUndepositedCents, nonCashCents, paymentTypes },
    ros,
    payments: paymentRows,
  };
}
