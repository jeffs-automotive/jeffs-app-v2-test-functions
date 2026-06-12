/**
 * Unit tests for the daily poster — QBO write mocked; Supabase admin mocked (rpc
 * routed by name; `from` returns queued row-sets for findLatestPostedDaily); the
 * desired-state REBUILD is injected (the §4.1 staleness recheck is exercised by
 * making the rebuilt hash match — or not — the claimed row's hash).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromResults: unknown[][] = [];

function chainResolving(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) q[m] = vi.fn(() => q);
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

import { postDailyPostingById, type QboDailyWriteClient } from "../daily-poster";
import { dailySourceState } from "../daily-postings";
import { sourceStateHash } from "../postings";
import { QboClientError } from "@/lib/qbo/errors";
import type { DailyJournalEntry } from "@/lib/daily/daily-je-builder";

const REALM = "9341455608740708";
const DATE = "2026-06-05";

const DESIRED: DailyJournalEntry = {
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
};
const DESIRED_HASH = sourceStateHash(dailySourceState("sales", DATE, DESIRED));
const EMPTY_HASH = sourceStateHash(dailySourceState("sales", DATE, null));

function claimRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "dp-1",
    business_date: DATE,
    category: "sales",
    posting_version: 1,
    action: "create",
    source_state_hash: DESIRED_HASH,
    requestid: "qtl-day-req",
    proposed_je: {
      je: { lines: DESIRED.lines, docNumber: DESIRED.docNumber, txnDate: DATE },
      marker: `QTL|7476|${REALM}|day=${DATE}|sales|v1`,
    },
    ...over,
  };
}

/** A posted prior-version row (the live JE) for the from-mock. */
function postedDbRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "dp-0",
    business_date: DATE,
    category: "sales",
    posting_version: 1,
    action: "create",
    status: "posted",
    proposed_je: { je: { lines: [], docNumber: `QTL-RO-${DATE}`, txnDate: DATE } },
    constituents: {},
    source_state_hash: "h-prior",
    requestid: "qtl-prior",
    qbo_je_id: "QBO-100",
    qbo_sync_token: "4",
    approved_by: "chris@x.com",
    created_at: "2026-06-06T01:00:00Z",
    ...over,
  };
}

function setup({ realm = REALM as string | null, claim = null as unknown }) {
  rpcMock.mockImplementation((fn: string) => {
    switch (fn) {
      case "qbo_resolve_realm_for_shop": return Promise.resolve({ data: realm, error: null });
      case "qteklink_requeue_expired_daily_leases": return Promise.resolve({ data: 0, error: null });
      case "qteklink_claim_daily_posting_by_id": return Promise.resolve({ data: claim, error: null });
      case "qteklink_mark_daily_posted": return Promise.resolve({ data: true, error: null });
      case "qteklink_mark_daily_failed": return Promise.resolve({ data: true, error: null });
      case "qteklink_refresh_daily_posting": return Promise.resolve({ data: true, error: null });
      case "qteklink_upsert_review_item": return Promise.resolve({ data: "item-id", error: null });
      default: return Promise.resolve({ data: null, error: null });
    }
  });
}

const okClient = (): QboDailyWriteClient => ({
  create: vi.fn().mockResolvedValue({ JournalEntry: { Id: "QBO-200", SyncToken: "0" } }),
  deleteEntity: vi.fn().mockResolvedValue({ JournalEntry: { Id: "QBO-100", status: "Deleted" } }),
});

const rebuilds = {
  same: vi.fn().mockResolvedValue(DESIRED),
  empty: vi.fn().mockResolvedValue(null),
};

beforeEach(() => {
  vi.clearAllMocks();
  fromResults.length = 0;
});

