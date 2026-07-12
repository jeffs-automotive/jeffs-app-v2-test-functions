/**
 * Pure-aggregator tests for the payroll derivation layer — NO DB. The core claim
 * under test is INVARIANT #1 (extraction doc #20): only jobs with `authorized === true`
 * count in ANY rollup; declined (`false`) AND undetermined (`null`) jobs are excluded,
 * and labor lines / parts filter through their PARENT job's flag. Each aggregator gets
 * an explicit declined-exclusion case, plus multiplier math and zero-data null-safety.
 */
import { describe, it, expect } from "vitest";

import {
  authorizedJobIds,
  aggregateBilledHoursByTechnician,
  aggregateShopBilledHours,
  aggregateSalesCandidates,
  aggregateFeesCents,
  aggregateAuthorizedPartsCostCents,
  aggregateSubletCostCents,
  aggregateMonthSubtotalCents,
  aggregateSpiffCountsByServiceWriter,
  newCategoryNames,
  monthDateRange,
  priorYearMonth,
  rosInLocalRange,
  rosInLocalRangeHoursBasis,
  roundCents,
  type MirrorJobRow,
  type MirrorLaborRow,
  type MirrorPartRow,
  type MirrorRoRow,
  type MirrorSubletItemRow,
  type SpiffCategoryConfig,
} from "../derive";

// ── Synthetic row set: one RO with an authorized, a declined, and a null-flag job ──

const ro = (over: Partial<MirrorRoRow> = {}): MirrorRoRow => ({
  id: 1,
  service_writer_id: 900,
  total_sales_cents: 0,
  taxes_cents: 0,
  fee_total_cents: 0,
  posted_date: "2026-06-15T14:00:00Z",
  completed_date: null,
  synced_at: "2026-07-01T00:00:00Z",
  ...over,
});

const JOBS: MirrorJobRow[] = [
  { id: 10, ro_id: 1, authorized: true, job_category_name: "FLUID FLUSHES" },
  { id: 11, ro_id: 1, authorized: false, job_category_name: "FLUID FLUSHES" }, // declined
  { id: 12, ro_id: 1, authorized: null, job_category_name: "FLUID FLUSHES" }, // undetermined
];

describe("authorizedJobIds (INVARIANT #1 gate)", () => {
  it("keeps ONLY authorized === true — false AND null are excluded", () => {
    expect([...authorizedJobIds(JOBS)]).toEqual([10]);
  });

  it("is empty on zero jobs", () => {
    expect(authorizedJobIds([]).size).toBe(0);
  });
});

describe("aggregateBilledHoursByTechnician", () => {
  const labor: MirrorLaborRow[] = [
    { id: 100, job_id: 10, technician_id: 501, hours: 2.5 },
    { id: 101, job_id: 10, technician_id: 501, hours: 1.25 },
    { id: 102, job_id: 10, technician_id: 502, hours: 3 },
    { id: 103, job_id: 11, technician_id: 501, hours: 40 }, // declined parent job
    { id: 104, job_id: 12, technician_id: 501, hours: 40 }, // null-flag parent job
    { id: 105, job_id: 10, technician_id: null, hours: 4 }, // unattributable
    { id: 106, job_id: 10, technician_id: 502, hours: null }, // null hours
  ];

  it("sums per technician on authorized jobs only (declined + null-flag excluded)", () => {
    const m = aggregateBilledHoursByTechnician(JOBS, labor);
    expect(m.get(501)).toBe(3.75);
    expect(m.get(502)).toBe(3);
    expect(m.size).toBe(2);
  });

  it("excludes null-technician and null-hours lines from per-tech totals", () => {
    const m = aggregateBilledHoursByTechnician(JOBS, [
      { id: 1, job_id: 10, technician_id: null, hours: 4 },
      { id: 2, job_id: 10, technician_id: 502, hours: null },
    ]);
    expect(m.size).toBe(0);
  });

  it("rounds to 2dp per technician", () => {
    const m = aggregateBilledHoursByTechnician(JOBS, [
      { id: 1, job_id: 10, technician_id: 501, hours: 0.1 },
      { id: 2, job_id: 10, technician_id: 501, hours: 0.2 },
    ]);
    expect(m.get(501)).toBe(0.3);
  });

  it("zero data → empty map", () => {
    expect(aggregateBilledHoursByTechnician([], []).size).toBe(0);
  });
});

