/**
 * Unit tests for the posted-day correction sweep — the AUTO-POST rule (only categories
 * with a posted prior; first-time days stay human-gated), the office-manager change
 * email (RO#/what changed/JE title), describeCorrection's diff text, per-day error
 * isolation, and `applyDateMoveDecision` (the date-move approve/unapprove orchestration
 * that moved out of the action: find → flip → re-reconcile + correct both days). All
 * DB/QBO/notify seams mocked.
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
const listMovesMock = vi.fn();
const approveMoveMock = vi.fn();
const unapproveMoveMock = vi.fn();

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
  listDateMoves: (...a: unknown[]) => listMovesMock(...a),
  approveDateMove: (...a: unknown[]) => approveMoveMock(...a),
  unapproveDateMove: (...a: unknown[]) => unapproveMoveMock(...a),
}));
vi.mock("@/lib/dal/notify", () => ({ sendQteklinkEmail: (...a: unknown[]) => sendMock(...a) }));
vi.mock("@/lib/dal/daily-postings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../daily-postings")>()),
  listDailyPostingsForDay: (...a: unknown[]) => listDailyMock(...a),
  approveDailyPosting: (...a: unknown[]) => approveDailyMock(...a),
}));

import { applyDayCorrections, sweepPostedDays, classifyChange, describeDayCorrections, applyDateMoveDecision } from "../posted-day-sweep";
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
  approveMoveMock.mockResolvedValue({ approved: true });
  unapproveMoveMock.mockResolvedValue({ unapproved: true });
});

describe("classifyChange", () => {
  it("membership: added + removed repair orders", () => {
    const prior = row({ status: "posted", constituents: { roIds: [101, 102], paymentIds: [] } });
    const next = row({ status: "pending", action: "update", constituents: { roIds: [101, 103], paymentIds: [] } });
    expect(classifyChange(prior, next)).toEqual({ changeKind: "membership", added: ["103"], removed: ["102"] });
  });

  it("descriptions-only: same constituents + total + account/amount lines, only the descriptions differ", () => {
    const L = (description: string) => [{ accountId: "366", postingType: "Debit" as const, amountCents: 1000, description }];
    const prior = row({ status: "posted", category: "payments", totalCents: 1000, constituents: { roIds: [], paymentIds: ["1"] }, lines: L("PAY 1 — RO 2") });
    const next = row({ status: "pending", action: "update", category: "payments", totalCents: 1000, constituents: { roIds: [], paymentIds: ["1"] }, lines: L("Check · RO 2 · Carmax") });
    expect(classifyChange(prior, next).changeKind).toBe("descriptions-only");
  });

  it("amounts: same constituents but the total/lines moved", () => {
    const prior = row({ status: "posted", totalCents: 1000, constituents: { roIds: [101], paymentIds: [] }, lines: [{ accountId: "120", postingType: "Debit", amountCents: 1000, description: "x" }] });
    const next = row({ status: "pending", action: "update", totalCents: 1200, constituents: { roIds: [101], paymentIds: [] }, lines: [{ accountId: "120", postingType: "Debit", amountCents: 1200, description: "x" }] });
    expect(classifyChange(prior, next).changeKind).toBe("amounts");
  });

  it("deleted: the correction removed the JE", () => {
    const prior = row({ status: "posted", category: "fees", constituents: { roIds: [], paymentIds: ["1"] } });
    const next = row({ status: "pending", action: "delete", category: "fees" });
    expect(classifyChange(prior, next).changeKind).toBe("deleted");
  });
});

describe("describeDayCorrections", () => {
  it("ONE email lists all categories, highlights changes, and words a descriptions-only change correctly", () => {
    const { subject, text } = describeDayCorrections(DATE, [
      { category: "sales", changed: true, changeKind: "membership", docNumber: `QTL-RO-${DATE}`, priorTotalCents: 100000, nextTotalCents: 80000, added: ["103"], removed: ["102"], sameDayChurn: false },
      { category: "payments", changed: true, changeKind: "descriptions-only", docNumber: `QTL-PAY-${DATE}`, priorTotalCents: 125000, nextTotalCents: 125000, added: [], removed: [], sameDayChurn: false },
      { category: "fees", changed: false, changeKind: "no-change", docNumber: `QTL-FEE-${DATE}`, priorTotalCents: 4500, nextTotalCents: 4500, added: [], removed: [], sameDayChurn: false },
    ]);
    expect(subject).toContain("Day Correction Alert");
    expect(subject).toContain(DATE);
    expect(text).toContain("Sales — CHANGED");
    expect(text).toContain("New total: $800.00 (was $1,000.00)");
    expect(text).toContain("Added repair orders: 103");
    expect(text).toContain("Removed repair orders: 102");
    expect(text).toContain("Payments — CHANGED");
    // the bug fix: a wording-only change must NOT be reported as an amounts/totals change.
    expect(text).toContain("Wording only: the line descriptions were updated. The payments and the total ($1,250.00) are unchanged.");
    expect(text).not.toContain("different totals");
    expect(text).toContain("Card fees — no change");
  });

  it("a DELETE correction says the entry was deleted", () => {
    const { text } = describeDayCorrections(DATE, [
      { category: "fees", changed: true, changeKind: "deleted", docNumber: `QTL-FEE-${DATE}`, priorTotalCents: 5000, nextTotalCents: null, added: [], removed: [], sameDayChurn: false },
    ]);
    expect(text).toContain("DELETED");
  });
});

describe("applyDayCorrections", () => {
  it("a change made on a LATER day: auto-approves + posts the correction and sends the Day Correction Alert", async () => {
    listDailyMock.mockResolvedValue({
      realmId: REALM,
      postings: [
        row({ id: "v1", status: "posted", postingVersion: 1, totalCents: 100000, constituents: { roIds: [101, 102], paymentIds: [] }, qboJeId: "QBO-1" }),
        row({ id: "v2", status: "pending", postingVersion: 2, action: "update", totalCents: 80000, constituents: { roIds: [101], paymentIds: [] } }),
      ],
    });
    // newest RO event: June 11 — days AFTER the June 8 business day → email.
    fromResults.push([{ tekmetric_event_at: "2026-06-11T14:00:00Z", received_at: "2026-06-11T14:00:01Z" }]);
    const r = await applyDayCorrections(7476, DATE);
    expect(r).toEqual({ businessDate: DATE, correctionsPosted: 1, correctionsFailed: 0 });
    expect(approveDailyMock).toHaveBeenCalledWith(7476, "v2", "system (auto-correction)");
    expect(postDailyMock).toHaveBeenCalledWith(7476, "v2", expect.anything());
    expect(sendMock).toHaveBeenCalledTimes(1);
    const email = sendMock.mock.calls[0]![0] as { to: string[]; subject: string; text: string };
    expect(email.to).toEqual(["om@shop.com"]);
    expect(email.text).toContain("Removed repair orders: 102");
  });

  it("SAME-DAY Tekmetric churn (Chris's rule): the correction still posts but NO email goes out", async () => {
    listDailyMock.mockResolvedValue({
      realmId: REALM,
      postings: [
        row({ id: "v1", status: "posted", postingVersion: 1, totalCents: 100000, constituents: { roIds: [101], paymentIds: [] }, qboJeId: "QBO-1" }),
        row({ id: "v2", status: "pending", postingVersion: 2, action: "update", totalCents: 110000, constituents: { roIds: [101], paymentIds: [] } }),
      ],
    });
    // newest RO event: 21:00 UTC June 8 = 5 PM America/New_York on June 8 — the SAME
    // shop-local day as the business date → same-day fix, post silently.
    fromResults.push([{ tekmetric_event_at: "2026-06-08T21:00:00Z", received_at: "2026-06-08T21:00:01Z" }]);
    const r = await applyDayCorrections(7476, DATE);
    expect(r).toEqual({ businessDate: DATE, correctionsPosted: 1, correctionsFailed: 0 });
    expect(postDailyMock).toHaveBeenCalledWith(7476, "v2", expect.anything());
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("event lookup finds nothing → fails OPEN (the alert still goes out)", async () => {
    listDailyMock.mockResolvedValue({
      realmId: REALM,
      postings: [
        row({ id: "v1", status: "posted", postingVersion: 1, qboJeId: "QBO-1", constituents: { roIds: [101], paymentIds: [] } }),
        row({ id: "v2", status: "pending", postingVersion: 2, action: "update", constituents: { roIds: [101], paymentIds: [] } }),
      ],
    });
    // no fromResults pushed → the events query returns [] → can't prove same-day → email.
    await applyDayCorrections(7476, DATE);
    expect(sendMock).toHaveBeenCalledTimes(1);
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

  it("consolidates a multi-category day into ONE email listing all three JE entries", async () => {
    listDailyMock.mockResolvedValue({
      realmId: REALM,
      postings: [
        // sales: a membership change (RO 102 removed)
        row({ id: "s1", category: "sales", status: "posted", postingVersion: 1, totalCents: 100000, constituents: { roIds: [101, 102], paymentIds: [] }, qboJeId: "QBO-1" }),
        row({ id: "s2", category: "sales", status: "pending", postingVersion: 2, action: "update", totalCents: 80000, constituents: { roIds: [101], paymentIds: [] } }),
        // payments: descriptions-only (same payment + total + account/amount; only the line text changed)
        row({ id: "p1", category: "payments", status: "posted", postingVersion: 1, docNumber: `QTL-PAY-${DATE}`, totalCents: 125000, constituents: { roIds: [], paymentIds: ["1"] }, lines: [{ accountId: "366", postingType: "Debit", amountCents: 125000, description: "PAY 1 — RO 2" }], qboJeId: "QBO-2" }),
        row({ id: "p2", category: "payments", status: "pending", postingVersion: 2, action: "update", docNumber: `QTL-PAY-${DATE}`, totalCents: 125000, constituents: { roIds: [], paymentIds: ["1"] }, lines: [{ accountId: "366", postingType: "Debit", amountCents: 125000, description: "Check · RO 2 · Carmax" }] }),
        // fees: a posted entry with NO staged correction → unchanged context
        row({ id: "f1", category: "fees", status: "posted", postingVersion: 1, docNumber: `QTL-FEE-${DATE}`, totalCents: 4500, constituents: { roIds: [], paymentIds: ["1"] }, qboJeId: "QBO-3" }),
      ],
    });
    fromResults.push([{ tekmetric_event_at: "2026-06-11T14:00:00Z", received_at: "2026-06-11T14:00:01Z" }]); // sales: later day → not churn
    const r = await applyDayCorrections(7476, DATE);
    expect(r).toEqual({ businessDate: DATE, correctionsPosted: 2, correctionsFailed: 0 });
    expect(sendMock).toHaveBeenCalledTimes(1); // ONE email for the whole day, not one per category
    const email = sendMock.mock.calls[0]![0] as { subject: string; text: string };
    expect(email.text).toContain("Removed repair orders: 102"); // sales
    expect(email.text).toContain("Wording only: the line descriptions were updated."); // payments
    expect(email.text).toContain("Card fees — no change"); // fees context
  });

  it("sends the day alert when a non-churn change accompanies a same-day sales churn (whole-day suppression only when ALL churn)", async () => {
    listDailyMock.mockResolvedValue({
      realmId: REALM,
      postings: [
        row({ id: "s1", category: "sales", status: "posted", postingVersion: 1, totalCents: 100000, constituents: { roIds: [101], paymentIds: [] }, qboJeId: "QBO-1" }),
        row({ id: "s2", category: "sales", status: "pending", postingVersion: 2, action: "update", totalCents: 110000, constituents: { roIds: [101], paymentIds: [] } }),
        row({ id: "p1", category: "payments", status: "posted", postingVersion: 1, docNumber: `QTL-PAY-${DATE}`, totalCents: 5000, constituents: { roIds: [], paymentIds: ["1"] }, lines: [{ accountId: "366", postingType: "Debit", amountCents: 5000, description: "a" }], qboJeId: "QBO-2" }),
        row({ id: "p2", category: "payments", status: "pending", postingVersion: 2, action: "update", docNumber: `QTL-PAY-${DATE}`, totalCents: 6000, constituents: { roIds: [], paymentIds: ["1"] }, lines: [{ accountId: "366", postingType: "Debit", amountCents: 6000, description: "a" }] }),
      ],
    });
    fromResults.push([{ tekmetric_event_at: "2026-06-08T21:00:00Z", received_at: "2026-06-08T21:00:01Z" }]); // sales: SAME shop-local day → churn
    const r = await applyDayCorrections(7476, DATE);
    expect(r.correctionsPosted).toBe(2);
    expect(sendMock).toHaveBeenCalledTimes(1); // payments change forces ONE day email listing both
    const email = sendMock.mock.calls[0]![0] as { text: string };
    expect(email.text).toContain("Sales — CHANGED");
    expect(email.text).toContain("Payments — CHANGED");
  });

  it("a day with posted entries but NO staged corrections sends no email", async () => {
    listDailyMock.mockResolvedValue({
      realmId: REALM,
      postings: [
        row({ id: "s1", category: "sales", status: "posted", postingVersion: 1, qboJeId: "QBO-1", constituents: { roIds: [101], paymentIds: [] } }),
        row({ id: "f1", category: "fees", status: "posted", postingVersion: 1, qboJeId: "QBO-3", constituents: { roIds: [], paymentIds: ["1"] } }),
      ],
    });
    const r = await applyDayCorrections(7476, DATE);
    expect(r).toEqual({ businessDate: DATE, correctionsPosted: 0, correctionsFailed: 0 });
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

describe("applyDateMoveDecision", () => {
  const MOVE = {
    id: "mv-1", tekmetricRoId: 101, roNumber: "101",
    originalBusinessDate: "2026-06-05", newBusinessDate: "2026-06-08",
    originalTotalCents: null, newTotalCents: 10600, status: "pending" as const,
    detectedAt: "x", approvedBy: null, approvedAt: null, resolvedAt: null,
  };

  beforeEach(() => {
    // applyDayCorrections runs for real over both days → keep it a no-op (no postings).
    listDailyMock.mockResolvedValue({ realmId: REALM, postings: [] });
  });

  it("approve: flips a PENDING move, then re-reconciles + corrects BOTH days (original then new, in order)", async () => {
    listMovesMock.mockResolvedValue({ open: [MOVE] });
    const r = await applyDateMoveDecision(7476, "mv-1", "approve", "chris@x.com");
    expect(r).toEqual({ ok: true });
    expect(approveMoveMock).toHaveBeenCalledWith(7476, "mv-1", "chris@x.com");
    expect(unapproveMoveMock).not.toHaveBeenCalled();
    expect(reconcileMock).toHaveBeenCalledTimes(2);
    expect(reconcileMock.mock.calls.map((c) => c[1])).toEqual(["2026-06-05", "2026-06-08"]); // original → new
  });

  it("unapprove: requires an APPROVED move, then flips both days back", async () => {
    listMovesMock.mockResolvedValue({ open: [{ ...MOVE, status: "approved" }] });
    const r = await applyDateMoveDecision(7476, "mv-1", "unapprove", "chris@x.com");
    expect(r).toEqual({ ok: true });
    expect(unapproveMoveMock).toHaveBeenCalledWith(7476, "mv-1", "chris@x.com");
    expect(approveMoveMock).not.toHaveBeenCalled();
    expect(reconcileMock).toHaveBeenCalledTimes(2);
  });

  it("not_found: the move isn't in the required state → no flip, no reconcile", async () => {
    // approve needs pending; this move is already approved → not found for approve.
    listMovesMock.mockResolvedValue({ open: [{ ...MOVE, status: "approved" }] });
    const r = await applyDateMoveDecision(7476, "mv-1", "approve", "chris@x.com");
    expect(r).toEqual({ ok: false, reason: "not_found" });
    expect(approveMoveMock).not.toHaveBeenCalled();
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("not_found: the RPC reports it didn't flip (concurrent change) → treated as not_found", async () => {
    listMovesMock.mockResolvedValue({ open: [MOVE] });
    approveMoveMock.mockResolvedValue({ approved: false });
    const r = await applyDateMoveDecision(7476, "mv-1", "approve", "chris@x.com");
    expect(r).toEqual({ ok: false, reason: "not_found" });
    expect(reconcileMock).not.toHaveBeenCalled(); // never applied the days
  });
});
