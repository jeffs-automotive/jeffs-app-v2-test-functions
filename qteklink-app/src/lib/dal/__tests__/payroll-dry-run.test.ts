/**
 * payroll-dry-run.ts unit tests (round-7 #42) — the dry-run orchestration:
 *   - open runs only (a completed run rejects BEFORE any Tekmetric call);
 *   - BEFORE numbers captured from the live snapshot BEFORE the ingest runs;
 *   - the range ingest carries the period's posted window PLUS
 *     updatedDateStart = period_start (the completed-but-unposted catch), and the
 *     bonus month's posted window when the slider is on — nothing else;
 *   - every open run marked stale, THIS run recomputed fresh (freshQbo: true);
 *   - the recompute racing a completion (null) surfaces a validation error;
 *   - the diff is built before→after and rosChecked sums the passes.
 * fetchRunGuarded / payroll-live / mirror-ingest are mocked; buildDryRunDiff runs REAL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/dal/payroll-shared", () => ({
  fetchRunGuarded: vi.fn(),
  fetchEmployeesByIds: vi.fn(),
  getPayrollSettings: vi.fn(),
}));
vi.mock("@/lib/dal/payroll-live", () => ({
  getOrComputeLiveSnapshot: vi.fn(),
  markPayrollOpenRunsStale: vi.fn(),
  recomputeAndStoreLiveSnapshot: vi.fn(),
}));
vi.mock("@/lib/payroll/mirror-ingest", () => ({ runMirrorIngest: vi.fn() }));
// Round-11 (plan §4): the PTO projection reads the ledger + runs the pure engine.
// projectRunPto + ptoFieldsFromEmployee run REAL (pure); only the DB fetchers mock.
vi.mock("@/lib/dal/payroll-pto", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/dal/payroll-pto")>();
  return {
    ...actual,
    getPtoBalances: vi.fn(),
    getPtoRolloverLedger: vi.fn(),
  };
});

import {
  fetchRunGuarded,
  fetchEmployeesByIds,
  getPayrollSettings,
  type PayrollEmployee,
  type PayrollSettings,
  type RunDbRow,
} from "@/lib/dal/payroll-shared";
import {
  getOrComputeLiveSnapshot,
  markPayrollOpenRunsStale,
  recomputeAndStoreLiveSnapshot,
} from "@/lib/dal/payroll-live";
import { getPtoBalances, getPtoRolloverLedger } from "@/lib/dal/payroll-pto";
import { runMirrorIngest } from "@/lib/payroll/mirror-ingest";
import { CALC_VERSION } from "@/lib/payroll/calc";
import type { RunSnapshot, SnapshotEmployee } from "@/lib/payroll/types";
import { dryRunPayrollRefresh } from "../payroll-dry-run";

const SHOP_ID = 7476;
const RUN_UUID = "7f0a1b2c-3d4e-4f5a-8b9c-0d1e2f3a4b5c";

function makeRun(over: Partial<RunDbRow> = {}): RunDbRow {
  return {
    id: RUN_UUID,
    shop_id: SHOP_ID,
    period_start: "2026-06-28",
    period_end: "2026-07-11",
    status: "open",
    bonus_period: false,
    bonus_month: null,
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
    ...over,
  };
}

function validSnapshot(asOf: string): RunSnapshot {
  return {
    snapshot_version: 1,
    calc_version: CALC_VERSION,
    run: {
      run_id: RUN_UUID,
      shop_id: SHOP_ID,
      period_start: "2026-06-28",
      period_end: "2026-07-11",
      bonus_period: false,
      bonus_month: null,
    },
    employees: [],
    summary: [],
    derived_provenance: {
      as_of: asOf,
      period_start: "2026-06-28",
      period_end: "2026-07-11",
      bonus_month: null,
      ro_count: 0,
      source: "tekmetric_ros mirror",
    },
    spiff_categories: [],
  };
}

const ingestResult = (rosUpserted: number) => ({
  rosUpserted,
  pagesFetched: 1,
  alerts: [],
  watermark: null,
});

const EMP_ID = "11111111-2222-4333-8444-555566667777";

/** A snapshot carrying ONE roster employee with paid PTO hours — the dry-run PTO
 *  projection reads `sheet.pto_hours` + `display_name`; buildDryRunDiff reads the
 *  derived/family/summary. Cast because only these fields are exercised. */
function snapshotWithEmployee(asOf: string, ptoHours: number): RunSnapshot {
  const base = validSnapshot(asOf);
  const employee = {
    employee_id: EMP_ID,
    display_name: "Clark, Matt",
    role: "technician",
    family: "technician",
    derived: { billed_hours_w1: null, billed_hours_w2: null, spiff_count: null },
    sheet: { pto_hours: ptoHours },
  } as unknown as SnapshotEmployee;
  return {
    ...base,
    employees: [employee],
    summary: [{ employee_id: EMP_ID, display_name: "Clark, Matt", total_pay_cents: 0 } as never],
  };
}

