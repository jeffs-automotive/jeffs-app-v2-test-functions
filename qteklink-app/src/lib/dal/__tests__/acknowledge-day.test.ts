/**
 * Unit tests for the daily-reconcile orchestrations that moved out of the actions
 * (audit 2026-06-12, thin-action): `acknowledgeDay` (reconcile → orphaned-QBO refusal →
 * acknowledge the pending rows) and the pure `isDayTerminal` predicate behind the
 * live-on-view preamble. The real `runDailyReconciliation` runs but with all its
 * collaborators stubbed cheaply; the daily-postings read/ack seams are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const realmMock = vi.fn();
const listDailyMock = vi.fn();
const acknowledgeDailyMock = vi.fn();
const enqueueDailyMock = vi.fn();
const buildDayDraftsMock = vi.fn();
const rollupDayMock = vi.fn();
const buildBundleMock = vi.fn();

// runDailyReconciliation is in the module UNDER TEST, so we can't mock it directly —
// instead we stub its collaborators so it returns cheaply (realm from resolveRealmForShop;
// an empty day). The daily-postings read/ack/enqueue seams ARE mocked.
vi.mock("@/lib/dal/realm", () => ({ resolveRealmForShop: (...a: unknown[]) => realmMock(...a) }));
vi.mock("@/lib/dal/day-drafts", () => ({ buildDayDrafts: (...a: unknown[]) => buildDayDraftsMock(...a) }));
vi.mock("@/lib/dal/review-items", () => ({ upsertReviewItem: vi.fn() }));
vi.mock("@/lib/reconcile/daily-rollup", () => ({ rollupDay: (...a: unknown[]) => rollupDayMock(...a) }));
vi.mock("@/lib/daily/daily-je-builder", () => ({
  buildDailyJournalEntries: (...a: unknown[]) => buildBundleMock(...a),
  DAILY_LINE_CAP: 1000,
}));
vi.mock("@/lib/dal/daily-postings", () => ({
  enqueueDailyPosting: (...a: unknown[]) => enqueueDailyMock(...a),
  listDailyPostingsForDay: (...a: unknown[]) => listDailyMock(...a),
  acknowledgeDailyPosting: (...a: unknown[]) => acknowledgeDailyMock(...a),
}));

import { acknowledgeDay, isDayTerminal } from "../daily-reconcile";
import type { DailyPostingRow } from "../daily-postings";

const REALM = "9341455608740708";
const DATE = "2026-06-08";

function row(over: Partial<DailyPostingRow>): DailyPostingRow {
  return {
    id: "dp-x", businessDate: DATE, category: "sales", postingVersion: 1, action: "create",
    status: "pending", docNumber: null, txnDate: DATE, lines: [], totalCents: null,
    constituents: { roIds: [], paymentIds: [] }, sourceStateHash: "h", requestid: "q",
    qboJeId: null, qboSyncToken: null, approvedBy: null, createdAt: "2026-06-09T01:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  realmMock.mockResolvedValue(REALM);
  // An empty day → runDailyReconciliation enqueues nothing but returns realmId: REALM.
  buildDayDraftsMock.mockResolvedValue({ sales: [], payments: [], extraReviewItems: [], gateSettings: {} });
  rollupDayMock.mockReturnValue({
    saleCount: 0, paymentCount: 0, postableSales: 0, postablePayments: 0, reviewCount: 0,
    reviewItems: [], postableSaleDrafts: [], postablePaymentDrafts: [],
  });
  buildBundleMock.mockReturnValue({ sales: null, payments: null, fees: null });
  enqueueDailyMock.mockResolvedValue({ enqueueAction: "noop", action: null, postingId: null, postingVersion: null });
  acknowledgeDailyMock.mockResolvedValue({ acknowledged: true });
});

describe("acknowledgeDay", () => {
  it("happy path: reconciles, then acknowledges every PENDING row (count returned)", async () => {
    listDailyMock.mockResolvedValue({
      realmId: REALM,
      postings: [
        row({ id: "s", category: "sales", status: "pending" }),
        row({ id: "p", category: "payments", status: "pending" }),
        row({ id: "f", category: "fees", status: "rejected" }), // not pending → skipped
      ],
    });
    const r = await acknowledgeDay(7476, DATE, "chris@x.com");
    expect(r).toEqual({ ok: true, acknowledged: 2 });
    expect(acknowledgeDailyMock).toHaveBeenCalledTimes(2);
    expect(acknowledgeDailyMock).toHaveBeenCalledWith(7476, "s", "chris@x.com");
    expect(acknowledgeDailyMock).toHaveBeenCalledWith(7476, "p", "chris@x.com");
  });

  it("refuses (already_posted) when ANY row is posted / posting / approved", async () => {
    for (const status of ["posted", "posting", "approved"]) {
      acknowledgeDailyMock.mockClear();
      listDailyMock.mockResolvedValue({
        realmId: REALM,
        postings: [row({ id: "a", status: "pending" }), row({ id: "b", category: "payments", status })],
      });
      const r = await acknowledgeDay(7476, DATE, "chris@x.com");
      expect(r).toEqual({ ok: false, reason: "already_posted" });
      expect(acknowledgeDailyMock).not.toHaveBeenCalled(); // never touch a posted day
    }
  });

  it("returns reconnect_required when QuickBooks isn't connected", async () => {
    realmMock.mockResolvedValue(null); // runDailyReconciliation returns realmId: null
    const r = await acknowledgeDay(7476, DATE, "chris@x.com");
    expect(r).toEqual({ ok: false, reason: "reconnect_required" });
    expect(listDailyMock).not.toHaveBeenCalled();
  });
});

describe("isDayTerminal", () => {
  it("empty → false (nothing staged is not 'done')", () => {
    expect(isDayTerminal([])).toBe(false);
  });
  it("a pending mix → false (the day still has live work)", () => {
    expect(isDayTerminal([row({ status: "acknowledged" }), row({ status: "pending" })])).toBe(false);
  });
  it("all acknowledged → true", () => {
    expect(isDayTerminal([row({ status: "acknowledged" }), row({ status: "acknowledged" })])).toBe(true);
  });
  it("acknowledged + rejected → true (both are terminal)", () => {
    expect(isDayTerminal([row({ status: "acknowledged" }), row({ status: "rejected" })])).toBe(true);
  });
});