describe("aggregateShopBilledHours", () => {
  it("counts null-technician lines (shop total) but still excludes declined/null jobs", () => {
    const labor: MirrorLaborRow[] = [
      { id: 1, job_id: 10, technician_id: 501, hours: 2 },
      { id: 2, job_id: 10, technician_id: null, hours: 1.5 }, // counted in the shop total
      { id: 3, job_id: 11, technician_id: 501, hours: 99 }, // declined
      { id: 4, job_id: 12, technician_id: 501, hours: 99 }, // null flag
      { id: 5, job_id: 10, technician_id: 501, hours: null },
    ];
    expect(aggregateShopBilledHours(JOBS, labor)).toBe(3.5);
  });

  it("zero data → 0", () => {
    expect(aggregateShopBilledHours([], [])).toBe(0);
  });
});

describe("aggregateSalesCandidates (both month-sales definitions)", () => {
  it("returns Σ total AND Σ (total − taxes)", () => {
    const ros = [
      ro({ id: 1, total_sales_cents: 100_00, taxes_cents: 6_00 }),
      ro({ id: 2, total_sales_cents: 250_50, taxes_cents: 14_50 }),
    ];
    const c = aggregateSalesCandidates(ros);
    expect(c.totalSalesCents).toBe(350_50);
    expect(c.totalSalesMinusTaxesCents).toBe(330_00);
  });

  it("null totals/taxes are treated as 0 (null-safety)", () => {
    const c = aggregateSalesCandidates([ro({ id: 1, total_sales_cents: null, taxes_cents: null })]);
    expect(c.totalSalesCents).toBe(0);
    expect(c.totalSalesMinusTaxesCents).toBe(0);
  });

  it("zero data → zeros", () => {
    const c = aggregateSalesCandidates([]);
    expect(c.totalSalesCents).toBe(0);
    expect(c.totalSalesMinusTaxesCents).toBe(0);
  });
});

describe("aggregateFeesCents", () => {
  it("sums ro.fee_total_cents (Tekmetric's authorized-only rollup), null-safe", () => {
    expect(
      aggregateFeesCents([ro({ id: 1, fee_total_cents: 12_34 }), ro({ id: 2, fee_total_cents: null })]),
    ).toBe(12_34);
    expect(aggregateFeesCents([])).toBe(0);
  });
});

describe("prior-year sales-goal derivation (round-3 #22/#23)", () => {
  it("priorYearMonth shifts the month exactly one year back", () => {
    expect(priorYearMonth("2026-06")).toBe("2025-06");
    expect(priorYearMonth("2026-01")).toBe("2025-01");
    expect(priorYearMonth("2026-12")).toBe("2025-12");
  });

  it("priorYearMonth rejects malformed input", () => {
    expect(() => priorYearMonth("2026-13")).toThrow(/YYYY-MM/);
    expect(() => priorYearMonth("2026-06-01")).toThrow(/YYYY-MM/);
  });

  it("subtotal = Σ(total_sales − taxes), FEES STAY IN (round-9, extraction #45 — supersedes #36, restores #28)", () => {
    const rows = [
      ro({ id: 1, total_sales_cents: 100_000, taxes_cents: 6_000, fee_total_cents: 1_500 }), // 94,000 (fees NOT subtracted)
      ro({ id: 2, total_sales_cents: 50_000, taxes_cents: 3_000, fee_total_cents: 500 }), // 47,000
      ro({ id: 3, total_sales_cents: null, taxes_cents: null, fee_total_cents: null }), // null-safe → 0
    ];
    expect(aggregateMonthSubtotalCents(rows)).toBe(141_000);
  });

  it("#45: the subtotal is IDENTICAL to the GP sales base (#38) — the with/without-fees split is GP-only", () => {
    const rows = [ro({ id: 1, total_sales_cents: 100_000, taxes_cents: 6_000, fee_total_cents: 1_500 })];
    expect(aggregateSalesCandidates(rows).totalSalesMinusTaxesCents).toBe(94_000);
    expect(aggregateMonthSubtotalCents(rows)).toBe(94_000);
  });

  it("zero rows → 0 (callers key the no-data fallback on provenance roCount, not the value)", () => {
    expect(aggregateMonthSubtotalCents([])).toBe(0);
  });
});