/** A master employee row with the round-11 profile columns (read surface). */
function master(over: Partial<PayrollEmployee> = {}): PayrollEmployee {
  return {
    id: EMP_ID,
    shopId: SHOP_ID,
    displayName: "Clark, Matt",
    role: "technician",
    tekmetricEmployeeId: 501,
    tekmetricIdType: "technician",
    payConfig: {},
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    workEmail: null,
    personalEmail: "matt@example.com",
    personalPhone: null,
    workPhone: null,
    address: null,
    startDate: "2024-01-01",
    terminationDate: null,
    ptoGrandfathered: false,
    ptoTenureCreditDate: null,
    fullTime: true,
    ...over,
  };
}

const PTO_SETTINGS: PayrollSettings = {
  anchor_period_start: "2026-06-28",
  spiff_categories: [],
  alert_emails: { void_clone: [], completed: [] },
  pto_tenure_tiers: [{ min_years: 0, hours_per_period: 4 }],
  pto_rollover_cap_hours: null,
  pto_adjustment_alert_emails: [],
  pto_negative_alert_admin_emails: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchRunGuarded).mockResolvedValue(makeRun());
  vi.mocked(getOrComputeLiveSnapshot).mockResolvedValue(validSnapshot("2026-07-11T04:00:00Z"));
  vi.mocked(runMirrorIngest).mockResolvedValue(ingestResult(7));
  vi.mocked(markPayrollOpenRunsStale).mockResolvedValue(2);
  vi.mocked(recomputeAndStoreLiveSnapshot).mockResolvedValue(validSnapshot("2026-07-11T16:00:00Z"));
  // PTO projection defaults (empty-roster snapshots never reach these).
  vi.mocked(getPayrollSettings).mockResolvedValue({ realmId: "r1", payroll: PTO_SETTINGS });
  vi.mocked(fetchEmployeesByIds).mockResolvedValue(new Map([[EMP_ID, master()]]));
  vi.mocked(getPtoBalances).mockResolvedValue(new Map());
  vi.mocked(getPtoRolloverLedger).mockResolvedValue(new Map());
});

