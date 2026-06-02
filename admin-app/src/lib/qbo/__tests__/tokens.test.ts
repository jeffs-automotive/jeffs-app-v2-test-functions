import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// intuit-oauth (CJS `export =`) — mock the default ctor; instances expose
// refreshUsingToken returning an AuthResponse-like { getToken() }.
const refreshUsingTokenMock: Mock = vi.fn();
vi.mock("intuit-oauth", () => ({
  __esModule: true,
  // Inline class so `new OAuthClient(...)` in the SUT is constructable.
  default: class {
    refreshUsingToken = refreshUsingTokenMock;
  },
}));

// Service-role client — single rpc() mock routed by function name.
const rpcMock: Mock = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock }),
}));

import { getValidAccessToken } from "@/lib/qbo/tokens";

const REALM = "9130000000000001";

function connectionRow(overrides: Record<string, unknown> = {}) {
  return {
    realm_id: REALM,
    environment: "production",
    access_token: "access-current",
    refresh_token: "refresh-current",
    access_token_expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    refresh_token_expires_at: new Date(Date.now() + 100 * 86_400_000).toISOString(),
    ...overrides,
  };
}

/** Route rpc() by name: get-connection result + persist result configurable. */
function routeRpc(opts: {
  connection?: unknown;
  connectionError?: { message: string } | null;
  persistError?: { message: string } | null;
}) {
  rpcMock.mockImplementation((fn: string) => {
    if (fn === "qbo_get_connection") {
      return Promise.resolve({
        data: opts.connection ?? null,
        error: opts.connectionError ?? null,
      });
    }
    if (fn === "qbo_persist_tokens") {
      return Promise.resolve({ data: null, error: opts.persistError ?? null });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

beforeEach(() => {
  refreshUsingTokenMock.mockReset();
  rpcMock.mockReset();
  process.env.QBO_CLIENT_ID = "cid";
  process.env.QBO_CLIENT_SECRET = "secret";
});

describe("getValidAccessToken", () => {
  it("returns the current token without refreshing when it's still valid", async () => {
    routeRpc({ connection: [connectionRow()] });

    const result = await getValidAccessToken();

    expect(result).toEqual({ accessToken: "access-current", realmId: REALM });
    expect(refreshUsingTokenMock).not.toHaveBeenCalled();
    // No persist call (nothing rotated).
    expect(rpcMock.mock.calls.some((c) => c[0] === "qbo_persist_tokens")).toBe(false);
  });

  it("forceRefresh:true refreshes even when the current token is still valid", async () => {
    routeRpc({ connection: [connectionRow()] }); // token valid ~1h
    refreshUsingTokenMock.mockResolvedValue({
      getToken: () => ({
        access_token: "forced-new",
        refresh_token: "r2",
        expires_in: 3600,
        x_refresh_token_expires_in: 8_726_400,
      }),
    });

    const result = await getValidAccessToken(undefined, { forceRefresh: true });

    expect(refreshUsingTokenMock).toHaveBeenCalledWith("refresh-current");
    expect(result.accessToken).toBe("forced-new");
  });

  it("refreshes + persists the ROTATED refresh token when near expiry, returns the new access token", async () => {
    routeRpc({
      connection: [
        connectionRow({
          access_token_expires_at: new Date(Date.now() + 60_000).toISOString(), // ~1 min → within skew
        }),
      ],
    });
    refreshUsingTokenMock.mockResolvedValue({
      getToken: () => ({
        access_token: "access-new",
        refresh_token: "refresh-rotated",
        expires_in: 3600,
        x_refresh_token_expires_in: 8_726_400,
      }),
    });

    const result = await getValidAccessToken();

    expect(refreshUsingTokenMock).toHaveBeenCalledWith("refresh-current");
    expect(result.accessToken).toBe("access-new");
    const persist = rpcMock.mock.calls.find((c) => c[0] === "qbo_persist_tokens");
    expect(persist).toBeDefined();
    expect(persist![1].p_refresh_token).toBe("refresh-rotated");
    expect(persist![1].p_access_token).toBe("access-new");
    expect(persist![1].p_realm_id).toBe(REALM);
  });

  it("throws reconnect_required when there is no connection", async () => {
    routeRpc({ connection: null });
    await expect(getValidAccessToken()).rejects.toMatchObject({
      kind: "reconnect_required",
    });
  });

  it("throws reconnect_required (and does NOT persist) when refresh returns invalid_grant", async () => {
    routeRpc({
      connection: [connectionRow({ access_token_expires_at: new Date(Date.now() + 60_000).toISOString() })],
    });
    refreshUsingTokenMock.mockRejectedValue({ error: "invalid_grant", error_description: "Token invalid" });

    await expect(getValidAccessToken()).rejects.toMatchObject({ kind: "reconnect_required" });
    expect(rpcMock.mock.calls.some((c) => c[0] === "qbo_persist_tokens")).toBe(false);
  });

  it("surfaces a DB read error (no silent failure)", async () => {
    routeRpc({ connection: null, connectionError: { message: "db down" } });
    await expect(getValidAccessToken()).rejects.toMatchObject({ kind: "unknown" });
  });
});
