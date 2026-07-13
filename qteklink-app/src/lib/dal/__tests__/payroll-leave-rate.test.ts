/**
 * Leave-rate ROLLING-26 MEAN tests (round-3 #24 + round-4 seeds + round-12
 * mean-of-per-period-rates; docs/qteklink/payroll-contract.md §Round-4 amendments +
 * payroll-rolling-avg-fulltime-plan-2026-07-12.md §A): mergeLeaveRateWindow unions
 * completed-run per-period RATE entries with pay_config seed RATE entries (a real
 * run WINS over a seed with the same period_start — including a zero-hours run whose
 * null rate evicts the seed and contributes nothing), newest-26 window, and returns
 * the ARITHMETIC MEAN of the contributing per-period rates (meanRateCents = null
 * when no windowed period had a finite rate). resolveLeaveRate precedence override →
 * history (mean of the window) → seed (single-rate fallback) → current_run →
 * base_rate, reporting windowRuns + seededEntries. Plus the new technician/
 * shop_foreman pay_config seed fields (leave_rate_seed_cents_per_hour +
 * leave_rate_seed_history, strict {period_start, avg_hourly_pay_cents} entries).
 * Pure functions — the Supabase admin client is mocked out for import safety only.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));

import { mergeLeaveRateWindow, resolveLeaveRate, type LeaveRateEntry } from "../payroll-leave-rate";
import { computeSheet } from "@/lib/payroll/calc";
import {
  LeaveRateSourceSchema,
  ShopForemanPayConfigSchema,
  TechnicianPayConfigSchema,
  type LeaveRateSeedEntry,
  type TechnicianPayConfig,
} from "@/lib/payroll/types";

/** A completed-run per-period rate entry (round-12). rateCents null = the run had
 *  zero worked hours → no finite rate for that period. */
const run = (periodStart: string, rateCents: number | null): LeaveRateEntry => ({
  periodStart,
  rateCents,
});
/** A seed carries the period's already-averaged hourly rate (round-12). */
const seed = (period_start: string, avg_hourly_pay_cents: number): LeaveRateSeedEntry => ({
  period_start,
  avg_hourly_pay_cents,
});

/** 14-day cadence periods, newest LAST (2026-01-04 + i×14d). */
const period = (i: number) =>
  new Date(Date.parse("2026-01-04T00:00:00Z") + i * 14 * 86_400_000).toISOString().slice(0, 10);

