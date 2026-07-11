/**
 * Unit tests for requireQtekUser (the all-entrypoint auth
 * gate). Mocks both Supabase clients + next/navigation's redirect (which
 * throws, like the real one) so we can assert every reject branch.
 *
 * SECURITY note: the oid is resolved server-side inside the
 * `qteklink_resolve_allowed_user` RPC (from auth.identities, keyed on the
 * validated user.id) — NOT from user_metadata — so the tests mock the RPC, and
 * the user fixture deliberately carries NO custom_claims (proving the gate does
 * not depend on client-writable metadata).
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("../supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
// The unauth bounce reads x-qtl-pathname (set by middleware) to build ?next=.
const mockHeaderStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => mockHeaderStore.get(name.toLowerCase()) ?? null,
  })),
}));

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../supabase/server";
import { createSupabaseAdminClient } from "../supabase/admin";
import { requireQtekUser } from "../auth";

const ALLOWED_OID = "1afee9a1-271c-4180-b777-6d83b381aa5a";

// Deliberately NO user_metadata/custom_claims — the gate must not depend on it.
function mockUser(overrides: Record<string, unknown> = {}) {
  return { id: "user-uuid-1", email: "admin@jeffsautomotive.com", ...overrides };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    shop_id: 7476,
    entra_object_id: ALLOWED_OID,
    email: "admin@jeffsautomotive.com",
    full_name: "Admin",
    role: "admin",
    active: true,
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

// Mocks the qteklink_resolve_allowed_user RPC (keyed on the validated user id).
function setResolver(rows: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data: rows, error });
  (createSupabaseAdminClient as Mock).mockReturnValue({ rpc });
  return rpc;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHeaderStore.clear();
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

  it("carries the intended destination as ?next= (deep link survives login)", async () => {
    setSession(null);
    mockHeaderStore.set("x-qtl-pathname", "/approvals/2026-07-03");
    await expect(requireQtekUser()).rejects.toThrow("NEXT_REDIRECT:/login?next=");
    expect(redirect).toHaveBeenCalledWith(
      `/login?next=${encodeURIComponent("/approvals/2026-07-03")}`,
    );
  });

  it.each(["//evil.com", "/", "/login?error=x", "/auth/callback", "https://evil.com"])(
    "never threads unsafe next %s",
    async (path) => {
      setSession(null);
      mockHeaderStore.set("x-qtl-pathname", path);
      await expect(requireQtekUser()).rejects.toThrow("NEXT_REDIRECT:/login");
      expect(redirect).toHaveBeenCalledWith("/login");
    },
  );

  it("resolves the allowlist by the validated user id (not user_metadata)", async () => {
    setSession(mockUser());
    const rpc = setResolver([row()]);
    await requireQtekUser();
    expect(rpc).toHaveBeenCalledWith("qteklink_resolve_allowed_user", {
      p_user_id: "user-uuid-1",
    });
  });

  it("signs out + redirects when the user is not on the allowlist", async () => {
    setSession(mockUser());
    setResolver([]); // empty → not on list (or no azure identity)
    await expect(requireQtekUser()).rejects.toThrow(
      "NEXT_REDIRECT:/login?error=not_allowed",
    );
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("signs out + redirects when the allowlisted user is deactivated", async () => {
    setSession(mockUser());
    setResolver([row({ role: "viewer", active: false })]);
    await expect(requireQtekUser()).rejects.toThrow(
      "NEXT_REDIRECT:/login?error=deactivated",
    );
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("returns the session for an active allowlisted user", async () => {
    setSession(mockUser());
    setResolver([row({ role: "admin", active: true })]);
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

  it("FAILS CLOSED — throws (does not grant) when the resolver errors", async () => {
    setSession(mockUser());
    setResolver(null, { message: "db down" });
    await expect(requireQtekUser()).rejects.toThrow(
      /qteklink_resolve_allowed_user failed/,
    );
  });
});