describe("parts cost (decision #37 — Σ round(cost × qty) per line, authorized jobs only)", () => {
  const AUTH_JOB: MirrorJobRow[] = [{ id: 10, ro_id: 1, authorized: true, job_category_name: null }];
  const parts: MirrorPartRow[] = [
    { id: 1, job_id: 10, cost_cents: 10_00, quantity: 2 }, // 2,000
    { id: 2, job_id: 10, cost_cents: 5_00, quantity: null }, // qty null → 1 → 500
    { id: 3, job_id: 11, cost_cents: 999_99, quantity: 1 }, // declined parent job
    { id: 4, job_id: 12, cost_cents: 999_99, quantity: 1 }, // null-flag parent job
    { id: 5, job_id: 10, cost_cents: null, quantity: 3 }, // null cost → 0
  ];

  it("#37 definition: Σ round(cost × qty) on authorized jobs only (declined + null-flag excluded)", () => {
    expect(aggregateAuthorizedPartsCostCents(JOBS, parts)).toBe(25_00);
  });

  it("fractional quantities round PER LINE, half away from zero: 1725¢ × 0.5 → 863", () => {
    expect(
      aggregateAuthorizedPartsCostCents(AUTH_JOB, [{ id: 1, job_id: 10, cost_cents: 1725, quantity: 0.5 }]),
    ).toBe(863);
  });

  it("rounding is per LINE, not on the total: two 862.5¢ lines → 863 + 863 = 1726", () => {
    expect(
      aggregateAuthorizedPartsCostCents(AUTH_JOB, [
        { id: 1, job_id: 10, cost_cents: 1725, quantity: 0.5 },
        { id: 2, job_id: 10, cost_cents: 1725, quantity: 0.5 },
      ]),
    ).toBe(1726);
  });

  it("zero data → 0", () => {
    expect(aggregateAuthorizedPartsCostCents([], [])).toBe(0);
  });
});

describe("sublet cost (decision #37 — RO-level sublet items, no authorized flag)", () => {
  it("Σ item cost_cents, null-safe", () => {
    const items: MirrorSubletItemRow[] = [
      { id: 1, sublet_id: 50, cost_cents: 29_000 }, // the June $290.00
      { id: 2, sublet_id: 50, cost_cents: null },
      { id: 3, sublet_id: 51, cost_cents: 1_25 },
    ];
    expect(aggregateSubletCostCents(items)).toBe(29_125);
  });

  it("zero data → 0", () => {
    expect(aggregateSubletCostCents([])).toBe(0);
  });
});

describe("#37 component split (parts table vs sublet — the June proof structure)", () => {
  it("month parts cost composes the two halves: parts(+tires+batteries) + sublet items", () => {
    // Synthetic mini-June: the parts TABLE carries parts + tires + batteries
    // (all qty-weighted per line); sublets ride separately at item cost.
    const jobs: MirrorJobRow[] = [
      { id: 10, ro_id: 1, authorized: true, job_category_name: null },
      { id: 11, ro_id: 1, authorized: false, job_category_name: null }, // declined — excluded
    ];
    const parts: MirrorPartRow[] = [
      { id: 1, job_id: 10, cost_cents: 5_343_456, quantity: 1 }, // "parts"
      { id: 2, job_id: 10, cost_cents: 659_580, quantity: 2 }, // "tires" → 1,319,160
      { id: 3, job_id: 10, cost_cents: 245_474, quantity: 1 }, // "batteries"
      { id: 4, job_id: 11, cost_cents: 999_999, quantity: 1 }, // declined — excluded
    ];
    const subletItems: MirrorSubletItemRow[] = [{ id: 1, sublet_id: 9, cost_cents: 29_000 }];
    const partsHalf = aggregateAuthorizedPartsCostCents(jobs, parts);
    const subletHalf = aggregateSubletCostCents(subletItems);
    expect(partsHalf).toBe(6_908_090); // $69,080.90 — the parts-table half
    expect(subletHalf).toBe(29_000); // $290.00 — the sublet half
    expect(partsHalf + subletHalf).toBe(6_937_090); // $69,370.90 — decision #37's June total
  });
});

