/**
 * pto.ts tests — the plan §7 pto.ts matrix (docs/qteklink/
 * payroll-pto-employee-mgmt-plan-2026-07-12.md; Round-11 decisions #54–#57/#60):
 * eligibility (hire mid-period, exactly 6 vs 7 full periods, grandfathered,
 * grandfathered-with-no-dates, NULL start_date, terminated, REHIRED,
 * gap/backfill-immune cadence math), tier boundaries + anniversary crossing,
 * the never-RAISE unconfigured contract (C14), usage-vs-accrual gating (C37),
 * the order-independent rollover (C33 — out-of-order completion computes the
 * SAME value, void→clone nets the same forfeit, mid-year go-live forfeits
 * nothing, Dec/Jan straddle), and the projection math.
 */
import { describe, expect, it } from "vitest";

import {
  attributionYear,
  buildEmployeeRunPtoEntries,
  carryoverHours,
  computeAccrual,
  firstAccrualPeriodStart,
  firstCadencePeriodStartOnOrAfter,
  projectPtoBalance,
  PTO_WAIT_DAYS,
  rolloverBoundaryYear,
  rolloverForfeitHours,
  tierHoursForYears,
  yearsOfServiceAt,
  type PtoEmployeeFields,
  type PtoLedgerEntryForRollover,
  type PtoSettingsSlice,
  type PtoTenureTier,
} from "../pto";

// ── Fixtures ───────────────────────────────────────────────────────────────────

/** The live anchor used across the payroll test suites (Sun-anchored cadence). */
const ANCHOR = "2026-06-28";

const TIERS: PtoTenureTier[] = [
  { min_years: 0, hours_per_period: 4 },
  { min_years: 1, hours_per_period: 4.62 },
  { min_years: 5, hours_per_period: 6.16 },
];

function settings(over: Partial<PtoSettingsSlice> = {}): PtoSettingsSlice {
  return {
    anchor_period_start: ANCHOR,
    pto_tenure_tiers: TIERS,
    pto_rollover_cap_hours: null,
    ...over,
  };
}

function emp(over: Partial<PtoEmployeeFields> = {}): PtoEmployeeFields {
  return {
    employee_id: "00000000-0000-4000-8000-000000000001",
    display_name: "Matt Clark",
    archived: false,
    start_date: "2020-05-01",
    termination_date: null,
    pto_grandfathered: false,
    pto_tenure_credit_date: null,
    full_time: true, // round-12 default (DB default true) — keeps the matrix accruing
    ...over,
  };
}

/** Run-linked ledger entry (accrual/usage/void_reversal — buckets by period_end). */
function runEntry(hours: number, runPeriodEnd: string): PtoLedgerEntryForRollover {
  return { hours, run_period_end: runPeriodEnd, created_at: `${runPeriodEnd}T12:00:00Z` };
}

/** Non-run entry (initial/adjustment — buckets by created_at). */
function manualEntry(hours: number, createdAt: string): PtoLedgerEntryForRollover {
  return { hours, run_period_end: null, created_at: createdAt };
}

// ── Cadence math (C35) ─────────────────────────────────────────────────────────

describe("firstCadencePeriodStartOnOrAfter / firstAccrualPeriodStart", () => {
  it("snaps forward to the next cadence period_start (anchor + 14n)", () => {
    expect(firstCadencePeriodStartOnOrAfter(ANCHOR, "2026-07-01")).toBe("2026-07-12");
    expect(firstCadencePeriodStartOnOrAfter(ANCHOR, "2026-07-12")).toBe("2026-07-12"); // on-cadence = itself
    expect(firstCadencePeriodStartOnOrAfter(ANCHOR, "2026-06-27")).toBe("2026-06-28");
  });

  it("extends the cadence BEFORE the anchor (n negative) for pre-anchor hires", () => {
    expect(firstCadencePeriodStartOnOrAfter(ANCHOR, "2026-06-14")).toBe("2026-06-14");
    expect(firstCadencePeriodStartOnOrAfter(ANCHOR, "2026-06-15")).toBe("2026-06-28");
  });

  it("first accrual = P0 + 84 days (6 full periods; the 7th accrues — decision #55)", () => {
    expect(PTO_WAIT_DAYS).toBe(84);
    // Hire MID-period: the partial period never counts — P0 is the NEXT start.
    expect(firstAccrualPeriodStart(ANCHOR, "2026-07-01")).toBe("2026-10-04");
    // Hire exactly on a period boundary: that period is full period #1.
    expect(firstAccrualPeriodStart(ANCHOR, "2026-06-28")).toBe("2026-09-20");
  });
});