describe("mergeLeaveRateWindow (round-12 mean of per-period rates)", () => {
  it("a completed-run entry WINS over a seed entry with the same period_start", () => {
    const merged = mergeLeaveRateWindow(
      [run("2026-06-28", 3000)],
      [seed("2026-06-28", 9999), seed("2026-06-14", 2000)],
    );
    // 2026-06-28 comes from the RUN (the seed's 9999 is superseded); the mean is of
    // the run rate (3000) and the surviving seed rate (2000) → 2500.
    expect(merged).toEqual({ meanRateCents: 2500, runs: 1, seededEntries: 1 });
  });

  it("means the per-period rates — rounding once at the end (half away from zero)", () => {
    // 3 rates: 2000, 2001, 2001 → sum 6002 / 3 = 2000.666… → 2001.
    const merged = mergeLeaveRateWindow(
      [run("2026-06-28", 2000)],
      [seed("2026-06-14", 2001), seed("2026-05-31", 2001)],
    );
    expect(merged).toEqual({ meanRateCents: 2001, runs: 1, seededEntries: 2 });
  });

  it("windows to 26 periods, dropping the OLDEST beyond the window", () => {
    // 27 seed periods; the newest 26 survive, the oldest (index 0) falls out. Give
    // the oldest a wildly different rate to prove it is excluded from the mean.
    const seeds = [
      seed(period(0), 999_999), // oldest — must be dropped
      ...Array.from({ length: 26 }, (_, i) => seed(period(i + 1), 2000)),
    ];
    const merged = mergeLeaveRateWindow([], seeds);
    // Survivors are the 26 uniform 2000 rates; the 999,999 outlier was evicted.
    expect(merged).toEqual({ meanRateCents: 2000, runs: 0, seededEntries: 26 });
  });

  it("seeds-only: means the seed rates, runs = 0", () => {
    const merged = mergeLeaveRateWindow([], [seed("2026-05-03", 2000), seed("2026-05-17", 3000)]);
    expect(merged).toEqual({ meanRateCents: 2500, runs: 0, seededEntries: 2 });
  });

  it("mixed unsorted runs + seeds sort newest-first before the window is cut", () => {
    // window=2: only the two NEWEST periods survive regardless of input order.
    const merged = mergeLeaveRateWindow(
      [run("2026-05-03", 100), run("2026-06-28", 4000)], // unsorted: old first
      [seed("2026-06-14", 2000), seed("2026-01-04", 9999)],
      2,
    );
    // Survivors: 2026-06-28 (run 4000) + 2026-06-14 (seed 2000) → mean 3000.
    expect(merged).toEqual({ meanRateCents: 3000, runs: 1, seededEntries: 1 });
  });

  it("a zero-hours run (null rate) evicts the same-period seed AND contributes no rate", () => {
    // The run for 2026-06-28 had 0 worked hours (rate null). It still beats the seed
    // for that period (real-beats-seed), so that period drops out of the mean; only
    // the 2026-06-14 seed rate remains.
    const merged = mergeLeaveRateWindow(
      [run("2026-06-28", null)],
      [seed("2026-06-28", 9999), seed("2026-06-14", 2000)],
    );
    expect(merged).toEqual({ meanRateCents: 2000, runs: 1, seededEntries: 1 });
  });

  it("a window with ONLY null-rate runs → meanRateCents null (falls through in resolveLeaveRate)", () => {
    const merged = mergeLeaveRateWindow([run("2026-06-28", null), run("2026-06-14", null)], []);
    expect(merged).toEqual({ meanRateCents: null, runs: 2, seededEntries: 0 });
  });

  it("empty inputs → an empty window (meanRateCents null falls through in resolveLeaveRate)", () => {
    expect(mergeLeaveRateWindow([], [])).toEqual({ meanRateCents: null, runs: 0, seededEntries: 0 });
  });
});

// ── resolveLeaveRate precedence ────────────────────────────────────────────────

const techConfig: TechnicianPayConfig = {
  config_version: 1,
  pto_balance_hours: 0,
  pto_accrual_hours_per_period: 0,
  hourly_rate_cents: 2000, // $20 base hourly
  billed_rate_cents: 1000,
};
/** Current-run prelim with 40 worked hours → ex-bonus ex-leave ratio $20/h. */
const prelimWorked = computeSheet("technician", techConfig, { clock_hours_w1: 40 }, {});
/** Current-run prelim with 0 worked hours (leave only) → no current-run basis. */
const prelimIdle = computeSheet("technician", techConfig, { pto_w1: 8 }, {});

describe("resolveLeaveRate precedence (round-3 #24 + round-4 'seed' + round-12 mean)", () => {
  const merged = mergeLeaveRateWindow([run("2026-06-28", 3000)], [seed("2026-06-14", 2250)]);

  it("override beats the merged window, the seed rate, and everything else", () => {
    const r = resolveLeaveRate(
      { leave_rate_cents_per_hour: { value: 4321, note: "manual" } },
      merged,
      3406,
      prelimWorked,
      2000,
    );
    expect(r).toEqual({ rateCents: 4321, source: "override", windowRuns: 1, seededEntries: 1 });
  });

  it("merged window with a finite mean → 'history', averaging runs AND seed rates, both counts reported", () => {
    const r = resolveLeaveRate({}, merged, 3406, prelimWorked, 2000);
    // mean(3000, 2250) = 2625 — the seed rate is part of the basis.
    expect(r).toEqual({ rateCents: 2625, source: "history", windowRuns: 1, seededEntries: 1 });
  });

  it("empty window + seed rate → 'seed' (beats the current-run ratio)", () => {
    const r = resolveLeaveRate({}, mergeLeaveRateWindow([], []), 3406, prelimWorked, 2000);
    expect(r).toEqual({ rateCents: 3406, source: "seed", windowRuns: 0, seededEntries: 0 });
  });

  it("a null-mean window (only zero-hours runs) falls through to 'seed' too", () => {
    const nullMean = mergeLeaveRateWindow([run("2026-06-14", null)], []);
    const r = resolveLeaveRate({}, nullMean, 3406, prelimWorked, 2000);
    expect(r).toEqual({ rateCents: 3406, source: "seed", windowRuns: 1, seededEntries: 0 });
  });

  it("no seed rate → 'current_run' ratio from the prelim sheet", () => {
    const r = resolveLeaveRate({}, mergeLeaveRateWindow([], []), null, prelimWorked, 2000);
    expect(r).toEqual({ rateCents: 2000, source: "current_run", windowRuns: 0, seededEntries: 0 });
  });

  it("nothing at all → 'base_rate'", () => {
    const r = resolveLeaveRate({}, undefined, undefined, prelimIdle, 2000);
    expect(r).toEqual({ rateCents: 2000, source: "base_rate", windowRuns: 0, seededEntries: 0 });
  });

  it("'seed' is a valid LeaveRateSource (snapshot/SheetComputation enum)", () => {
    expect(LeaveRateSourceSchema.parse("seed")).toBe("seed");
  });
});