describe("aggregateSpiffCountsByServiceWriter", () => {
  const categories: SpiffCategoryConfig[] = [
    { name: "FLUID FLUSHES", counted: true, multiplier: 1 },
    { name: "FLUID FLUSH 2", counted: true, multiplier: 2 },
    { name: "FLUID FLUSH ADD ON ", counted: true, multiplier: 1 }, // live trailing-space value
    { name: "5PACK", counted: false, multiplier: 1 }, // configured OFF
  ];

  const ros = [
    ro({ id: 1, service_writer_id: 900 }),
    ro({ id: 2, service_writer_id: 901 }),
    ro({ id: 3, service_writer_id: null }), // nobody to credit
  ];

  it("Σ multiplier per counted category, authorized jobs only, grouped by service writer", () => {
    const jobs: MirrorJobRow[] = [
      { id: 10, ro_id: 1, authorized: true, job_category_name: "FLUID FLUSHES" }, // sw 900 +1
      { id: 11, ro_id: 1, authorized: true, job_category_name: "FLUID FLUSH 2" }, // sw 900 +2 (multiplier)
      { id: 12, ro_id: 1, authorized: false, job_category_name: "FLUID FLUSHES" }, // declined → 0
      { id: 13, ro_id: 1, authorized: null, job_category_name: "FLUID FLUSH 2" }, // null flag → 0
      { id: 14, ro_id: 2, authorized: true, job_category_name: "FLUID FLUSH ADD ON " }, // sw 901 +1 (verbatim)
      { id: 15, ro_id: 2, authorized: true, job_category_name: "5PACK" }, // counted=false → 0
      { id: 16, ro_id: 2, authorized: true, job_category_name: "BRAKES" }, // unknown category → 0
      { id: 17, ro_id: 2, authorized: true, job_category_name: null }, // no category → 0
      { id: 18, ro_id: 3, authorized: true, job_category_name: "FLUID FLUSHES" }, // null sw → 0
    ];
    const counts = aggregateSpiffCountsByServiceWriter(ros, jobs, categories);
    expect(counts.get(900)).toBe(3);
    expect(counts.get(901)).toBe(1);
    expect(counts.size).toBe(2);
  });

  it("trailing-space names do NOT match their trimmed twin (verbatim compare)", () => {
    const jobs: MirrorJobRow[] = [
      { id: 10, ro_id: 1, authorized: true, job_category_name: "FLUID FLUSH ADD ON" }, // no trailing space
    ];
    expect(aggregateSpiffCountsByServiceWriter(ros, jobs, categories).size).toBe(0);
  });

  it("zero data → empty map", () => {
    expect(aggregateSpiffCountsByServiceWriter([], [], []).size).toBe(0);
    expect(aggregateSpiffCountsByServiceWriter(ros, [], categories).size).toBe(0);
  });
});

describe("newCategoryNames", () => {
  it("returns unseen names deduped + sorted, keeps verbatim spelling, drops nulls", () => {
    expect(
      newCategoryNames(
        ["5PACK", "FLUID FLUSH ADD ON ", "FLUID FLUSH ADD ON ", null, "BRAKES"],
        ["5PACK"],
      ),
    ).toEqual(["BRAKES", "FLUID FLUSH ADD ON "]);
  });

  it("zero data → empty", () => {
    expect(newCategoryNames([], [])).toEqual([]);
  });
});

describe("rosInLocalRange — the #39 shop-local date bucketing (basis-parameterized)", () => {
  const TZ = "America/New_York";

  it("buckets the evening boundary to the SHOP-LOCAL day: completed 7/4 23:30 ET = 7/5 03:30Z → 7/4", () => {
    // The round-7 #39 acceptance case: an RO completed Saturday evening (week-1's
    // last day, 2026-07-04T23:30 ET) arrives in UTC as 2026-07-05T03:30:00Z. A
    // naive UTC bucket would push it into week 2 — it MUST land in week 1 (…7/4).
    const evening = ro({ id: 1, completed_date: "2026-07-05T03:30:00Z", posted_date: null });
    const week1 = rosInLocalRange([evening], "completed_date", "2026-06-28", "2026-07-04", TZ);
    const week2 = rosInLocalRange([evening], "completed_date", "2026-07-05", "2026-07-11", TZ);
    expect(week1.map((r) => r.id)).toEqual([1]);
    expect(week2).toEqual([]);
  });

  it("includes completed-but-NOT-posted ROs on the completed basis (the #39 point)", () => {
    const unposted = ro({ id: 2, completed_date: "2026-07-06T15:00:00Z", posted_date: null });
    expect(rosInLocalRange([unposted], "completed_date", "2026-07-05", "2026-07-11", TZ).length).toBe(1);
    // …while the posted basis excludes the same row (null basis date → out).
    expect(rosInLocalRange([unposted], "posted_date", "2026-07-05", "2026-07-11", TZ)).toEqual([]);
  });

  it("the two bases bucket the SAME RO independently (completed 6/30, posted 7/2)", () => {
    const straddler = ro({
      id: 3,
      completed_date: "2026-06-30T20:00:00Z",
      posted_date: "2026-07-02T14:00:00Z",
    });
    expect(rosInLocalRange([straddler], "completed_date", "2026-06-01", "2026-06-30", TZ).length).toBe(1);
    expect(rosInLocalRange([straddler], "posted_date", "2026-06-01", "2026-06-30", TZ)).toEqual([]);
    expect(rosInLocalRange([straddler], "posted_date", "2026-07-01", "2026-07-31", TZ).length).toBe(1);
  });

  it("range ends are inclusive on both sides (shop-local calendar dates)", () => {
    const first = ro({ id: 4, completed_date: "2026-06-28T12:00:00Z" });
    const last = ro({ id: 5, completed_date: "2026-07-04T12:00:00Z" });
    const out = rosInLocalRange([first, last], "completed_date", "2026-06-28", "2026-07-04", TZ);
    expect(out.map((r) => r.id)).toEqual([4, 5]);
  });
});