// ── Eligibility matrix ─────────────────────────────────────────────────────────

describe("computeAccrual — eligibility", () => {
  it("hire mid-period: ineligible through the 6th full period, accrues on the 7th", () => {
    const hire = emp({ start_date: "2026-07-01" });
    // Periods 1..6 for this hire start 2026-07-12 .. 2026-09-20.
    expect(computeAccrual(hire, settings(), "2026-09-20").eligible).toBe(false);
    const seventh = computeAccrual(hire, settings(), "2026-10-04");
    expect(seventh.eligible).toBe(true);
    expect(seventh.accrual_hours).toBe(4); // 0 whole years → the min_years 0 tier
  });

  it("boundary hire: exactly 6 full periods (P0+70) ineligible, 7th (P0+84) eligible", () => {
    const hire = emp({ start_date: "2026-06-28" });
    expect(computeAccrual(hire, settings(), "2026-09-06").eligible).toBe(false); // period 6
    expect(computeAccrual(hire, settings(), "2026-09-20").eligible).toBe(true); // period 7
  });

  it("eligibility is pure calendar math — gaps/voids/backfills cannot shift it (C35)", () => {
    // The engine consumes NO run list: only period_start enters. Whatever runs
    // exist (or were voided) around it, the threshold is the same date.
    const hire = emp({ start_date: "2026-07-01" });
    const byPeriod = ["2026-08-23", "2026-09-20", "2026-10-04", "2026-11-01"].map(
      (periodStart) => computeAccrual(hire, settings(), periodStart).eligible,
    );
    expect(byPeriod).toEqual([false, false, true, true]);
  });

  it("grandfather waives the wait — accrues on the very first full period (decision #55)", () => {
    const gf = emp({ start_date: "2026-07-01", pto_grandfathered: true });
    const r = computeAccrual(gf, settings(), "2026-07-12");
    expect(r.eligible).toBe(true);
    expect(r.accrual_hours).toBe(4);
    expect(r.warnings).toEqual([]);
  });

  it("grandfathered on a period that STARTED before hire: eligible but negative tenure → no tier, 0 hours", () => {
    const gf = emp({ start_date: "2026-07-01", pto_grandfathered: true });
    const r = computeAccrual(gf, settings(), "2026-06-28");
    expect(r.eligible).toBe(true);
    expect(r.accrual_hours).toBe(0);
  });

  it("grandfathered with NO dates at all: no accrual + the non-blocking warning (C14)", () => {
    const gf = emp({ start_date: null, pto_tenure_credit_date: null, pto_grandfathered: true });
    const r = computeAccrual(gf, settings(), "2026-07-12");
    expect(r.eligible).toBe(true);
    expect(r.accrual_hours).toBe(0);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({
      employee_id: gf.employee_id,
      code: "grandfathered_no_dates",
    });
    expect(r.warnings[0]!.message).toContain("Matt Clark");
  });

  it("NULL start_date, not grandfathered: ineligible, silent (a tenure-credit date does NOT rescue it)", () => {
    const r = computeAccrual(
      emp({ start_date: null, pto_tenure_credit_date: "2019-03-15" }),
      settings(),
      "2026-07-12",
    );
    expect(r.eligible).toBe(false);
    expect(r.accrual_hours).toBe(0);
    expect(r.warnings).toEqual([]);
  });

  it("terminated BEFORE the period starts: no accrual (C37)", () => {
    const r = computeAccrual(emp({ termination_date: "2026-06-27" }), settings(), "2026-06-28");
    expect(r.eligible).toBe(false);
    expect(r.accrual_hours).toBe(0);
  });

  it("terminated ON or DURING the period: still accrues (only termination_date < period_start gates)", () => {
    expect(computeAccrual(emp({ termination_date: "2026-06-28" }), settings(), "2026-06-28").accrual_hours).toBe(6.16);
    expect(computeAccrual(emp({ termination_date: "2026-07-03" }), settings(), "2026-06-28").accrual_hours).toBe(6.16);
  });

  it("archived: no accrual regardless of tenure", () => {
    const r = computeAccrual(emp({ archived: true }), settings(), "2026-06-28");
    expect(r.eligible).toBe(false);
    expect(r.accrual_hours).toBe(0);
  });

  it("REHIRED (unarchive cleared termination_date — plan §2a): accrues again", () => {
    const r = computeAccrual(
      emp({ archived: false, termination_date: null, start_date: "2020-05-01" }),
      settings(),
      "2026-06-28",
    );
    expect(r.eligible).toBe(true);
    expect(r.accrual_hours).toBe(6.16); // 6 whole years → the min_years 5 tier
  });

  it("never RAISES on zero PTO configuration: null anchor + no tiers ⇒ ineligible/0 (C14)", () => {
    const zeroConfig = settings({ anchor_period_start: null, pto_tenure_tiers: undefined });
    const r = computeAccrual(emp(), zeroConfig, "2026-06-28");
    expect(r.eligible).toBe(false);
    expect(r.accrual_hours).toBe(0);
    expect(r.warnings).toEqual([]);
  });
});

