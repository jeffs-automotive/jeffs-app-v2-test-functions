/**
 * buildOpenRunSnapshot GP-composition tests (round-5 #38 + round-9 #45 +
 * round-10 #49): the precedence chain override > qbo_tech_cost > computed, the
 * #45 fee-INCLUSIVE month sales (Σ totalSales − taxes — supersedes #36; both
 * snapshot sales keys ride equal), the #49 office-manager bonus base
 * (fees-EXCLUDED sales for her family ONLY), and the single sanctioned catch
 * (QBO failure → Sentry with shop_id tag → labeled 'computed' fallback).
 * Fetchers are module-mocked; the calc engine, override precedence, snapshot
 * assembly + strict RunSnapshotSchema parse all run REAL — the assertions read
 * the frozen-shape snapshot itself.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Sentry from "@sentry/nextjs";

const { adminQueryMock } = vi.hoisted(() => ({ adminQueryMock: vi.fn() }));

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
// Only consulted by the round-7 #41 memo-validity check (reusableTechCostMemo) —
// the no-memo paths never touch it.
vi.mock("@/lib/dal/realm", () => ({ resolveRealmForShop: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "in", "not", "order", "range", "limit", "lte", "gte"]) {
        builder[m] = vi.fn(() => builder);
      }
      builder.then = (
        onFulfilled: (v: unknown) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) => Promise.resolve(adminQueryMock(table)).then(onFulfilled, onRejected);
      return builder;
    },
  })),
}));
vi.mock("@/lib/dal/settings", () => ({ getShopSettings: vi.fn() }));
vi.mock("@/lib/qbo/reports", () => ({ qboMonthTechnicianCostCents: vi.fn() }));
vi.mock("@/lib/dal/payroll-leave-rate", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchLeaveRateHistory: vi.fn(),
}));
vi.mock("@/lib/payroll/derive", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  billedHoursByTechnician: vi.fn(),
  monthSalesPreTaxCents: vi.fn(),
  monthFeesCents: vi.fn(),
  monthPartsCostCents: vi.fn(),
  shopBilledHours: vi.fn(),
  spiffCountsByServiceWriter: vi.fn(),
  priorYearMonthSubtotalCents: vi.fn(),
  priorYearShopBilledHours: vi.fn(),
}));
vi.mock("@/lib/dal/payroll-shared", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchRunEntries: vi.fn(),
  fetchEmployeesByIds: vi.fn(),
  getPayrollSettings: vi.fn(),
}));

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getShopSettings } from "@/lib/dal/settings";
import { qboMonthTechnicianCostCents } from "@/lib/qbo/reports";
import { fetchLeaveRateHistory } from "@/lib/dal/payroll-leave-rate";
import {
  billedHoursByTechnician,
  monthFeesCents,
  monthPartsCostCents,
  monthSalesPreTaxCents,
  priorYearMonthSubtotalCents,
  shopBilledHours,
  spiffCountsByServiceWriter,
} from "@/lib/payroll/derive";
import {
  fetchEmployeesByIds,
  fetchRunEntries,
  getPayrollSettings,
  type EntryDbRow,
  type RunDbRow,
} from "@/lib/dal/payroll-shared";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { buildOpenRunSnapshot } from "@/lib/dal/payroll-compute";
import type { QboTechCostMemo } from "@/lib/dal/payroll-compute-gp";

// ── Fixtures ───────────────────────────────────────────────────────────────────

const RUN_ID = "0b2e6f3a-1c4d-4e5f-8a9b-0c1d2e3f4a5b";
const EMPLOYEE_ID = "6b1f0d9e-4c3a-4b2a-9d1e-2f3a4b5c6d7e";
const SHOP_ID = 7476;

const run: RunDbRow = {
  id: RUN_ID,
  shop_id: SHOP_ID,
  period_start: "2026-06-28",
  period_end: "2026-07-11",
  status: "open",
  bonus_period: true,
  bonus_month: "2026-06-01",
  snapshot: null,
  live_snapshot: null,
  live_snapshot_at: null,
  live_snapshot_stale: true,
  completed_at: null,
  completed_by_label: null,
  voided_at: null,
  voided_by_label: null,
  void_reason: null,
  cloned_from_run_id: null,
  created_at: "2026-06-28T00:00:00Z",
  updated_at: "2026-07-11T00:00:00Z",
};

const saPayConfig = {
  config_version: 1,
  pto_balance_hours: 0,
  pto_accrual_hours_per_period: 0,
  weekly_salary_cents: 115_384,
  gp_goal_1_cents: 11_500_000,
  gp_goal_2_cents: 12_500_000,
  sales_goal_cents: 25_769_874,
  tier1_pct: 0.005,
  tier2_pct: 0.01,
  tier3_pct: 0.02,
  spiff_amount_cents: 500,
};

function saEntry(overrides: Record<string, unknown> = {}): EntryDbRow {
  return {
    id: "9a8b7c6d-5e4f-4a3b-8c9d-0e1f2a3b4c5d",
    run_id: RUN_ID,
    shop_id: SHOP_ID,
    employee_id: EMPLOYEE_ID,
    role_snapshot: "service_manager",
    pay_config: saPayConfig,
    clock_hours_w1: null,
    clock_hours_w2: null,
    pto_w1: null,
    pto_w2: null,
    holiday_w1: null,
    holiday_w2: null,
    bereavement_w1: null,
    bereavement_w2: null,
    training_w1: null,
    training_w2: null,
    manual_incentive_cents: null,
    overrides,
    updated_at: "2026-07-11T00:00:00Z",
  };
}

const derived = <T>(value: T, roCount = 10) => ({
  value,
  provenance: {
    roCount,
    dateRange: { start: "2026-06-01", end: "2026-06-30" },
    asOf: "2026-07-11T04:00:00Z",
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  adminQueryMock.mockResolvedValue({ data: [], error: null }); // no overlapping runs
  vi.mocked(getShopSettings).mockResolvedValue({
    settings: { shopTimezone: "America/New_York" },
  } as never);
  vi.mocked(getPayrollSettings).mockResolvedValue({
    realmId: "R123",
    payroll: { anchor_period_start: "2026-06-28", spiff_categories: [], alert_emails: { void_clone: [], completed: [] } },
  } as never);
  vi.mocked(fetchRunEntries).mockResolvedValue([saEntry()]);
  vi.mocked(fetchEmployeesByIds).mockResolvedValue(
    new Map([
      [
        EMPLOYEE_ID,
        {
          id: EMPLOYEE_ID,
          shopId: SHOP_ID,
          displayName: "James Wollman",
          role: "service_manager",
          tekmetricEmployeeId: 900,
          tekmetricIdType: "service_writer",
          payConfig: saPayConfig,
          archivedAt: null,
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-01T00:00:00Z",
        },
      ],
    ]) as never,
  );
  vi.mocked(fetchLeaveRateHistory).mockResolvedValue(new Map());
  vi.mocked(billedHoursByTechnician).mockResolvedValue(derived(new Map<number, number>(), 5));
  // June 2026 real figures (extraction #45/#37/#38):
  vi.mocked(monthSalesPreTaxCents).mockResolvedValue(
    derived({ totalSalesCents: 30_000_000, totalSalesMinusTaxesCents: 28_629_076 }),
  );
  vi.mocked(monthFeesCents).mockResolvedValue(derived(1_322_963));
  vi.mocked(monthPartsCostCents).mockResolvedValue(derived(6_937_090));
  vi.mocked(shopBilledHours).mockResolvedValue(derived(1_176.7));
  vi.mocked(spiffCountsByServiceWriter).mockResolvedValue(derived(new Map([[900, 3]])));
  vi.mocked(priorYearMonthSubtotalCents).mockResolvedValue(derived(25_000_000));
  vi.mocked(qboMonthTechnicianCostCents).mockResolvedValue({
    valueCents: 4_874_072,
    accountLabel: "6010 Technicians",
    matchedBy: "account_id",
    realmId: "R123",
  });
});

describe("buildOpenRunSnapshot — GP composition (#38) + month sales (#45)", () => {
  it("primary path: sales(incl fees) − parts − QBO 6010 tech cost, source 'qbo_tech_cost'; month sales = Σ(totalSales − taxes), fees IN", async () => {
    const snapshot = await buildOpenRunSnapshot(SHOP_ID, run);
    const prov = snapshot.derived_provenance as Record<string, unknown>;

    // #45 (supersedes #36; restores #28): display sales = 28,629,076 ($286,290.76,
    // June acceptance) — EQUAL to the GP-base key, which is kept for auditability.
    expect(prov.month_sales_cents).toBe(28_629_076);
    expect(prov.month_sales_incl_fees_cents).toBe(28_629_076);

    // #38 June acceptance: 286,290.76 − 69,370.90 − 48,740.72 = 168,179.14; − fees = 154,949.51.
    expect(prov.month_gp_source).toBe("qbo_tech_cost");
    expect(prov.month_qbo_tech_cost_cents).toBe(4_874_072);
    expect(prov.month_qbo_tech_cost_account).toBe("6010 Technicians");
    expect(prov.month_gp_with_fees_cents).toBe(16_817_914);
    expect(prov.month_gp_without_fees_cents).toBe(15_494_951);
    expect(prov.month_labor_pay_prorated_cents).toBeNull();

    // The SA sheet consumed the composed values (override-free).
    const sa = snapshot.employees[0];
    expect(sa?.derived.month_sales_cents).toBe(28_629_076);
    expect(sa?.derived.month_gp_with_fees_cents).toBe(16_817_914);
    expect(sa?.derived.month_gp_without_fees_cents).toBe(15_494_951);
    expect(sa?.derived.spiff_count).toBe(3);
    expect(sa?.derived.sales_goal_cents).toBe(25_000_000);

    // No fallback ran: no overlapping-runs query, no Sentry noise.
    expect(vi.mocked(createSupabaseAdminClient)).not.toHaveBeenCalled();
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
  });

  it("fallback path: a QBO failure is Sentry-captured (shop_id tag) and GP comes from the computed prorated-labor path, source 'computed'", async () => {
    const boom = new Error("QBO P&L parse: no row matching account 6010");
    vi.mocked(qboMonthTechnicianCostCents).mockRejectedValue(boom);

    const snapshot = await buildOpenRunSnapshot(SHOP_ID, run);
    const prov = snapshot.derived_provenance as Record<string, unknown>;

    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({
        tags: expect.objectContaining({ shop_id: String(SHOP_ID) }),
      }),
    );
    expect(prov.month_gp_source).toBe("computed");
    expect(prov.month_qbo_tech_cost_cents).toBeNull();
    // SA-only roster → zero GP-role labor pay; sales base stays the fee-INCLUSIVE figure.
    expect(prov.month_labor_pay_prorated_cents).toBe(0);
    expect(prov.month_gp_with_fees_cents).toBe(28_629_076 - 6_937_090);
    expect(prov.month_gp_without_fees_cents).toBe(28_629_076 - 6_937_090 - 1_322_963);
    expect(vi.mocked(createSupabaseAdminClient)).toHaveBeenCalled();
  });

  it("override precedence: a per-employee month_gp_with_fees_cents override beats the qbo_tech_cost composition (which still records in provenance)", async () => {
    vi.mocked(fetchRunEntries).mockResolvedValue([
      saEntry({ month_gp_with_fees_cents: { value: 12_345, note: "hand-checked" } }),
    ]);

    const snapshot = await buildOpenRunSnapshot(SHOP_ID, run);
    const prov = snapshot.derived_provenance as Record<string, unknown>;
    const sa = snapshot.employees[0];

    expect(sa?.derived.month_gp_with_fees_cents).toBe(12_345); // override wins on the sheet
    expect(prov.month_gp_source).toBe("qbo_tech_cost"); // the month-level derivation is untouched
    expect(prov.month_gp_with_fees_cents).toBe(16_817_914);
  });

  it("a fresh fetch stamps the round-7 #41 memo provenance (fetched_at + realm)", async () => {
    const snapshot = await buildOpenRunSnapshot(SHOP_ID, run);
    const prov = snapshot.derived_provenance as Record<string, unknown>;
    expect(typeof prov.month_qbo_tech_cost_fetched_at).toBe("string");
    expect(prov.month_qbo_tech_cost_realm_id).toBe("R123");
  });
});

// ── Round-10 #49: the office-manager bonus base excludes fees ──────────────────

describe("buildOpenRunSnapshot — office-manager bonus base (#49)", () => {
  const OM_ID = "3f2a1b0c-9d8e-4f7a-b6c5-d4e3f2a1b0c9";
  const omPayConfig = {
    config_version: 1,
    pto_balance_hours: 0,
    pto_accrual_hours_per_period: 0,
    hourly_rate_cents: 2_600,
    sales_goal_cents: 25_000_000,
    bonus_pct: 0.01,
  };
  const omEntry: EntryDbRow = {
    ...saEntry(),
    id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    employee_id: OM_ID,
    role_snapshot: "office_manager",
    pay_config: omPayConfig,
  };

  const omEmployee = {
    id: OM_ID,
    shopId: SHOP_ID,
    displayName: "Marie Aube",
    role: "office_manager",
    tekmetricEmployeeId: 901,
    tekmetricIdType: "service_writer",
    payConfig: omPayConfig,
    archivedAt: null,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  };

  it("the OM sheet consumes sales − fees while the SA sheet keeps the fee-inclusive #45 figure", async () => {
    vi.mocked(fetchRunEntries).mockResolvedValue([saEntry(), omEntry]);
    vi.mocked(fetchEmployeesByIds).mockResolvedValue(
      new Map<string, unknown>([
        [
          EMPLOYEE_ID,
          {
            ...omEmployee,
            id: EMPLOYEE_ID,
            displayName: "James Wollman",
            role: "service_manager",
            tekmetricEmployeeId: 900,
            payConfig: saPayConfig,
          },
        ],
        [OM_ID, omEmployee],
      ]) as never,
    );

    const snapshot = await buildOpenRunSnapshot(SHOP_ID, run);
    const om = snapshot.employees.find((e) => e.family === "office_manager");
    const sa = snapshot.employees.find((e) => e.family === "service_advisor");
    const prov = snapshot.derived_provenance as Record<string, unknown>;

    // Her effective input: 28,629,076 − 1,322,963 = 27,306,113 (fees OUT).
    expect(om?.derived.month_sales_cents).toBe(27_306_113);
    // Her bonus: (27,306,113 − 25,000,000) × 1% = 23,061.13 → 23,061.
    expect(om?.sheet.bonus_cents).toBe(23_061);
    // The SA tier check + the run-level display definition stay fee-INCLUSIVE (#45).
    expect(sa?.derived.month_sales_cents).toBe(28_629_076);
    expect(prov.month_sales_cents).toBe(28_629_076);
  });

  it("a month_sales_cents override on her entry still beats the fees-out derivation", async () => {
    vi.mocked(fetchRunEntries).mockResolvedValue([
      { ...omEntry, overrides: { month_sales_cents: { value: 26_000_000, note: "hand-checked" } } },
    ]);
    vi.mocked(fetchEmployeesByIds).mockResolvedValue(new Map([[OM_ID, omEmployee]]) as never);

    const snapshot = await buildOpenRunSnapshot(SHOP_ID, run);
    const om = snapshot.employees[0];
    expect(om?.derived.month_sales_cents).toBe(26_000_000);
    // (26,000,000 − 25,000,000) × 1% = 10,000.
    expect(om?.sheet.bonus_cents).toBe(10_000);
  });
});

// ── Round-7 #41: the < 6h QBO tech-cost memo ──────────────────────────────────

describe("buildOpenRunSnapshot — QBO tech-cost memo reuse (#41)", () => {
  const memo = (over: Partial<QboTechCostMemo> = {}): QboTechCostMemo => ({
    month: "2026-06",
    valueCents: 4_874_072,
    accountLabel: "6010 Technicians (memo)",
    fetchedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h old
    realmId: "R123",
    ...over,
  });

  it("a fresh (realm, month) memo replaces the live QBO fetch and carries its own fetched_at", async () => {
    vi.mocked(resolveRealmForShop).mockResolvedValue("R123");
    const m = memo();
    const snapshot = await buildOpenRunSnapshot(SHOP_ID, run, { qboTechCostMemo: m });
    const prov = snapshot.derived_provenance as Record<string, unknown>;

    expect(vi.mocked(qboMonthTechnicianCostCents)).not.toHaveBeenCalled();
    expect(prov.month_gp_source).toBe("qbo_tech_cost");
    expect(prov.month_qbo_tech_cost_cents).toBe(4_874_072);
    expect(prov.month_qbo_tech_cost_account).toBe("6010 Technicians (memo)");
    expect(prov.month_qbo_tech_cost_fetched_at).toBe(m.fetchedAt); // the ORIGINAL fetch time
    expect(prov.month_qbo_tech_cost_realm_id).toBe("R123");
    expect(prov.month_gp_with_fees_cents).toBe(16_817_914); // same composition as a fresh fetch
  });

  it("an EXPIRED memo (>= 6h) is ignored — fresh fetch", async () => {
    vi.mocked(resolveRealmForShop).mockResolvedValue("R123");
    const stale = memo({ fetchedAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString() });
    await buildOpenRunSnapshot(SHOP_ID, run, { qboTechCostMemo: stale });
    expect(vi.mocked(qboMonthTechnicianCostCents)).toHaveBeenCalledWith(SHOP_ID, "2026-06");
  });

  it("a memo from a DIFFERENT realm is ignored — fresh fetch (per-(realm, month) pinning)", async () => {
    vi.mocked(resolveRealmForShop).mockResolvedValue("R999");
    await buildOpenRunSnapshot(SHOP_ID, run, { qboTechCostMemo: memo() });
    expect(vi.mocked(qboMonthTechnicianCostCents)).toHaveBeenCalled();
  });

  it("a memo for a DIFFERENT month is ignored — fresh fetch (no realm lookup needed)", async () => {
    await buildOpenRunSnapshot(SHOP_ID, run, { qboTechCostMemo: memo({ month: "2026-05" }) });
    expect(vi.mocked(resolveRealmForShop)).not.toHaveBeenCalled();
    expect(vi.mocked(qboMonthTechnicianCostCents)).toHaveBeenCalled();
  });
});
