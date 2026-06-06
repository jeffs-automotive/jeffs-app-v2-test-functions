/**
 * Unit tests for the COA DAL (C1, hardened). Mocks the QboClient + the Supabase
 * admin client (rpc routes by function name; from() is a chain). These test the
 * shop->realm binding, runtime validation, fail-closed behavior, and mapping —
 * the QboClient HTTP path is MSW-tested in qbo/__tests__/client.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/qbo/client", () => ({
  QboClient: class {
    query = queryMock;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock, from: fromMock }),
}));

import { syncQboAccounts, getCoaSummary } from "../coa";

const REALM = "9341455608740708";

// Route rpc() by function name so resolveRealmForShop + qbo_accounts_sync are
// independently controllable per test.
function routeRpc(opts: {
  realm?: string | null;
  realmError?: { message: string } | null;
  syncData?: unknown;
  syncError?: { message: string } | null;
}) {
  rpcMock.mockImplementation((fn: string) => {
    if (fn === "qbo_resolve_realm_for_shop") {
      return Promise.resolve({
        data: opts.realm === undefined ? REALM : opts.realm,
        error: opts.realmError ?? null,
      });
    }
    if (fn === "qbo_accounts_sync") {
      return Promise.resolve({
        data: opts.syncData === undefined ? 2 : opts.syncData,
        error: opts.syncError ?? null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  routeRpc({});
});

describe("syncQboAccounts", () => {
  it("resolves the shop-bound realm, queries active+inactive, validates, maps, upserts", async () => {
    queryMock.mockResolvedValue({
      QueryResponse: {
        Account: [
          {
            Id: "275",
            Name: "Sales - Labor",
            AccountType: "Income",
            AccountSubType: "ServiceFeeIncome",
            Classification: "Revenue",
            FullyQualifiedName: "Sales - Labor",
            Active: true,
          },
          { Id: "235", Name: "Accounts Receivable", AccountType: "Accounts Receivable", Active: false },
        ],
      },
    });

    const res = await syncQboAccounts(7476);

    expect(rpcMock).toHaveBeenCalledWith("qbo_resolve_realm_for_shop", { p_shop_id: 7476 });
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("Active IN (true, false)"));
    expect(rpcMock).toHaveBeenCalledWith("qbo_accounts_sync", {
      p_shop_id: 7476,
      p_realm_id: REALM,
      p_accounts: [
        {
          qbo_account_id: "275",
          name: "Sales - Labor",
          fully_qualified_name: "Sales - Labor",
          account_type: "Income",
          account_sub_type: "ServiceFeeIncome",
          classification: "Revenue",
          active: true,
        },
        {
          qbo_account_id: "235",
          name: "Accounts Receivable",
          fully_qualified_name: null,
          account_type: "Accounts Receivable",
          account_sub_type: null,
          classification: null,
          active: false,
        },
      ],
    });
    expect(res).toEqual({ realmId: REALM, synced: 2 });
  });

  it("FAILS CLOSED with reconnect_required when the shop has no connection", async () => {
    routeRpc({ realm: null });
    await expect(syncQboAccounts(7476)).rejects.toThrow(/not connected/i);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("drops accounts that fail schema validation (missing Active / Name / Id)", async () => {
    queryMock.mockResolvedValue({
      QueryResponse: {
        Account: [
          { Id: "1", Name: "Good", Active: true },
          { Id: "2", Name: "No active flag" }, // missing Active -> schema drop
          { Id: "", Name: "Blank id", Active: true }, // blank id -> drop
          { Id: "3", Name: "   ", Active: true }, // blank name -> drop
        ],
      },
    });
    routeRpc({ syncData: 1 });
    await syncQboAccounts(7476);
    const call = rpcMock.mock.calls.find((c) => c[0] === "qbo_accounts_sync")!;
    const accounts = (call[1] as { p_accounts: unknown[] }).p_accounts;
    expect(accounts).toHaveLength(1);
    expect((accounts[0] as { qbo_account_id: string }).qbo_account_id).toBe("1");
  });

  it("FAILS CLOSED at the 1000-account page cap (no partial-mirror success)", async () => {
    queryMock.mockResolvedValue({
      QueryResponse: {
        Account: Array.from({ length: 1000 }, (_, i) => ({
          Id: String(i),
          Name: `Acct ${i}`,
          Active: true,
        })),
      },
    });
    await expect(syncQboAccounts(7476)).rejects.toThrow(/page cap/i);
    expect(rpcMock).not.toHaveBeenCalledWith("qbo_accounts_sync", expect.anything());
  });

  it("FAILS CLOSED when the sync RPC errors", async () => {
    queryMock.mockResolvedValue({ QueryResponse: { Account: [{ Id: "1", Name: "X", Active: true }] } });
    routeRpc({ syncError: { message: "db down" } });
    await expect(syncQboAccounts(7476)).rejects.toThrow(/qbo_accounts_sync failed/);
  });

  it("FAILS CLOSED when the sync RPC returns a non-numeric result", async () => {
    queryMock.mockResolvedValue({ QueryResponse: { Account: [{ Id: "1", Name: "X", Active: true }] } });
    routeRpc({ syncData: null });
    await expect(syncQboAccounts(7476)).rejects.toThrow(/non-numeric/);
  });

  it("propagates a QBO query error (e.g. reconnect_required from token refresh)", async () => {
    queryMock.mockRejectedValue(new Error("reconnect_required"));
    await expect(syncQboAccounts(7476)).rejects.toThrow(/reconnect_required/);
  });
});

describe("getCoaSummary", () => {
  function setSyncState(row: unknown) {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    };
    fromMock.mockReturnValue(chain);
    return chain;
  }

  it("returns realm + count + last-synced from sync-state, scoped by shop + realm", async () => {
    const chain = setSyncState({ last_synced_at: "2026-06-05T12:00:00Z", account_count: 42 });
    const res = await getCoaSummary(7476);
    expect(rpcMock).toHaveBeenCalledWith("qbo_resolve_realm_for_shop", { p_shop_id: 7476 });
    expect(fromMock).toHaveBeenCalledWith("qbo_coa_sync_state");
    expect(chain.eq).toHaveBeenCalledWith("shop_id", 7476);
    expect(chain.eq).toHaveBeenCalledWith("realm_id", REALM);
    expect(res).toEqual({ realmId: REALM, count: 42, lastSyncedAt: "2026-06-05T12:00:00Z" });
  });

  it("returns nulls when the shop has no connection (never connected)", async () => {
    routeRpc({ realm: null });
    const res = await getCoaSummary(7476);
    expect(res).toEqual({ realmId: null, count: 0, lastSyncedAt: null });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("distinguishes 'never synced' (no sync-state row) from synced", async () => {
    setSyncState(null);
    const res = await getCoaSummary(7476);
    expect(res).toEqual({ realmId: REALM, count: 0, lastSyncedAt: null });
  });

  it("FAILS CLOSED on a DB error", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
    };
    fromMock.mockReturnValue(chain);
    await expect(getCoaSummary(7476)).rejects.toThrow(/getCoaSummary failed/);
  });
});