// ── Full-time accrual gate (round-12 §B2) ──────────────────────────────────────

describe("computeAccrual — full-time gate (round-12)", () => {
  it("part-time + tenure-eligible: accrual 0, NO row, but `eligible` stays true", () => {
    // Same long-tenured, fully-eligible employee — only full_time flips off.
    const ft = computeAccrual(emp(), settings(), "2026-06-28");
    expect(ft.eligible).toBe(true);
    expect(ft.accrual_hours).toBe(6.16); // full-timer accrues the 5-yr tier

    const pt = computeAccrual(emp({ full_time: false }), settings(), "2026-06-28");
    expect(pt.eligible).toBe(true); // eligibility (tenure/archive) is UNCHANGED
    expect(pt.accrual_hours).toBe(0); // the gate zeroes accrual only
    expect(pt.warnings).toEqual([]);
  });

  it("part-time gate applies even when grandfathered (waived wait ≠ accrual)", () => {
    const pt = computeAccrual(
      emp({ start_date: "2026-07-01", pto_grandfathered: true, full_time: false }),
      settings(),
      "2026-07-12",
    );
    expect(pt.eligible).toBe(true);
    expect(pt.accrual_hours).toBe(0);
  });

  it("part-time is decided by an EXPLICIT boolean — never `?? true`", () => {
    // The field is required; a false must gate. (A `?? true` bug would accrue.)
    expect(computeAccrual(emp({ full_time: false }), settings(), "2026-08-09").accrual_hours).toBe(0);
    expect(computeAccrual(emp({ full_time: true }), settings(), "2026-08-09").accrual_hours).toBe(6.16);
  });

  it("full-time gate does NOT gate USAGE — a part-timer with paid PTO still decrements (C37)", () => {
    const r = buildEmployeeRunPtoEntries(
      { employee: emp({ full_time: false }), snapshot_pto_hours: 8, ledger_entries: [] },
      settings(),
      { period_start: "2026-06-28", period_end: "2026-07-11" },
    );
    expect(r.eligible).toBe(true); // tenure-eligible, just part-time
    expect(r.accrual_hours).toBe(0); // no accrual
    expect(r.entries).toEqual([
      { employee_id: r.employee_id, kind: "usage", hours: -8, boundary_year: null },
    ]);
  });

  it("part-time + archived/terminated/NULL-start: usage still written, accrual still 0", () => {
    const run = { period_start: "2026-06-28", period_end: "2026-07-11" };
    for (const over of [
      { archived: true } as const,
      { termination_date: "2026-06-01" } as const,
      { start_date: null } as const,
    ]) {
      const r = buildEmployeeRunPtoEntries(
        { employee: emp({ ...over, full_time: false }), snapshot_pto_hours: 4.5, ledger_entries: [] },
        settings(),
        run,
      );
      expect(r.accrual_hours).toBe(0);
      expect(r.entries).toEqual([
        { employee_id: r.employee_id, kind: "usage", hours: -4.5, boundary_year: null },
      ]);
    }
  });
});

// ── Tiers (decision #56) ───────────────────────────────────────────────────────

