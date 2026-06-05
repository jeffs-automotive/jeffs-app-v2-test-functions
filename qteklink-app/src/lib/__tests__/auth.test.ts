/**
 * Unit tests for requireQtekUser / getQtekSession (the all-entrypoint auth
 * gate). Mocks both Supabase clients + next/navigation's redirect (which
 * throws, like the real one) so we can assert every reject branch.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("../supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  // The real redirect() throws to halt rendering — mirror that so control
  // never falls through a reject branch.
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../supabase/server";
import { createSupabaseAdminClient } from "../supabase/admin";
import { requireQtekUser, getQtekSession, extractEntraObjectId } from "../auth";

const ALLOWED_OID = "oid-active-admin";

function mockUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-uuid-1",
    email: "admin@jeffsautomotive.com",
    user_metadata: { custom_claims: { oid: ALLOWED_OID, tid: "tid-1" } },
    ...overrides,
  };
}

const signOut = vi.fn();

function setSession(user: unknown, getUserError: unknown = null) {
  (createSupabaseServerClient as Mock).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: getUserError }),
      signOut,
    },
  });
}

function setAllowlist(rows: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data: rows, error });
  (createSupabaseAdminClient as Mock).mockReturnValue({ rpc });
  return rpc;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractEntraObjectId", () => {
  it("reads custom_claims.oid", () => {
    expect(extractEntraObjectId(mockUser() as never)).toBe(ALLOWED_OID);
  });
  it("returns null when oid is absent", () => {
    expect(
      extractEntraObjectId(mockUser({ user_metadata: { custom_claims: {} } }) as never),
    ).toBeNull();
  });
  it("returns null when user_metadata is missing", () => {
    expect(extractEntraObjectId({ user_metadata: null } as never)).toBeNull();
  });
});

describe("requireQtekUser", () => {
  it("redirects to /login when there is no session", async () => {
    setSession(null);
    await expect(requireQtekUser()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("redirects to /login on a getUser error", async () => {
    setSession(null, { message: "boom" });
    await expect(requireQtekUser()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("signs out + redirects when the Entra oid claim is missing", async () => {
    setSession(mockUser({ user_metadata: { custom_claims: {} } }));
    setAllowlist([]);
    await expect(requireQtekUser()).rejects.toThrow(
      "NEXT_REDIRECT:/login?error=no_object_id",
    );
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("signs out + redirects when the oid is not on the allowlist", async () => {
    setSession(mockUser());
    setAllowlist([]); // empty → not on list
    await expect(requireQtekUser()).rejects.toThrow(
      "NEXT_REDIRECT:/login?error=not_allowed",
    );
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("signs out + redirects when the allowlisted user is deactivated", async () => {
    setSession(mockUser());
    setAllowlist([
      { id: "1", shop_id: 7476, entra_object_id: ALLOWED_OID, email: "a@b.com", full_name: null, role: "viewer", active: false },
    ]);
    await expect(requireQtekUser()).rejects.toThrow(
      "NEXT_REDIRECT:/login?error=deactivated",
    );
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("returns the session for an active allowlisted user", async () => {
    setSession(mockUser());
    setAllowlist([
      { id: "1", shop_id: 7476, entra_object_id: ALLOWED_OID, email: "admin@jeffsautomotive.com", full_name: "A", role: "admin", active: true },
    ]);
    const session = await requireQtekUser();
    expect(session).toEqual({
      email: "admin@jeffsautomotive.com",
      userId: "user-uuid-1",
      objectId: ALLOWED_OID,
      shopId: 7476,
      role: "admin",
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED — throws (does not grant) when the allowlist lookup errors", async () => {
    setSession(mockUser());
    setAllowlist(null, { message: "db down" });
    await expect(requireQtekUser()).rejects.toThrow(/qteklink_get_allowed_user failed/);
  });
});

describe("getQtekSession", () => {
  it("returns null when there is no session (no redirect)", async () => {
    setSession(null);
    expect(await getQtekSession()).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("returns null when not on the allowlist", async () => {
    setSession(mockUser());
    setAllowlist([]);
    expect(await getQtekSession()).toBeNull();
  });

  it("returns the session for an active allowlisted user", async () => {
    setSession(mockUser());
    setAllowlist([
      { id: "1", shop_id: 7476, entra_object_id: ALLOWED_OID, email: "admin@jeffsautomotive.com", full_name: "A", role: "approver", active: true },
    ]);
    expect(await getQtekSession()).toMatchObject({ role: "approver", shopId: 7476 });
  });
});