describe("dryRunPayrollRefresh", () => {
  it("rejects non-open runs BEFORE touching Tekmetric", async () => {
    vi.mocked(fetchRunGuarded).mockResolvedValue(makeRun({ status: "completed" }));
    await expect(dryRunPayrollRefresh(SHOP_ID, RUN_UUID)).rejects.toThrow(/only open runs/i);
    expect(vi.mocked(runMirrorIngest)).not.toHaveBeenCalled();
    expect(vi.mocked(markPayrollOpenRunsStale)).not.toHaveBeenCalled();
  });

  it("non-bonus run: BEFORE first, then ONE range ingest (posted window + updated-since), mark-stale, fresh recompute", async () => {
    const out = await dryRunPayrollRefresh(SHOP_ID, RUN_UUID);

    // the BEFORE numbers are captured BEFORE the mirror moves
    const beforeOrder = vi.mocked(getOrComputeLiveSnapshot).mock.invocationCallOrder[0]!;
    const ingestOrder = vi.mocked(runMirrorIngest).mock.invocationCallOrder[0]!;
    expect(beforeOrder).toBeLessThan(ingestOrder);

    // exactly ONE ingest with ONLY Tekmetric-supported filters
    expect(vi.mocked(runMirrorIngest)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runMirrorIngest)).toHaveBeenCalledWith(
      { shopId: SHOP_ID },
      {
        mode: "range",
        postedDateStart: "2026-06-28",
        postedDateEnd: "2026-07-11",
        updatedDateStart: "2026-06-28",
      },
    );

    // shop-wide invalidation, then THIS run recomputed fresh (never the QBO memo)
    expect(vi.mocked(markPayrollOpenRunsStale)).toHaveBeenCalledWith(SHOP_ID);
    expect(vi.mocked(recomputeAndStoreLiveSnapshot)).toHaveBeenCalledWith(SHOP_ID, RUN_UUID, {
      freshQbo: true,
    });
    const staleOrder = vi.mocked(markPayrollOpenRunsStale).mock.invocationCallOrder[0]!;
    const recomputeOrder = vi.mocked(recomputeAndStoreLiveSnapshot).mock.invocationCallOrder[0]!;
    expect(ingestOrder).toBeLessThan(staleOrder);
    expect(staleOrder).toBeLessThan(recomputeOrder);

    // diff (built REAL) carries the as-of stamps; identical snapshots → no changes
    expect(out.diff.changed).toBe(false);
    expect(out.diff.beforeAsOf).toBe("2026-07-11T04:00:00Z");
    expect(out.diff.afterAsOf).toBe("2026-07-11T16:00:00Z");
    expect(out.rosChecked).toBe(7);
  });

  it("bonus run: a SECOND posted-window ingest for the bonus month; rosChecked sums", async () => {
    vi.mocked(fetchRunGuarded).mockResolvedValue(
      makeRun({ bonus_period: true, bonus_month: "2026-06-01" }),
    );
    vi.mocked(runMirrorIngest)
      .mockResolvedValueOnce(ingestResult(7))
      .mockResolvedValueOnce(ingestResult(240));

    const out = await dryRunPayrollRefresh(SHOP_ID, RUN_UUID);

    expect(vi.mocked(runMirrorIngest)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runMirrorIngest)).toHaveBeenNthCalledWith(
      2,
      { shopId: SHOP_ID },
      { mode: "range", postedDateStart: "2026-06-01", postedDateEnd: "2026-06-30" },
    );
    expect(out.rosChecked).toBe(247);
  });

  it("a completion racing the recompute (null) surfaces a validation error", async () => {
    vi.mocked(recomputeAndStoreLiveSnapshot).mockResolvedValue(null);
    await expect(dryRunPayrollRefresh(SHOP_ID, RUN_UUID)).rejects.toThrow(/no longer open/i);
  });

  // ── Round-11 (plan §4/§10.4): the PTO projection is a NEW OPTIONAL SIBLING of
  //    the diff — buildDryRunDiff + every existing diff key stay byte-identical. ──

  it("empty-roster snapshot ⇒ `pto` is absent (the modal omits the section); the diff is untouched", async () => {
    // The default validSnapshot has employees: [] ⇒ projectPtoForDryRun returns undefined.
    const out = await dryRunPayrollRefresh(SHOP_ID, RUN_UUID);
    expect(out.pto).toBeUndefined();
    // The PTO ledger fetchers were never reached (no roster to project).
    expect(vi.mocked(getPtoBalances)).not.toHaveBeenCalled();
    expect(vi.mocked(getPtoRolloverLedger)).not.toHaveBeenCalled();
    // The existing contract holds unchanged.
    expect(out.diff.changed).toBe(false);
    expect(out.rosChecked).toBe(7);
  });

  it("projects PTO for a roster employee as a SIBLING of the diff (accrual − entered usage against the current balance)", async () => {
    // BEFORE == AFTER (same roster, same numbers) ⇒ the diff is genuinely
    // unchanged; PTO still projects as an independent sibling.
    vi.mocked(getOrComputeLiveSnapshot).mockResolvedValue(snapshotWithEmployee("2026-07-11T04:00:00Z", 8));
    vi.mocked(recomputeAndStoreLiveSnapshot).mockResolvedValue(snapshotWithEmployee("2026-07-11T16:00:00Z", 8));
    vi.mocked(getPtoBalances).mockResolvedValue(new Map([[EMP_ID, 40]]));

    const out = await dryRunPayrollRefresh(SHOP_ID, RUN_UUID);

    expect(out.pto).toBeDefined();
    expect(out.pto).toHaveLength(1);
    const p = out.pto![0]!;
    expect(p.employeeId).toBe(EMP_ID);
    expect(p.displayName).toBe("Clark, Matt");
    expect(p.currentBalanceHours).toBe(40);
    expect(p.accrualHours).toBe(4); // tier min_years 0 ⇒ 4 hrs/period (started 2024, eligible)
    expect(p.usageHours).toBe(8); // the entered/paid PTO hours in the snapshot
    expect(p.projectedBalanceHours).toBe(36); // 40 + 4 − 8

    // The diff (built REAL) is a genuine SIBLING — no PTO leaked into it.
    expect(out.diff).not.toHaveProperty("pto");
    expect(out.diff.techHours).toEqual([]);
    expect(out.diff.month).toEqual([]);
    expect(out.diff.payTotals).toEqual([]);
    expect(out.diff.changed).toBe(false);
  });

  it("unseeded employee (no ledger rows) projects against a 0 current balance", async () => {
    vi.mocked(getOrComputeLiveSnapshot).mockResolvedValue(snapshotWithEmployee("2026-07-11T04:00:00Z", 0));
    vi.mocked(recomputeAndStoreLiveSnapshot).mockResolvedValue(snapshotWithEmployee("2026-07-11T16:00:00Z", 0));
    vi.mocked(getPtoBalances).mockResolvedValue(new Map()); // absent ⇒ 0

    const out = await dryRunPayrollRefresh(SHOP_ID, RUN_UUID);
    const p = out.pto![0]!;
    expect(p.currentBalanceHours).toBe(0);
    expect(p.projectedBalanceHours).toBe(4); // 0 + 4 accrual − 0 usage
  });

  it("a deficit projection can co-render with a NO-differences diff (plan §4 both-branches)", async () => {
    // 40 hrs used against a 4-hr balance → a projected deficit, while the diff is
    // unchanged (BEFORE == AFTER roster).
    vi.mocked(getOrComputeLiveSnapshot).mockResolvedValue(snapshotWithEmployee("2026-07-11T04:00:00Z", 40));
    vi.mocked(recomputeAndStoreLiveSnapshot).mockResolvedValue(snapshotWithEmployee("2026-07-11T16:00:00Z", 40));
    vi.mocked(getPtoBalances).mockResolvedValue(new Map([[EMP_ID, 4]]));

    const out = await dryRunPayrollRefresh(SHOP_ID, RUN_UUID);
    expect(out.diff.changed).toBe(false); // "no Tekmetric differences"
    expect(out.pto![0]!.projectedBalanceHours).toBeLessThan(0); // 4 + 4 − 40 = −32
  });
});