describe("tierHoursForYears / anniversary crossing", () => {
  it("picks the greatest min_years ≤ years; empty/absent/no-match ⇒ 0 (C14)", () => {
    expect(tierHoursForYears(TIERS, 0)).toBe(4);
    expect(tierHoursForYears(TIERS, 4)).toBe(4.62);
    expect(tierHoursForYears(TIERS, 5)).toBe(6.16);
    expect(tierHoursForYears(TIERS, 40)).toBe(6.16);
    expect(tierHoursForYears([], 3)).toBe(0);
    expect(tierHoursForYears(null, 3)).toBe(0);
    expect(tierHoursForYears(undefined, 3)).toBe(0);
    expect(tierHoursForYears([{ min_years: 5, hours_per_period: 6 }], 2)).toBe(0); // no match
    expect(tierHoursForYears(TIERS, -1)).toBe(0); // negative tenure matches nothing
  });

  it("is order-agnostic (the validator sorts; the engine must not care)", () => {
    const shuffled = [TIERS[2]!, TIERS[0]!, TIERS[1]!];
    expect(tierHoursForYears(shuffled, 5)).toBe(6.16);
    expect(tierHoursForYears(shuffled, 1)).toBe(4.62);
  });

  it("2dp-rounds the configured rate (float-noise absorption, the round2 idiom)", () => {
    expect(tierHoursForYears([{ min_years: 0, hours_per_period: 4.6200000000001 }], 1)).toBe(4.62);
  });

  it("yearsOfServiceAt counts whole anniversary years (negative when basis is in the future)", () => {
    expect(yearsOfServiceAt("2021-08-09", "2026-08-08")).toBe(4);
    expect(yearsOfServiceAt("2021-08-09", "2026-08-09")).toBe(5); // the anniversary itself
    expect(yearsOfServiceAt("2026-07-01", "2026-06-28")).toBe(-1);
  });

  it("the new tier rate lands on the FIRST pay period at/after the anniversary (#56)", () => {
    const veteran = emp({ start_date: "2021-08-09" });
    // Period starting 2026-07-26: 4 whole years → the 1-year tier.
    expect(computeAccrual(veteran, settings(), "2026-07-26").accrual_hours).toBe(4.62);
    // Period starting 2026-08-09 (the 5th anniversary): the 5-year tier.
    expect(computeAccrual(veteran, settings(), "2026-08-09").accrual_hours).toBe(6.16);
  });

  it("pto_tenure_credit_date overrides start_date for the TIER lookup only", () => {
    const acquired = emp({
      start_date: "2026-01-04",
      pto_tenure_credit_date: "2019-03-15",
      pto_grandfathered: true, // waives the wait a 2026 hire hasn't served
    });
    const r = computeAccrual(acquired, settings(), "2026-06-28");
    expect(r.accrual_hours).toBe(6.16); // 7 years via the credit date
  });

  it("tiers absent/empty ⇒ accrual 0 for an otherwise fully-eligible employee (C14)", () => {
    expect(computeAccrual(emp(), settings({ pto_tenure_tiers: [] }), "2026-06-28").accrual_hours).toBe(0);
    expect(computeAccrual(emp(), settings({ pto_tenure_tiers: null }), "2026-06-28").accrual_hours).toBe(0);
  });
});

// ── Rollover (decision #57; C33/N13) ───────────────────────────────────────────