describe("rosInLocalRangeHoursBasis — the round-10 #50 HOURS basis (posted, else completed)", () => {
  const TZ = "America/New_York";

  it("the RO 153870 case: completed Fri 7/3 (w1) but posted Mon 7/6 → buckets to WEEK 2", () => {
    // Chris's live discrepancy (Clark 1.0h): the report shows the posted week.
    const weekender = ro({
      id: 1,
      completed_date: "2026-07-03T21:08:59Z",
      posted_date: "2026-07-06T12:48:17Z",
    });
    expect(rosInLocalRangeHoursBasis([weekender], "2026-06-28", "2026-07-04", TZ)).toEqual([]);
    expect(rosInLocalRangeHoursBasis([weekender], "2026-07-05", "2026-07-11", TZ).map((r) => r.id)).toEqual([1]);
  });

  it("completed-but-NOT-posted ROs still count when performed (the #39 point survives)", () => {
    const unposted = ro({ id: 2, completed_date: "2026-07-06T15:00:00Z", posted_date: null });
    expect(rosInLocalRangeHoursBasis([unposted], "2026-07-05", "2026-07-11", TZ).length).toBe(1);
  });

  it("a stale RO completed months earlier counts in its POSTED week (the RO 152158 case)", () => {
    const stale = ro({
      id: 3,
      completed_date: "2026-05-28T15:00:00Z",
      posted_date: "2026-07-10T15:00:00Z",
    });
    expect(rosInLocalRangeHoursBasis([stale], "2026-07-05", "2026-07-11", TZ).length).toBe(1);
  });

  it("completed in-window but posted AFTER it → excluded (it will count in the posted window)", () => {
    const postedLater = ro({
      id: 4,
      completed_date: "2026-07-10T15:00:00Z",
      posted_date: "2026-07-13T15:00:00Z",
    });
    expect(rosInLocalRangeHoursBasis([postedLater], "2026-07-05", "2026-07-11", TZ)).toEqual([]);
  });

  it("the posted timestamp converts shop-local at the evening boundary (posted 7/4 23:30 ET = 7/5 03:30Z → w1)", () => {
    const evening = ro({
      id: 5,
      completed_date: "2026-07-04T18:00:00Z",
      posted_date: "2026-07-05T03:30:00Z",
    });
    expect(rosInLocalRangeHoursBasis([evening], "2026-06-28", "2026-07-04", TZ).map((r) => r.id)).toEqual([5]);
    expect(rosInLocalRangeHoursBasis([evening], "2026-07-05", "2026-07-11", TZ)).toEqual([]);
  });

  it("neither date → excluded", () => {
    expect(
      rosInLocalRangeHoursBasis([ro({ id: 6, completed_date: null, posted_date: null })], "2026-07-05", "2026-07-11", TZ),
    ).toEqual([]);
  });
});

describe("helpers", () => {
  it("monthDateRange handles month lengths + leap years and rejects junk", () => {
    expect(monthDateRange("2026-06")).toEqual({ start: "2026-06-01", end: "2026-06-30" });
    expect(monthDateRange("2026-07")).toEqual({ start: "2026-07-01", end: "2026-07-31" });
    expect(monthDateRange("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(() => monthDateRange("2026-13")).toThrow(/YYYY-MM/);
    expect(() => monthDateRange("June 2026")).toThrow(/YYYY-MM/);
  });

  it("roundCents rounds half away from zero in both directions", () => {
    expect(roundCents(0.5)).toBe(1);
    expect(roundCents(-0.5)).toBe(-1);
    expect(roundCents(2.4)).toBe(2);
    expect(roundCents(-2.6)).toBe(-3);
    expect(roundCents(0)).toBe(0);
  });
});
