/**
 * Daily-breakdown read model (approval-dashboard upgrade, plan §5/§3.2) — the drill-down
 * the breakdown page renders in 3 tabs:
 *   - Summary: the day's net BY GL ACCOUNT (the balanced postable+posted net, account-name
 *     labeled) — "what hits QuickBooks."
 *   - ROs: one row per repair order → its JE lines (labor / parts / fees / tax), with a
 *     status + the §3.2 source precedence (a POSTED row renders its PERSISTED JE; a
 *     not-yet-posted row renders the live draft — incl. unmapped markers so a blocked RO
 *     is still diagnosable) + a `changedSincePosted` flag.
 *   - Payments: two-column (payment + its CC fee + net-to-Undeposited).
 *
 * Read-only, shop+realm server-derived, integer cents, fail-closed.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { buildDayDrafts } from "@/lib/dal/day-drafts";
import { listPostingsForDay, sourceStateHash, type PostingRow, type PostingJeLine } from "@/lib/dal/postings";
import { rollupDay } from "@/lib/reconcile/daily-rollup";
import { gatePaymentDraft } from "@/lib/reconcile/payment-gate";
import { statusToColumn, type SnapshotColumn } from "@/lib/dal/daily-snapshot";

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
  method: string;
  amountCents: number;
  feeCents: number;
  netCents: number;
  status: SnapshotColumn;
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
  summary: { rows: SummaryRow[]; totalDebitCents: number; totalCreditCents: number; balanced: boolean; paymentsTotalCents: number; feesTotalCents: number };
  ros: RoBreakdown[];
  payments: PaymentBreakdown[];
}

interface AccountLabel { name: string | null; acctNum: string | null }

function keepLatest<K>(m: Map<K, PostingRow>, k: K, p: PostingRow): void {
  const cur = m.get(k);
  if (!cur || p.postingVersion > cur.postingVersion) m.set(k, p);
}

function labelLines(lines: PostingJeLine[], accts: Map<string, AccountLabel>): BreakdownLine[] {
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
    return { realmId: null, businessDate, summary: { rows: [], totalDebitCents: 0, totalCreditCents: 0, balanced: true, paymentsTotalCents: 0, feesTotalCents: 0 }, ros: [], payments: [] };
  }

  const { sales, payments, gateSettings } = await buildDayDrafts(shopId, realmId, businessDate, opts);
  const rollup = rollupDay(businessDate, sales, payments.map((p) => p.je), gateSettings);
  const { postings } = await listPostingsForDay(shopId, businessDate);

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

  const salePostingByRo = new Map<number, PostingRow>();
  const paymentPostingByKey = new Map<string, PostingRow>();
  for (const p of postings) {
    if (p.kind === "sale") keepLatest(salePostingByRo, p.tekmetricRoId, p);
    else if (p.kind === "payment" && p.paymentId != null) keepLatest(paymentPostingByKey, `${p.tekmetricRoId}:${p.paymentId}`, p);
  }
  const postableSaleRos = new Set(rollup.postableSaleDrafts.map((d) => d.snapshot.repairOrderId));
  const postablePaymentIds = new Set(rollup.postablePaymentDrafts.map((j) => j.paymentId));

  // ── ROs ──
  const ros: RoBreakdown[] = sales.map((s) => {
    const ro = s.snapshot.repairOrderId;
    const posting = salePostingByRo.get(ro);
    const status: SnapshotColumn = posting ? statusToColumn(posting.status) : postableSaleRos.has(ro) ? "unapproved" : "needsAttention";

    // §3.2 precedence: a POSTED row renders its persisted JE; otherwise the live draft.
    const usePersisted = posting?.status === "posted";
    const lines = usePersisted ? posting!.lines : (s.je.lines as PostingJeLine[]);
    const draftContent = { lines: s.je.lines, docNumber: s.je.docNumber, txnDate: s.je.txnDate };
    const changedSincePosted = posting?.status === "posted" && posting.sourceStateHash != null && sourceStateHash(draftContent) !== posting.sourceStateHash;

    const totalCents = posting?.totalCents ?? (postableSaleRos.has(ro)
      ? lines.filter((l) => l.postingType === "Debit").reduce((a, l) => a + l.amountCents, 0)
      : s.snapshot.totalSales);

    return {
      tekmetricRoId: ro,
      roNumber: s.snapshot.repairOrderNumber,
      totalCents,
      status,
      changedSincePosted: Boolean(changedSincePosted),
      unmapped: status === "needsAttention" ? s.je.unmapped : [],
      lines: labelLines(lines, accts),
    };
  });

  // ── Payments (two-column) ──
  const paymentRows: PaymentBreakdown[] = [];
  for (const p of payments) {
    const je = p.je;
    const g = gatePaymentDraft(je);
    if (je.suppressed && g.reviewItems.length === 0) continue; // benign void/zero — excluded
    const ro = je.repairOrderId;
    const payIdNum = Number(je.paymentId);
    const posting = ro != null && Number.isSafeInteger(payIdNum) ? paymentPostingByKey.get(`${ro}:${payIdNum}`) : undefined;
    const status: SnapshotColumn = posting ? statusToColumn(posting.status) : postablePaymentIds.has(je.paymentId) ? "unapproved" : "needsAttention";
    const amountCents = Math.abs(p.input.signedAmountCents);
    const feeCents = Math.abs(p.input.signedProcessingFeeCents);
    paymentRows.push({
      paymentId: je.paymentId,
      tekmetricRoId: ro,
      method: p.input.method,
      amountCents,
      feeCents,
      netCents: amountCents - feeCents,
      status,
    });
  }

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
    summary: { rows: summaryRows, totalDebitCents, totalCreditCents, balanced: totalDebitCents === totalCreditCents, paymentsTotalCents, feesTotalCents },
    ros,
    payments: paymentRows,
  };
}