describe("rollover — boundary, bucketing, cap", () => {
  it("boundary year = year(period_end) — the pay-date convention, NOT bonus_month (N13)", () => {
    expect(rolloverBoundaryYear("2027-01-09")).toBe(2027); // Dec/Jan straddle run
    expect(rolloverBoundaryYear("2026-12-26")).toBe(2026); // last fully-2026 run
  });

  it("buckets run-linked entries by run period_end year and manual entries by created_at (C33)", () => {
    expect(attributionYear(runEntry(4, "2026-12-26"))).toBe(2026);
    expect(attributionYear(runEntry(4, "2027-01-09"))).toBe(2027);
    expect(attributionYear(manualEntry(10, "2026-03-01T12:00:00Z"))).toBe(2026);
  });

  it("carryover(Y) sums only entries attributable BEFORE Jan 1 of Y", () => {
    const entries = [
      runEntry(40, "2026-08-08"), // accrual
      runEntry(-8, "2026-09-05"), // usage
      manualEntry(10, "2026-03-01T12:00:00Z"), // initial/adjustment
      runEntry(4, "2027-01-09"), // year-Y run — excluded from carryover(2027)
    ];
    expect(carryoverHours(entries, 2027)).toBe(42);
  });

  it("forfeit = max(0, carryover − cap); cap null = unlimited; under-cap forfeits nothing", () => {
    const entries = [runEntry(42, "2026-08-08")];
    expect(rolloverForfeitHours(entries, 2027, 40)).toBe(2);
    expect(rolloverForfeitHours(entries, 2027, 42)).toBe(0);
    expect(rolloverForfeitHours(entries, 2027, 100)).toBe(0);
    expect(rolloverForfeitHours(entries, 2027, null)).toBe(0);
    expect(rolloverForfeitHours(entries, 2027, undefined)).toBe(0);
    expect(rolloverForfeitHours(entries, 2027, 0)).toBe(42);
  });

  it("mid-year go-live: NO ledger history before Y ⇒ no forfeit, even at cap 0 (C33)", () => {
    const entries = [manualEntry(60, "2027-02-01T12:00:00Z"), runEntry(4, "2027-02-06")];
    expect(carryoverHours(entries, 2027)).toBeNull(); // no history ≠ zero balance
    expect(rolloverForfeitHours(entries, 2027, 0)).toBe(0);
    expect(rolloverForfeitHours([], 2027, 0)).toBe(0);
  });

  it("is order-independent: shuffled history computes the identical forfeit", () => {
    const entries = [
      runEntry(40, "2026-08-08"),
      runEntry(-8, "2026-09-05"),
      manualEntry(10, "2026-03-01T12:00:00Z"),
    ];
    const forfeit = rolloverForfeitHours(entries, 2027, 40);
    expect(rolloverForfeitHours([...entries].reverse(), 2027, 40)).toBe(forfeit);
    expect(forfeit).toBe(2);
  });

  it("out-of-order completion: EVERY year-Y run computes the same (employee, Y) value — the RPC applies it once", () => {
    const history = [runEntry(50, "2026-11-14")];
    const janRun = buildEmployeeRunPtoEntries(
      { employee: emp(), snapshot_pto_hours: 0, ledger_entries: history },
      settings({ pto_rollover_cap_hours: 40 }),
      { period_start: "2026-12-27", period_end: "2027-01-09" },
    );
    const febRun = buildEmployeeRunPtoEntries(
      { employee: emp(), snapshot_pto_hours: 0, ledger_entries: history },
      settings({ pto_rollover_cap_hours: 40 }),
      { period_start: "2027-01-24", period_end: "2027-02-06" },
    );
    expect(janRun.rollover_forfeit_hours).toBe(10);
    expect(febRun.rollover_forfeit_hours).toBe(10);
    expect(janRun.boundary_year).toBe(2027);
    expect(febRun.boundary_year).toBe(2027);
  });

  it("void→clone: the voided run's rows + their reversals net zero, so the clone re-fires the SAME forfeit (C33)", () => {
    const preVoid = [runEntry(50, "2026-11-14")];
    const forfeit = rolloverForfeitHours(preVoid, 2027, 40);
    // The first 2027 run completed (accrual/usage/forfeit), then was voided:
    // every row + its void_reversal carries the VOIDED run's period_end (plan
    // §2b), all attributing to 2027 — carryover(2027) is untouched.
    const afterVoid = [
      ...preVoid,
      runEntry(6.16, "2027-01-09"), // accrual
      runEntry(-8, "2027-01-09"), // usage
      runEntry(-10, "2027-01-09"), // rollover_forfeit for 2027
      runEntry(-6.16, "2027-01-09"), // void_reversal of the accrual
      runEntry(8, "2027-01-09"), // void_reversal of the usage
      runEntry(10, "2027-01-09"), // void_reversal of the forfeit
    ];
    expect(rolloverForfeitHours(afterVoid, 2027, 40)).toBe(forfeit);
    expect(forfeit).toBe(10);
  });

  it("a prior year's applied forfeit DOES reduce the next boundary's carryover", () => {
    const entries = [
      runEntry(50, "2026-11-14"),
      runEntry(-10, "2027-01-09"), // the 2027 forfeit, applied by the first 2027 run
      runEntry(4, "2027-03-06"),
    ];
    expect(carryoverHours(entries, 2028)).toBe(44);
  });
});

// ── Usage gating (C37) + per-employee assembly ─────────────────────────────────