describe("postDailyPostingById", () => {
  it("returns no_connection / idle on missing realm / unclaimable id", async () => {
    setup({ realm: null });
    expect(await postDailyPostingById(7476, "dp-1", { client: okClient(), rebuild: rebuilds.same })).toEqual({ status: "no_connection" });
    setup({ claim: { id: null } });
    expect(await postDailyPostingById(7476, "dp-1", { client: okClient(), rebuild: rebuilds.same })).toEqual({ status: "idle" });
  });

  it("CREATE: rebuild matches → posts with the stable requestid, marks posted with SyncToken", async () => {
    setup({ claim: claimRow() });
    const client = okClient();
    const r = await postDailyPostingById(7476, "dp-1", { client, rebuild: rebuilds.same });
    expect(r).toEqual({ status: "posted", postingId: "dp-1", qboJeId: "QBO-200", action: "create" });
    expect(client.create).toHaveBeenCalledWith(
      "journalentry",
      expect.objectContaining({ DocNumber: `QTL-RO-${DATE}`, TxnDate: DATE, PrivateNote: expect.stringContaining("day=2026-06-05|sales") }),
      "qtl-day-req",
    );
    expect(rpcMock).toHaveBeenCalledWith("qteklink_mark_daily_posted", expect.objectContaining({
      p_id: "dp-1", p_qbo_je_id: "QBO-200", p_qbo_sync_token: "0",
    }));
  });

  it("STALE (§4.1): rebuilt hash differs → releases to pending with fresh content; NO QBO write", async () => {
    const stale = claimRow({ source_state_hash: "h-stale" });
    setup({ claim: stale });
    fromResults.push([]); // findLatestPostedDaily inside the stale branch (no live JE)
    const client = okClient();
    const r = await postDailyPostingById(7476, "dp-1", { client, rebuild: rebuilds.same });
    expect(r).toEqual({ status: "stale_refreshed", postingId: "dp-1" });
    expect(client.create).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith("qteklink_refresh_daily_posting", expect.objectContaining({
      p_id: "dp-1", p_action: "create", p_source_state_hash: DESIRED_HASH,
      // the requestid ROTATES with the refreshed content (audit 2026-06-12)
      p_requestid: expect.stringMatching(/^qtl-[0-9a-f]{40}$/),
    }));
  });

  it("STALE + day emptied + NO live JE → refreshes as an empty CREATE (never a v1 'delete' that would trip the correction CHECK)", async () => {
    setup({ claim: claimRow({ source_state_hash: "h-stale" }) }); // v1 create, claimed
    fromResults.push([]); // no posted version → nothing live to delete
    const client = okClient();
    const r = await postDailyPostingById(7476, "dp-1", { client, rebuild: rebuilds.empty });
    expect(r).toEqual({ status: "stale_refreshed", postingId: "dp-1" });
    expect(rpcMock).toHaveBeenCalledWith("qteklink_refresh_daily_posting", expect.objectContaining({
      p_id: "dp-1", p_action: "create", p_source_state_hash: EMPTY_HASH,
      p_proposed_je: expect.objectContaining({ je: expect.objectContaining({ lines: [] }) }),
    }));
    expect(client.create).not.toHaveBeenCalled();
    expect(client.deleteEntity).not.toHaveBeenCalled();
  });

  it("STALE + day emptied + a LIVE posted JE → refreshes as a DELETE (the correction the next approval posts)", async () => {
    setup({ claim: claimRow({ source_state_hash: "h-stale", action: "update", posting_version: 2 }) });
    fromResults.push([postedDbRow()]); // live JE exists
    const r = await postDailyPostingById(7476, "dp-1", { client: okClient(), rebuild: rebuilds.empty });
    expect(r).toEqual({ status: "stale_refreshed", postingId: "dp-1" });
    expect(rpcMock).toHaveBeenCalledWith("qteklink_refresh_daily_posting", expect.objectContaining({ p_action: "delete" }));
  });

  it("forwards the caller's settings overrides into the rebuild (the hash contract)", async () => {
    setup({ claim: claimRow() });
    const rebuild = vi.fn().mockResolvedValue(DESIRED);
    const opts = { shopTimezone: "America/Chicago", salesTaxRateBps: 700 };
    await postDailyPostingById(7476, "dp-1", { client: okClient(), rebuild }, opts);
    expect(rebuild).toHaveBeenCalledWith(7476, REALM, DATE, "sales", opts);
  });

  it("UPDATE: full-replacement under the live JE's id + current SyncToken", async () => {
    setup({ claim: claimRow({ action: "update", posting_version: 2 }) });
    fromResults.push([postedDbRow()]); // the live JE (QBO-100, token 4)
    const client = okClient();
    const r = await postDailyPostingById(7476, "dp-1", { client, rebuild: rebuilds.same });
    expect(r).toMatchObject({ status: "posted", action: "update", qboJeId: "QBO-200" });
    expect(client.create).toHaveBeenCalledWith(
      "journalentry",
      expect.objectContaining({ Id: "QBO-100", SyncToken: "4", sparse: false }),
      "qtl-day-req",
    );
  });

  it("UPDATE with no live target fails CLOSED (review item, never a blind create)", async () => {
    setup({ claim: claimRow({ action: "update", posting_version: 2 }) });
    fromResults.push([]); // no posted version
    const client = okClient();
    const r = await postDailyPostingById(7476, "dp-1", { client, rebuild: rebuilds.same });
    expect(r).toMatchObject({ status: "failed", reason: "update_target_missing" });
    expect(client.create).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith("qteklink_upsert_review_item", expect.objectContaining({
      p_subject_kind: "day", p_subject_ref: `${DATE}:sales`,
    }));
  });

  it("UPDATE with a live target but NO stored SyncToken fails CLOSED (never guesses '0')", async () => {
    setup({ claim: claimRow({ action: "update", posting_version: 2 }) });
    fromResults.push([postedDbRow({ qbo_sync_token: null })]);
    const client = okClient();
    const r = await postDailyPostingById(7476, "dp-1", { client, rebuild: rebuilds.same });
    expect(r).toMatchObject({ status: "failed", reason: "sync_token_missing" });
    expect(client.create).not.toHaveBeenCalled();
    expect(client.deleteEntity).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith("qteklink_mark_daily_failed", expect.objectContaining({ p_retryable: false }));
  });

  it("DELETE: sends {Id, SyncToken} with operation=delete; marks posted with the deleted id", async () => {
    setup({ claim: claimRow({ action: "delete", posting_version: 2, source_state_hash: EMPTY_HASH, proposed_je: { je: { lines: [], docNumber: null, txnDate: DATE }, marker: "m" } }) });
    fromResults.push([postedDbRow()]);
    const client = okClient();
    const r = await postDailyPostingById(7476, "dp-1", { client, rebuild: rebuilds.empty });
    expect(r).toMatchObject({ status: "posted", action: "delete", qboJeId: "QBO-100" });
    expect(client.deleteEntity).toHaveBeenCalledWith("journalentry", { Id: "QBO-100", SyncToken: "4" }, "qtl-day-req");
    expect(rpcMock).toHaveBeenCalledWith("qteklink_mark_daily_posted", expect.objectContaining({ p_qbo_je_id: "QBO-100" }));
  });

  it("throttle → retry (mark_failed retryable, no review item)", async () => {
    setup({ claim: claimRow() });
    const client: QboDailyWriteClient = {
      create: vi.fn().mockRejectedValue(new QboClientError("rate limited", { kind: "throttle" })),
      deleteEntity: vi.fn(),
    };
    const r = await postDailyPostingById(7476, "dp-1", { client, rebuild: rebuilds.same });
    expect(r).toEqual({ status: "retry", postingId: "dp-1" });
    expect(rpcMock).toHaveBeenCalledWith("qteklink_mark_daily_failed", expect.objectContaining({ p_retryable: true }));
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_upsert_review_item", expect.anything());
  });

  it("a QBO fault fails with a DAY-subject review item", async () => {
    setup({ claim: claimRow() });
    const client: QboDailyWriteClient = {
      create: vi.fn().mockRejectedValue(new QboClientError("ValidationFault", { kind: "validation" })),
      deleteEntity: vi.fn(),
    };
    const r = await postDailyPostingById(7476, "dp-1", { client, rebuild: rebuilds.same });
    expect(r).toMatchObject({ status: "failed" });
    expect(rpcMock).toHaveBeenCalledWith("qteklink_upsert_review_item", expect.objectContaining({
      p_subject_kind: "day", p_subject_ref: `${DATE}:sales`,
    }));
  });

  it("no QBO id in the response → retry, never mark posted without proof", async () => {
    setup({ claim: claimRow() });
    const client: QboDailyWriteClient = { create: vi.fn().mockResolvedValue({}), deleteEntity: vi.fn() };
    const r = await postDailyPostingById(7476, "dp-1", { client, rebuild: rebuilds.same });
    expect(r).toEqual({ status: "retry", postingId: "dp-1" });
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_mark_daily_posted", expect.anything());
  });
});
