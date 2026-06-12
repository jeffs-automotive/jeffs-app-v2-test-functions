/**
 * Unit tests for getDayBreakdown — the Summary (balanced net-by-account + names), the RO
 * tab at the DAY grain (lines are always the LIVE draft; status from the day-category
 * ledger; changedSincePosted = posted constituent + a staged correction), the
 * needs-attention unmapped surface, and the Payments derivation: RO numbers (same-day
 * snapshot + newest-event fallback), the DISPLAY payment type (otherPaymentType over
 * "Other"), and the adaptive non-zero paymentTypes summary.
 * DB seams + rollup/gate mocked; the real buildDailyStatusIndex is kept.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const reduceMock = vi.fn();
const reconcileMock = vi.fn();
const buildDayDraftsMock = vi.fn();
const listDailyMock = vi.fn();
const rollupDayMock = vi.fn();
const fromMock = vi.fn();

// getDayBreakdown refreshes the payment projection FIRST (freshness contract) and
// takes the realm from its result; then it LIVE-reconciles the viewed day via the shared
// reconcileDayForView preamble. The mock mirrors that preamble's terminality gate over
// the test's own seams (listDailyMock for postings; reconcileMock for the reconcile) so
// the called/not-called assertions exercise the real not-when-terminal behavior.
vi.mock("@/lib/dal/payment-state", () => ({ reduceShopPaymentState: (...a: unknown[]) => reduceMock(...a) }));
vi.mock("@/lib/dal/daily-reconcile", () => ({
  runDailyReconciliation: (...a: unknown[]) => reconcileMock(...a),
  reconcileDayForView: async (shopId: number, businessDate: string) => {
    const { postings } = (await listDailyMock(shopId, businessDate)) as { postings: { status: string }[] };
    const terminal = postings.length > 0 && postings.every((p) => p.status === "acknowledged" || p.status === "rejected");
    if (!terminal) await reconcileMock(shopId, businessDate);
  },
}));
vi.mock("@/lib/dal/day-drafts", () => ({ buildDayDrafts: (...a: unknown[]) => buildDayDraftsMock(...a) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ from: fromMock }) }));
vi.mock("@/lib/reconcile/daily-rollup", () => ({ rollupDay: (...a: unknown[]) => rollupDayMock(...a) }));
vi.mock("@/lib/reconcile/payment-gate", () => ({ gatePaymentDraft: (je: { suppressed?: boolean }) => ({ postable: !je.suppressed, reviewItems: [] }) }));
// Keep the REAL daily-postings module EXCEPT the DB read (buildDailyStatusIndex is real).
vi.mock("@/lib/dal/daily-postings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../daily-postings")>()),
  listDailyPostingsForDay: (...a: unknown[]) => listDailyMock(...a),
}));

import { getDayBreakdown } from "../daily-breakdown";

const REALM = "9341455608740708";
const DATE = "2026-06-06";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sale = (ro: number, num: string, lines: any[], totalSales: number, unmapped: string[] = []): any => ({
  snapshot: { repairOrderId: ro, repairOrderNumber: num, totalSales },
  je: { lines, docNumber: `RO ${num}`, txnDate: DATE, unmapped },
});
const L = (accountId: string, postingType: "Debit" | "Credit", amountCents: number, description = "") => ({ accountId, postingType, amountCents, description });

function chainOf(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) chain[m] = vi.fn(() => chain);
  chain.then = (onF: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(onF);
  return chain;
}
const ACCT_ROWS = [
  { qbo_account_id: "120", name: "Accounts Receivable", acct_num: "120" },
  { qbo_account_id: "412", name: "Sales – Labor", acct_num: "412" },
  { qbo_account_id: "206", name: "Sales Tax Payable", acct_num: "206" },
];
/** newest-posting-event rows for the RO-number fallback (newest-first order). */
let eventRows: unknown[] = [];
/** keytag firehose rows — the SECOND RO-number fallback (older ROs). */
let keytagRows: unknown[] = [];
function routeFrom(table: string) {
  if (table === "qteklink_events") return chainOf(eventRows);
  if (table === "keytag_webhook_events") return chainOf(keytagRows);
  return chainOf(ACCT_ROWS);
}

