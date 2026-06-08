/**
 * Unit tests for the per-RO SALE projection DAL (C8b). Mocks the Supabase admin client.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock, from: fromMock }),
}));

import { getRoStateByRo, upsertRoState } from "../ro-state";

const REALM = "9341455608740708";

function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "limit"]) c[m] = vi.fn(() => c);
  c.then = (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF);
  return c;
}
function routeRealm(realm: string | null = REALM) {
  rpcMock.mockImplementation((fn: string) =>
    fn === "qbo_resolve_realm_for_shop" ? Promise.resolve({ data: realm, error: null }) : Promise.resolve({ data: null, error: null }),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  routeRealm();
});

describe("getRoStateByRo", () => {
  it("maps a row (bigint cents → number)", async () => {
    fromMock.mockReturnValue(chain({ data: [{ id: "r1", tekmetric_ro_id: "152805", ro_number: "RO-152805", last_total_cents: "11202", last_posted_date: "2026-05-19", source_snapshot_hash: "h1", sale_qbo_je_id: "QBO-1", sale_qbo_sync_token: "0", status: "posted" }], error: null }));
    const { realmId, roState } = await getRoStateByRo(7476, 152805);
    expect(realmId).toBe(REALM);
    expect(roState).toEqual({
      id: "r1", tekmetricRoId: 152805, roNumber: "RO-152805", lastTotalCents: 11202,
      lastPostedDate: "2026-05-19", sourceSnapshotHash: "h1", saleQboJeId: "QBO-1",
      saleQboSyncToken: "0", status: "posted",
    });
  });

  it("returns null when the RO has no projection yet", async () => {
    fromMock.mockReturnValue(chain({ data: [], error: null }));
    expect((await getRoStateByRo(7476, 152805)).roState).toBeNull();
  });

  it("returns {realmId:null, roState:null} when the shop has no connection", async () => {
    routeRealm(null);
    expect(await getRoStateByRo(7476, 152805)).toEqual({ realmId: null, roState: null });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED on a non-safe-integer cents value", async () => {
    fromMock.mockReturnValue(chain({ data: [{ id: "r2", tekmetric_ro_id: "1", ro_number: null, last_total_cents: "9007199254740993", last_posted_date: null, source_snapshot_hash: null, sale_qbo_je_id: null, sale_qbo_sync_token: null, status: "pending" }], error: null }));
    await expect(getRoStateByRo(7476, 1)).rejects.toThrow(/non-safe-integer last_total_cents/);
  });

  it("FAILS CLOSED on a DB error", async () => {
    fromMock.mockReturnValue(chain({ data: null, error: { message: "boom" } }));
    await expect(getRoStateByRo(7476, 1)).rejects.toThrow(/getRoStateByRo failed/);
  });
});

describe("upsertRoState", () => {
  it("upserts via the RPC with mapped args", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: REALM, error: null });
      if (fn === "qteklink_upsert_ro_state") return Promise.resolve({ data: "ro-uuid", error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const res = await upsertRoState(7476, { tekmetricRoId: 152805, saleQboJeId: "QBO-1", saleQboSyncToken: "0", status: "posted" });
    expect(rpcMock).toHaveBeenCalledWith("qteklink_upsert_ro_state", {
      p_shop_id: 7476, p_realm_id: REALM, p_tekmetric_ro_id: 152805, p_ro_number: null,
      p_last_total_cents: null, p_last_posted_date: null, p_source_snapshot_hash: null,
      p_sale_qbo_je_id: "QBO-1", p_sale_qbo_sync_token: "0", p_status: "posted",
    });
    expect(res).toEqual({ id: "ro-uuid" });
  });

  it("FAILS CLOSED with reconnect_required when the shop has no connection", async () => {
    routeRealm(null);
    await expect(upsertRoState(7476, { tekmetricRoId: 1 })).rejects.toThrow(/not connected/i);
  });

  it("FAILS CLOSED on a non-uuid result", async () => {
    rpcMock.mockImplementation((fn: string) =>
      fn === "qbo_resolve_realm_for_shop" ? Promise.resolve({ data: REALM, error: null }) : Promise.resolve({ data: 1, error: null }),
    );
    await expect(upsertRoState(7476, { tekmetricRoId: 1 })).rejects.toThrow(/non-uuid/);
  });
});
