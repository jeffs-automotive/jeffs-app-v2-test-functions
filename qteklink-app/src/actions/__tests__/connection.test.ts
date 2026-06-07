/**
 * Unit tests for disconnectQboAction — admin gate + the success/failure envelope.
 * Mocks requireQtekUser + the connection DAL (the real wrapQtekAction wrapper runs,
 * matching the mappings action test).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const requireQtekUserMock = vi.fn();
const disconnectQboMock = vi.fn();

vi.mock("@/lib/auth", () => ({ requireQtekUser: () => requireQtekUserMock() }));
vi.mock("@/lib/dal/connection", () => ({ disconnectQbo: (s: number) => disconnectQboMock(s) }));

import { disconnectQboAction } from "../connection";

beforeEach(() => {
  vi.clearAllMocks();
  requireQtekUserMock.mockResolvedValue({ shopId: 7476, role: "admin", email: "a@b.com" });
  disconnectQboMock.mockResolvedValue({ realmId: "9341455608740708", revoked: true });
});

describe("disconnectQboAction", () => {
  it("admin -> calls disconnectQbo with the session shop", async () => {
    const r = await disconnectQboAction(null, new FormData());
    expect(disconnectQboMock).toHaveBeenCalledWith(7476);
    expect(r).toMatchObject({ ok: true, data: { revoked: true } });
  });

  it("denies a non-admin BEFORE touching the DAL", async () => {
    requireQtekUserMock.mockResolvedValue({ shopId: 7476, role: "viewer" });
    const r = await disconnectQboAction(null, new FormData());
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(disconnectQboMock).not.toHaveBeenCalled();
  });

  it("returns a failure envelope when the DAL throws", async () => {
    disconnectQboMock.mockRejectedValue(new Error("boom"));
    const r = await disconnectQboAction(null, new FormData());
    expect(r).toMatchObject({ ok: false });
  });
});
