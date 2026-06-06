/**
 * Unit tests for the mappings DAL (C2). Mocks the Supabase admin client (rpc
 * routes by function name; from() returns a thenable chain per table). Covers
 * the shop->realm binding, the active-mapping + account-name join (incl. the
 * stale/soft-deleted flag), fail-closed writes, and the P0001 business-rejection
 * translation. The DB-enforced role-compat is pgTAP + live-DO-block verified.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock, from: fromMock }),
}));

import {
  listMappings,
  listMappableAccounts,
  setMapping,
  deactivateMapping,
} from "../mappings";

const REALM = "9341455608740708";

/** A thenable PostgREST-builder stand-in: every method returns the chain; the
 *  chain itself resolves to {data,error} when awaited. */
function chainResolving(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "is", "limit"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF);
  return chain;
}

function routeRealm(realm: string | null = REALM, realmError: { message: string } | null = null) {
  rpcMock.mockImplementation((fn: string) => {
    if (fn === "qbo_resolve_realm_for_shop") {
      return Promise.resolve({ data: realm, error: realmError });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  routeRealm();
});

describe("listMappings", () => {
  it("joins active mappings to account names + flags stale (removed OR inactive) accounts", async () => {
    const mapChain = chainResolving({
      data: [
        { id: "m1", kind: "labor", source_key: "Labor", source_id: null, qbo_account_id: "275", posting_role: "income", effective_from: "2026-06-06T00:00:00Z" },
        { id: "m2", kind: "fee", source_key: "Old Fee", source_id: null, qbo_account_id: "999", posting_role: "income", effective_from: "2026-06-06T00:00:00Z" },
        { id: "m3", kind: "fee", source_key: "Inactive Fee", source_id: null, qbo_account_id: "400", posting_role: "income", effective_from: "2026-06-06T00:00:00Z" },
      ],
      error: null,
    });
    const acctChain = chainResolving({
      data: [
        { qbo_account_id: "275", name: "Sales - Labor", account_type: "Income", active: true, deleted_at: null },
        { qbo_account_id: "999", name: "Removed Income", account_type: "Income", active: true, deleted_at: "2026-06-06T01:00:00Z" },
        { qbo_account_id: "400", name: "Deactivated Income", account_type: "Income", active: false, deleted_at: null },
      ],
      error: null,
    });
    fromMock.mockImplementation((t: string) => (t === "qteklink_mappings" ? mapChain : acctChain));

    const res = await listMappings(7476);
    expect(rpcMock).toHaveBeenCalledWith("qbo_resolve_realm_for_shop", { p_shop_id: 7476 });
    expect(res.realmId).toBe(REALM);
    expect(res.mappings).toHaveLength(3);
    expect(res.mappings[0]).toMatchObject({ qboAccountId: "275", accountName: "Sales - Labor", accountStale: false });
    expect(res.mappings[1]).toMatchObject({ qboAccountId: "999", accountName: "Removed Income", accountStale: true });
    expect(res.mappings[2]).toMatchObject({ qboAccountId: "400", accountName: "Deactivated Income", accountStale: true });
  });

  it("returns {realmId:null, mappings:[]} when the shop has no connection", async () => {
    routeRealm(null);
    const res = await listMappings(7476);
    expect(res).toEqual({ realmId: null, mappings: [] });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED on a mappings DB error", async () => {
    fromMock.mockImplementation((t: string) =>
      t === "qteklink_mappings"
        ? chainResolving({ data: null, error: { message: "boom" } })
        : chainResolving({ data: [], error: null }),
    );
    await expect(listMappings(7476)).rejects.toThrow(/listMappings \(mappings\) failed/);
  });
});

describe("listMappableAccounts", () => {
  it("returns live accounts for the picker", async () => {
    fromMock.mockReturnValue(
      chainResolving({
        data: [{ qbo_account_id: "275", name: "Sales - Labor", account_type: "Income", account_sub_type: "ServiceFeeIncome" }],
        error: null,
      }),
    );
    const res = await listMappableAccounts(7476);
    expect(fromMock).toHaveBeenCalledWith("qbo_accounts");
    expect(res).toEqual([{ qboAccountId: "275", name: "Sales - Labor", accountType: "Income", accountSubType: "ServiceFeeIncome" }]);
  });

  it("returns [] when the shop has no connection", async () => {
    routeRealm(null);
    expect(await listMappableAccounts(7476)).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("setMapping", () => {
  it("resolves the realm and calls qteklink_set_mapping with mapped args", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: REALM, error: null });
      if (fn === "qteklink_set_mapping") return Promise.resolve({ data: "new-uuid", error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const res = await setMapping(7476, { kind: "labor", sourceKey: "Labor", qboAccountId: "275", postingRole: "income" });
    expect(rpcMock).toHaveBeenCalledWith("qteklink_set_mapping", {
      p_shop_id: 7476,
      p_realm_id: REALM,
      p_kind: "labor",
      p_source_key: "Labor",
      p_source_id: null,
      p_qbo_account_id: "275",
      p_posting_role: "income",
    });
    expect(res).toEqual({ id: "new-uuid" });
  });

  it("FAILS CLOSED with reconnect_required when the shop has no connection", async () => {
    routeRealm(null);
    await expect(setMapping(7476, { kind: "labor", sourceKey: "Labor", qboAccountId: "275", postingRole: "income" })).rejects.toThrow(/not connected/i);
  });

  it("translates a P0001 business rejection to a clean message", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: REALM, error: null });
      return Promise.resolve({ data: null, error: { code: "P0001", message: "posting_role income is not compatible with account type Expense" } });
    });
    await expect(setMapping(7476, { kind: "labor", sourceKey: "Labor", qboAccountId: "309", postingRole: "income" })).rejects.toThrow(/not compatible with account type Expense/);
  });

  it("FAILS CLOSED on a non-P0001 system error", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: REALM, error: null });
      return Promise.resolve({ data: null, error: { code: "57014", message: "canceled" } });
    });
    await expect(setMapping(7476, { kind: "labor", sourceKey: "Labor", qboAccountId: "275", postingRole: "income" })).rejects.toThrow(/qteklink_set_mapping failed/);
  });
});

describe("deactivateMapping", () => {
  it("returns {deactivated:true} when the RPC reports a row was deactivated", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: REALM, error: null });
      if (fn === "qteklink_deactivate_mapping") return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const res = await deactivateMapping(7476, "m1");
    expect(rpcMock).toHaveBeenCalledWith("qteklink_deactivate_mapping", { p_shop_id: 7476, p_realm_id: REALM, p_id: "m1" });
    expect(res).toEqual({ deactivated: true });
  });

  it("returns {deactivated:false} when nothing was active", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: REALM, error: null });
      return Promise.resolve({ data: false, error: null });
    });
    expect(await deactivateMapping(7476, "m1")).toEqual({ deactivated: false });
  });

  it("FAILS CLOSED on a DB error", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: REALM, error: null });
      return Promise.resolve({ data: null, error: { message: "boom" } });
    });
    await expect(deactivateMapping(7476, "m1")).rejects.toThrow(/qteklink_deactivate_mapping failed/);
  });
});
