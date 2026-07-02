/**
 * Unit tests for the failed-posting resolution flows (resolution-workflow Part B) —
 * the two exits from a FAILED daily posting: RETRY ("I unlinked the deposit") and
 * ACCEPT ("Keep QuickBooks as-is"), Pattern S guarded. Replays the 2026-06-29 shape:
 * payments v1 posted (20), v2 failed deposit-locked (22 = +2 late Carmax checks).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();
const listDailyMock = vi.fn();
const retryMock = vi.fn();
const acceptMock = vi.fn();
const postByIdMock = vi.fn();
const buildDayDraftsMock = vi.fn();
const rollupDayMock = vi.fn();
const bundleMock = vi.fn();
const listOpenItemsMock = vi.fn();
const autoResolveMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: rpcMock, from: fromMock }) }));
vi.mock("@/lib/dal/realm", () => ({ resolveRealmForShop: vi.fn().mockResolvedValue("realm-A") }));
vi.mock("@/lib/dal/day-drafts", () => ({ buildDayDrafts: (...a: unknown[]) => buildDayDraftsMock(...a) }));
vi.mock("@/lib/reconcile/daily-rollup", () => ({ rollupDay: (...a: unknown[]) => rollupDayMock(...a) }));
vi.mock("@/lib/daily/daily-je-builder", () => ({
  buildDailyJournalEntries: (...a: unknown[]) => bundleMock(...a),
  DAILY_LINE_CAP: 1000,
}));
vi.mock("@/lib/dal/daily-poster", () => ({ postDailyPostingById: (...a: unknown[]) => postByIdMock(...a) }));
vi.mock("@/lib/dal/review-items", () => ({
  listOpenReviewItems: (...a: unknown[]) => listOpenItemsMock(...a),
  autoResolveReviewItems: (...a: unknown[]) => autoResolveMock(...a),
}));
vi.mock("@/lib/dal/daily-postings", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/dal/daily-postings")>();
  return {
    ...real,
    listDailyPostingsForDay: (...a: unknown[]) => listDailyMock(...a),
    retryDailyPosting: (...a: unknown[]) => retryMock(...a),
    acceptDailyVariance: (...a: unknown[]) => acceptMock(...a),
  };
});

import { planFailedPostingResolution, executeFailedPostingResolution } from "../failed-posting-resolution";
import { sourceStateHash } from "@/lib/dal/postings";
import { dailySourceState } from "@/lib/dal/daily-postings";
import type { DailyPostingRow } from "@/lib/dal/daily-postings";

const DATE = "2026-06-29";
const V1_IDS = Array.from({ length: 20 }, (_, i) => `p${i + 1}`);
const V2_IDS = [...V1_IDS, "61299633", "61299634"];

function row(over: Partial<DailyPostingRow>): DailyPostingRow {
  return {
    id: "v2", businessDate: DATE, category: "payments", postingVersion: 2, action: "update",
    status: "failed", docNumber: "QTL-PAY-2026-06-29", txnDate: DATE,
    lines: [], totalCents: 1295872,
    constituents: { roIds: [], paymentIds: V2_IDS }, sourceStateHash: "H2", requestid: "q2",
    qboJeId: null, qboSyncToken: null, approvedBy: "system (auto-correction)", approvedAt: null, createdAt: "2026-06-30T10:28:00Z",
    ...over,
  };
}
const V1 = row({ id: "v1", postingVersion: 1, action: "create", status: "posted", sourceStateHash: "H1", constituents: { roIds: [], paymentIds: V1_IDS }, qboJeId: "26455", totalCents: 1220162 });
const V2 = row({});

/** The desired bundle whose category hash will be computed by the plan. */
function desiredBundle(je: unknown) {
  bundleMock.mockReturnValue({ sales: null, payments: je, fees: null });
}
/** A desired JE whose dailySourceState hash EQUALS the given row's stored hash. */
function makeDesiredMatching(target: DailyPostingRow): unknown {
  // The plan hashes dailySourceState(category, date, je) — craft a je and store ITS
  // hash on the row so they match exactly.
  const je = { docNumber: target.docNumber, txnDate: target.txnDate, constituents: { roIds: [], paymentIds: target.constituents.paymentIds }, lines: [] };
  target.sourceStateHash = sourceStateHash(dailySourceState("payments", DATE, je as never));
  return je;
}

function headRow() {
  return { business_date: DATE, category: "payments" };
}
function thenable(data: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "gte", "lt", "order", "is", "limit"]) chain[m] = vi.fn(() => chain);
  chain.then = (onF: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(onF);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  fromMock.mockImplementation(() => thenable([headRow()]));
  listDailyMock.mockResolvedValue({ realmId: "realm-A", postings: [V1, V2] });
  buildDayDraftsMock.mockResolvedValue({ sales: [], payments: [], heldRedatePayments: [], extraReviewItems: [], gateSettings: {} });
  rollupDayMock.mockReturnValue({ postableSaleDrafts: [], postablePaymentDrafts: [], reviewItems: [] });
  retryMock.mockResolvedValue({ retried: true });
  acceptMock.mockResolvedValue({ accepted: true });
  listOpenItemsMock.mockResolvedValue({ realmId: "realm-A", items: [
    { id: "ri-1", kind: "qbo_deposit_locked", subjectKind: "day", subjectRef: `${DATE}:payments`, detail: {}, status: "open", createdAt: "" },
    { id: "ri-2", kind: "unmapped", subjectKind: "ro", subjectRef: "1", detail: {}, status: "open", createdAt: "" },
  ] });
  autoResolveMock.mockResolvedValue({ resolved: 1 });
});