// ── pay_config seed fields (types.ts) ──────────────────────────────────────────

describe("technician/shop_foreman pay_config seed fields (round-12 rate shape)", () => {
  const seededConfig = {
    ...techConfig,
    leave_rate_seed_cents_per_hour: 3406,
    leave_rate_seed_history: [
      { period_start: "2026-05-17", avg_hourly_pay_cents: 2885 },
      { period_start: "2026-05-31", avg_hourly_pay_cents: 3125 },
    ],
  };

  it("both fields parse on technician AND shop_foreman (inherited) configs", () => {
    expect(TechnicianPayConfigSchema.parse(seededConfig)).toEqual(seededConfig);
    const foreman = {
      ...seededConfig,
      shop_hour_goal: 1000,
      shop_hour_bonus_cents_per_hour: 50,
    };
    expect(ShopForemanPayConfigSchema.parse(foreman)).toEqual(foreman);
  });

  it("both fields stay OPTIONAL (existing configs keep parsing)", () => {
    expect(TechnicianPayConfigSchema.parse(techConfig)).toEqual(techConfig);
  });

  it("rejects unknown entry keys (strict entries) — incl. the retired weighted-model keys", () => {
    const bad = {
      ...techConfig,
      leave_rate_seed_history: [{ period_start: "2026-05-17", avg_hourly_pay_cents: 1, bonus_cents: 5 }],
    };
    expect(() => TechnicianPayConfigSchema.parse(bad)).toThrow(/bonus_cents/);
    // The old {work_pay_cents, clock_hours} shape is now rejected outright.
    const legacy = {
      ...techConfig,
      leave_rate_seed_history: [{ period_start: "2026-05-17", work_pay_cents: 1, clock_hours: 1 }],
    };
    expect(() => TechnicianPayConfigSchema.parse(legacy)).toThrow();
  });

  it("rejects a malformed period_start, non-integer/negative cents, a missing rate, and >26 entries", () => {
    const entry = { period_start: "2026-05-17", avg_hourly_pay_cents: 1 };
    const withHistory = (history: unknown) => ({ ...techConfig, leave_rate_seed_history: history });
    expect(() => TechnicianPayConfigSchema.parse(withHistory([{ ...entry, period_start: "2026-13-01" }]))).toThrow();
    expect(() => TechnicianPayConfigSchema.parse(withHistory([{ ...entry, avg_hourly_pay_cents: 10.5 }]))).toThrow();
    expect(() => TechnicianPayConfigSchema.parse(withHistory([{ ...entry, avg_hourly_pay_cents: -1 }]))).toThrow();
    expect(() => TechnicianPayConfigSchema.parse(withHistory([{ period_start: "2026-05-17" }]))).toThrow();
    expect(() =>
      TechnicianPayConfigSchema.parse(withHistory(Array.from({ length: 27 }, () => ({ ...entry })))),
    ).toThrow(/26/);
  });
});
