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
import type {
  KeytagDashboardResult,
  WipKeyTagsResult,
  ListManualReviewsResult,
  GetKeytagAuditHistoryResult,
} from "@jeffs/keytag-core";

vi.mock("@jeffs/keytag-core", () => ({
  getKeytagDashboardTool: vi.fn(),
  listWipKeyTags: vi.fn(),
  listManualReviewsTool: vi.fn(),
  getKeytagAuditHistory: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({ __stub: "admin-client" })),
}));
// resolveAdminShopId reads process.env then falls back to 7476 — let the real
// fallback run (no SCHEDULER_ADMIN_SHOP_ID in the test env), so we also prove
// the shop id threads through to the tool call.

import {
  getKeytagDashboardTool,
  listWipKeyTags,
  listManualReviewsTool,
  getKeytagAuditHistory,
} from "@jeffs/keytag-core";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getDashboard,
  getWipKeyTags,
  getManualReviews,
  getAuditHistory,
} from "@/lib/keytag/read-dal";

const mockTool = vi.mocked(getKeytagDashboardTool);
const mockAdmin = vi.mocked(createSupabaseAdminClient);
const mockWip = vi.mocked(listWipKeyTags);
const mockReviews = vi.mocked(listManualReviewsTool);
const mockAudit = vi.mocked(getKeytagAuditHistory);

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

// ─── Phase 2: the three board/tab reads, same contract as getDashboard ──────

const WIP_RESULT: WipKeyTagsResult = {
  ok: true,
  count: 1,
  shop_id: 7476,
  results: [
    {
      ro_number: 5,
      ro_id: 5,
      tag: "R4",
      tag_color: "red",
      tag_number: 4,
      status: "assigned",
      customer_id: null,
      customer_name: null,
      vehicle_id: null,
      ro_url: "https://shop.tekmetric.com/ro/5",
      last_activity_at: null,
    },
  ],
};

describe("getWipKeyTags — direct in-process WIP-keytags read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the package's WipKeyTagsResult on success", async () => {
    mockWip.mockResolvedValue(WIP_RESULT);
    expect(await getWipKeyTags()).toEqual(WIP_RESULT);
  });

  it("builds a service-role client and passes the resolved shop_id (7476)", async () => {
    mockWip.mockResolvedValue(WIP_RESULT);
    await getWipKeyTags();
    expect(mockAdmin).toHaveBeenCalledTimes(1);
    expect(mockWip).toHaveBeenCalledWith({ __stub: "admin-client" }, 7476);
  });

  it("propagates a DB error thrown by the package (no silent empty board)", async () => {
    mockWip.mockRejectedValue(new Error("keytags query failed: reset"));
    await expect(getWipKeyTags()).rejects.toThrow("keytags query failed: reset");
  });

  it("throws the 10s-timeout error when the read hangs past the seatbelt", async () => {
    vi.useFakeTimers();
    mockWip.mockReturnValue(new Promise<WipKeyTagsResult>(() => {}));
    const promise = getWipKeyTags();
    const assertion = expect(promise).rejects.toThrow(
      "keytag WIP-keytags read timed out after 10s",
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });
});

const REVIEWS_RESULT: ListManualReviewsResult = {
  ok: true,
  count: 0,
  open_count: 0,
  results: [],
};

describe("getManualReviews — direct in-process manual-reviews read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the package's ListManualReviewsResult on success", async () => {
    mockReviews.mockResolvedValue(REVIEWS_RESULT);
    expect(await getManualReviews({ only_open: true, limit: 200 })).toEqual(
      REVIEWS_RESULT,
    );
  });

  it("builds a service-role client and forwards the args verbatim", async () => {
    mockReviews.mockResolvedValue(REVIEWS_RESULT);
    await getManualReviews({ only_open: true, limit: 200 });
    expect(mockAdmin).toHaveBeenCalledTimes(1);
    expect(mockReviews).toHaveBeenCalledWith(
      { __stub: "admin-client" },
      { only_open: true, limit: 200 },
    );
  });

  it("propagates a DB error thrown by the package (no silent empty list)", async () => {
    mockReviews.mockRejectedValue(
      new Error("list_manual_reviews query failed: reset"),
    );
    await expect(getManualReviews({ only_open: true })).rejects.toThrow(
      "list_manual_reviews query failed: reset",
    );
  });

  it("throws the 10s-timeout error when the read hangs past the seatbelt", async () => {
    vi.useFakeTimers();
    mockReviews.mockReturnValue(new Promise<ListManualReviewsResult>(() => {}));
    const promise = getManualReviews({ only_open: true });
    const assertion = expect(promise).rejects.toThrow(
      "keytag manual-reviews read timed out after 10s",
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });
});

const AUDIT_RESULT: GetKeytagAuditHistoryResult = {
  ok: true,
  filters: {
    since: "2026-06-25T12:00:00.000Z",
    until: "2026-06-26T12:00:00.000Z",
    user_label: null,
    tag_color: null,
    tag_number: null,
    ro_number: null,
    action: null,
    source: null,
  },
  count: 0,
  results: [],
  truncated: false,
  message: "No audit entries matched the filters.",
};

describe("getAuditHistory — direct in-process audit-log read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the package's GetKeytagAuditHistoryResult on success", async () => {
    mockAudit.mockResolvedValue(AUDIT_RESULT);
    expect(await getAuditHistory({ limit: 50 })).toEqual(AUDIT_RESULT);
  });

  it("builds a service-role client and forwards the filter args verbatim", async () => {
    mockAudit.mockResolvedValue(AUDIT_RESULT);
    await getAuditHistory({ limit: 50, tag_color: "red" });
    expect(mockAdmin).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith(
      { __stub: "admin-client" },
      { limit: 50, tag_color: "red" },
    );
  });

  it("propagates a DB error thrown by the package (no silent empty log)", async () => {
    mockAudit.mockRejectedValue(
      new Error("keytag_audit_log query failed: reset"),
    );
    await expect(getAuditHistory({ limit: 50 })).rejects.toThrow(
      "keytag_audit_log query failed: reset",
    );
  });

  it("throws the 10s-timeout error when the read hangs past the seatbelt", async () => {
    vi.useFakeTimers();
    mockAudit.mockReturnValue(
      new Promise<GetKeytagAuditHistoryResult>(() => {}),
    );
    const promise = getAuditHistory({ limit: 50 });
    const assertion = expect(promise).rejects.toThrow(
      "keytag audit-history read timed out after 10s",
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });
});
