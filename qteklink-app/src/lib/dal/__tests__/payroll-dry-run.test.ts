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
vi.mock("@/lib/dal/payroll-shared", () => ({ fetchRunGuarded: vi.fn() }));
vi.mock("@/lib/dal/payroll-live", () => ({
  getOrComputeLiveSnapshot: vi.fn(),
  markPayrollOpenRunsStale: vi.fn(),
  recomputeAndStoreLiveSnapshot: vi.fn(),
}));
vi.mock("@/lib/payroll/mirror-ingest", () => ({ runMirrorIngest: vi.fn() }));

import { fetchRunGuarded, type RunDbRow } from "@/lib/dal/payroll-shared";
import {
  getOrComputeLiveSnapshot,
  markPayrollOpenRunsStale,
  recomputeAndStoreLiveSnapshot,
} from "@/lib/dal/payroll-live";
import { runMirrorIngest } from "@/lib/payroll/mirror-ingest";
import { CALC_VERSION } from "@/lib/payroll/calc";
import type { RunSnapshot } from "@/lib/payroll/types";
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchRunGuarded).mockResolvedValue(makeRun());
  vi.mocked(getOrComputeLiveSnapshot).mockResolvedValue(validSnapshot("2026-07-11T04:00:00Z"));
  vi.mocked(runMirrorIngest).mockResolvedValue(ingestResult(7));
  vi.mocked(markPayrollOpenRunsStale).mockResolvedValue(2);
  vi.mocked(recomputeAndStoreLiveSnapshot).mockResolvedValue(validSnapshot("2026-07-11T16:00:00Z"));
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
});
