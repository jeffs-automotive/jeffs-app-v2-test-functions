/**
 * Unit tests for the LEGACY postings read module — the canonical sourceStateHash (the
 * daily diff / scope_hash / staleness recheck all depend on it) + the read-only
 * listPostings mapping for the legacy ledger page. (The per-RO write path — enqueue /
 * approve / reject / poster — was retired by the daily-JE rework step 6.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock, from: fromMock }),
}));

import { sourceStateHash, listPostings } from "../postings";

const REALM = "9341455608740708";

function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "order", "limit"]) c[m] = vi.fn(() => c);
  c.then = (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF);
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sourceStateHash", () => {
  it("is deterministic + independent of key order", () => {
    expect(sourceStateHash({ a: 1, b: [2, 3] })).toBe(sourceStateHash({ b: [2, 3], a: 1 }));
  });
  it("changes when the value changes", () => {
    expect(sourceStateHash({ total: 1 })).not.toBe(sourceStateHash({ total: 2 }));
  });
});

describe("listPostings (legacy, read-only)", () => {
  it("maps rows + computes totalCents from the debit lines", async () => {
    rpcMock.mockImplementation((fn: string) =>
      fn === "qbo_resolve_realm_for_shop" ? Promise.resolve({ data: REALM, error: null }) : Promise.resolve({ data: null, error: null }),
    );
    fromMock.mockReturnValue(chain({ data: [{
      id: "p1", kind: "sale", tekmetric_ro_id: "152805", payment_id: null, status: "pending",
      posting_version: 1, txn_date: "2026-05-19", batch_date: "2026-05-19", qbo_je_id: null,
      proposed_je: { je: { lines: [{ postingType: "Debit", amountCents: 11202 }, { postingType: "Credit", amountCents: 11202 }], docNumber: "RO 152805" } },
      created_at: "2026-05-19T00:00:00Z",
    }], error: null }));
    const { realmId, postings } = await listPostings(7476);
    expect(realmId).toBe(REALM);
    expect(postings[0]).toEqual({
      id: "p1", kind: "sale", tekmetricRoId: 152805, paymentId: null, status: "pending",
      postingVersion: 1, txnDate: "2026-05-19", batchDate: "2026-05-19", qboJeId: null,
      docNumber: "RO 152805", totalCents: 11202, createdAt: "2026-05-19T00:00:00Z",
      lines: [
        { accountId: "", postingType: "Debit", amountCents: 11202, description: "" },
        { accountId: "", postingType: "Credit", amountCents: 11202, description: "" },
      ],
      sourceStateHash: null,
    });
  });

  it("returns {realmId:null, postings:[]} when no connection", async () => {
    rpcMock.mockImplementation(() => Promise.resolve({ data: null, error: null }));
    expect(await listPostings(7476)).toEqual({ realmId: null, postings: [] });
  });
});
