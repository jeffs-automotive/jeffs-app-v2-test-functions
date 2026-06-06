/**
 * Unit tests for refreshCoaAction — the browser-facing security boundary.
 * Mocks requireQtekUser, the DAL, and wrapQtekAction (passthrough) so we can
 * assert the admin gate, fail-closed mapping, and that Next's redirect
 * control-flow errors are re-thrown (never swallowed into the envelope).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QboClientError } from "@/lib/qbo/errors";

const requireQtekUserMock = vi.fn();
const syncQboAccountsMock = vi.fn();

vi.mock("@/lib/auth", () => ({ requireQtekUser: () => requireQtekUserMock() }));
vi.mock("@/lib/dal/coa", () => ({
  syncQboAccounts: (...a: unknown[]) => syncQboAccountsMock(...a),
}));
// wrapQtekAction is pure observability — pass through to the inner fn in tests.
vi.mock("@/lib/instrument-action", () => ({
  wrapQtekAction: (_name: string, inner: (...a: unknown[]) => unknown) => inner,
}));

import { refreshCoaAction } from "../coa";

beforeEach(() => {
  vi.clearAllMocks();
  requireQtekUserMock.mockResolvedValue({
    shopId: 7476,
    role: "admin",
    email: "admin@jeffsautomotive.com",
    userId: "u",
    objectId: "o",
  });
  syncQboAccountsMock.mockResolvedValue({ realmId: "R1", synced: 5 });
});

describe("refreshCoaAction", () => {
  it("admin -> syncs the SESSION shop (not a client value) + returns ok", async () => {
    const r = await refreshCoaAction(null, new FormData());
    expect(syncQboAccountsMock).toHaveBeenCalledWith(7476);
    expect(r).toMatchObject({ ok: true, data: { realmId: "R1", synced: 5 } });
  });

  it("denies a non-admin BEFORE touching the DAL", async () => {
    requireQtekUserMock.mockResolvedValue({ shopId: 7476, role: "viewer" });
    const r = await refreshCoaAction(null, new FormData());
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(syncQboAccountsMock).not.toHaveBeenCalled();
  });

  it("envelopes a reconnect_required QBO error (no raw rejection)", async () => {
    syncQboAccountsMock.mockRejectedValue(
      new QboClientError("not connected", { kind: "reconnect_required" }),
    );
    const r = await refreshCoaAction(null, new FormData());
    expect(r).toMatchObject({ ok: false, reason: "reconnect_required" });
  });

  it("re-throws Next redirect control-flow errors (the auth redirect must navigate)", async () => {
    const redirectErr = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/login;307;",
    });
    requireQtekUserMock.mockRejectedValue(redirectErr);
    await expect(refreshCoaAction(null, new FormData())).rejects.toThrow("NEXT_REDIRECT");
    expect(syncQboAccountsMock).not.toHaveBeenCalled();
  });
});
