/**
 * Daily-breakdown read model (approval-dashboard upgrade §5 + daily-JE rework step 4) —
 * the drill-down the breakdown page renders in 3 tabs:
 *   - Summary: the day's net BY GL ACCOUNT (the balanced postable+posted net, account-name
 *     labeled) — "what hits QuickBooks."
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
 *     abs-sum KPI convention.
 *
 * Read-only, shop+realm server-derived, integer cents, fail-closed.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { buildDayDrafts } from "@/lib/dal/day-drafts";
import { listDailyPostingsForDay, buildDailyStatusIndex } from "@/lib/dal/daily-postings";
import { rollupDay } from "@/lib/reconcile/daily-rollup";
import { gatePaymentDraft } from "@/lib/reconcile/payment-gate";
import { statusToColumn, type SnapshotColumn } from "@/lib/dal/daily-snapshot";
import { RO_SALE_SCAN_EVENT_KINDS } from "@/lib/events/kinds";

interface DraftJeLine {
  accountId: string;
  postingType: "Debit" | "Credit";
  amountCents: number;
  description: string;
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
  amountCents: number;
  feeCents: number;
  netCents: number;
  status: SnapshotColumn;
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
export interface DayBreakdown {
  realmId: string | null;
  businessDate: string;
  summary: { rows: SummaryRow[]; totalDebitCents: number; totalCreditCents: number; balanced: boolean; paymentsTotalCents: number; feesTotalCents: number; depositToUndepositedCents: number; nonCashCents: number; paymentTypes: PaymentTypeSummary[] };
  ros: RoBreakdown[];
  payments: PaymentBreakdown[];
}

interface AccountLabel { name: string | null; acctNum: string | null }

/**
 * repairOrderNumber per RO id from the NEWEST posting event — the fallback for
 * payments whose RO was sold on a different business day (so it isn't among the
 * day's sale snapshots). Throws on DB error (fail closed).
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
  for (const r of (data ?? []) as { tekmetric_ro_id: number | string; raw_body: { data?: { repairOrderNumber?: unknown } } | null }[]) {
    const ro = Number(r.tekmetric_ro_id);
    if (out.has(ro)) continue; // newest-first — first hit wins
    const n = r.raw_body?.data?.repairOrderNumber;
    if (typeof n === "string" || typeof n === "number") out.set(ro, String(n));
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
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) {
    return { realmId: null, businessDate, summary: { rows: [], totalDebitCents: 0, totalCreditCents: 0, balanced: true, paymentsTotalCents: 0, feesTotalCents: 0, depositToUndepositedCents: 0, nonCashCents: 0, paymentTypes: [] }, ros: [], payments: [] };
  }

  const { sales, payments, gateSettings } = await buildDayDrafts(shopId, realmId, businessDate, opts);
  const rollup = rollupDay(businessDate, sales, payments.map((p) => p.je), gateSettings);
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

    const totalCents = status === "needsAttention"
      ? s.snapshot.totalSales
      : lines.filter((l) => l.postingType === "Debit").reduce((a, l) => a + l.amountCents, 0);

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
    const amountCents = Math.abs(p.input.signedAmountCents);
    const feeCents = Math.abs(p.input.signedProcessingFeeCents);
    // je.route reflects the MAPPING (financing flagged "deposits like a card" → "deposit";
    // a true contra type → "non_cash"). Net to Undeposited is the deposit route minus its fee.
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
    });
  }

  // Adaptive per-type summary (the card above the payments list): count / gross /
  // fees per DISPLAY type, NON-ZERO types only, biggest first. Same abs-sum
  // convention as the row amounts + the page KPIs, so the card reconciles exactly.
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

  // ── Summary: the balanced postable+posted net by account (rollup.netByAccount). ──
  const summaryRows: SummaryRow[] = Object.entries(rollup.netByAccount)
    .filter(([, net]) => net !== 0)
    .map(([accountId, net]) => ({
      accountId,
      accountName: accts.get(accountId)?.name ?? null,
      acctNum: accts.get(accountId)?.acctNum ?? null,
      debitCents: net > 0 ? net : 0,
      creditCents: net < 0 ? -net : 0,
    }))
    .sort((a, b) => (a.acctNum ?? "").localeCompare(b.acctNum ?? "") || a.accountId.localeCompare(b.accountId));
  const totalDebitCents = summaryRows.reduce((a, r) => a + r.debitCents, 0);
  const totalCreditCents = summaryRows.reduce((a, r) => a + r.creditCents, 0);
  // Payments-summary totals — sum the SAME payment set as the main snapshot KPIs (abs gross +
  // abs fee), so the breakdown card matches the /approvals "Total payments" / "Total CC fees".
  const paymentsTotalCents = paymentRows.reduce((a, r) => a + r.amountCents, 0);
  const feesTotalCents = paymentRows.reduce((a, r) => a + r.feeCents, 0);

  return {
    realmId,
    businessDate,
    summary: { rows: summaryRows, totalDebitCents, totalCreditCents, balanced: totalDebitCents === totalCreditCents, paymentsTotalCents, feesTotalCents, depositToUndepositedCents, nonCashCents, paymentTypes },
    ros,
    payments: paymentRows,
  };
}
