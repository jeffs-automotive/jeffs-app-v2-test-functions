/**
 * Unit tests for the QBO connection DAL (soft disconnect). Mocks the realm
 * resolver, the token loader, intuit-oauth's revoke, and the admin RPC.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const resolveRealmMock = vi.fn();
const loadConnectionMock = vi.fn();
const revokeMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: rpcMock }) }));
vi.mock("@/lib/dal/realm", () => ({ resolveRealmForShop: (s: number) => resolveRealmMock(s) }));
vi.mock("@/lib/qbo/tokens", () => ({ loadConnection: (r?: string) => loadConnectionMock(r) }));
vi.mock("@/lib/qbo/config", () => ({ resolveQboEnvironment: () => "production" }));
vi.mock("intuit-oauth", () => ({ default: class { revoke = revokeMock; } }));

import { disconnectQbo } from "../connection";

const REALM = "9341455608740708";

beforeEach(() => {
  vi.clearAllMocks();
  resolveRealmMock.mockResolvedValue(REALM);
  loadConnectionMock.mockResolvedValue({ realmId: REALM, refreshToken: "rt-123" });
  revokeMock.mockResolvedValue({});
  rpcMock.mockResolvedValue({ error: null });
});

describe("disconnectQbo", () => {
  it("does nothing when the shop has no connection", async () => {
    resolveRealmMock.mockResolvedValue(null);
    expect(await disconnectQbo(7476)).toEqual({ realmId: null, revoked: false });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it("revokes at Intuit + calls qbo_disconnect", async () => {
    const res = await disconnectQbo(7476);
    expect(revokeMock).toHaveBeenCalledWith({ refresh_token: "rt-123" });
    expect(rpcMock).toHaveBeenCalledWith("qbo_disconnect", { p_realm_id: REALM });
    expect(res).toEqual({ realmId: REALM, revoked: true });
  });

  it("treats a revoke failure as non-fatal — still tombstones via the RPC", async () => {
    revokeMock.mockRejectedValue(new Error("invalid_grant"));
    const res = await disconnectQbo(7476);
    expect(rpcMock).toHaveBeenCalledWith("qbo_disconnect", { p_realm_id: REALM });
    expect(res).toEqual({ realmId: REALM, revoked: false });
  });

  it("skips revoke for an already-tombstoned token", async () => {
    loadConnectionMock.mockResolvedValue({ realmId: REALM, refreshToken: "__disconnected__" });
    const res = await disconnectQbo(7476);
    expect(revokeMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith("qbo_disconnect", { p_realm_id: REALM });
    expect(res.revoked).toBe(false);
  });

  it("FAILS CLOSED when qbo_disconnect errors", async () => {
    rpcMock.mockResolvedValue({ error: { message: "boom" } });
    await expect(disconnectQbo(7476)).rejects.toThrow(/qbo_disconnect failed/);
  });
});
