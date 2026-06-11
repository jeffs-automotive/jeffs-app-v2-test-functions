/**
 * Unit tests for the daily-postings DAL — the desired-vs-posted diff at the
 * (shop, realm, business_date, category) grain. Supabase admin mocked (rpc routed by
 * name; `from` returns queued row-sets per call). The diff matrix under test is the
 * plan §3 table: create/update/delete decisions, pending-refresh, frozen in-flight
 * rows, posted-unchanged skip, terminal-state re-enqueue only on change, the
 * empty-day withdrawal, and the unbalanced/over-cap block.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromResults: unknown[][] = [];

function chainResolving(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "in", "is", "gte", "lt"]) {
    q[m] = vi.fn(() => q);
  }
  (q as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve);
  return q;
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: rpcMock,
    from: vi.fn(() => chainResolving(fromResults.shift() ?? [])),
  }),
}));

import {
  enqueueDailyPosting,
  dailySourceState,
  dailyRequestIdFor,
  dailyPrivateNoteMarker,
} from "../daily-postings";
import { sourceStateHash } from "../postings";
import type { DailyJournalEntry } from "@/lib/daily/daily-je-builder";

const REALM = "9341455608740708";
const DATE = "2026-06-05";

function salesJe(over: Partial<DailyJournalEntry> = {}): DailyJournalEntry {
  return {
    category: "sales",
    docNumber: `QTL-RO-${DATE}`,
    txnDate: DATE,
    lines: [
      { accountId: "235", postingType: "Debit", amountCents: 10600, description: "RO 152001" },
      { accountId: "275", postingType: "Credit", amountCents: 10000, description: `Daily sales ${DATE}` },
      { accountId: "250", postingType: "Credit", amountCents: 600, description: `Daily sales ${DATE}` },
    ],
    totalDebitsCents: 10600,
    totalCreditsCents: 10600,
    balanced: true,
    constituents: { roIds: [101], paymentIds: [] },
    overLineCap: false,
    ...over,
  };
}

/** A qteklink_daily_postings DB row for the from-mock. */
function dbRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "dp-1",
    business_date: DATE,
    category: "sales",
    posting_version: 1,
    action: "create",
    status: "pending",
    proposed_je: { je: { lines: [], docNumber: `QTL-RO-${DATE}`, txnDate: DATE } },
    constituents: { ro_ids: [101] },
    source_state_hash: "h-old",
    requestid: "qtl-x",
    qbo_je_id: null,
    qbo_sync_token: null,
    approved_by: null,
    created_at: "2026-06-05T23:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fromResults.length = 0;
  rpcMock.mockImplementation((fn: string) => {
    switch (fn) {
      case "qbo_resolve_realm_for_shop": return Promise.resolve({ data: REALM, error: null });
      case "qteklink_enqueue_daily_posting": return Promise.resolve({ data: "dp-new", error: null });
      case "qteklink_reject_daily_posting": return Promise.resolve({ data: true, error: null });
      default: return Promise.resolve({ data: null, error: null });
    }
  });
});

describe("dailySourceState / dailyRequestIdFor / dailyPrivateNoteMarker", () => {
  it("hashes constituents + lines (membership changes trip the hash even at equal totals)", () => {
    const a = sourceStateHash(dailySourceState("sales", DATE, salesJe()));
    const b = sourceStateHash(dailySourceState("sales", DATE, salesJe({ constituents: { roIds: [102], paymentIds: [] } })));
    expect(a).not.toBe(b);
    // an empty category hashes distinctly + deterministically
    expect(sourceStateHash(dailySourceState("sales", DATE, null))).toBe(sourceStateHash(dailySourceState("sales", DATE, null)));
  });

  it("requestid is stable, day-category keyed, ≤ 50 chars (QBO cap)", () => {
    const id = dailyRequestIdFor(7476, REALM, DATE, "sales", 1);
    expect(id).toBe(dailyRequestIdFor(7476, REALM, DATE, "sales", 1));
    expect(id).not.toBe(dailyRequestIdFor(7476, REALM, DATE, "sales", 2));
    expect(id.length).toBeLessThanOrEqual(50);
  });

  it("marker carries the full day-category identity", () => {
    expect(dailyPrivateNoteMarker(7476, REALM, DATE, "fees", 2)).toBe(`QTL|7476|${REALM}|day=${DATE}|fees|v2`);
  });
});

