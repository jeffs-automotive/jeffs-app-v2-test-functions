import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

import {
  getRoutineServicesForChips,
  __resetRoutineServicesCacheForTests,
} from "@/lib/scheduler/routine-services-cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function buildSupabaseStub(rows: unknown[]) {
  // Chainable mock that resolves on the order() terminal
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const chainable: Record<string, unknown> = {};
  const fluent = ["from", "select", "eq", "order"];
  for (const m of fluent) {
    chainable[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return chainable;
    };
  }
  // Make `order(...)` resolvable as a thenable so `await ... .order(...)` works
  chainable.then = (
    onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
  ) => Promise.resolve({ data: rows, error: null }).then(onFulfilled);
  return { stub: chainable, calls };
}

describe("getRoutineServicesForChips", () => {
  beforeEach(() => {
    __resetRoutineServicesCacheForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    __resetRoutineServicesCacheForTests();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("returns active routine services in display_order", async () => {
    const rows = [
      { service_key: "state_inspection_emissions", display_name: "State Inspection and Emissions", abbreviation: "SI IM" },
      { service_key: "oil_change", display_name: "Oil Change", abbreviation: "LOF" },
    ];
    const { stub, calls } = buildSupabaseStub(rows);
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      stub as unknown as ReturnType<typeof createSupabaseAdminClient>,
    );

    const result = await getRoutineServicesForChips();

    expect(result).toEqual(rows);

    const fromCall = calls.find((c) => c.method === "from");
    expect(fromCall?.args[0]).toBe("routine_services");

    const eqCalls = calls.filter((c) => c.method === "eq");
    expect(eqCalls.find((c) => c.args[0] === "shop_id")?.args[1]).toBe(7476);
    expect(eqCalls.find((c) => c.args[0] === "active")?.args[1]).toBe(true);

    const orderCall = calls.find((c) => c.method === "order");
    expect(orderCall?.args).toEqual([
      "display_order",
      { ascending: true },
    ]);
  });

  it("caches the result for 5 minutes (no second DB call within TTL)", async () => {
    const rows = [
      { service_key: "oil_change", display_name: "Oil Change", abbreviation: "LOF" },
    ];
    const { stub } = buildSupabaseStub(rows);
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      stub as unknown as ReturnType<typeof createSupabaseAdminClient>,
    );

    await getRoutineServicesForChips();
    expect(createSupabaseAdminClient).toHaveBeenCalledTimes(1);

    // Within TTL — no new DB call
    vi.advanceTimersByTime(4 * 60_000);
    await getRoutineServicesForChips();
    expect(createSupabaseAdminClient).toHaveBeenCalledTimes(1);
  });

  it("re-queries after the 5-minute TTL expires", async () => {
    const rows = [
      { service_key: "oil_change", display_name: "Oil Change", abbreviation: "LOF" },
    ];
    const { stub } = buildSupabaseStub(rows);
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      stub as unknown as ReturnType<typeof createSupabaseAdminClient>,
    );

    await getRoutineServicesForChips();
    expect(createSupabaseAdminClient).toHaveBeenCalledTimes(1);

    // After TTL — new DB call
    vi.advanceTimersByTime(5 * 60_000 + 1_000);
    await getRoutineServicesForChips();
    expect(createSupabaseAdminClient).toHaveBeenCalledTimes(2);
  });

  it("__resetRoutineServicesCacheForTests() clears the cache mid-TTL", async () => {
    const rows = [
      { service_key: "oil_change", display_name: "Oil Change", abbreviation: "LOF" },
    ];
    const { stub } = buildSupabaseStub(rows);
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      stub as unknown as ReturnType<typeof createSupabaseAdminClient>,
    );

    await getRoutineServicesForChips();
    __resetRoutineServicesCacheForTests();
    await getRoutineServicesForChips();
    expect(createSupabaseAdminClient).toHaveBeenCalledTimes(2);
  });

  it("throws a clear error when Supabase returns an error", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const stub: Record<string, unknown> = {};
    for (const m of ["from", "select", "eq", "order"]) {
      stub[m] = (...args: unknown[]) => {
        calls.push({ method: m, args });
        return stub;
      };
    }
    stub.then = (
      onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
    ) =>
      Promise.resolve({
        data: null,
        error: { message: "permission denied" },
      }).then(onFulfilled);

    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      stub as unknown as ReturnType<typeof createSupabaseAdminClient>,
    );

    await expect(getRoutineServicesForChips()).rejects.toThrow(
      /permission denied/,
    );
  });
});
