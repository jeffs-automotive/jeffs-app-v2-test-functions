/**
 * Unit tests for the RO-number cache DAL. The qteklink_ros read + the qteklink_upsert_ros RPC are
 * mocked; getRepairOrderNumberById (the Tekmetric fetch) is mocked. Unlike the customer cache,
 * an unresolvable RO (404 / no number) is SKIPPED (not cached) — there's no honest synthetic RO#.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fromMock = vi.fn();
const rpcMock = vi.fn();
const getRoNumMock = vi.fn();
const captureMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ from: fromMock, rpc: rpcMock }) }));
vi.mock("@/lib/tekmetric/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tekmetric/client")>()),
  getRepairOrderNumberById: (...a: unknown[]) => getRoNumMock(...a),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureMock(...a) }));

import { resolveRoNumbers, getCachedRoNumbers, warmRoNumbers } from "../ro-numbers";

/** A thenable PostgREST-style select chain that resolves to { data, error }. */
function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "gte", "not"]) chain[m] = vi.fn(() => chain);
  chain.then = (onF: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(onF);
  return chain;
}

describe("getCachedRoNumbers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps rows and skips null repair_order_number", async () => {
    fromMock.mockReturnValue(selectChain([
      { tekmetric_ro_id: 100, repair_order_number: "152222" },
      { tekmetric_ro_id: 200, repair_order_number: null },
    ]));
    const m = await getCachedRoNumbers(7476, [100, 200]);
    expect(m.get(100)).toBe("152222");
    expect(m.has(200)).toBe(false);
  });

  it("short-circuits with no ids (no DB call)", async () => {
    const m = await getCachedRoNumbers(7476, []);
    expect(m.size).toBe(0);
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("resolveRoNumbers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockResolvedValue({ data: 0, error: null });
  });

  it("reads cache, fetches only MISSING ids, upserts them, skips a 404, and is resilient to a fetch failure", async () => {
    fromMock.mockReturnValue(selectChain([{ tekmetric_ro_id: 100, repair_order_number: "152222" }])); // 1 cached
    getRoNumMock.mockImplementation(async (_shop: number, id: number) => {
      if (id === 200) return "152333";
      if (id === 300) return null; // 404 / no number → SKIPPED (not cached)
      throw new Error("HTTP 500"); // id 400 transient → skipped + captured
    });

    const m = await resolveRoNumbers(7476, [100, 200, 300, 400]);

    expect(m.get(100)).toBe("152222");
    expect(m.get(200)).toBe("152333");
    expect(m.has(300)).toBe(false); // 404 → not cached (no honest synthetic RO#)
    expect(m.has(400)).toBe(false); // transient → retried next warm

    expect(getRoNumMock).toHaveBeenCalledTimes(3); // only the 3 missing (100 was cached)
    // ONLY the genuinely-resolved id 200 was upserted (300 was null, 400 threw).
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const arg = rpcMock.mock.calls[0]![1] as { p_shop_id: number; p_ros: { tekmetric_ro_id: number }[] };
    expect(arg.p_shop_id).toBe(7476);
    expect(arg.p_ros.map((r) => r.tekmetric_ro_id)).toEqual([200]);
    expect(captureMock).toHaveBeenCalledTimes(1); // the id-400 failure
  });

  it("all cached → no Tekmetric fetch, no upsert", async () => {
    fromMock.mockReturnValue(selectChain([
      { tekmetric_ro_id: 100, repair_order_number: "152222" },
      { tekmetric_ro_id: 200, repair_order_number: "152333" },
    ]));
    const m = await resolveRoNumbers(7476, [100, 200]);
    expect(m.get(100)).toBe("152222");
    expect(m.get(200)).toBe("152333");
    expect(getRoNumMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("nothing resolvable → no upsert", async () => {
    fromMock.mockReturnValue(selectChain([])); // cache empty
    getRoNumMock.mockResolvedValue(null); // every RO 404
    const m = await resolveRoNumbers(7476, [900, 901]);
    expect(m.size).toBe(0);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("warmRoNumbers (nightly cron)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockResolvedValue({ data: 0, error: null });
  });

  it("collects ALL payment ROs (deduped), resolves their numbers via Tekmetric, caches them", async () => {
    fromMock.mockImplementation((table: string) =>
      table === "qteklink_payment_state"
        ? selectChain([{ repair_order_id: 100 }, { repair_order_id: 200 }, { repair_order_id: 100 }]) // dupe RO
        : selectChain([]), // qteklink_ros cache empty → all fetched
    );
    getRoNumMock.mockImplementation(async (_s: number, id: number) => `RO-${id}`);

    const r = await warmRoNumbers(7476, "realm");

    expect(getRoNumMock).toHaveBeenCalledTimes(2); // deduped to 100, 200
    expect(rpcMock).toHaveBeenCalledTimes(1); // numbers upserted to the cache
    expect(r.ros).toBe(2);
  });

  it("no payment ROs → no fetch", async () => {
    fromMock.mockImplementation(() => selectChain([]));
    const r = await warmRoNumbers(7476, "realm");
    expect(getRoNumMock).not.toHaveBeenCalled();
    expect(r.ros).toBe(0);
  });
});
