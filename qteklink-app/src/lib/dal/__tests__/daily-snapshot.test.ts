/**
 * Unit tests for getDailySnapshot — the day-grain §3a status→column precedence (a
 * constituent of the live POSTED category JE → Posted; a staged constituent → its
 * version's column), the source-gross fallback for blocked rows, the derived
 * Payment-Fee row (the FEES category's status, falling back to the parent payment),
 * and benign-suppressed exclusion. DB seams + rollup/gate mocked; the real
 * buildDailyStatusIndex is kept (it's part of the unit).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { statusToColumn } from "../daily-snapshot";

const reduceMock = vi.fn();
const reconcileMock = vi.fn();
const buildDayDraftsMock = vi.fn();
const listDailyMock = vi.fn();
const rollupDayMock = vi.fn();

// getDailySnapshot refreshes the payment projection FIRST (freshness contract) and
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
vi.mock("@/lib/dal/daily-postings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../daily-postings")>()),
  listDailyPostingsForDay: (...a: unknown[]) => listDailyMock(...a),
}));
vi.mock("@/lib/reconcile/daily-rollup", () => ({ rollupDay: (...a: unknown[]) => rollupDayMock(...a) }));
vi.mock("@/lib/dal/review-items", () => ({
  listOpenReviewItems: vi.fn().mockResolvedValue({ realmId: "9341455608740708", items: [] }),
}));
vi.mock("@/lib/dal/payment-redates", () => ({
  listOpenPaymentRedatesForDay: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/reconcile/payment-gate", () => ({
  // benign-suppressed (voided/zero) → no review item; everything else → postable, no items.
  gatePaymentDraft: (je: { suppressed?: boolean }) => ({ postable: !je.suppressed, reviewItems: [] }),
}));

import { getDailySnapshot } from "../daily-snapshot";

const REALM = "9341455608740708";
const DATE = "2026-06-06";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sale = (ro: number, totalSales: number, debit: number): any => ({
  snapshot: { repairOrderId: ro, totalSales },
  je: { lines: [{ accountId: "120", postingType: "Debit", amountCents: debit, description: "" }] },
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pay = (id: string, ro: number, gross: number, fee: number, suppressed = false): any => ({
  input: { paymentId: id, signedAmountCents: gross, signedProcessingFeeCents: fee },
  je: { paymentId: id, repairOrderId: ro, suppressed, lines: [] },
});

/** A qteklink_daily_postings row (DailyPostingRow shape) for the ledger mock. */
function dayRow(
  category: "sales" | "payments" | "fees",
  status: string,
  constituents: { roIds?: number[]; paymentIds?: string[] },
  over: Partial<Record<string, unknown>> = {},
) {
  return {
    id: `dp-${category}-${status}`, businessDate: DATE, category, postingVersion: 1, action: "create",
    status, docNumber: null, txnDate: DATE, lines: [], totalCents: null,
    constituents: { roIds: constituents.roIds ?? [], paymentIds: constituents.paymentIds ?? [] },
    sourceStateHash: "h", requestid: "q", qboJeId: status === "posted" ? "QBO-1" : null,
    qboSyncToken: null, approvedBy: null, approvedAt: null, createdAt: "2026-06-06T01:00:00Z",
    ...over,
  };
}

describe("statusToColumn (§3a exhaustive)", () => {
  it("maps every posting status to its column", () => {
    expect(statusToColumn("pending")).toBe("unapproved");
    expect(statusToColumn("approved")).toBe("inProgress");
    expect(statusToColumn("posting")).toBe("inProgress");
    expect(statusToColumn("posted")).toBe("posted");
    expect(statusToColumn("failed")).toBe("needsAttention");
    expect(statusToColumn("rejected")).toBe("needsAttention");
    expect(statusToColumn("needs_resolution")).toBe("needsAttention");
    expect(statusToColumn("something_new")).toBe("needsAttention"); // fail-safe
  });
});

