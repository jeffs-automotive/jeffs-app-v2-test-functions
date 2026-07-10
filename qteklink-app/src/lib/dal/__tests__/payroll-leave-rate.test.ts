/**
 * Leave-rate SEED HISTORY tests (round-4; docs/qteklink/payroll-contract.md
 * §Round-4 amendments): mergeLeaveRateWindow unions completed-run entries with
 * pay_config seed entries (a real run WINS over a seed with the same period_start),
 * newest-12 window; resolveLeaveRate precedence override → history (merged window)
 * → seed (single-rate fallback) → current_run → base_rate, reporting windowRuns +
 * seededEntries. Plus the new optional technician/shop_foreman pay_config fields
 * (leave_rate_seed_cents_per_hour + leave_rate_seed_history, strict entries).
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

const run = (periodStart: string, payCents: number, hours: number): LeaveRateEntry => ({
  periodStart,
  payCents,
  hours,
});
const seed = (period_start: string, work_pay_cents: number, clock_hours: number): LeaveRateSeedEntry => ({
  period_start,
  work_pay_cents,
  clock_hours,
});

/** 14-day cadence periods, newest LAST (2026-01-04 + i×14d). */
const period = (i: number) =>
  new Date(Date.parse("2026-01-04T00:00:00Z") + i * 14 * 86_400_000).toISOString().slice(0, 10);

describe("mergeLeaveRateWindow (round-4)", () => {
  it("a completed-run entry WINS over a seed entry with the same period_start", () => {
    const merged = mergeLeaveRateWindow(
      [run("2026-06-28", 100_000, 40)],
      [seed("2026-06-28", 999_999, 99), seed("2026-06-14", 50_000, 25)],
    );
    // 2026-06-28 comes from the RUN (the seed's 999,999/99 is superseded).
    expect(merged).toEqual({ payCents: 150_000, hours: 65, runs: 1, seededEntries: 1 });
  });

  it("windows to 12 periods, dropping the OLDEST beyond the window", () => {
    // 13 seed periods, 1,000 cents / 1 h each — the oldest (index 0) must fall out.
    const seeds = Array.from({ length: 13 }, (_, i) => seed(period(i), 1_000, 1));
    const merged = mergeLeaveRateWindow([], seeds);
    expect(merged).toEqual({ payCents: 12_000, hours: 12, runs: 0, seededEntries: 12 });
    // The survivor set is the NEWEST 12: dropping the newest instead would change
    // nothing here (uniform entries), so prove it via a marked oldest entry.
    const marked = mergeLeaveRateWindow([], [seed(period(0), 777_777, 777), ...seeds.slice(1)]);
    expect(marked.payCents).toBe(12_000); // the marked oldest was dropped
    expect(marked.hours).toBe(12);
  });

  it("seeds-only: sums the seeds, runs = 0", () => {
    const merged = mergeLeaveRateWindow([], [seed("2026-05-03", 80_000, 40), seed("2026-05-17", 90_000, 45)]);
    expect(merged).toEqual({ payCents: 170_000, hours: 85, runs: 0, seededEntries: 2 });
  });

  it("mixed unsorted runs + seeds sort newest-first before the window is cut", () => {
    // window=2: only the two NEWEST periods survive regardless of input order.
    const merged = mergeLeaveRateWindow(
      [run("2026-05-03", 1, 1), run("2026-06-28", 200, 20)], // unsorted: old first
      [seed("2026-06-14", 100, 10), seed("2026-01-04", 999, 99)],
      2,
    );
    // Survivors: 2026-06-28 (run) + 2026-06-14 (seed).
    expect(merged).toEqual({ payCents: 300, hours: 30, runs: 1, seededEntries: 1 });
  });

  it("empty inputs → an empty window (hours 0 falls through in resolveLeaveRate)", () => {
    expect(mergeLeaveRateWindow([], [])).toEqual({ payCents: 0, hours: 0, runs: 0, seededEntries: 0 });
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

describe("resolveLeaveRate precedence (round-3 #24 + round-4 'seed')", () => {
  const merged = mergeLeaveRateWindow(
    [run("2026-06-28", 120_000, 40)],
    [seed("2026-06-14", 90_000, 40)],
  );

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

  it("merged window with hours → 'history', averaging runs AND seeds, both counts reported", () => {
    const r = resolveLeaveRate({}, merged, 3406, prelimWorked, 2000);
    // (120,000 + 90,000) ÷ (40 + 40) = 2,625 — seeds are part of the basis.
    expect(r).toEqual({ rateCents: 2625, source: "history", windowRuns: 1, seededEntries: 1 });
  });

  it("empty window + seed rate → 'seed' (beats the current-run ratio)", () => {
    const r = resolveLeaveRate({}, mergeLeaveRateWindow([], []), 3406, prelimWorked, 2000);
    expect(r).toEqual({ rateCents: 3406, source: "seed", windowRuns: 0, seededEntries: 0 });
  });

  it("a zero-hours window falls through to 'seed' too", () => {
    const zeroHours = mergeLeaveRateWindow([], [seed("2026-06-14", 0, 0)]);
    const r = resolveLeaveRate({}, zeroHours, 3406, prelimWorked, 2000);
    expect(r).toEqual({ rateCents: 3406, source: "seed", windowRuns: 0, seededEntries: 1 });
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

describe("technician/shop_foreman pay_config seed fields (round-4)", () => {
  const seededConfig = {
    ...techConfig,
    leave_rate_seed_cents_per_hour: 3406,
    leave_rate_seed_history: [
      { period_start: "2026-05-17", work_pay_cents: 234_567, clock_hours: 81.25 },
      { period_start: "2026-05-31", work_pay_cents: 250_000, clock_hours: 80 },
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

  it("rejects unknown entry keys (strict entries)", () => {
    const bad = {
      ...techConfig,
      leave_rate_seed_history: [
        { period_start: "2026-05-17", work_pay_cents: 1, clock_hours: 1, bonus_cents: 5 },
      ],
    };
    expect(() => TechnicianPayConfigSchema.parse(bad)).toThrow(/bonus_cents/);
  });

  it("rejects a malformed period_start, non-integer cents, negative hours, and >26 entries", () => {
    const entry = { period_start: "2026-05-17", work_pay_cents: 1, clock_hours: 1 };
    const withHistory = (history: unknown) => ({ ...techConfig, leave_rate_seed_history: history });
    expect(() => TechnicianPayConfigSchema.parse(withHistory([{ ...entry, period_start: "2026-13-01" }]))).toThrow();
    expect(() => TechnicianPayConfigSchema.parse(withHistory([{ ...entry, work_pay_cents: 10.5 }]))).toThrow();
    expect(() => TechnicianPayConfigSchema.parse(withHistory([{ ...entry, clock_hours: -1 }]))).toThrow();
    expect(() =>
      TechnicianPayConfigSchema.parse(withHistory(Array.from({ length: 27 }, () => ({ ...entry })))),
    ).toThrow(/26/);
  });
});
