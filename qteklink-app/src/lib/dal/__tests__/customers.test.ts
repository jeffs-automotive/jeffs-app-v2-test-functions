/**
 * Unit tests for the customer-name cache DAL. The qteklink_customers read + the
 * qteklink_upsert_customers RPC are mocked; getCustomerById (the Tekmetric fetch) is mocked
 * while customerDisplayName stays REAL (so the "Customer #id" fallback is exercised).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fromMock = vi.fn();
const rpcMock = vi.fn();
const getCustomerByIdMock = vi.fn();
const captureMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ from: fromMock, rpc: rpcMock }) }));
vi.mock("@/lib/tekmetric/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tekmetric/client")>()),
  getCustomerById: (...a: unknown[]) => getCustomerByIdMock(...a),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureMock(...a) }));

import { resolveCustomerNames, getCachedCustomerNames } from "../customers";

/** A thenable PostgREST-style select chain that resolves to { data, error }. */
function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in"]) chain[m] = vi.fn(() => chain);
  chain.then = (onF: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(onF);
  return chain;
}

describe("getCachedCustomerNames", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps rows and skips null display_name", async () => {
    fromMock.mockReturnValue(selectChain([
      { tekmetric_customer_id: 1, display_name: "Alice" },
      { tekmetric_customer_id: 2, display_name: null },
    ]));
    const m = await getCachedCustomerNames(7476, [1, 2]);
    expect(m.get(1)).toBe("Alice");
    expect(m.has(2)).toBe(false);
  });

  it("short-circuits with no ids (no DB call)", async () => {
    const m = await getCachedCustomerNames(7476, []);
    expect(m.size).toBe(0);
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("resolveCustomerNames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockResolvedValue({ data: 0, error: null });
  });

  it("reads cache, fetches only MISSING ids, upserts them, and is resilient to a fetch failure", async () => {
    fromMock.mockReturnValue(selectChain([{ tekmetric_customer_id: 1, display_name: "Alice" }])); // 1 cached
    getCustomerByIdMock.mockImplementation(async (_shop: number, id: number) => {
      if (id === 2) return { firstName: "Bob", lastName: "Jones" };
      if (id === 3) return null; // 404 → "Customer #3"
      throw new Error("HTTP 500"); // id 4 transient → skipped
    });

    const m = await resolveCustomerNames(7476, [1, 2, 3, 4]);

    expect(m.get(1)).toBe("Alice");
    expect(m.get(2)).toBe("Bob Jones");
    expect(m.get(3)).toBe("Customer #3"); // 404 → stable synthetic label
    expect(m.has(4)).toBe(false); // transient failure → uncached, retried next build

    // Only the missing ids were fetched (id 1 was cached).
    expect(getCustomerByIdMock).toHaveBeenCalledTimes(3);
    // The two resolved (incl. the 404) were upserted; id 4 was not.
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const arg = rpcMock.mock.calls[0]![1] as { p_shop_id: number; p_customers: { tekmetric_customer_id: number }[] };
    expect(arg.p_shop_id).toBe(7476);
    expect(arg.p_customers.map((c) => c.tekmetric_customer_id).sort()).toEqual([2, 3]);
    expect(captureMock).toHaveBeenCalledTimes(1); // the id-4 failure
  });

  it("all cached → no Tekmetric fetch, no upsert", async () => {
    fromMock.mockReturnValue(selectChain([
      { tekmetric_customer_id: 1, display_name: "Alice" },
      { tekmetric_customer_id: 2, display_name: "Bob Jones" },
    ]));
    const m = await resolveCustomerNames(7476, [1, 2]);
    expect(m.get(1)).toBe("Alice");
    expect(m.get(2)).toBe("Bob Jones");
    expect(getCustomerByIdMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
