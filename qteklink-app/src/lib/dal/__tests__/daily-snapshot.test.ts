/**
 * Unit tests for getDailySnapshot — the §3a status→column precedence (persisted posting
 * WINS over the live draft), the source-gross fallback for blocked rows, the derived
 * Payment-Fee row (follows the parent payment's column), and benign-suppressed exclusion.
 * The DB seams + the pure rollup/gate are mocked; the merge logic is the unit under test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { statusToColumn } from "../daily-snapshot";

const resolveRealmMock = vi.fn();
const buildDayDraftsMock = vi.fn();
const listPostingsForDayMock = vi.fn();
const rollupDayMock = vi.fn();

vi.mock("@/lib/dal/realm", () => ({ resolveRealmForShop: (...a: unknown[]) => resolveRealmMock(...a) }));
vi.mock("@/lib/dal/day-drafts", () => ({ buildDayDrafts: (...a: unknown[]) => buildDayDraftsMock(...a) }));
vi.mock("@/lib/dal/postings", () => ({ listPostingsForDay: (...a: unknown[]) => listPostingsForDayMock(...a) }));
vi.mock("@/lib/reconcile/daily-rollup", () => ({ rollupDay: (...a: unknown[]) => rollupDayMock(...a) }));
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
    resolveRealmMock.mockResolvedValue(REALM);
  });

  it("returns an empty snapshot when the shop has no connection", async () => {
    resolveRealmMock.mockResolvedValue(null);
    const snap = await getDailySnapshot(7476, DATE);
    expect(snap.realmId).toBeNull();
    expect(snap.rows.map((r) => r.type)).toEqual(["Repair Order", "Customer Payment", "Payment Fee"]);
    expect(snap.rows.every((r) => r.totalCents === 0 && r.count === 0)).toBe(true);
    expect(buildDayDraftsMock).not.toHaveBeenCalled();
  });

  it("applies §3a precedence: persisted posting wins; postable→Unapproved; blocked→Needs attention(source gross); derives the Fee row", async () => {
    const s1 = sale(1, 1000, 1000); // posted (persisted) → Posted, $ from the posting
    const s2 = sale(2, 900, 900); //   postable, no posting → Unapproved (draft debit)
    const s3 = sale(3, 500, 500); //   NOT postable, no posting → Needs attention (totalSales)
    const p1 = pay("101", 1, 1200, 35); // posting=approved → In progress; fee 35
    const p2 = pay("102", 2, 500, 0); //  postable, no posting → Unapproved; no fee
    const p3 = pay("103", 3, 0, 0, true); // benign void → excluded entirely

    buildDayDraftsMock.mockResolvedValue({
      tz: "America/New_York", gateSettings: { salesTaxRateBps: 600 },
      sales: [s1, s2, s3], payments: [p1, p2, p3], extraReviewItems: [],
    });
    rollupDayMock.mockReturnValue({
      postableSaleDrafts: [s1, s2], postablePaymentDrafts: [p1.je, p2.je],
      saleCount: 3, paymentCount: 2, postableSales: 2, postablePayments: 2, reviewCount: 1, netByAccount: {}, reviewItems: [],
    });
    listPostingsForDayMock.mockResolvedValue({
      realmId: REALM,
      postings: [
        { id: "a", kind: "sale", tekmetricRoId: 1, paymentId: null, status: "posted", postingVersion: 1, totalCents: 1000 },
        { id: "b", kind: "payment", tekmetricRoId: 1, paymentId: 101, status: "approved", postingVersion: 1, totalCents: 1200 },
      ],
    });

    const snap = await getDailySnapshot(7476, DATE);
    const [ro, payRow, fee] = snap.rows;

    // Repair Order
    expect(ro).toMatchObject({ count: 3, postedCents: 1000, unapprovedCents: 900, needsAttentionCents: 500, inProgressCents: 0, totalCents: 2400 });
    // Customer Payment (p3 excluded)
    expect(payRow).toMatchObject({ count: 2, inProgressCents: 1200, unapprovedCents: 500, needsAttentionCents: 0, totalCents: 1700 });
    // Payment Fee — only p1 has a fee; it follows p1's column (In progress)
    expect(fee).toMatchObject({ count: 1, inProgressCents: 35, unapprovedCents: 0, totalCents: 35 });

    expect(snap.kpis).toEqual({ salesCents: 2400, paymentsCents: 1700, ccFeesCents: 35 });
    expect(snap.needsAttentionCount).toBe(1); // RO 3 only
  });

  it("a higher posting version wins over an older one for the same subject", async () => {
    const s1 = sale(1, 1000, 1000);
    buildDayDraftsMock.mockResolvedValue({ tz: "America/New_York", gateSettings: { salesTaxRateBps: 600 }, sales: [s1], payments: [], extraReviewItems: [] });
    rollupDayMock.mockReturnValue({ postableSaleDrafts: [s1], postablePaymentDrafts: [], saleCount: 1, paymentCount: 0, postableSales: 1, postablePayments: 0, reviewCount: 0, netByAccount: {}, reviewItems: [] });
    listPostingsForDayMock.mockResolvedValue({
      realmId: REALM,
      postings: [
        { id: "v1", kind: "sale", tekmetricRoId: 1, paymentId: null, status: "rejected", postingVersion: 1, totalCents: 1000 },
        { id: "v2", kind: "sale", tekmetricRoId: 1, paymentId: null, status: "posted", postingVersion: 2, totalCents: 1000 },
      ],
    });
    const snap = await getDailySnapshot(7476, DATE);
    expect(snap.rows[0]).toMatchObject({ count: 1, postedCents: 1000, needsAttentionCents: 0 }); // v2 (posted) wins, not v1 (rejected)
  });
});
