/**
 * read-dal.getDashboard — Phase 1 of the keytag orchestrator-removal plan.
 *
 * Proves the direct in-process dashboard read: getDashboard() builds a
 * service-role client + resolves shop_id server-side, calls the shared
 * @jeffs/keytag-core `getKeytagDashboardTool`, returns its KeytagDashboardResult
 * on success, and THROWS (no silent blank-dashboard) on the 10s timeout.
 *
 * `server-only` is aliased to a no-op stub in vitest.config.ts (test alias), so
 * this server-only module is importable here. We mock the read package and the
 * admin client at the module boundary — the real package/DB are exercised by
 * tests/unit/keytag-core-parity.test.ts; here we isolate read-dal's own logic
 * (delegation + the timeout/throw contract).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { KeytagDashboardResult } from "@jeffs/keytag-core";

vi.mock("@jeffs/keytag-core", () => ({ getKeytagDashboardTool: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({ __stub: "admin-client" })),
}));
// resolveAdminShopId reads process.env then falls back to 7476 — let the real
// fallback run (no SCHEDULER_ADMIN_SHOP_ID in the test env), so we also prove
// the shop id threads through to the tool call.

import { getKeytagDashboardTool } from "@jeffs/keytag-core";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDashboard } from "@/lib/keytag/read-dal";

const mockTool = vi.mocked(getKeytagDashboardTool);
const mockAdmin = vi.mocked(createSupabaseAdminClient);

const SNAPSHOT: KeytagDashboardResult = {
  ok: true,
  generated_at: "2026-06-26T12:00:00.000Z",
  counts: { in_use: 2, available: 1, stale: 1, total: 3 },
  stale: [],
  ros_without_tags: [],
  grid: [],
};

describe("getDashboard — direct in-process keytag dashboard read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the package's KeytagDashboardResult on success", async () => {
    mockTool.mockResolvedValue(SNAPSHOT);
    const result = await getDashboard();
    expect(result).toEqual(SNAPSHOT);
  });

  it("builds a service-role client and passes the resolved shop_id (7476 fallback) to the tool", async () => {
    mockTool.mockResolvedValue(SNAPSHOT);
    await getDashboard();
    expect(mockAdmin).toHaveBeenCalledTimes(1);
    // shop_id is resolved server-side (resolveAdminShopId → 7476 fallback),
    // NOT from any client input.
    expect(mockTool).toHaveBeenCalledWith({ __stub: "admin-client" }, 7476);
  });

  it("propagates a DB error thrown by the tool (no silent blank dashboard)", async () => {
    mockTool.mockRejectedValue(new Error("keytags query: connection reset"));
    await expect(getDashboard()).rejects.toThrow(
      "keytags query: connection reset",
    );
  });

  it("throws the 10s-timeout error when the read hangs past the seatbelt", async () => {
    vi.useFakeTimers();
    // A read that never resolves → the 10s timeout must win the Promise.race.
    mockTool.mockReturnValue(new Promise<KeytagDashboardResult>(() => {}));

    const promise = getDashboard();
    // Assert the rejection BEFORE advancing so the rejection handler is
    // attached (avoids an unhandled-rejection warning), then fire the timer.
    const assertion = expect(promise).rejects.toThrow(
      "keytag dashboard read timed out after 10s",
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });
});
