/**
 * Phase 0 build-seam spike (keytag orchestrator-removal) — Node/Vitest proof.
 *
 * This test exists to prove that the Node/Next runtime can IMPORT and EXECUTE
 * the shared `@jeffs/keytag-core` read package (raw `.ts` source, resolved via
 * the admin-app `file:` dependency + transpilePackages). It runs the package's
 * `buildKeytagDashboardData` read against a stubbed Supabase client returning
 * fixed rows, and asserts the returned shape against a golden snapshot.
 *
 * It does NOT hit a real DB and does NOT re-point any caller — the package is
 * still unconsumed by app code at Phase 0. The stub mimics the subset of the
 * supabase-js query-builder surface `buildKeytagDashboardData` touches
 * (.from().select().order()... and the .eq().is().or().limit() chain for the
 * ARN audit lookup), all thenable to the canned result.
 */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildKeytagDashboardData,
  getKeytagDashboardTool,
  type KeytagDashboardData,
} from "@jeffs/keytag-core";

const SHOP_ID = 7476;

// A frozen "now" reference so days_stale / staleCount are deterministic.
// Two in-use tags: R4 fresh (assigned today), Y45 stale (last activity 10d ago).
const NOW = Date.parse("2026-06-26T12:00:00.000Z");
const TEN_DAYS_AGO = new Date(NOW - 10 * 24 * 60 * 60_000).toISOString();
const TODAY = new Date(NOW).toISOString();

const KEYTAG_ROWS = [
  {
    tag_color: "red",
    tag_number: 4,
    status: "assigned",
    ro_id: 5,
    ro_number: 152222,
    customer_id: 11,
    customer_name: "Carmax",
    assigned_at: TODAY,
    posted_at: null,
    last_activity_at: TODAY,
  },
  {
    tag_color: "yellow",
    tag_number: 45,
    status: "posted_ar",
    ro_id: 6,
    ro_number: 152223,
    customer_id: 12,
    customer_name: "Nazareth Key",
    assigned_at: TEN_DAYS_AGO,
    posted_at: TEN_DAYS_AGO,
    last_activity_at: TEN_DAYS_AGO,
  },
  {
    tag_color: "red",
    tag_number: 1,
    status: "available",
    ro_id: null,
    ro_number: null,
    customer_id: null,
    customer_name: null,
    assigned_at: null,
    posted_at: null,
    last_activity_at: null,
  },
];

/**
 * Minimal thenable query-builder stub. Every chainable method returns `this`;
 * awaiting the builder yields the canned `{ data, error }`. `from()` routes to
 * the right canned result by table name.
 */
function makeStubClient(): SupabaseClient {
  function builderFor(result: { data: unknown; error: unknown }) {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const m of [
      "select",
      "eq",
      "is",
      "or",
      "in",
      "gte",
      "lte",
      "order",
      "limit",
      "maybeSingle",
    ]) {
      builder[m] = chain;
    }
    // Thenable: `await builder` resolves to the canned result.
    builder.then = (
      onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
    ) => Promise.resolve(result).then(onFulfilled);
    return builder;
  }

  const client = {
    from(table: string) {
      if (table === "keytags") {
        return builderFor({ data: KEYTAG_ROWS, error: null });
      }
      if (table === "keytag_manual_reviews") {
        // No unresolved ARN reviews → empty rosWithoutKeytags.
        return builderFor({ data: [], error: null });
      }
      if (table === "keytag_audit_log") {
        return builderFor({ data: [], error: null });
      }
      return builderFor({ data: [], error: null });
    },
  };
  return client as unknown as SupabaseClient;
}

describe("@jeffs/keytag-core — Node/Vitest import + execute (build-seam parity)", () => {
  it("buildKeytagDashboardData returns the golden snapshot shape", async () => {
    const data: KeytagDashboardData = await buildKeytagDashboardData(
      makeStubClient(),
      SHOP_ID,
    );

    // Counts: 2 in-use (R4 assigned, Y45 posted_ar), 1 available.
    expect(data.inUseCount).toBe(2);
    expect(data.availableCount).toBe(1);
    expect(data.tags).toHaveLength(3);

    // Only Y45 is stale (10d > STALE_DAYS=3); R4 is fresh.
    expect(data.staleCount).toBe(1);
    expect(data.staleDetails).toHaveLength(1);
    const stale = data.staleDetails[0]!;
    expect(stale).toMatchObject({
      tag_color: "yellow",
      tag_number: 45,
      ro_id: 6,
      ro_number: 152223,
      customer_name: "Nazareth Key",
      category: "ar",
      ro_url:
        "https://shop.tekmetric.com/admin/shop/7476/repair-orders/6/estimate",
    });
    expect(stale.days_stale).toBeGreaterThanOrEqual(9);

    // No unresolved ARN reviews wired → empty.
    expect(data.rosWithoutKeytags).toEqual([]);

    // generatedAt is an ISO timestamp.
    expect(() => new Date(data.generatedAt).toISOString()).not.toThrow();
  });

  it("getKeytagDashboardTool reshapes the snapshot into grid tiles", async () => {
    const result = await getKeytagDashboardTool(makeStubClient(), SHOP_ID);
    expect(result.ok).toBe(true);
    expect(result.counts).toEqual({
      in_use: 2,
      available: 1,
      stale: 1,
      total: 3,
    });
    expect(result.grid).toHaveLength(3);
    // The available tag is the only non-in-use tile.
    const available = result.grid.find((t) => !t.in_use);
    expect(available).toMatchObject({
      tag_color: "red",
      tag_number: 1,
      status: "available",
      ro_number: null,
    });
  });
});
