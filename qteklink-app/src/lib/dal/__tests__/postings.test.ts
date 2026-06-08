/**
 * Unit tests for the postings DAL (C8b) — the deterministic hash + the desired-vs-posted
 * diff (new / correction / skip / exists). Mocks the Supabase admin client.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock, from: fromMock }),
}));

import { enqueuePostingForDraft, sourceStateHash, listPostings, approvePosting, rejectPosting, type PostingDraft } from "../postings";

const REALM = "9341455608740708";

function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "order", "limit"]) c[m] = vi.fn(() => c);
  c.then = (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF);
  return c;
}
/** What findLatestPosting returns. */
function routeLatest(row: unknown | null) {
  fromMock.mockReturnValue(chain({ data: row ? [row] : [], error: null }));
}

const DRAFT: PostingDraft = {
  kind: "sale", tekmetricRoId: 152805, paymentId: null,
  batchDate: "2026-05-19", txnDate: "2026-05-19",
  je: { lines: [{ a: 1 }] }, sourceState: { total: 11202, hash_input: "x" },
};

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockImplementation((fn: string) =>
    fn === "qteklink_enqueue_posting" ? Promise.resolve({ data: "posting-uuid", error: null }) : Promise.resolve({ data: null, error: null }),
  );
});

describe("sourceStateHash", () => {
  it("is deterministic + independent of key order", () => {
    expect(sourceStateHash({ a: 1, b: [2, 3] })).toBe(sourceStateHash({ b: [2, 3], a: 1 }));
  });
  it("changes when the value changes", () => {
    expect(sourceStateHash({ total: 1 })).not.toBe(sourceStateHash({ total: 2 }));
  });
});

describe("enqueuePostingForDraft — diff", () => {
  it("NEW when the subject has no prior posting (version 1)", async () => {
    routeLatest(null);
    const r = await enqueuePostingForDraft(7476, REALM, DRAFT);
    expect(r).toEqual({ action: "new", postingId: "posting-uuid", postingVersion: 1 });
    expect(rpcMock).toHaveBeenCalledWith("qteklink_enqueue_posting", expect.objectContaining({
      p_shop_id: 7476, p_realm_id: REALM, p_tekmetric_ro_id: 152805, p_kind: "sale",
      p_payment_id: null, p_posting_version: 1,
      p_requestid: expect.stringMatching(/^qtl-[0-9a-f]{40}$/), // QBO 50-char-safe hash
    }));
  });

  it("SKIP when already posted with the SAME source hash (no enqueue)", async () => {
    routeLatest({ id: "p1", posting_version: 1, status: "posted", source_state_hash: sourceStateHash(DRAFT.sourceState) });
    const r = await enqueuePostingForDraft(7476, REALM, DRAFT);
    expect(r).toEqual({ action: "skip", postingId: null, postingVersion: 1 });
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_enqueue_posting", expect.anything());
  });

  it("CORRECTION (version+1) when posted with a DIFFERENT source hash", async () => {
    routeLatest({ id: "p1", posting_version: 2, status: "posted", source_state_hash: "stale-hash" });
    const r = await enqueuePostingForDraft(7476, REALM, DRAFT);
    expect(r.action).toBe("correction");
    expect(r.postingVersion).toBe(3);
    expect(rpcMock).toHaveBeenCalledWith("qteklink_enqueue_posting", expect.objectContaining({ p_posting_version: 3 }));
  });

  it("EXISTS (idempotent, same version) when an un-posted row already exists", async () => {
    routeLatest({ id: "p1", posting_version: 1, status: "approved", source_state_hash: "whatever" });
    const r = await enqueuePostingForDraft(7476, REALM, DRAFT);
    expect(r.action).toBe("exists");
    expect(r.postingVersion).toBe(1);
  });

  it("persists the JE + marker + hash in proposed_je", async () => {
    routeLatest(null);
    await enqueuePostingForDraft(7476, REALM, DRAFT);
    const call = rpcMock.mock.calls.find((c) => c[0] === "qteklink_enqueue_posting");
    const pj = (call![1] as { p_proposed_je: { je: unknown; marker: string; source_state_hash: string } }).p_proposed_je;
    expect(pj.je).toEqual(DRAFT.je);
    expect(pj.marker).toBe(`QTL|7476|${REALM}|ro=152805|sale|pay=0|v1`);
    expect(pj.source_state_hash).toBe(sourceStateHash(DRAFT.sourceState));
  });

  it("FAILS CLOSED on a DB error from findLatestPosting", async () => {
    fromMock.mockReturnValue(chain({ data: null, error: { message: "boom" } }));
    await expect(enqueuePostingForDraft(7476, REALM, DRAFT)).rejects.toThrow(/findLatestPosting failed/);
  });
});

describe("listPostings / approvePosting / rejectPosting", () => {
  function routeRealm() {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: REALM, error: null });
      if (fn === "qteklink_approve_posting") return Promise.resolve({ data: true, error: null });
      if (fn === "qteklink_reject_posting") return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: null });
    });
  }

  it("listPostings maps rows + computes totalCents from the debit lines", async () => {
    routeRealm();
    fromMock.mockReturnValue(chain({ data: [{
      id: "p1", kind: "sale", tekmetric_ro_id: "152805", payment_id: null, status: "pending",
      posting_version: 1, txn_date: "2026-05-19", batch_date: "2026-05-19", qbo_je_id: null,
      proposed_je: { je: { lines: [{ postingType: "Debit", amountCents: 11202 }, { postingType: "Credit", amountCents: 11202 }], docNumber: "RO 152805" } },
      created_at: "2026-05-19T00:00:00Z",
    }], error: null }));
    const { realmId, postings } = await listPostings(7476);
    expect(realmId).toBe(REALM);
    expect(postings[0]).toEqual({
      id: "p1", kind: "sale", tekmetricRoId: 152805, paymentId: null, status: "pending",
      postingVersion: 1, txnDate: "2026-05-19", batchDate: "2026-05-19", qboJeId: null,
      docNumber: "RO 152805", totalCents: 11202, createdAt: "2026-05-19T00:00:00Z",
      lines: [
        { accountId: "", postingType: "Debit", amountCents: 11202, description: "" },
        { accountId: "", postingType: "Credit", amountCents: 11202, description: "" },
      ],
      sourceStateHash: null,
    });
  });

  it("listPostings returns {realmId:null, postings:[]} when no connection", async () => {
    rpcMock.mockImplementation(() => Promise.resolve({ data: null, error: null })); // realm null
    expect(await listPostings(7476)).toEqual({ realmId: null, postings: [] });
  });

  it("approvePosting calls the RPC and returns the boolean", async () => {
    routeRealm();
    const r = await approvePosting(7476, "p1", "chris@x.com");
    expect(rpcMock).toHaveBeenCalledWith("qteklink_approve_posting", { p_shop_id: 7476, p_realm_id: REALM, p_id: "p1", p_approved_by: "chris@x.com" });
    expect(r).toEqual({ approved: true });
  });

  it("rejectPosting calls the RPC and returns the boolean", async () => {
    routeRealm();
    const r = await rejectPosting(7476, "p1", "chris@x.com");
    expect(rpcMock).toHaveBeenCalledWith("qteklink_reject_posting", { p_shop_id: 7476, p_realm_id: REALM, p_id: "p1", p_rejected_by: "chris@x.com" });
    expect(r).toEqual({ rejected: true });
  });
});
