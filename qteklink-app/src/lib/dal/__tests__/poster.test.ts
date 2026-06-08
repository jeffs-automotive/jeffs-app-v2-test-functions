/**
 * Unit tests for the QTekLink poster (C8c). The QBO write is an injected mock; the
 * Supabase admin client is mocked (rpc routed by function name).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock, from: vi.fn() }),
}));

import { postNextApproved } from "../poster";
import { QboClientError } from "@/lib/qbo/errors";

const REALM = "9341455608740708";

const SALE_CLAIM = {
  id: "post-1", tekmetric_ro_id: 152805, payment_id: null, kind: "sale",
  txn_date: "2026-05-19", posting_version: 1, requestid: "qtl-abc",
  proposed_je: {
    je: {
      lines: [
        { accountId: "235", postingType: "Debit", amountCents: 11202, description: "RO 152805" },
        { accountId: "272", postingType: "Credit", amountCents: 11202, description: "income" },
      ],
      docNumber: "RO 152805", txnDate: "2026-05-19",
    },
    marker: "QTL|7476", source_state_hash: "h1",
  },
};

function setup({ realm = REALM as string | null, claim = null as unknown }) {
  rpcMock.mockImplementation((fn: string) => {
    switch (fn) {
      case "qbo_resolve_realm_for_shop": return Promise.resolve({ data: realm, error: null });
      case "qteklink_requeue_expired_leases": return Promise.resolve({ data: 0, error: null });
      case "qteklink_claim_posting": return Promise.resolve({ data: claim, error: null });
      case "qteklink_mark_posted": return Promise.resolve({ data: true, error: null });
      case "qteklink_mark_failed": return Promise.resolve({ data: true, error: null });
      case "qteklink_upsert_review_item": return Promise.resolve({ data: "item-id", error: null });
      case "qteklink_upsert_ro_state": return Promise.resolve({ data: "ro-id", error: null });
      default: return Promise.resolve({ data: null, error: null });
    }
  });
}

const okClient = () => ({ create: vi.fn().mockResolvedValue({ JournalEntry: { Id: "QBO-25735", SyncToken: "0" } }) });

beforeEach(() => vi.clearAllMocks());

describe("postNextApproved", () => {
  it("returns no_connection when the shop has no realm", async () => {
    setup({ realm: null });
    expect(await postNextApproved(7476, { client: okClient() })).toEqual({ status: "no_connection" });
  });

  it("returns idle when nothing is claimable", async () => {
    setup({ claim: { id: null } });
    expect(await postNextApproved(7476, { client: okClient() })).toEqual({ status: "idle" });
  });

  it("posts a SALE: builds the JE, sends the stable requestid, marks posted, records ro_state", async () => {
    setup({ claim: SALE_CLAIM });
    const client = okClient();
    const r = await postNextApproved(7476, { client });
    expect(r).toEqual({ status: "posted", postingId: "post-1", qboJeId: "QBO-25735" });
    expect(client.create).toHaveBeenCalledWith("journalentry", expect.objectContaining({ DocNumber: "RO 152805", PrivateNote: "QTL|7476" }), "qtl-abc");
    expect(rpcMock).toHaveBeenCalledWith("qteklink_mark_posted", expect.objectContaining({ p_id: "post-1", p_qbo_je_id: "QBO-25735" }));
    expect(rpcMock).toHaveBeenCalledWith("qteklink_upsert_ro_state", expect.objectContaining({ p_sale_qbo_je_id: "QBO-25735", p_sale_qbo_sync_token: "0", p_status: "posted" }));
  });

  it("DEFERS a correction (version > 1) — never posts it as a new JE", async () => {
    setup({ claim: { ...SALE_CLAIM, posting_version: 2 } });
    const client = okClient();
    const r = await postNextApproved(7476, { client });
    expect(r.status).toBe("deferred");
    expect(client.create).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith("qteklink_mark_failed", expect.objectContaining({ p_id: "post-1", p_retryable: false }));
    expect(rpcMock).toHaveBeenCalledWith("qteklink_upsert_review_item", expect.objectContaining({ p_kind: "correction_unsupported" }));
  });

  it("RETRIES a throttle/network fault (mark_failed retryable, no review item)", async () => {
    setup({ claim: SALE_CLAIM });
    const client = { create: vi.fn().mockRejectedValue(new QboClientError("rate limited", { kind: "throttle" })) };
    const r = await postNextApproved(7476, { client });
    expect(r).toEqual({ status: "retry", postingId: "post-1" });
    expect(rpcMock).toHaveBeenCalledWith("qteklink_mark_failed", expect.objectContaining({ p_retryable: true }));
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_upsert_review_item", expect.anything());
  });

  it("flags an Entity-rejection as 'ar_entity_rejected' (the §13 guard)", async () => {
    setup({ claim: SALE_CLAIM });
    const client = { create: vi.fn().mockRejectedValue(new QboClientError("QBO ValidationFault (6000): A required Entity is missing", { kind: "validation", detail: "Entity required" })) };
    const r = await postNextApproved(7476, { client });
    expect(r.status).toBe("failed");
    expect(rpcMock).toHaveBeenCalledWith("qteklink_upsert_review_item", expect.objectContaining({ p_kind: "ar_entity_rejected" }));
    expect(rpcMock).toHaveBeenCalledWith("qteklink_mark_failed", expect.objectContaining({ p_retryable: false }));
  });

  it("HARD-fails a reconnect_required fault with a review item (pause posting)", async () => {
    setup({ claim: SALE_CLAIM });
    const client = { create: vi.fn().mockRejectedValue(new QboClientError("invalid_grant", { kind: "reconnect_required" })) };
    const r = await postNextApproved(7476, { client });
    expect(r.status).toBe("failed");
    expect(rpcMock).toHaveBeenCalledWith("qteklink_upsert_review_item", expect.objectContaining({ p_kind: "reconnect_required" }));
  });

  it("fails closed on a malformed proposed_je", async () => {
    setup({ claim: { ...SALE_CLAIM, proposed_je: { je: { lines: [], docNumber: "", txnDate: "" } } } });
    const client = okClient();
    const r = await postNextApproved(7476, { client });
    expect(r.status).toBe("failed");
    expect(client.create).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith("qteklink_upsert_review_item", expect.objectContaining({ p_kind: "qbo_error" }));
  });
});
