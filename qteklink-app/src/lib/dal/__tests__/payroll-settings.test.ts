/**
 * updatePayrollSettings — the live-snapshot invalidation hook (round-7 #41):
 * spiff-category edits (multiplier/counted/name) change service-advisor spiff PAY
 * on open runs, so the direct settings-page write must invalidate the display
 * cache like every other post-commit mutation hook (it was the one gap in the
 * invalidation matrix). The mark runs AFTER the settings RPC commits and is
 * capture-not-throw — the committed save is never misreported as failed.
 * Split from payroll.test.ts per the ~500-line file policy (same mock idiom).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock, from: fromMock }),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock("@/lib/dal/notify", () => ({ sendQteklinkEmail: vi.fn() }));
vi.mock("@/lib/payroll/mirror-ingest", () => ({ runMirrorIngest: vi.fn() }));
vi.mock("@/lib/dal/payroll-compute", () => ({ buildOpenRunSnapshot: vi.fn() }));
vi.mock("@/lib/dal/payroll-live", () => ({
  computePayrollRun: vi.fn(),
  getOrComputeLiveSnapshot: vi.fn(),
  markPayrollOpenRunsStale: vi.fn(),
  recomputeAndStoreLiveSnapshot: vi.fn(),
  refreshLiveSnapshotAfterMutation: vi.fn(),
}));
vi.mock("@/lib/payroll/derive", () => ({ discoverNewCategories: vi.fn(), monthDateRange: vi.fn() }));

import * as Sentry from "@sentry/nextjs";
import { markPayrollOpenRunsStale } from "@/lib/dal/payroll-live";
import { updatePayrollSettings } from "../payroll";

function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "order", "limit", "range"]) c[m] = vi.fn(() => c);
  c.then = (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF);
  return c;
}

function routeRpc(overrides: Record<string, { data: unknown; error: unknown }> = {}) {
  rpcMock.mockImplementation((fn: string) => {
    if (fn in overrides) return Promise.resolve(overrides[fn]);
    return Promise.resolve({ data: null, error: null });
  });
}

const SETTINGS_ROW = {
  payroll: {
    anchor_period_start: "2026-06-28",
    spiff_categories: [],
    alert_emails: { void_clone: [], completed: [] },
  },
};
const CATEGORY = {
  name: "Tires",
  counted: true,
  multiplier: 1,
  first_seen: "2026-07-11T00:00:00Z",
  is_new: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  fromMock.mockImplementation((table: string) => {
    if (table === "qteklink_settings") return chain({ data: [SETTINGS_ROW], error: null });
    throw new Error(`unexpected table ${table}`);
  });
  routeRpc({ qbo_resolve_realm_for_shop: { data: "realm-A", error: null } });
});

describe("updatePayrollSettings live-snapshot invalidation (round-7 #41)", () => {
  it("marks every open run stale AFTER the committed settings write", async () => {
    await updatePayrollSettings(7476, { spiff_categories: [CATEGORY] });
    expect(rpcMock).toHaveBeenCalledWith(
      "qteklink_upsert_settings",
      expect.objectContaining({
        p_shop_id: 7476,
        p_payroll: expect.objectContaining({ spiff_categories: [CATEGORY] }),
      }),
    );
    expect(vi.mocked(markPayrollOpenRunsStale)).toHaveBeenCalledWith(7476);
  });

  it("a mark failure is captured, never thrown — the committed save is not misreported", async () => {
    vi.mocked(markPayrollOpenRunsStale).mockRejectedValueOnce(new Error("mark exploded"));
    await expect(updatePayrollSettings(7476, { spiff_categories: [CATEGORY] })).resolves.toMatchObject({
      spiff_categories: [CATEGORY],
    });
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ qteklink_action: "payroll-settings-invalidate" }),
      }),
    );
  });

  it("a FAILED settings RPC never marks stale (nothing committed)", async () => {
    routeRpc({
      qbo_resolve_realm_for_shop: { data: "realm-A", error: null },
      qteklink_upsert_settings: { data: null, error: { code: "P0001", message: "garbage anchor" } },
    });
    await expect(updatePayrollSettings(7476, { spiff_categories: [CATEGORY] })).rejects.toThrow(
      /garbage anchor/,
    );
    expect(vi.mocked(markPayrollOpenRunsStale)).not.toHaveBeenCalled();
  });
});
