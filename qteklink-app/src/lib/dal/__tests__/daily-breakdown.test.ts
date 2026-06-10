/**
 * Unit tests for getDayBreakdown — the Summary (balanced net-by-account + names), the RO
 * tab at the DAY grain (lines are always the LIVE draft; status from the day-category
 * ledger; changedSincePosted = posted constituent + a staged correction), the
 * needs-attention unmapped surface, and the Payments two-column derivation.
 * DB seams + rollup/gate mocked; the real buildDailyStatusIndex is kept.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveRealmMock = vi.fn();
const buildDayDraftsMock = vi.fn();
const listDailyMock = vi.fn();
const rollupDayMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/dal/realm", () => ({ resolveRealmForShop: (...a: unknown[]) => resolveRealmMock(...a) }));
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

function acctChain() {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) chain[m] = vi.fn(() => chain);
  chain.then = (onF: (v: unknown) => unknown) =>
    Promise.resolve({
      data: [
        { qbo_account_id: "120", name: "Accounts Receivable", acct_num: "120" },
        { qbo_account_id: "412", name: "Sales – Labor", acct_num: "412" },
        { qbo_account_id: "206", name: "Sales Tax Payable", acct_num: "206" },
      ],
      error: null,
    }).then(onF);
  return chain;
}

describe("getDayBreakdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveRealmMock.mockResolvedValue(REALM);
    fromMock.mockReturnValue(acctChain());
  });

  it("returns empty when the shop has no connection", async () => {
    resolveRealmMock.mockResolvedValue(null);
    const b = await getDayBreakdown(7476, DATE);
    expect(b).toMatchObject({ realmId: null, ros: [], payments: [], summary: { rows: [], balanced: true } });
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
      netByAccount: { "120": 1500, "412": -1440, "206": -60 }, // Dr 1500 = Cr 1500
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

    // Summary — balanced, names joined, sorted by acct_num
    expect(b.summary.balanced).toBe(true);
    expect(b.summary.totalDebitCents).toBe(1500);
    expect(b.summary.rows.find((r) => r.accountId === "120")).toMatchObject({ acctNum: "120", accountName: "Accounts Receivable", debitCents: 1500, creditCents: 0 });
    expect(b.summary.rows.find((r) => r.accountId === "412")).toMatchObject({ creditCents: 1440, debitCents: 0 });

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

    // Payments — two-column derivation (no payments daily row → postable → unapproved)
    expect(b.payments).toEqual([{ paymentId: "101", tekmetricRoId: 1, method: "Credit Card", amountCents: 1200, feeCents: 35, netCents: 1165, status: "unapproved" }]);

    // Payments-summary card totals (abs gross + abs fee, matching the main snapshot KPIs)
    expect(b.summary.paymentsTotalCents).toBe(1200);
    expect(b.summary.feesTotalCents).toBe(35);
  });

  it("splits the payments-summary totals by booking route (deposit → Undeposited vs non-cash)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dep: any = { input: { paymentId: "1", signedAmountCents: 1000, signedProcessingFeeCents: 30, method: "Credit Card" }, je: { paymentId: "1", repairOrderId: 1, suppressed: false, lines: [], route: "deposit" } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nc: any = { input: { paymentId: "2", signedAmountCents: 400, signedProcessingFeeCents: 0, method: "Other" }, je: { paymentId: "2", repairOrderId: 2, suppressed: false, lines: [], route: "non_cash" } };
    buildDayDraftsMock.mockResolvedValue({ tz: "America/New_York", gateSettings: { salesTaxRateBps: 600 }, sales: [], payments: [dep, nc], extraReviewItems: [] });
    rollupDayMock.mockReturnValue({ postableSaleDrafts: [], postablePaymentDrafts: [], netByAccount: {}, saleCount: 0, paymentCount: 2, postableSales: 0, postablePayments: 0, reviewCount: 0, reviewItems: [] });
    listDailyMock.mockResolvedValue({ realmId: REALM, postings: [] });

    const b = await getDayBreakdown(7476, DATE);
    expect(b.summary.paymentsTotalCents).toBe(1400); // 1000 + 400 (all payments)
    expect(b.summary.feesTotalCents).toBe(30);
    expect(b.summary.depositToUndepositedCents).toBe(970); // 1000 − 30 fee (deposit route only)
    expect(b.summary.nonCashCents).toBe(400); // non-cash contra — excluded from Undeposited
  });
});