describe("planFailedPostingResolution", () => {
  it("mode 'ready' when the desired hash still matches the failed row; variance = the 2 late payments", async () => {
    desiredBundle(makeDesiredMatching(V2));
    const plan = await planFailedPostingResolution(7476, "v2");
    expect(plan).toMatchObject({ ok: true, mode: "ready", category: "payments", businessDate: DATE });
    if (plan.ok) {
      expect(plan.variance?.changeKind).toBe("membership");
      expect(plan.variance?.added).toEqual(["61299633", "61299634"]);
      expect(plan.scopeHash).toBeTruthy();
    }
  });

  it("mode 'stale' when the day's desired state moved on", async () => {
    V2.sourceStateHash = "H2";
    desiredBundle({ docNumber: "QTL-PAY-2026-06-29", txnDate: DATE, constituents: { roIds: [], paymentIds: ["different"] }, lines: [] });
    const plan = await planFailedPostingResolution(7476, "v2");
    expect(plan).toMatchObject({ ok: true, mode: "stale" });
  });

  it("refuses a non-failed row and a superseded (non-latest) failed row", async () => {
    listDailyMock.mockResolvedValue({ realmId: "realm-A", postings: [V1, row({ status: "posted", qboJeId: "x" })] });
    expect(await planFailedPostingResolution(7476, "v2")).toMatchObject({ ok: false, reason: "not_failed" });

    listDailyMock.mockResolvedValue({ realmId: "realm-A", postings: [V1, V2, row({ id: "v3", postingVersion: 3, status: "pending" })] });
    expect(await planFailedPostingResolution(7476, "v2")).toMatchObject({ ok: false, reason: "superseded" });
  });

  it("not_found when the id isn't in the ledger", async () => {
    fromMock.mockImplementation(() => thenable([]));
    expect(await planFailedPostingResolution(7476, "nope")).toMatchObject({ ok: false, reason: "not_found" });
  });
});

describe("executeFailedPostingResolution", () => {
  it("rejects a mismatched scope hash (the row changed since review)", async () => {
    const r = await executeFailedPostingResolution(7476, "v2", "retry", "wrong-hash", "chris@jeffsautomotive.com");
    expect(r).toMatchObject({ ok: false, reason: "scope_changed" });
    expect(retryMock).not.toHaveBeenCalled();
  });

  it("ACCEPT: flips failed→accepted and closes ONLY the paired poster review items", async () => {
    desiredBundle(makeDesiredMatching(V2));
    const plan = await planFailedPostingResolution(7476, "v2");
    const r = await executeFailedPostingResolution(7476, "v2", "accept", plan.ok ? plan.scopeHash : "", "chris@jeffsautomotive.com");
    expect(r).toMatchObject({ ok: true, outcome: "accepted", resolvedReviewItems: 1 });
    expect(acceptMock).toHaveBeenCalledWith(7476, "v2", "chris@jeffsautomotive.com");
    // only ri-1 (the day-scoped poster item) — never the unrelated unmapped item
    expect(autoResolveMock).toHaveBeenCalledWith(7476, "realm-A", ["ri-1"], "system (chris@jeffsautomotive.com)", { action: "variance_accepted" });
    expect(postByIdMock).not.toHaveBeenCalled();
  });

  it("RETRY: failed→approved→post; on 'posted' closes the paired items", async () => {
    desiredBundle(makeDesiredMatching(V2));
    postByIdMock.mockResolvedValue({ status: "posted", postingId: "v2", qboJeId: "26999", action: "update" });
    const plan = await planFailedPostingResolution(7476, "v2");
    const r = await executeFailedPostingResolution(7476, "v2", "retry", plan.ok ? plan.scopeHash : "", "chris@jeffsautomotive.com");
    expect(r).toMatchObject({ ok: true, outcome: "posted", resolvedReviewItems: 1 });
    expect(retryMock).toHaveBeenCalledWith(7476, "v2", "chris@jeffsautomotive.com");
    expect(postByIdMock).toHaveBeenCalledWith(7476, "v2");
    expect(autoResolveMock).toHaveBeenCalledWith(7476, "realm-A", ["ri-1"], "system (chris@jeffsautomotive.com)", { action: "retried", qboJeId: "26999" });
  });

  it("RETRY that fails again (still deposit-locked) reports post_failed and closes NOTHING", async () => {
    desiredBundle(makeDesiredMatching(V2));
    postByIdMock.mockResolvedValue({ status: "failed", postingId: "v2" });
    const plan = await planFailedPostingResolution(7476, "v2");
    const r = await executeFailedPostingResolution(7476, "v2", "retry", plan.ok ? plan.scopeHash : "", "chris@jeffsautomotive.com");
    expect(r).toMatchObject({ ok: false, reason: "post_failed" });
    expect(autoResolveMock).not.toHaveBeenCalled();
  });
});
