/**
 * Unit tests for the mapping actions — the browser-facing security boundary.
 * Mocks requireQtekUser, the mappings DAL, and wrapQtekAction (passthrough) so
 * we can assert the admin gate, Zod input validation, the SESSION shop is used
 * (never a client value), envelope mapping, and that Next redirect control-flow
 * errors are re-thrown (never swallowed).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QboClientError } from "@/lib/qbo/errors";

const requireQtekUserMock = vi.fn();
const setMappingMock = vi.fn();
const deactivateMappingMock = vi.fn();

vi.mock("@/lib/auth", () => ({ requireQtekUser: () => requireQtekUserMock() }));
vi.mock("@/lib/dal/mappings", () => ({
  setMapping: (...a: unknown[]) => setMappingMock(...a),
  deactivateMapping: (...a: unknown[]) => deactivateMappingMock(...a),
}));
vi.mock("@/lib/instrument-action", () => ({
  wrapQtekAction: (_name: string, inner: (...a: unknown[]) => unknown) => inner,
}));

import { mapTekmetricItemAction, deactivateMappingAction } from "../mappings";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireQtekUserMock.mockResolvedValue({ shopId: 7476, role: "admin", email: "a@b.com", userId: "u", objectId: "o" });
  setMappingMock.mockResolvedValue({ id: "new-uuid" });
  deactivateMappingMock.mockResolvedValue({ deactivated: true });
});

describe("mapTekmetricItemAction (the picker — the only mapping-set surface)", () => {
  it("admin + valid input -> calls setMapping with the SESSION shop + the SERVER-derived role", async () => {
    const r = await mapTekmetricItemAction(null, fd({ kind: "labor", source_key: "Labor", qbo_account_id: "275" }));
    expect(setMappingMock).toHaveBeenCalledWith(7476, {
      kind: "labor",
      sourceKey: "Labor",
      qboAccountId: "275",
      postingRole: "income", // derived server-side from (kind, sourceKey) — never client input
      passThrough: false,
    });
    expect(r).toMatchObject({ ok: true, data: { id: "new-uuid" } });
  });

  it("passes passThrough:true for a fee marked pass-through", async () => {
    const r = await mapTekmetricItemAction(
      null,
      fd({ kind: "fee", source_key: "State Communication Fee", qbo_account_id: "276", pass_through: "on" }),
    );
    expect(setMappingMock).toHaveBeenCalledWith(7476, expect.objectContaining({ kind: "fee", passThrough: true }));
    expect(r).toMatchObject({ ok: true });
  });

  it("rejects pass-through on a NON-fee kind (no DAL call)", async () => {
    const r = await mapTekmetricItemAction(
      null,
      fd({ kind: "labor", source_key: "Labor", qbo_account_id: "275", pass_through: "on" }),
    );
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(setMappingMock).not.toHaveBeenCalled();
  });

  it("deposits-like-card on a non-cash type derives role undeposited_funds (the financing path)", async () => {
    const r = await mapTekmetricItemAction(
      null,
      fd({ kind: "noncash_payment_type", source_key: "Synchrony", qbo_account_id: "366", deposits_like_card: "on" }),
    );
    expect(setMappingMock).toHaveBeenCalledWith(7476, expect.objectContaining({ postingRole: "undeposited_funds" }));
    expect(r).toMatchObject({ ok: true });
  });

  it("rejects deposits-like-card on a NON-noncash kind (no DAL call)", async () => {
    const r = await mapTekmetricItemAction(
      null,
      fd({ kind: "labor", source_key: "Labor", qbo_account_id: "275", deposits_like_card: "on" }),
    );
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(setMappingMock).not.toHaveBeenCalled();
  });

  it("denies a non-admin BEFORE touching the DAL", async () => {
    requireQtekUserMock.mockResolvedValue({ shopId: 7476, role: "approver" });
    const r = await mapTekmetricItemAction(null, fd({ kind: "labor", source_key: "Labor", qbo_account_id: "275" }));
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(setMappingMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid kind with a validation envelope (no DAL call)", async () => {
    const r = await mapTekmetricItemAction(null, fd({ kind: "bogus", source_key: "Labor", qbo_account_id: "275" }));
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(setMappingMock).not.toHaveBeenCalled();
  });

  it("rejects a blank source_key (no DAL call)", async () => {
    const r = await mapTekmetricItemAction(null, fd({ kind: "labor", source_key: "   ", qbo_account_id: "275" }));
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(setMappingMock).not.toHaveBeenCalled();
  });

  it("envelopes a DB business rejection (role-incompat) as a clean failure", async () => {
    setMappingMock.mockRejectedValue(
      new QboClientError("posting_role income is not compatible with account type Expense", { kind: "unknown" }),
    );
    const r = await mapTekmetricItemAction(null, fd({ kind: "labor", source_key: "Labor", qbo_account_id: "309" }));
    expect(r).toMatchObject({ ok: false, reason: "unknown" });
    if (!r.ok) expect(r.message).toMatch(/not compatible with account type Expense/);
  });

  it("re-throws Next redirect control-flow errors (auth redirect must navigate)", async () => {
    requireQtekUserMock.mockRejectedValue(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" }));
    await expect(mapTekmetricItemAction(null, fd({ kind: "labor", source_key: "Labor", qbo_account_id: "275" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(setMappingMock).not.toHaveBeenCalled();
  });
});

describe("deactivateMappingAction", () => {
  it("admin + valid uuid -> deactivates via the SESSION shop", async () => {
    const r = await deactivateMappingAction(null, fd({ id: "11111111-1111-4111-8111-111111111111" }));
    expect(deactivateMappingMock).toHaveBeenCalledWith(7476, "11111111-1111-4111-8111-111111111111");
    expect(r).toMatchObject({ ok: true, data: { deactivated: true } });
  });

  it("rejects a non-uuid id with a validation envelope", async () => {
    const r = await deactivateMappingAction(null, fd({ id: "not-a-uuid" }));
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(deactivateMappingMock).not.toHaveBeenCalled();
  });

  it("denies a non-admin", async () => {
    requireQtekUserMock.mockResolvedValue({ shopId: 7476, role: "viewer" });
    const r = await deactivateMappingAction(null, fd({ id: "11111111-1111-4111-8111-111111111111" }));
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(deactivateMappingMock).not.toHaveBeenCalled();
  });
});
