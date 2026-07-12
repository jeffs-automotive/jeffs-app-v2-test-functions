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
import { discoverNewCategories } from "@/lib/payroll/derive";
import {
  discoverAndMergePayrollCategories,
  getPayrollSettings,
  updatePayrollSettings,
} from "../payroll";

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

// ── Round-11 whole-replace-wipe guard (plan §7, C1/C10/C17/C28/C31 family) ─────
//
// The single most-found regression: the settings write is a WHOLE-object replace.
// A patch that touches only ONE key (spiff, or the AUTOMATIC discover-and-merge
// fired by "Refresh Tekmetric data") must round-trip every other key — including
// the four Round-11 PTO keys — untouched. If the TS chain is unextended anywhere,
// these keys silently VANISH from the p_payroll the RPC receives.

/** A settings row with all four PTO keys populated (the state after Chris configures). */
const PTO_POPULATED_ROW = {
  payroll: {
    anchor_period_start: "2026-06-28",
    spiff_categories: [CATEGORY],
    alert_emails: { void_clone: ["a@x.com"], completed: ["b@x.com"] },
    pto_tenure_tiers: [
      { min_years: 0, hours_per_period: 4 },
      { min_years: 5, hours_per_period: 6 },
    ],
    pto_rollover_cap_hours: 80,
    pto_adjustment_alert_emails: ["adj@x.com"],
    pto_negative_alert_admin_emails: ["neg@x.com"],
  },
};

/** Pull the p_payroll argument from the (only) qteklink_upsert_settings call. */
function lastUpsertPayroll(): Record<string, unknown> {
  const call = rpcMock.mock.calls.find((c) => c[0] === "qteklink_upsert_settings");
  if (!call) throw new Error("qteklink_upsert_settings was never called");
  return (call[1] as { p_payroll: Record<string, unknown> }).p_payroll;
}

describe("settings whole-replace preserves the four PTO keys (C1 family)", () => {
  beforeEach(() => {
    // Read path returns the PTO-populated row for these round-trip tests.
    fromMock.mockImplementation((table: string) => {
      if (table === "qteklink_settings") return chain({ data: [PTO_POPULATED_ROW], error: null });
      throw new Error(`unexpected table ${table}`);
    });
    routeRpc({ qbo_resolve_realm_for_shop: { data: "realm-A", error: null } });
  });

  it("a spiff-categories-ONLY patch round-trips all four PTO keys unchanged", async () => {
    const NEW_CAT = { ...CATEGORY, name: "Alignments" };
    await updatePayrollSettings(7476, { spiff_categories: [NEW_CAT] });

    const p = lastUpsertPayroll();
    // The one key the patch touched changed…
    expect(p.spiff_categories).toEqual([NEW_CAT]);
    // …and every PTO key survived the whole-object rebuild.
    expect(p.pto_tenure_tiers).toEqual(PTO_POPULATED_ROW.payroll.pto_tenure_tiers);
    expect(p.pto_rollover_cap_hours).toBe(80);
    expect(p.pto_adjustment_alert_emails).toEqual(["adj@x.com"]);
    expect(p.pto_negative_alert_admin_emails).toEqual(["neg@x.com"]);
    // The legacy alert_emails pair is untouched too.
    expect(p.alert_emails).toEqual({ void_clone: ["a@x.com"], completed: ["b@x.com"] });
  });

  it("discoverAndMergePayrollCategories merge round-trips all four PTO keys unchanged", async () => {
    // One brand-new Tekmetric category surfaces → the merge writes settings back.
    vi.mocked(discoverNewCategories).mockResolvedValueOnce(["Diagnostics"]);

    const { added } = await discoverAndMergePayrollCategories(7476);
    expect(added).toEqual(["Diagnostics"]);

    const p = lastUpsertPayroll();
    // The merged category list carries the existing category + the discovered one…
    expect((p.spiff_categories as Array<{ name: string }>).map((c) => c.name)).toEqual([
      "Tires",
      "Diagnostics",
    ]);
    // …and the PTO configuration is preserved verbatim through the automatic write.
    expect(p.pto_tenure_tiers).toEqual(PTO_POPULATED_ROW.payroll.pto_tenure_tiers);
    expect(p.pto_rollover_cap_hours).toBe(80);
    expect(p.pto_adjustment_alert_emails).toEqual(["adj@x.com"]);
    expect(p.pto_negative_alert_admin_emails).toEqual(["neg@x.com"]);
  });

  it("normalizePayrollSettings round-trips a fully-populated object (via getPayrollSettings)", async () => {
    // getPayrollSettings runs the raw DB row through normalizePayrollSettings —
    // exercising the normalizer at the module boundary the mock idiom supports.
    const { payroll } = await getPayrollSettings(7476);
    expect(payroll).toEqual({
      anchor_period_start: "2026-06-28",
      spiff_categories: [CATEGORY],
      alert_emails: { void_clone: ["a@x.com"], completed: ["b@x.com"] },
      pto_tenure_tiers: [
        { min_years: 0, hours_per_period: 4 },
        { min_years: 5, hours_per_period: 6 },
      ],
      pto_rollover_cap_hours: 80,
      pto_adjustment_alert_emails: ["adj@x.com"],
      pto_negative_alert_admin_emails: ["neg@x.com"],
    });
  });
});

describe("a production-shaped settings object with NO PTO keys normalizes cleanly", () => {
  it("defaults every absent PTO key rather than throwing (the pre-migration row shape)", async () => {
    // SETTINGS_ROW (module-level) is exactly the legacy shape: anchor + spiff +
    // alert_emails, NONE of the four PTO keys. The nullish schema must default them.
    fromMock.mockImplementation((table: string) => {
      if (table === "qteklink_settings") return chain({ data: [SETTINGS_ROW], error: null });
      throw new Error(`unexpected table ${table}`);
    });
    routeRpc({ qbo_resolve_realm_for_shop: { data: "realm-A", error: null } });

    const { payroll } = await getPayrollSettings(7476);
    expect(payroll.pto_tenure_tiers).toEqual([]);
    expect(payroll.pto_rollover_cap_hours).toBeNull();
    expect(payroll.pto_adjustment_alert_emails).toEqual([]);
    expect(payroll.pto_negative_alert_admin_emails).toEqual([]);
    // The legacy keys still normalize as before.
    expect(payroll.anchor_period_start).toBe("2026-06-28");
    expect(payroll.alert_emails).toEqual({ void_clone: [], completed: [] });
  });
});