describe("enqueueDailyPosting — the diff matrix", () => {
  it("no existing rows + a desired JE → enqueues v1 create ('new')", async () => {
    fromResults.push([]); // findLatestDailyPosting
    fromResults.push([]); // findLatestPostedDaily
    const r = await enqueueDailyPosting(7476, REALM, DATE, "sales", salesJe());
    expect(r).toMatchObject({ enqueueAction: "new", action: "create", postingId: "dp-new", postingVersion: 1 });
    expect(rpcMock).toHaveBeenCalledWith("qteklink_enqueue_daily_posting", expect.objectContaining({
      p_posting_version: 1, p_action: "create", p_category: "sales",
      p_requestid: dailyRequestIdFor(7476, REALM, DATE, "sales", 1),
      p_constituents: { ro_ids: [101], payment_ids: [] },
    }));
  });

  it("pending slot, hash moved → 'refreshed' at the same version", async () => {
    const je = salesJe();
    fromResults.push([dbRow({ status: "pending", source_state_hash: "h-old" })]);
    fromResults.push([]);
    const r = await enqueueDailyPosting(7476, REALM, DATE, "sales", je);
    expect(r).toMatchObject({ enqueueAction: "refreshed", action: "create", postingVersion: 1 });
    expect(rpcMock).toHaveBeenCalledWith("qteklink_enqueue_daily_posting", expect.objectContaining({ p_posting_version: 1 }));
  });

  it("pending slot, hash unchanged → 'exists' (idempotent)", async () => {
    const je = salesJe();
    const hash = sourceStateHash(dailySourceState("sales", DATE, je));
    fromResults.push([dbRow({ status: "pending", source_state_hash: hash })]);
    fromResults.push([]);
    const r = await enqueueDailyPosting(7476, REALM, DATE, "sales", je);
    expect(r.enqueueAction).toBe("exists");
  });

  it("approved/posting slot → 'frozen' (never touched; claim-time recheck owns it)", async () => {
    fromResults.push([dbRow({ status: "approved" })]);
    fromResults.push([]);
    const r = await enqueueDailyPosting(7476, REALM, DATE, "sales", salesJe());
    expect(r).toMatchObject({ enqueueAction: "frozen", postingId: "dp-1" });
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_enqueue_daily_posting", expect.anything());
  });

  it("posted + unchanged → 'skip'", async () => {
    const je = salesJe();
    const hash = sourceStateHash(dailySourceState("sales", DATE, je));
    fromResults.push([dbRow({ status: "posted", source_state_hash: hash, qbo_je_id: "QBO-1" })]);
    const r = await enqueueDailyPosting(7476, REALM, DATE, "sales", je);
    expect(r.enqueueAction).toBe("skip");
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_enqueue_daily_posting", expect.anything());
  });

  it("posted + changed → correction v2 with action UPDATE (live JE exists)", async () => {
    fromResults.push([dbRow({ status: "posted", source_state_hash: "h-old", qbo_je_id: "QBO-1" })]);
    const r = await enqueueDailyPosting(7476, REALM, DATE, "sales", salesJe());
    expect(r).toMatchObject({ enqueueAction: "new", action: "update", postingVersion: 2 });
    expect(rpcMock).toHaveBeenCalledWith("qteklink_enqueue_daily_posting", expect.objectContaining({ p_posting_version: 2, p_action: "update" }));
  });

  it("posted DELETE is not live → a new desired JE enqueues action CREATE at v(N+1)", async () => {
    fromResults.push([dbRow({ status: "posted", action: "delete", posting_version: 2, source_state_hash: "h-del", qbo_je_id: "QBO-1" })]);
    const r = await enqueueDailyPosting(7476, REALM, DATE, "sales", salesJe());
    expect(r).toMatchObject({ enqueueAction: "new", action: "create", postingVersion: 3 });
  });

  it("desired EMPTY + live JE → enqueues action DELETE at v(N+1)", async () => {
    fromResults.push([dbRow({ status: "posted", source_state_hash: "h-old", qbo_je_id: "QBO-1" })]);
    const r = await enqueueDailyPosting(7476, REALM, DATE, "sales", null);
    expect(r).toMatchObject({ enqueueAction: "new", action: "delete", postingVersion: 2 });
    expect(rpcMock).toHaveBeenCalledWith("qteklink_enqueue_daily_posting", expect.objectContaining({
      p_action: "delete",
      p_proposed_je: expect.objectContaining({ je: expect.objectContaining({ lines: [] }) }),
    }));
  });

  it("desired EMPTY + no live JE + a pending version → 'withdrawn' (system-rejected)", async () => {
    fromResults.push([dbRow({ status: "pending" })]);
    fromResults.push([]); // no posted version
    const r = await enqueueDailyPosting(7476, REALM, DATE, "sales", null);
    expect(r).toMatchObject({ enqueueAction: "withdrawn", postingId: "dp-1" });
    expect(rpcMock).toHaveBeenCalledWith("qteklink_reject_daily_posting", expect.objectContaining({ p_id: "dp-1" }));
  });

  it("desired EMPTY + nothing anywhere → 'noop'", async () => {
    fromResults.push([]);
    fromResults.push([]);
    const r = await enqueueDailyPosting(7476, REALM, DATE, "sales", null);
    expect(r.enqueueAction).toBe("noop");
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_enqueue_daily_posting", expect.anything());
  });

  it("an unbalanced or over-cap JE is 'blocked' — never enqueued (fail closed)", async () => {
    const r1 = await enqueueDailyPosting(7476, REALM, DATE, "sales", salesJe({ balanced: false }));
    const r2 = await enqueueDailyPosting(7476, REALM, DATE, "sales", salesJe({ overLineCap: true }));
    expect(r1.enqueueAction).toBe("blocked");
    expect(r2.enqueueAction).toBe("blocked");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("an ACKNOWLEDGED category is TERMINAL — never re-enqueued, even when the day changes", async () => {
    fromResults.push([dbRow({ status: "acknowledged", source_state_hash: "h-old" })]);
    const r = await enqueueDailyPosting(7476, REALM, DATE, "sales", salesJe());
    expect(r.enqueueAction).toBe("skip");
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_enqueue_daily_posting", expect.anything());
  });

  it("failed/rejected latest: unchanged → 'skip'; changed → a NEW version", async () => {
    const je = salesJe();
    const hash = sourceStateHash(dailySourceState("sales", DATE, je));
    fromResults.push([dbRow({ status: "failed", source_state_hash: hash })]);
    fromResults.push([]);
    expect((await enqueueDailyPosting(7476, REALM, DATE, "sales", je)).enqueueAction).toBe("skip");

    fromResults.push([dbRow({ status: "rejected", source_state_hash: "h-old", posting_version: 3 })]);
    fromResults.push([]);
    const r = await enqueueDailyPosting(7476, REALM, DATE, "sales", je);
    expect(r).toMatchObject({ enqueueAction: "new", action: "create", postingVersion: 4 });
  });
});