describe("buildEmployeeRunPtoEntries", () => {
  const RUN = { period_start: "2026-12-27", period_end: "2027-01-09" };

  it("eligible employee: accrual (+), usage (−), forfeit (− with boundary_year) in write order", () => {
    const r = buildEmployeeRunPtoEntries(
      {
        employee: emp({ start_date: "2018-05-01" }),
        snapshot_pto_hours: 8,
        ledger_entries: [runEntry(42, "2026-08-08")],
      },
      settings({ pto_rollover_cap_hours: 40 }),
      RUN,
    );
    expect(r.eligible).toBe(true);
    expect(r.entries).toEqual([
      { employee_id: r.employee_id, kind: "accrual", hours: 6.16, boundary_year: null },
      { employee_id: r.employee_id, kind: "usage", hours: -8, boundary_year: null },
      { employee_id: r.employee_id, kind: "rollover_forfeit", hours: -2, boundary_year: 2027 },
    ]);
    expect(r.accrual_hours).toBe(6.16);
    expect(r.usage_hours).toBe(8);
    expect(r.rollover_forfeit_hours).toBe(2);
  });

  it("usage is written for an ARCHIVED employee with paid PTO hours — accrual is not (C37)", () => {
    const r = buildEmployeeRunPtoEntries(
      { employee: emp({ archived: true }), snapshot_pto_hours: 8, ledger_entries: [] },
      settings(),
      RUN,
    );
    expect(r.eligible).toBe(false);
    expect(r.accrual_hours).toBe(0);
    expect(r.entries).toEqual([
      { employee_id: r.employee_id, kind: "usage", hours: -8, boundary_year: null },
    ]);
  });

  it("usage is written for a TERMINATED employee with paid PTO hours (C37)", () => {
    const r = buildEmployeeRunPtoEntries(
      {
        employee: emp({ termination_date: "2026-12-01" }),
        snapshot_pto_hours: 4.5,
        ledger_entries: [],
      },
      settings(),
      RUN,
    );
    expect(r.accrual_hours).toBe(0);
    expect(r.entries).toEqual([
      { employee_id: r.employee_id, kind: "usage", hours: -4.5, boundary_year: null },
    ]);
  });

  it("usage is written even for a never-eligible employee (NULL start_date) with PTO hours", () => {
    const r = buildEmployeeRunPtoEntries(
      { employee: emp({ start_date: null }), snapshot_pto_hours: 8, ledger_entries: [] },
      settings(),
      RUN,
    );
    expect(r.entries.map((e) => e.kind)).toEqual(["usage"]);
  });

  it("zero PTO configuration ⇒ zero rows — completion behaves exactly as today (C14)", () => {
    const r = buildEmployeeRunPtoEntries(
      { employee: emp({ start_date: null }), snapshot_pto_hours: 0, ledger_entries: [] },
      settings({ anchor_period_start: null, pto_tenure_tiers: undefined, pto_rollover_cap_hours: undefined }),
      RUN,
    );
    expect(r.entries).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("no zero-hour noise rows: eligible + empty tiers + no PTO entered ⇒ no entries", () => {
    const r = buildEmployeeRunPtoEntries(
      { employee: emp(), snapshot_pto_hours: 0, ledger_entries: [] },
      settings({ pto_tenure_tiers: [] }),
      RUN,
    );
    expect(r.eligible).toBe(true);
    expect(r.entries).toEqual([]);
  });

  it("surfaces the grandfathered-no-dates warning through the assembly", () => {
    const r = buildEmployeeRunPtoEntries(
      {
        employee: emp({ start_date: null, pto_grandfathered: true }),
        snapshot_pto_hours: 0,
        ledger_entries: [],
      },
      settings(),
      RUN,
    );
    expect(r.warnings.map((w) => w.code)).toEqual(["grandfathered_no_dates"]);
    expect(r.entries).toEqual([]);
  });
});

// ── Projection (plan §3 dry run) ───────────────────────────────────────────────

describe("projectPtoBalance", () => {
  it("projected = current + accrual − entered PTO hours", () => {
    expect(projectPtoBalance(10, 4.62, 8)).toBe(6.62);
  });

  it("negative balances are allowed (decision #59) — projection goes below zero", () => {
    expect(projectPtoBalance(2, 0, 8)).toBe(-6);
  });

  it("settles float noise to 2dp (the round2 idiom)", () => {
    expect(projectPtoBalance(0.1, 0.2, 0)).toBe(0.3); // NOT 0.30000000000000004
  });
});
