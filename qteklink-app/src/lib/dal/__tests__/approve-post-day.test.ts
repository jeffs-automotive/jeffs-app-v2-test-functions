/**
 * Unit tests for the bulk approve+post DAL (plan §6): the scope set (excludes posted/
 * in-flight), the scope_hash binding, the scope-changed rejection, and the
 * enqueue→approve→scoped-post loop with partial-failure tolerance. The QBO write (poster)
 * + DB seams are mocked; the real sourceStateHash is kept so plan/execute hashes agree.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveRealmMock = vi.fn();
const buildDayDraftsMock = vi.fn();
const rollupDayMock = vi.fn();
const listPostingsForDayMock = vi.fn();
const enqueueMock = vi.fn();
const approveMock = vi.fn();
const postByIdMock = vi.fn();

vi.mock("@/lib/dal/realm", () => ({ resolveRealmForShop: (...a: unknown[]) => resolveRealmMock(...a) }));
vi.mock("@/lib/dal/day-drafts", () => ({ buildDayDrafts: (...a: unknown[]) => buildDayDraftsMock(...a) }));
vi.mock("@/lib/reconcile/daily-rollup", () => ({ rollupDay: (...a: unknown[]) => rollupDayMock(...a) }));
vi.mock("@/lib/dal/poster", () => ({ postApprovedPostingById: (...a: unknown[]) => postByIdMock(...a) }));
vi.mock("@/lib/dal/postings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../postings")>()),
  listPostingsForDay: (...a: unknown[]) => listPostingsForDayMock(...a),
  enqueuePostingForDraft: (...a: unknown[]) => enqueueMock(...a),
  approvePosting: (...a: unknown[]) => approveMock(...a),
}));

import { planApproveDay, executeApproveDay } from "../approve-post-day";

const REALM = "9341455608740708";
const DATE = "2026-06-06";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sale = (ro: number, debit: number): any => ({ snapshot: { repairOrderId: ro }, je: { lines: [{ accountId: "120", postingType: "Debit", amountCents: debit, description: "" }], docNumber: `RO ${ro}`, txnDate: DATE } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const payJe = (id: string, ro: number, debit: number): any => ({ paymentId: id, repairOrderId: ro, docNumber: `PAY ${id}`, txnDate: DATE, lines: [{ accountId: "366", postingType: "Debit", amountCents: debit, description: "" }], suppressed: false });

function wireDay() {
  const s1 = sale(1, 1000); // postable, no posting → draft
  const s2 = sale(2, 800); //  postable, but POSTED → excluded from scope
  const p1 = payJe("101", 1, 1200); // postable, a PENDING posting → in scope
  buildDayDraftsMock.mockResolvedValue({ tz: "America/New_York", gateSettings: { salesTaxRateBps: 600 }, sales: [s1, s2], payments: [{ input: {}, je: p1 }], extraReviewItems: [] });
  rollupDayMock.mockReturnValue({ postableSaleDrafts: [s1, s2], postablePaymentDrafts: [p1], netByAccount: {}, reviewItems: [], saleCount: 2, paymentCount: 1, postableSales: 2, postablePayments: 1, reviewCount: 0 });
  listPostingsForDayMock.mockResolvedValue({
    realmId: REALM,
    postings: [
      { id: "posted-s2", kind: "sale", tekmetricRoId: 2, paymentId: null, status: "posted", postingVersion: 1, totalCents: 800, lines: [], sourceStateHash: null },
      { id: "pending-p1", kind: "payment", tekmetricRoId: 1, paymentId: 101, status: "pending", postingVersion: 1, totalCents: 1200, lines: [], sourceStateHash: null },
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveRealmMock.mockResolvedValue(REALM);
  enqueueMock.mockResolvedValue({ action: "new", postingId: "new-s1", postingVersion: 1 });
  approveMock.mockResolvedValue({ approved: true });
  postByIdMock.mockResolvedValue({ status: "posted", postingId: "x", qboJeId: "je1" });
  wireDay();
});

describe("planApproveDay (dry run)", () => {
  it("computes the in-scope set (excludes the posted RO) + a per-type summary + a hash", async () => {
    const plan = await planApproveDay(7476, DATE, "day");
    expect(plan.realmId).toBe(REALM);
    expect(plan.summary.jeCount).toBe(2); // RO1 (draft) + payment 101 (pending); RO2 posted is excluded
    expect(plan.summary.perType).toEqual([
      { type: "sale", count: 1, cents: 1000 },
      { type: "payment", count: 1, cents: 1200 },
    ]);
    expect(plan.summary.totalCents).toBe(2200);
    expect(plan.scopeHash).toMatch(/^[0-9a-f]{64}$/);
    // dry run does NOT write
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(approveMock).not.toHaveBeenCalled();
    expect(postByIdMock).not.toHaveBeenCalled();
  });

  it("scope='sale' includes only the RO; 'payment' only the payment", async () => {
    expect((await planApproveDay(7476, DATE, "sale")).summary.jeCount).toBe(1);
    expect((await planApproveDay(7476, DATE, "payment")).summary.jeCount).toBe(1);
  });
});

describe("executeApproveDay", () => {
  it("rejects when the scope_hash no longer matches (the day changed)", async () => {
    const res = await executeApproveDay(7476, DATE, "day", "STALE-HASH", "chris@x.com");
    expect(res).toMatchObject({ ok: false, reason: "scope_changed", posted: 0 });
    expect(postByIdMock).not.toHaveBeenCalled();
  });

  it("enqueues the draft, approves both, scoped-posts each on a matching hash", async () => {
    const { scopeHash } = await planApproveDay(7476, DATE, "day");
    const res = await executeApproveDay(7476, DATE, "day", scopeHash, "chris@x.com");
    expect(res).toMatchObject({ ok: true, posted: 2, failed: 0 });
    expect(enqueueMock).toHaveBeenCalledTimes(1); // only the draft RO1 is enqueued
    expect(approveMock).toHaveBeenCalledWith(7476, "new-s1", "chris@x.com");
    expect(approveMock).toHaveBeenCalledWith(7476, "pending-p1", "chris@x.com");
    expect(postByIdMock).toHaveBeenCalledWith(7476, "new-s1", expect.anything());
    expect(postByIdMock).toHaveBeenCalledWith(7476, "pending-p1", expect.anything());
  });

  it("is partial-failure tolerant — one failed post doesn't abort the batch", async () => {
    postByIdMock.mockResolvedValueOnce({ status: "failed", postingId: "new-s1", reason: "qbo_error" });
    const { scopeHash } = await planApproveDay(7476, DATE, "day");
    const res = await executeApproveDay(7476, DATE, "day", scopeHash, "chris@x.com");
    expect(res).toMatchObject({ ok: true, posted: 1, failed: 1 });
  });
});
