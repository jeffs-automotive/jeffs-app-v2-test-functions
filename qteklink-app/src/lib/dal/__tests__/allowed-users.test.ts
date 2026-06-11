/**
 * Unit tests for the sign-in allowlist DAL — list mapping (incl. the pending
 * "bound" flag), RPC argument shapes for add / set-active / set-role / remove,
 * and the P0001 → QboClientError plain-message translation. Admin client mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock, from: fromMock }),
}));

import {
  listAllowedUsers,
  addAllowedUser,
  setAllowedUserActive,
  setAllowedUserRole,
  removeAllowedUser,
} from "../allowed-users";

function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) c[m] = vi.fn(() => c);
  c.then = (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF);
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockResolvedValue({ data: true, error: null });
});

describe("listAllowedUsers", () => {
  it("maps rows; a NULL entra_object_id surfaces as bound=false (hasn't signed in)", async () => {
    fromMock.mockReturnValue(chain({
      data: [
        { id: "u1", email: "chris@shop.com", full_name: "Chris", role: "admin", active: true, entra_object_id: "oid-1", created_by: "seed", created_at: "2026-06-05T00:00:00Z" },
        { id: "u2", email: "new@shop.com", full_name: null, role: "viewer", active: true, entra_object_id: null, created_by: "chris@shop.com", created_at: "2026-06-11T00:00:00Z" },
      ],
      error: null,
    }));
    const users = await listAllowedUsers(7476);
    expect(users).toEqual([
      { id: "u1", email: "chris@shop.com", fullName: "Chris", role: "admin", active: true, bound: true, createdBy: "seed", createdAt: "2026-06-05T00:00:00Z" },
      { id: "u2", email: "new@shop.com", fullName: null, role: "viewer", active: true, bound: false, createdBy: "chris@shop.com", createdAt: "2026-06-11T00:00:00Z" },
    ]);
  });

  it("FAILS CLOSED on a DB error", async () => {
    fromMock.mockReturnValue(chain({ data: null, error: { message: "boom" } }));
    await expect(listAllowedUsers(7476)).rejects.toThrow(/listAllowedUsers failed/);
  });
});

describe("mutations", () => {
  it("addAllowedUser calls the RPC with the shop, email, role and the acting admin", async () => {
    rpcMock.mockResolvedValue({ data: "new-id", error: null });
    const r = await addAllowedUser(7476, { email: "new@shop.com", role: "viewer", addedBy: "chris@shop.com" });
    expect(r).toEqual({ id: "new-id" });
    expect(rpcMock).toHaveBeenCalledWith("qteklink_add_allowed_user", {
      p_shop_id: 7476, p_email: "new@shop.com", p_role: "viewer", p_full_name: null, p_added_by: "chris@shop.com",
    });
  });

  it("setAllowedUserActive / setAllowedUserRole / removeAllowedUser map args + booleans", async () => {
    expect(await setAllowedUserActive(7476, "u2", false)).toEqual({ changed: true });
    expect(rpcMock).toHaveBeenLastCalledWith("qteklink_set_allowed_user_active", { p_shop_id: 7476, p_id: "u2", p_active: false });
    expect(await setAllowedUserRole(7476, "u2", "admin")).toEqual({ changed: true });
    expect(rpcMock).toHaveBeenLastCalledWith("qteklink_set_allowed_user_role", { p_shop_id: 7476, p_id: "u2", p_role: "admin" });
    rpcMock.mockResolvedValue({ data: false, error: null });
    expect(await removeAllowedUser(7476, "u2")).toEqual({ removed: false });
    expect(rpcMock).toHaveBeenLastCalledWith("qteklink_remove_allowed_user", { p_shop_id: 7476, p_id: "u2" });
  });

  it("a P0001 guard rejection (last active admin) surfaces its plain message", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "P0001", message: "You can't deactivate the only active admin — make someone else an admin first." } });
    await expect(setAllowedUserActive(7476, "u1", false)).rejects.toThrow(/only active admin/);
  });

  it("a non-P0001 DB error fails closed with the RPC name", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(addAllowedUser(7476, { email: "x@y.com", role: "viewer", addedBy: "a@b.com" })).rejects.toThrow(/qteklink_add_allowed_user failed/);
  });
});
