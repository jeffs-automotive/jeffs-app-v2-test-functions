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
  aggregateAuthorizedPartsCostQtyWeightedCents,
  aggregateMonthSubtotalCents,
  aggregateSpiffCountsByServiceWriter,
  newCategoryNames,
  monthDateRange,
  priorYearMonth,
  roundCents,
  type MirrorJobRow,
  type MirrorLaborRow,
  type MirrorPartRow,
  type MirrorRoRow,
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

  it('subtotal = Σ(total_sales − taxes − fees) — Chris\'s "sales − tax" per the backtest pin', () => {
    const rows = [
      ro({ id: 1, total_sales_cents: 100_000, taxes_cents: 6_000, fee_total_cents: 1_500 }), // 92,500
      ro({ id: 2, total_sales_cents: 50_000, taxes_cents: 3_000, fee_total_cents: 500 }), // 46,500
      ro({ id: 3, total_sales_cents: null, taxes_cents: null, fee_total_cents: null }), // null-safe → 0
    ];
    expect(aggregateMonthSubtotalCents(rows)).toBe(139_000);
  });

  it("zero rows → 0 (callers key the no-data fallback on provenance roCount, not the value)", () => {
    expect(aggregateMonthSubtotalCents([])).toBe(0);
  });
});

describe("parts cost aggregators", () => {
  const parts: MirrorPartRow[] = [
    { id: 1, job_id: 10, cost_cents: 10_00, quantity: 2 },
    { id: 2, job_id: 10, cost_cents: 5_00, quantity: null }, // qty null → 1
    { id: 3, job_id: 11, cost_cents: 999_99, quantity: 1 }, // declined parent job
    { id: 4, job_id: 12, cost_cents: 999_99, quantity: 1 }, // null-flag parent job
    { id: 5, job_id: 10, cost_cents: null, quantity: 3 }, // null cost
  ];

  it("contract definition: Σ cost_cents on authorized jobs only", () => {
    expect(aggregateAuthorizedPartsCostCents(JOBS, parts)).toBe(15_00);
  });

  it("qty-weighted candidate: Σ round(cost × qty) on authorized jobs only", () => {
    expect(aggregateAuthorizedPartsCostQtyWeightedCents(JOBS, parts)).toBe(25_00);
  });

  it("qty-weighted rounds half away from zero on fractional quantities", () => {
    const j: MirrorJobRow[] = [{ id: 10, ro_id: 1, authorized: true, job_category_name: null }];
    // 333 × 1.5 = 499.5 → 500
    expect(
      aggregateAuthorizedPartsCostQtyWeightedCents(j, [{ id: 1, job_id: 10, cost_cents: 333, quantity: 1.5 }]),
    ).toBe(500);
  });

  it("zero data → 0", () => {
    expect(aggregateAuthorizedPartsCostCents([], [])).toBe(0);
    expect(aggregateAuthorizedPartsCostQtyWeightedCents([], [])).toBe(0);
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
