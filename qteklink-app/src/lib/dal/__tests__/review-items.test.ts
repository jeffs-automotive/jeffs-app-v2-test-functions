/**
 * Unit tests for the resolution-queue DAL (C7, §9). Mocks the Supabase admin
 * client (rpc routes by function name; from() returns a thenable chain).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock, from: fromMock }),
}));

import { upsertReviewItem, listOpenReviewItems, resolveReviewItem } from "../review-items";

const REALM = "9341455608740708";

function chainResolving(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) chain[m] = vi.fn(() => chain);
  chain.then = (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF);
  return chain;
}

function routeRealm(realm: string | null = REALM) {
  rpcMock.mockImplementation((fn: string) => {
    if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: realm, error: null });
    return Promise.resolve({ data: null, error: null });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  routeRealm();
});

describe("upsertReviewItem", () => {
  const INPUT = { kind: "unmapped", subjectKind: "mapping_key" as const, subjectRef: "fee:Synchrony", detail: { x: 1 } };

  it("resolves the realm and upserts via the RPC with mapped args", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: REALM, error: null });
      if (fn === "qteklink_upsert_review_item") return Promise.resolve({ data: "item-uuid", error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const res = await upsertReviewItem(7476, INPUT);
    expect(rpcMock).toHaveBeenCalledWith("qteklink_upsert_review_item", {
      p_shop_id: 7476, p_realm_id: REALM, p_kind: "unmapped", p_subject_kind: "mapping_key",
      p_subject_ref: "fee:Synchrony", p_detail: { x: 1 },
    });
    expect(res).toEqual({ id: "item-uuid" });
  });

  it("defaults detail to {} when omitted", async () => {
    rpcMock.mockImplementation((fn: string) =>
      fn === "qbo_resolve_realm_for_shop" ? Promise.resolve({ data: REALM, error: null }) : Promise.resolve({ data: "id", error: null }),
    );
    await upsertReviewItem(7476, { kind: "tax_mismatch", subjectKind: "ro", subjectRef: "152805" });
    expect(rpcMock).toHaveBeenCalledWith("qteklink_upsert_review_item", expect.objectContaining({ p_detail: {} }));
  });

  it("FAILS CLOSED with reconnect_required when the shop has no connection", async () => {
    routeRealm(null);
    await expect(upsertReviewItem(7476, INPUT)).rejects.toThrow(/not connected/i);
  });

  it("translates a P0001 rejection to a clean message", async () => {
    rpcMock.mockImplementation((fn: string) =>
      fn === "qbo_resolve_realm_for_shop" ? Promise.resolve({ data: REALM, error: null }) : Promise.resolve({ data: null, error: { code: "P0001", message: "bad subject_kind" } }),
    );
    await expect(upsertReviewItem(7476, INPUT)).rejects.toThrow(/bad subject_kind/);
  });
});

describe("listOpenReviewItems", () => {
  it("reads + maps the open items", async () => {
    fromMock.mockReturnValue(chainResolving({
      data: [{ id: "i1", kind: "unmapped", subject_kind: "mapping_key", subject_ref: "fee:Synchrony", detail: { amount: 200 }, status: "open", created_at: "2026-06-06T00:00:00Z" }],
      error: null,
    }));
    const res = await listOpenReviewItems(7476);
    expect(fromMock).toHaveBeenCalledWith("qteklink_review_items");
    expect(res.realmId).toBe(REALM);
    expect(res.items[0]).toEqual({
      id: "i1", kind: "unmapped", subjectKind: "mapping_key", subjectRef: "fee:Synchrony",
      detail: { amount: 200 }, status: "open", createdAt: "2026-06-06T00:00:00Z",
    });
  });

  it("returns {realmId:null, items:[]} when the shop has no connection", async () => {
    routeRealm(null);
    expect(await listOpenReviewItems(7476)).toEqual({ realmId: null, items: [] });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED on a DB error", async () => {
    fromMock.mockReturnValue(chainResolving({ data: null, error: { message: "boom" } }));
    await expect(listOpenReviewItems(7476)).rejects.toThrow(/listOpenReviewItems failed/);
  });
});

describe("resolveReviewItem", () => {
  it("resolves via the RPC and returns the boolean", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: REALM, error: null });
      if (fn === "qteklink_resolve_review_item") return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const res = await resolveReviewItem(7476, "i1", { note: "mapped it" }, "chris@jeffsautomotive.com");
    expect(rpcMock).toHaveBeenCalledWith("qteklink_resolve_review_item", {
      p_shop_id: 7476, p_realm_id: REALM, p_id: "i1", p_resolution: { note: "mapped it" }, p_resolved_by: "chris@jeffsautomotive.com",
    });
    expect(res).toEqual({ resolved: true });
  });

  it("returns {resolved:false} when nothing open matched", async () => {
    rpcMock.mockImplementation((fn: string) =>
      fn === "qbo_resolve_realm_for_shop" ? Promise.resolve({ data: REALM, error: null }) : Promise.resolve({ data: false, error: null }),
    );
    expect(await resolveReviewItem(7476, "i1", {}, "x@y.com")).toEqual({ resolved: false });
  });

  it("FAILS CLOSED on a DB error", async () => {
    rpcMock.mockImplementation((fn: string) =>
      fn === "qbo_resolve_realm_for_shop" ? Promise.resolve({ data: REALM, error: null }) : Promise.resolve({ data: null, error: { message: "boom" } }),
    );
    await expect(resolveReviewItem(7476, "i1", {}, "x@y.com")).rejects.toThrow(/qteklink_resolve_review_item failed/);
  });
});