describe("getDayBreakdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventRows = [];
    keytagRows = [];
    reduceMock.mockResolvedValue({ realmId: REALM, events: 0, payments: 0 });
    reconcileMock.mockResolvedValue({ realmId: REALM });
    fromMock.mockImplementation(routeFrom);
  });

  it("returns empty when the shop has no connection (and still refreshed the projection first)", async () => {
    reduceMock.mockResolvedValue({ realmId: null, events: 0, payments: 0 });
    const b = await getDayBreakdown(7476, DATE);
    expect(b).toMatchObject({ realmId: null, ros: [], payments: [], summary: { jes: [], salesBreakdown: { roCount: 0, totalCents: 0 } } });
    expect(reduceMock).toHaveBeenCalledWith(7476);
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("builds the summary, RO detail (live-draft lines + day-grain status + changedSincePosted), and payments", async () => {
    const s1 = sale(1, "1001", [L("120", "Debit", 1000, "RO 1001"), L("412", "Credit", 940), L("206", "Credit", 60)], 1000);
    const s2 = sale(2, "1002", [L("120", "Debit", 500), L("412", "Credit", 500)], 500);
    const s3 = sale(3, "1003", [L("120", "Debit", 300)], 300, ["fee:Synchrony"]); // blocked
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p1: any = { input: { paymentId: "101", signedAmountCents: 1200, signedProcessingFeeCents: 35, method: "Credit Card" }, je: { paymentId: "101", repairOrderId: 1, suppressed: false, lines: [] } };

    buildDayDraftsMock.mockResolvedValue({ tz: "America/New_York", gateSettings: { salesTaxRateBps: 600 }, sales: [s1, s2, s3], payments: [p1], extraReviewItems: [] });
    rollupDayMock.mockReturnValue({
      postableSaleDrafts: [s1, s2], postablePaymentDrafts: [p1.je],
      saleCount: 3, paymentCount: 1, postableSales: 2, postablePayments: 1, reviewCount: 1, reviewItems: [],
    });
    // RO1 is in the POSTED sales JE (v1); a STAGED correction (pending v2) supersedes the
    // day → RO1 shows posted + changedSincePosted (the day needs re-approval).
    listDailyMock.mockResolvedValue({
      realmId: REALM,
      postings: [
        {
          id: "dv1", businessDate: DATE, category: "sales", postingVersion: 1, action: "create", status: "posted",
          docNumber: `QTL-RO-${DATE}`, txnDate: DATE, lines: [], totalCents: null,
          constituents: { roIds: [1], paymentIds: [] }, sourceStateHash: "h1", requestid: "q1",
          qboJeId: "QBO-1", qboSyncToken: "0", approvedBy: "chris@x.com", createdAt: "2026-06-07T01:00:00Z",
        },
        {
          id: "dv2", businessDate: DATE, category: "sales", postingVersion: 2, action: "update", status: "pending",
          docNumber: `QTL-RO-${DATE}`, txnDate: DATE, lines: [], totalCents: null,
          constituents: { roIds: [1, 2], paymentIds: [] }, sourceStateHash: "h2", requestid: "q2",
          qboJeId: null, qboSyncToken: null, approvedBy: null, createdAt: "2026-06-07T02:00:00Z",
        },
      ],
    });

    const b = await getDayBreakdown(7476, DATE);

    // LIVE-ON-VIEW: the day was reconciled before rendering (not acknowledged).
    expect(reconcileMock).toHaveBeenCalledWith(7476, DATE);

    // Summary — ONE PREVIEW PER JE (never netted across JEs). Mock payment jes have
    // no lines → only the sales JE previews; built by the REAL daily-JE builder.
    expect(b.summary.jes.map((j) => j.category)).toEqual(["sales"]);
    const salesJe = b.summary.jes[0]!;
    expect(salesJe.docNumber).toBe(`QTL-RO-${DATE}`);
    expect(salesJe.balanced).toBe(true);
    expect(salesJe.totalDebitCents).toBe(1500);
    expect(salesJe.constituentCount).toBe(2); // s1 + s2 (postable)
    expect(salesJe.rows.find((r) => r.accountId === "120")).toMatchObject({ acctNum: "120", accountName: "Accounts Receivable", debitCents: 1500, creditCents: 0 });
    expect(salesJe.rows.find((r) => r.accountId === "412")).toMatchObject({ creditCents: 1440, debitCents: 0 });

    // The RO tab's sales-breakdown card ties to ALL RO rows (incl. needs-attention).
    expect(b.summary.salesBreakdown).toMatchObject({ roCount: 3, totalCents: 1800 });

    // RO1 — in the posted daily JE → posted; staged correction → changed; LIVE draft lines
    const ro1 = b.ros.find((r) => r.tekmetricRoId === 1)!;
    expect(ro1.status).toBe("posted");
    expect(ro1.changedSincePosted).toBe(true);
    expect(ro1.lines.map((l) => l.description)).toEqual(["RO 1001", "", ""]);
    expect(ro1.totalCents).toBe(1000);
    // RO2 — only in the staged pending v2 → unapproved; RO3 blocked with the unmapped reason
    const ro2 = b.ros.find((r) => r.tekmetricRoId === 2)!;
    expect(ro2.status).toBe("unapproved");
    expect(ro2.changedSincePosted).toBe(false);
    const ro3 = b.ros.find((r) => r.tekmetricRoId === 3)!;
    expect(ro3.status).toBe("needsAttention");
    expect(ro3.unmapped).toEqual(["fee:Synchrony"]);

    // Payments — two-column derivation (no payments daily row → postable → unapproved);
    // the RO NUMBER comes from the same-day sale snapshot (no events lookup needed).
    expect(b.payments).toEqual([{ paymentId: "101", tekmetricRoId: 1, roNumber: "1001", method: "Credit Card", amountCents: 1200, feeCents: 35, netCents: 1165, status: "unapproved" }]);

    // Payments-summary card totals (abs gross + abs fee, matching the main snapshot KPIs)
    expect(b.summary.paymentsTotalCents).toBe(1200);
    expect(b.summary.feesTotalCents).toBe(35);
    expect(b.summary.paymentTypes).toEqual([{ label: "Credit Card", count: 1, amountCents: 1200, feeCents: 35 }]);
  });

  it("payments: RO# falls back to the newest posting event; 'Other' shows its sub-type; the type summary adapts (non-zero only, biggest first)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pay = (id: string, ro: number | null, method: string, other: string | null, cents: number, fee: number): any => ({
      input: { paymentId: id, signedAmountCents: cents, signedProcessingFeeCents: fee, method, otherPaymentType: other },
      je: { paymentId: id, repairOrderId: ro, suppressed: false, lines: [], route: "deposit" },
    });
    const sameDay = sale(1, "1001", [L("120", "Debit", 1000)], 1000);
    const payments = [
      pay("p1", 1, "Credit Card", null, 1200, 35), // RO# from the same-day sale snapshot
      pay("p2", 99, "Other", "Synchrony", 12000, 0), // RO sold ANOTHER day → event fallback
      pay("p3", 77, "Other", "Tire Protection Plan", 19550, 0), // keytag-firehose fallback
      pay("p4", 55, "Check", null, 8357, 0), // found NOWHERE → null RO# (UI shows "—")
      pay("p5", 1, "Cash", null, 0, 0), // zero — appears as a row, filtered from the summary
    ];
    eventRows = [
      { tekmetric_ro_id: 99, raw_body: { data: { repairOrderNumber: 2099, shopId: 7476 } } }, // newest wins
      { tekmetric_ro_id: 99, raw_body: { data: { repairOrderNumber: 1099, shopId: 7476 } } },
    ];
    keytagRows = [
      { tekmetric_ro_id: 77, raw_body: { data: { repairOrderNumber: 152077, shopId: 7476 } } },
      // the body shopId is REQUIRED to match — wrong-shop AND claim-less rows are
      // both ignored (every real Tekmetric RO payload carries shopId).
      { tekmetric_ro_id: 55, raw_body: { data: { repairOrderNumber: 999999, shopId: 1111 } } },
      { tekmetric_ro_id: 55, raw_body: { data: { repairOrderNumber: 888888 } } },
    ];
    buildDayDraftsMock.mockResolvedValue({ tz: "America/New_York", gateSettings: {}, sales: [sameDay], payments, extraReviewItems: [] });
    rollupDayMock.mockReturnValue({ postableSaleDrafts: [sameDay], postablePaymentDrafts: payments.map((p) => p.je), saleCount: 1, paymentCount: 4, postableSales: 1, postablePayments: 4, reviewCount: 0, reviewItems: [] });
    listDailyMock.mockResolvedValue({ realmId: REALM, postings: [] });

    const b = await getDayBreakdown(7476, DATE);

    const byId = new Map(b.payments.map((p) => [p.paymentId, p]));
    expect(byId.get("p1")).toMatchObject({ roNumber: "1001", method: "Credit Card" });
    expect(byId.get("p2")).toMatchObject({ roNumber: "2099", method: "Synchrony" });
    expect(byId.get("p3")).toMatchObject({ roNumber: "152077", method: "Tire Protection Plan" });
    expect(byId.get("p4")).toMatchObject({ roNumber: null, method: "Check" }); // wrong-shop body ignored

    // Adaptive summary: biggest first, the zero-money Cash type filtered out.
    expect(b.summary.paymentTypes).toEqual([
      { label: "Tire Protection Plan", count: 1, amountCents: 19550, feeCents: 0 },
      { label: "Synchrony", count: 1, amountCents: 12000, feeCents: 0 },
      { label: "Check", count: 1, amountCents: 8357, feeCents: 0 },
      { label: "Credit Card", count: 1, amountCents: 1200, feeCents: 35 },
    ]);
  });

  it("splits the payments-summary totals by booking route (deposit → Undeposited vs non-cash)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dep: any = { input: { paymentId: "1", signedAmountCents: 1000, signedProcessingFeeCents: 30, method: "Credit Card" }, je: { paymentId: "1", repairOrderId: 1, suppressed: false, lines: [], route: "deposit" } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nc: any = { input: { paymentId: "2", signedAmountCents: 400, signedProcessingFeeCents: 0, method: "Other" }, je: { paymentId: "2", repairOrderId: 2, suppressed: false, lines: [], route: "non_cash" } };
    buildDayDraftsMock.mockResolvedValue({ tz: "America/New_York", gateSettings: { salesTaxRateBps: 600 }, sales: [], payments: [dep, nc], extraReviewItems: [] });
    rollupDayMock.mockReturnValue({ postableSaleDrafts: [], postablePaymentDrafts: [], saleCount: 0, paymentCount: 2, postableSales: 0, postablePayments: 0, reviewCount: 0, reviewItems: [] });
    listDailyMock.mockResolvedValue({ realmId: REALM, postings: [] });

    const b = await getDayBreakdown(7476, DATE);
    expect(b.summary.paymentsTotalCents).toBe(1400); // 1000 + 400 (all payments)
    expect(b.summary.feesTotalCents).toBe(30);
    expect(b.summary.depositToUndepositedCents).toBe(970); // 1000 − 30 fee (deposit route only)
    expect(b.summary.nonCashCents).toBe(400); // non-cash contra — excluded from Undeposited
  });
});
