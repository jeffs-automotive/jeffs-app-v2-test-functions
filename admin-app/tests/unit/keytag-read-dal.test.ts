/**
 * Unit tests for the keytag READ DAL (admin-app direct-from-Node reads).
 *
 * The DAL replaces the orchestrator-mcp HTTP hop for the four keytag READ
 * surfaces (dashboard / WIP tags / manual-reviews / audit history). Each fn:
 *   - builds a service-role client (createSupabaseAdminClient)
 *   - resolves shop_id SERVER-SIDE (resolveAdminShopId)
 *   - calls the corresponding pure query under ./queries/
 *   - wraps it in a 10s seatbelt that THROWS on timeout OR DB error.
 *
 * These tests mock the queries + the admin client + shop-id resolver, then
 * assert: (a) the happy path passes shop_id / args through and returns the
 * query result, (b) a thrown DB error rejects (never swallowed to empty), and
 * (c) the 10s timeout rejects.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `server-only` is aliased to a no-op stub in vitest.config.ts (test alias).
const FAKE_CLIENT = { __fake: "admin-client" };
const SHOP_ID = 7476;

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => FAKE_CLIENT),
}));
vi.mock("@/lib/scheduler/shop-id", () => ({
  resolveAdminShopId: vi.fn(() => SHOP_ID),
}));
vi.mock("@/lib/keytag/queries/keytag-dashboard", () => ({
  getKeytagDashboardTool: vi.fn(),
}));
vi.mock("@/lib/keytag/queries/wip-keytags", () => ({
  listWipKeyTags: vi.fn(),
}));
vi.mock("@/lib/keytag/queries/manual-reviews", () => ({
  listManualReviewsTool: vi.fn(),
}));
vi.mock("@/lib/keytag/queries/audit-history", () => ({
  getKeytagAuditHistory: vi.fn(),
}));

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveAdminShopId } from "@/lib/scheduler/shop-id";
import { getKeytagDashboardTool } from "@/lib/keytag/queries/keytag-dashboard";
import { listWipKeyTags } from "@/lib/keytag/queries/wip-keytags";
import { listManualReviewsTool } from "@/lib/keytag/queries/manual-reviews";
import { getKeytagAuditHistory } from "@/lib/keytag/queries/audit-history";
import {
  getDashboard,
  getWipKeyTags,
  getManualReviews,
  getAuditHistory,
} from "@/lib/keytag/read-dal";

const mAdmin = vi.mocked(createSupabaseAdminClient);
const mShop = vi.mocked(resolveAdminShopId);
const mDashboard = vi.mocked(getKeytagDashboardTool);
const mWip = vi.mocked(listWipKeyTags);
const mReviews = vi.mocked(listManualReviewsTool);
const mAudit = vi.mocked(getKeytagAuditHistory);

beforeEach(() => {
  vi.clearAllMocks();
  mAdmin.mockReturnValue(FAKE_CLIENT as never);
  mShop.mockReturnValue(SHOP_ID);
});

describe("getDashboard", () => {
  it("passes the service-role client + server-resolved shop_id to the query and returns its result", async () => {
    const snapshot = { ok: true, generated_at: "x", counts: {}, stale: [], ros_without_tags: [], grid: [] };
    mDashboard.mockResolvedValue(snapshot as never);

    const out = await getDashboard();

    expect(mAdmin).toHaveBeenCalledTimes(1);
    expect(mShop).toHaveBeenCalledTimes(1);
    expect(mDashboard).toHaveBeenCalledWith(FAKE_CLIENT, SHOP_ID);
    expect(out).toBe(snapshot);
  });

  it("rejects (does not swallow to empty) when the query throws a DB error", async () => {
    mDashboard.mockRejectedValue(new Error("keytags query: boom"));
    await expect(getDashboard()).rejects.toThrow(/boom/);
  });
});

describe("getWipKeyTags", () => {
  it("passes the client + shop_id through and returns the result", async () => {
    const res = { ok: true, count: 0, shop_id: SHOP_ID, results: [] };
    mWip.mockResolvedValue(res as never);

    const out = await getWipKeyTags();

    expect(mWip).toHaveBeenCalledWith(FAKE_CLIENT, SHOP_ID);
    expect(out).toBe(res);
  });

  it("rejects when the query throws a DB error", async () => {
    mWip.mockRejectedValue(new Error("keytags query failed: nope"));
    await expect(getWipKeyTags()).rejects.toThrow(/nope/);
  });
});

describe("getManualReviews", () => {
  it("passes the client + the caller's args through and returns the result", async () => {
    const res = { ok: true, count: 0, open_count: 0, results: [] };
    mReviews.mockResolvedValue(res as never);
    const args = { only_open: true, limit: 200 };

    const out = await getManualReviews(args);

    expect(mReviews).toHaveBeenCalledWith(FAKE_CLIENT, args);
    // NOTE: shop_id is NOT an arg here — the reviews query is shop-global in
    // this single-shop product; assert the args object is threaded verbatim.
    expect(out).toBe(res);
  });

  it("rejects when the query throws a DB error", async () => {
    mReviews.mockRejectedValue(new Error("list_manual_reviews query failed: x"));
    await expect(getManualReviews({ only_open: true })).rejects.toThrow(/query failed/);
  });
});

describe("getAuditHistory", () => {
  it("passes the client + the caller's filters through and returns the result", async () => {
    const res = { ok: true, filters: {}, count: 0, results: [], truncated: false, message: "" };
    mAudit.mockResolvedValue(res as never);
    const args = { limit: 50, tag_color: "red" as const };

    const out = await getAuditHistory(args);

    expect(mAudit).toHaveBeenCalledWith(FAKE_CLIENT, args);
    expect(out).toBe(res);
  });

  it("rejects when the query throws a DB error", async () => {
    mAudit.mockRejectedValue(new Error("keytag_audit_log query failed: x"));
    await expect(getAuditHistory({})).rejects.toThrow(/query failed/);
  });
});

describe("10s seatbelt", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("rejects with a timeout when a query hangs past 10s", async () => {
    // A query that never settles — the seatbelt must win.
    mWip.mockReturnValue(new Promise(() => {}) as never);

    const p = getWipKeyTags();
    // Attach a rejection assertion BEFORE advancing timers so the rejection is
    // observed (avoids an unhandled-rejection warning).
    const assertion = expect(p).rejects.toThrow(/timed out after 10000ms/);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it("does NOT time out when the query settles before 10s", async () => {
    const res = { ok: true, count: 0, shop_id: SHOP_ID, results: [] };
    mWip.mockResolvedValue(res as never);

    const out = await getWipKeyTags();
    expect(out).toBe(res);
  });
});
