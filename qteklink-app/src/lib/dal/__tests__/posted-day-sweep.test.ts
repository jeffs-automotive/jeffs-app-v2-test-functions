/**
 * Unit tests for the posted-day correction sweep — the AUTO-POST rule (only categories
 * with a posted prior; first-time days stay human-gated), the office-manager change
 * email (RO#/what changed/JE title), describeCorrection's diff text, and per-day error
 * isolation. All DB/QBO/notify seams mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fromResults: unknown[][] = [];
const listDailyMock = vi.fn();
const approveDailyMock = vi.fn();
const postDailyMock = vi.fn();
const reconcileMock = vi.fn();
const detectMock = vi.fn();
const notifyMovesMock = vi.fn();
const sendMock = vi.fn();
const settingsMock = vi.fn();
const realmMock = vi.fn();

function chainResolving(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit", "gte"]) q[m] = vi.fn(() => q);
  (q as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve);
  return q;
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: vi.fn(() => chainResolving(fromResults.shift() ?? [])) }),
}));
vi.mock("@/lib/dal/realm", () => ({ resolveRealmForShop: (...a: unknown[]) => realmMock(...a) }));
vi.mock("@/lib/dal/settings", () => ({ getShopSettings: (...a: unknown[]) => settingsMock(...a) }));
vi.mock("@/lib/dal/daily-reconcile", () => ({ runDailyReconciliation: (...a: unknown[]) => reconcileMock(...a) }));
vi.mock("@/lib/dal/daily-poster", () => ({ postDailyPostingById: (...a: unknown[]) => postDailyMock(...a) }));
vi.mock("@/lib/dal/date-moves", () => ({
  detectDateMoves: (...a: unknown[]) => detectMock(...a),
  notifyDateMoves: (...a: unknown[]) => notifyMovesMock(...a),
}));
vi.mock("@/lib/dal/notify", () => ({ sendQteklinkEmail: (...a: unknown[]) => sendMock(...a) }));
vi.mock("@/lib/dal/daily-postings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../daily-postings")>()),
  listDailyPostingsForDay: (...a: unknown[]) => listDailyMock(...a),
  approveDailyPosting: (...a: unknown[]) => approveDailyMock(...a),
}));

import { applyDayCorrections, sweepPostedDays, describeCorrection } from "../posted-day-sweep";
import type { DailyPostingRow } from "../daily-postings";

const REALM = "9341455608740708";
const DATE = "2026-06-08";

function row(over: Partial<DailyPostingRow>): DailyPostingRow {
  return {
    id: "dp-x", businessDate: DATE, category: "sales", postingVersion: 1, action: "create",
    status: "pending", docNumber: `QTL-RO-${DATE}`, txnDate: DATE, lines: [], totalCents: 100000,
    constituents: { roIds: [], paymentIds: [] }, sourceStateHash: "h", requestid: "q",
    qboJeId: null, qboSyncToken: null, approvedBy: null, createdAt: "2026-06-09T01:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fromResults.length = 0;
  realmMock.mockResolvedValue(REALM);
  settingsMock.mockResolvedValue({
    realmId: REALM,
    settings: { dayCorrectionAlertEmails: ["om@shop.com"], dateChangeAlertEmails: [], shopTimezone: "America/New_York" },
  });
  approveDailyMock.mockResolvedValue({ approved: true });
  postDailyMock.mockResolvedValue({ status: "posted", postingId: "dp-x", qboJeId: "QBO-9", action: "update" });
  reconcileMock.mockResolvedValue({ realmId: REALM });
  detectMock.mockResolvedValue({ scannedRos: 0, newOrChangedMoves: [], autoResolved: 0 });
});

describe("describeCorrection", () => {
  it("names the JE, the added/removed ROs and the old → new totals", () => {
    const prior = row({ status: "posted", postingVersion: 1, totalCents: 100000, constituents: { roIds: [101, 102], paymentIds: [] } });
    const next = row({ status: "pending", postingVersion: 2, action: "update", totalCents: 80000, constituents: { roIds: [101, 103], paymentIds: [] } });
    const { subject, text } = describeCorrection(prior, next);
    expect(subject).toContain("Day Correction Alert");
    expect(subject).toContain(`QTL-RO-${DATE}`);
    expect(text).toContain("Journal entry: QTL-RO-2026-06-08");
    expect(text).toContain("New total:     $800.00 (was $1,000.00)");
    expect(text).toContain("Added repair orders: 103");
    expect(text).toContain("Removed repair orders: 102");
  });

  it("a DELETE correction says the entry was deleted", () => {
    const prior = row({ status: "posted", totalCents: 5000, constituents: { roIds: [], paymentIds: ["1"] }, category: "fees" });
    const next = row({ status: "pending", postingVersion: 2, action: "delete", totalCents: null, constituents: { roIds: [], paymentIds: [] }, category: "fees" });
    expect(describeCorrection(prior, next).text).toContain("DELETED");
  });
});

describe("applyDayCorrections", () => {
  it("auto-approves + posts a staged correction and emails the office manager the diff", async () => {
    listDailyMock.mockResolvedValue({
      realmId: REALM,
      postings: [
        row({ id: "v1", status: "posted", postingVersion: 1, totalCents: 100000, constituents: { roIds: [101, 102], paymentIds: [] }, qboJeId: "QBO-1" }),
        row({ id: "v2", status: "pending", postingVersion: 2, action: "update", totalCents: 80000, constituents: { roIds: [101], paymentIds: [] } }),
      ],
    });
    const r = await applyDayCorrections(7476, DATE);
    expect(r).toEqual({ businessDate: DATE, correctionsPosted: 1, correctionsFailed: 0 });
    expect(approveDailyMock).toHaveBeenCalledWith(7476, "v2", "system (auto-correction)");
    expect(postDailyMock).toHaveBeenCalledWith(7476, "v2", expect.anything());
    expect(sendMock).toHaveBeenCalledTimes(1);
    const email = sendMock.mock.calls[0]![0] as { to: string[]; subject: string; text: string };
    expect(email.to).toEqual(["om@shop.com"]);
    expect(email.text).toContain("Removed repair orders: 102");
  });

  it("a FIRST-TIME (never posted) category is NOT auto-posted — human approval only", async () => {
    listDailyMock.mockResolvedValue({
      realmId: REALM,
      postings: [row({ id: "v1", status: "pending", postingVersion: 1, action: "create" })],
    });
    const r = await applyDayCorrections(7476, DATE);
    expect(r.correctionsPosted).toBe(0);
    expect(approveDailyMock).not.toHaveBeenCalled();
    expect(postDailyMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("a poster failure is counted + isolated (no email, sweep continues)", async () => {
    listDailyMock.mockResolvedValue({
      realmId: REALM,
      postings: [
        row({ id: "v1", status: "posted", postingVersion: 1, qboJeId: "QBO-1" }),
        row({ id: "v2", status: "pending", postingVersion: 2, action: "update" }),
      ],
    });
    postDailyMock.mockResolvedValue({ status: "failed", postingId: "v2", reason: "qbo_error" });
    const r = await applyDayCorrections(7476, DATE);
    expect(r).toEqual({ businessDate: DATE, correctionsPosted: 0, correctionsFailed: 1 });
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("sweepPostedDays", () => {
  it("detects + notifies moves FIRST, then re-reconciles each posted day and applies corrections", async () => {
    detectMock.mockResolvedValue({
      scannedRos: 3,
      newOrChangedMoves: [{ id: "mv-1" }],
      autoResolved: 1,
    });
    fromResults.push([{ business_date: "2026-06-08" }, { business_date: "2026-06-09" }, { business_date: "2026-06-08" }]); // listPostedDays
    listDailyMock.mockResolvedValue({ realmId: REALM, postings: [] }); // no staged corrections
    const r = await sweepPostedDays(7476);
    expect(detectMock).toHaveBeenCalledWith(7476, REALM, "America/New_York");
    expect(notifyMovesMock).toHaveBeenCalledWith(7476, [{ id: "mv-1" }]);
    expect(reconcileMock).toHaveBeenCalledWith(7476, "2026-06-08");
    expect(reconcileMock).toHaveBeenCalledWith(7476, "2026-06-09");
    expect(r).toMatchObject({ postedDays: 2, movesDetected: 1, movesAutoResolved: 1 });
  });

  it("one day throwing never stops the rest", async () => {
    fromResults.push([{ business_date: "2026-06-08" }, { business_date: "2026-06-09" }]);
    reconcileMock.mockImplementation((_s: number, d: string) =>
      d === "2026-06-08" ? Promise.reject(new Error("boom")) : Promise.resolve({ realmId: REALM }));
    listDailyMock.mockResolvedValue({ realmId: REALM, postings: [] });
    const r = await sweepPostedDays(7476);
    expect(r.days).toEqual([
      { businessDate: "2026-06-08", correctionsPosted: 0, correctionsFailed: 1 },
      { businessDate: "2026-06-09", correctionsPosted: 0, correctionsFailed: 0 },
    ]);
  });

  it("no connection → an empty sweep", async () => {
    realmMock.mockResolvedValue(null);
    expect(await sweepPostedDays(7476)).toEqual({ postedDays: 0, movesDetected: 0, movesAutoResolved: 0, days: [] });
  });
});
