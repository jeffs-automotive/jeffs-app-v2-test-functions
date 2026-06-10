/**
 * Unit tests for the bulk approve+post DAL at the DAY-CATEGORY grain (daily-JE rework
 * step 4): the scope is the ≤3 category JEs (sales / payments / fees) — create when no
 * live JE, update when the posted content moved, delete when the category emptied;
 * posted-unchanged and in-flight categories are excluded. The scope_hash binds to each
 * category's desired source hash; execute re-derives and rejects on change, then per
 * category: enqueue (diff) → approve → post, partial-failure tolerant, with the
 * poster's stale-release surfaced as `stale`.
 *
 * The DB seams (drafts, ledger reads, enqueue/approve, poster) are mocked; the PURE
 * pieces (buildDailyJournalEntries, dailySourceState, sourceStateHash) are real so
 * plan/execute hashes agree with production.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveRealmMock = vi.fn();
const buildDayDraftsMock = vi.fn();
const rollupDayMock = vi.fn();
const listDailyMock = vi.fn();
const enqueueDailyMock = vi.fn();
const approveDailyMock = vi.fn();
const postDailyMock = vi.fn();

vi.mock("@/lib/dal/realm", () => ({ resolveRealmForShop: (...a: unknown[]) => resolveRealmMock(...a) }));
vi.mock("@/lib/dal/day-drafts", () => ({ buildDayDrafts: (...a: unknown[]) => buildDayDraftsMock(...a) }));
vi.mock("@/lib/reconcile/daily-rollup", () => ({ rollupDay: (...a: unknown[]) => rollupDayMock(...a) }));
vi.mock("@/lib/dal/daily-poster", () => ({ postDailyPostingById: (...a: unknown[]) => postDailyMock(...a) }));
vi.mock("@/lib/dal/daily-postings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../daily-postings")>()),
  listDailyPostingsForDay: (...a: unknown[]) => listDailyMock(...a),
  enqueueDailyPosting: (...a: unknown[]) => enqueueDailyMock(...a),
  approveDailyPosting: (...a: unknown[]) => approveDailyMock(...a),
}));

import { planApproveDay, executeApproveDay } from "../approve-post-day";
import { dailySourceState } from "../daily-postings";
import { sourceStateHash } from "../postings";
import { buildDailyJournalEntries } from "@/lib/daily/daily-je-builder";

const REALM = "9341455608740708";
const DATE = "2026-06-06";

// Minimal BALANCED drafts (the daily builder is real, so line sums must balance).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sale = (ro: number, cents: number): any => ({
  snapshot: { repairOrderId: ro },
  je: {
    lines: [
      { accountId: "235", postingType: "Debit", amountCents: cents, description: `RO ${ro}` },
      { accountId: "275", postingType: "Credit", amountCents: cents, description: "income" },
    ],
    docNumber: `RO ${ro}`, txnDate: DATE,
  },
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cardPay = (id: string, gross: number, fee: number): any => ({
  paymentId: id, repairOrderId: 1, docNumber: `PAY ${id}`, txnDate: DATE, suppressed: false,
  lines: [
    { accountId: "366", postingType: "Debit", amountCents: gross, description: `PAY ${id}`, part: "gross" },
    { accountId: "235", postingType: "Credit", amountCents: gross, description: `PAY ${id}`, part: "gross" },
    ...(fee > 0
      ? [
          { accountId: "309", postingType: "Debit", amountCents: fee, description: "CC fee", part: "fee" },
          { accountId: "366", postingType: "Credit", amountCents: fee, description: "CC fee", part: "fee" },
        ]
      : []),
  ],
});

const SALES = [sale(1, 1000)];
const PAYMENTS = [cardPay("501", 500, 50)];
const BUNDLE = buildDailyJournalEntries(DATE, SALES, PAYMENTS);
const SALES_HASH = sourceStateHash(dailySourceState("sales", DATE, BUNDLE.sales));

function wire({ postings = [] as unknown[], payments = PAYMENTS } = {}) {
  resolveRealmMock.mockResolvedValue(REALM);
  buildDayDraftsMock.mockResolvedValue({ sales: SALES, payments: payments.map((je) => ({ input: {}, je })), gateSettings: {} });
  rollupDayMock.mockReturnValue({ postableSaleDrafts: SALES, postablePaymentDrafts: payments });
  listDailyMock.mockResolvedValue({ realmId: REALM, postings });
  enqueueDailyMock.mockImplementation((_s: number, _r: string, _d: string, category: string) =>
    Promise.resolve({ enqueueAction: "new", action: "create", postingId: `dp-${category}`, postingVersion: 1 }));
  approveDailyMock.mockResolvedValue({ approved: true });
  postDailyMock.mockImplementation((_s: number, id: string) =>
    Promise.resolve({ status: "posted", postingId: id, qboJeId: `QBO-${id}`, action: "create" }));
}

/** A DailyPostingRow-shaped ledger row. */
function row(category: "sales" | "payments" | "fees", over: Partial<Record<string, unknown>> = {}) {
  return {
    id: `dp-${category}`, businessDate: DATE, category, postingVersion: 1, action: "create",
    status: "pending", docNumber: null, txnDate: DATE, lines: [], totalCents: null,
    constituents: { roIds: [], paymentIds: [] }, sourceStateHash: "h-old", requestid: "q",
    qboJeId: null, qboSyncToken: null, approvedBy: null, createdAt: "2026-06-06T01:00:00Z",
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("planApproveDay (dry run)", () => {
  it("returns an empty plan when the shop has no connection", async () => {
    resolveRealmMock.mockResolvedValue(null);
    const p = await planApproveDay(7476, DATE, "day");
    expect(p).toEqual({ realmId: null, scopeHash: "", summary: { perCategory: [], totalCents: 0, jeCount: 0 } });
  });

  it("a fresh day scopes ≤3 category CREATEs with constituent counts + a stable hash; NO writes", async () => {
    wire();
    const p = await planApproveDay(7476, DATE, "day");
    expect(p.summary.jeCount).toBe(3);
    expect(p.summary.perCategory).toEqual([
      { category: "sales", action: "create", cents: 1000, constituents: 1 },
      { category: "payments", action: "create", cents: 500, constituents: 1 },
      { category: "fees", action: "create", cents: 50, constituents: 1 },
    ]);
    expect(p.summary.totalCents).toBe(1550);
    expect(p.scopeHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await planApproveDay(7476, DATE, "day")).scopeHash).toBe(p.scopeHash); // deterministic
    expect(enqueueDailyMock).not.toHaveBeenCalled();
    expect(approveDailyMock).not.toHaveBeenCalled();
    expect(postDailyMock).not.toHaveBeenCalled();
  });

  it("scope narrows: 'sale' → the sales JE; 'payment' → payments + fees", async () => {
    wire();
    expect((await planApproveDay(7476, DATE, "sale")).summary.perCategory.map((c) => c.category)).toEqual(["sales"]);
    expect((await planApproveDay(7476, DATE, "payment")).summary.perCategory.map((c) => c.category)).toEqual(["payments", "fees"]);
  });

  it("excludes a posted-unchanged category and an in-flight one", async () => {
    wire({ postings: [
      row("sales", { status: "posted", sourceStateHash: SALES_HASH, qboJeId: "QBO-1" }),
      row("payments", { status: "posting" }),
    ] });
    const p = await planApproveDay(7476, DATE, "day");
    expect(p.summary.perCategory.map((c) => c.category)).toEqual(["fees"]);
  });

  it("a posted category whose content moved scopes an UPDATE; an emptied one a DELETE", async () => {
    const noFeePayments = [cardPay("501", 500, 0)];
    expect(buildDailyJournalEntries(DATE, SALES, noFeePayments).fees).toBeNull();
    wire({
      payments: noFeePayments,
      postings: [
        row("sales", { status: "posted", sourceStateHash: "h-old", qboJeId: "QBO-1" }),
        row("fees", { status: "posted", sourceStateHash: "h-old-fee", qboJeId: "QBO-3" }),
      ],
    });
    const p = await planApproveDay(7476, DATE, "day");
    expect(p.summary.perCategory).toEqual([
      { category: "sales", action: "update", cents: 1000, constituents: 1 },
      { category: "payments", action: "create", cents: 500, constituents: 1 },
      { category: "fees", action: "delete", cents: 0, constituents: 0 },
    ]);
  });
});

describe("executeApproveDay", () => {
  it("rejects when the scope hash no longer matches (the day moved since review)", async () => {
    wire();
    const r = await executeApproveDay(7476, DATE, "day", "STALE-HASH", "chris@x.com");
    expect(r).toMatchObject({ ok: false, reason: "scope_changed", posted: 0 });
    expect(enqueueDailyMock).not.toHaveBeenCalled();
    expect(postDailyMock).not.toHaveBeenCalled();
  });

  it("happy path: enqueue → approve → post each category (3 daily JEs)", async () => {
    wire();
    const { scopeHash } = await planApproveDay(7476, DATE, "day");
    const r = await executeApproveDay(7476, DATE, "day", scopeHash, "chris@x.com");
    expect(r).toMatchObject({ ok: true, posted: 3, failed: 0, skipped: 0, stale: 0 });
    expect(enqueueDailyMock).toHaveBeenCalledTimes(3);
    expect(approveDailyMock).toHaveBeenCalledTimes(3);
    for (const c of ["sales", "payments", "fees"]) {
      expect(postDailyMock).toHaveBeenCalledWith(7476, `dp-${c}`, expect.anything(), expect.anything());
    }
  });

  it("an already-APPROVED category posts directly (no re-approve, no re-enqueue)", async () => {
    wire({ postings: [row("sales", { status: "approved", sourceStateHash: SALES_HASH })] });
    const { scopeHash } = await planApproveDay(7476, DATE, "day");
    const r = await executeApproveDay(7476, DATE, "day", scopeHash, "chris@x.com");
    expect(r.posted).toBe(3);
    expect(enqueueDailyMock).toHaveBeenCalledTimes(2); // payments + fees only
    expect(approveDailyMock).toHaveBeenCalledTimes(2);
    expect(postDailyMock).toHaveBeenCalledWith(7476, "dp-sales", expect.anything(), expect.anything());
  });

  it("surfaces the poster's stale-release as `stale` (re-approval required)", async () => {
    wire();
    postDailyMock.mockImplementation((_s: number, id: string) =>
      Promise.resolve(id === "dp-payments"
        ? { status: "stale_refreshed", postingId: id }
        : { status: "posted", postingId: id, qboJeId: `QBO-${id}`, action: "create" }));
    const { scopeHash } = await planApproveDay(7476, DATE, "day");
    const r = await executeApproveDay(7476, DATE, "day", scopeHash, "chris@x.com");
    expect(r).toMatchObject({ posted: 2, stale: 1, failed: 0 });
  });

  it("a per-category failure never aborts the others (partial-failure tolerant)", async () => {
    wire();
    postDailyMock.mockImplementation((_s: number, id: string) =>
      id === "dp-sales" ? Promise.reject(new Error("boom")) : Promise.resolve({ status: "posted", postingId: id, qboJeId: "Q", action: "create" }));
    const { scopeHash } = await planApproveDay(7476, DATE, "day");
    const r = await executeApproveDay(7476, DATE, "day", scopeHash, "chris@x.com");
    expect(r).toMatchObject({ ok: true, posted: 2, failed: 1 });
  });

  it("an enqueue that reports blocked/skip/withdrawn is counted skipped, never posted", async () => {
    wire();
    enqueueDailyMock.mockImplementation((_s: number, _r: string, _d: string, category: string) =>
      Promise.resolve(category === "fees"
        ? { enqueueAction: "skip", action: null, postingId: null, postingVersion: 1 }
        : { enqueueAction: "new", action: "create", postingId: `dp-${category}`, postingVersion: 1 }));
    const { scopeHash } = await planApproveDay(7476, DATE, "day");
    const r = await executeApproveDay(7476, DATE, "day", scopeHash, "chris@x.com");
    expect(r).toMatchObject({ posted: 2, skipped: 1 });
    expect(postDailyMock).not.toHaveBeenCalledWith(7476, "dp-fees", expect.anything());
  });
});