describe("getDailySnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reduceMock.mockResolvedValue({ realmId: REALM, events: 0, payments: 0 });
    reconcileMock.mockResolvedValue({ realmId: REALM });
  });

  it("returns an empty snapshot when the shop has no connection", async () => {
    reduceMock.mockResolvedValue({ realmId: null, events: 0, payments: 0 });
    const snap = await getDailySnapshot(7476, DATE);
    expect(snap.realmId).toBeNull();
    expect(snap.rows.map((r) => r.type)).toEqual(["Repair Order", "Customer Payment", "Payment Fee"]);
    expect(snap.rows.every((r) => r.totalCents === 0 && r.count === 0)).toBe(true);
    expect(buildDayDraftsMock).not.toHaveBeenCalled();
  });

  it("refreshes the payment-state projection BEFORE building the day (the freshness contract)", async () => {
    reduceMock.mockResolvedValue({ realmId: null, events: 0, payments: 0 });
    await getDailySnapshot(7476, DATE);
    expect(reduceMock).toHaveBeenCalledWith(7476);
    expect(reconcileMock).not.toHaveBeenCalled(); // no connection → nothing to reconcile
  });

  it("LIVE-reconciles the viewed day — but NEVER a fully-acknowledged day (AL history is terminal)", async () => {
    const empty = { postableSaleDrafts: [], postablePaymentDrafts: [], saleCount: 0, paymentCount: 0, postableSales: 0, postablePayments: 0, reviewCount: 0, reviewItems: [] };
    buildDayDraftsMock.mockResolvedValue({ sales: [], payments: [], extraReviewItems: [], gateSettings: {} });
    rollupDayMock.mockReturnValue(empty);

    listDailyMock.mockResolvedValue({ realmId: REALM, postings: [dayRow("sales", "pending", { roIds: [1] })] });
    await getDailySnapshot(7476, DATE);
    expect(reconcileMock).toHaveBeenCalledWith(7476, DATE);

    reconcileMock.mockClear();
    listDailyMock.mockResolvedValue({ realmId: REALM, postings: [dayRow("sales", "acknowledged", { roIds: [1] })] });
    await getDailySnapshot(7476, DATE);
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("applies the day-grain §3a precedence: posted-JE constituent→Posted; staged→its column; postable→Unapproved; blocked→Needs attention(source gross); derives the Fee row from the FEES category", async () => {
    const s1 = sale(1, 1000, 1000); // in the POSTED sales JE → Posted
    const s2 = sale(2, 900, 900); //   postable, not in any daily row → Unapproved (draft debit)
    const s3 = sale(3, 500, 500); //   NOT postable → Needs attention (totalSales)
    const p1 = pay("101", 1, 1200, 35); // in the APPROVED payments JE → In progress; fee 35
    const p2 = pay("102", 2, 500, 0); //  postable, not staged → Unapproved; no fee
    const p3 = pay("103", 3, 0, 0, true); // benign void → excluded entirely

    buildDayDraftsMock.mockResolvedValue({
      tz: "America/New_York", gateSettings: { salesTaxRateBps: 600 },
      sales: [s1, s2, s3], payments: [p1, p2, p3], extraReviewItems: [],
    });
    rollupDayMock.mockReturnValue({
      postableSaleDrafts: [s1, s2], postablePaymentDrafts: [p1.je, p2.je],
      saleCount: 3, paymentCount: 2, postableSales: 2, postablePayments: 2, reviewCount: 1, reviewItems: [],
    });
    listDailyMock.mockResolvedValue({
      realmId: REALM,
      postings: [
        dayRow("sales", "posted", { roIds: [1] }),
        dayRow("payments", "approved", { paymentIds: ["101"] }),
        dayRow("fees", "approved", { paymentIds: ["101"] }),
      ],
    });

    const snap = await getDailySnapshot(7476, DATE);
    const [ro, payRow, fee] = snap.rows;

    // Repair Order
    expect(ro).toMatchObject({ count: 3, postedCents: 1000, unapprovedCents: 900, needsAttentionCents: 500, inProgressCents: 0, totalCents: 2400 });
    // Customer Payment (p3 excluded)
    expect(payRow).toMatchObject({ count: 2, inProgressCents: 1200, unapprovedCents: 500, needsAttentionCents: 0, totalCents: 1700 });
    // Payment Fee — only p1 has a fee; the FEES category row drives its column
    expect(fee).toMatchObject({ count: 1, inProgressCents: 35, unapprovedCents: 0, totalCents: 35 });

    expect(snap.kpis).toEqual({ salesCents: 2400, paymentsCents: 1700, ccFeesCents: 35 });
    // (the day-lock count moved to snap.attention.blockingCount — the per-row
    // needsAttentionCents assertions above cover the blocked-RO money behavior)
  });

  it("a posted day with a STAGED correction: posted constituents stay Posted; new ones show the staged column", async () => {
    const s1 = sale(1, 1000, 1000); // in the posted v1 JE → Posted (it IS in QBO)
    const s2 = sale(2, 900, 900); //   only in the staged pending v2 → Unapproved
    buildDayDraftsMock.mockResolvedValue({ tz: "America/New_York", gateSettings: { salesTaxRateBps: 600 }, sales: [s1, s2], payments: [], extraReviewItems: [] });
    rollupDayMock.mockReturnValue({ postableSaleDrafts: [s1, s2], postablePaymentDrafts: [], saleCount: 2, paymentCount: 0, postableSales: 2, postablePayments: 0, reviewCount: 0, reviewItems: [] });
    listDailyMock.mockResolvedValue({
      realmId: REALM,
      postings: [
        dayRow("sales", "posted", { roIds: [1] }),
        dayRow("sales", "pending", { roIds: [1, 2] }, { postingVersion: 2, action: "update" }),
      ],
    });
    const snap = await getDailySnapshot(7476, DATE);
    expect(snap.rows[0]).toMatchObject({ count: 2, postedCents: 1000, unapprovedCents: 900, needsAttentionCents: 0 });
  });

  it("a REFUND subtracts from the Customer Payment total / paymentsCents KPI (signed, never abs-added)", async () => {
    // A real payment + a separate refund on the SAME day (mirrors live payment 60216784 = -1062
    // on 2026-06-15). Both postable, no daily-postings rows → both land in the Unapproved column.
    const p1 = pay("201", 5, 10000, 0); // +$100.00 payment
    const p2 = pay("202", 5, -1062, 0); // −$10.62 refund (signed negative)

    buildDayDraftsMock.mockResolvedValue({ tz: "America/New_York", gateSettings: {}, sales: [], payments: [p1, p2], extraReviewItems: [] });
    rollupDayMock.mockReturnValue({ postableSaleDrafts: [], postablePaymentDrafts: [p1.je, p2.je], saleCount: 0, paymentCount: 2, postableSales: 0, postablePayments: 2, reviewCount: 0, reviewItems: [] });
    listDailyMock.mockResolvedValue({ realmId: REALM, postings: [] });

    const snap = await getDailySnapshot(7476, DATE);
    const payRow = snap.rows[1];
    // 10000 + (−1062) = 8938 — the refund NETS DOWN, it does not add (the bug gave 11062).
    expect(payRow).toMatchObject({ count: 2, unapprovedCents: 8938, totalCents: 8938 });
    expect(snap.kpis.paymentsCents).toBe(8938);
  });

  it("a same-day full refund of a same-day payment nets the Customer Payment total to zero", async () => {
    const p1 = pay("301", 6, 2513, 0); // +$25.13 payment
    const p2 = pay("302", 6, -2513, 0); // −$25.13 full refund

    buildDayDraftsMock.mockResolvedValue({ tz: "America/New_York", gateSettings: {}, sales: [], payments: [p1, p2], extraReviewItems: [] });
    rollupDayMock.mockReturnValue({ postableSaleDrafts: [], postablePaymentDrafts: [p1.je, p2.je], saleCount: 0, paymentCount: 2, postableSales: 0, postablePayments: 2, reviewCount: 0, reviewItems: [] });
    listDailyMock.mockResolvedValue({ realmId: REALM, postings: [] });

    const snap = await getDailySnapshot(7476, DATE);
    expect(snap.rows[1]).toMatchObject({ count: 2, totalCents: 0 });
    expect(snap.kpis.paymentsCents).toBe(0);
  });
});
