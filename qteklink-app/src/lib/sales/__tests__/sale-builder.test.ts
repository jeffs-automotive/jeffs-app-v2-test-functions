/**
 * Unit tests for the pure SALE JE builder (C5). No mocks — pure TS over a parsed
 * RO snapshot + resolved mappings. Fixtures are grounded in the verified model
 * (reconciliation identity holds; authorized-only; retail×qty / rate×hours ties).
 */
import { describe, it, expect } from "vitest";
import {
  allocateByShare,
  normalizeName,
  toShopLocalDate,
  buildSaleJournalEntry,
  type RoSaleSnapshot,
  type ResolvedMappings,
  type SaleSettings,
  type SnapshotJob,
} from "../sale-builder";

const M: ResolvedMappings = {
  laborAccountId: "275",
  partCategoryAccountIds: { PART: "272", TIRE: "270", BATTERY: "271" },
  feeAccountsByName: {
    "shop supplies": { accountId: "273", passThrough: false },
    "hazmat/oil disposal fee": { accountId: "277", passThrough: false },
    "state communication fee": { accountId: "276", passThrough: true },
  },
  subletAccountId: "276",
  arAccountId: "235",
  salesTaxAccountId: "250",
  tireFeeAccountId: "252",
};
const S: SaleSettings = { shopTimezone: "America/New_York", tireFeeCentsPerTire: 100, salesTaxRateBps: 600 };

function snap(over: Partial<RoSaleSnapshot>): RoSaleSnapshot {
  return {
    repairOrderNumber: "152805",
    repairOrderId: 1,
    postedDate: "2026-05-19T15:39:04Z",
    partsSales: 0, laborSales: 0, subletSales: 0,
    feeTotal: 0, discountTotal: 0, taxes: 0, totalSales: 0,
    jobs: [], fees: [],
    ...over,
  };
}
function job(over: Partial<SnapshotJob>): SnapshotJob {
  return { authorized: true, parts: [], labor: [], fees: [], ...over };
}
/** sum of credits to one account (after zero-line omission) */
const cr = (je: { lines: { accountId: string; postingType: string; amountCents: number }[] }, acct: string) =>
  je.lines.filter((l) => l.accountId === acct && l.postingType === "Credit").reduce((a, l) => a + l.amountCents, 0);
const dr = (je: { lines: { accountId: string; postingType: string; amountCents: number }[] }, acct: string) =>
  je.lines.filter((l) => l.accountId === acct && l.postingType === "Debit").reduce((a, l) => a + l.amountCents, 0);

describe("allocateByShare (largest-remainder)", () => {
  it("ties exactly and hands leftover cents to the largest fractions", () => {
    expect(allocateByShare(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateByShare(10, [1, 0, 0])).toEqual([10, 0, 0]); // single non-zero bucket gets it all
    expect(allocateByShare(0, [3, 7])).toEqual([0, 0]);
    expect(allocateByShare(100, [0, 0])).toEqual([0, 0]);
    // A negative weight must NOT make positive buckets over-allocate beyond total.
    expect(allocateByShare(100, [100, -50]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(allocateByShare(100, [100, -50])[1]).toBe(0);
  });
  it("handles fractional weights (retail×qty) and always sums to total", () => {
    for (const [total, weights] of [
      [5386, [5386.0]],
      [10000, [6000, 4000]],
      [2195, [21340.03, 18178.1]],
      [9129, [3000.5, 6128.7]],
    ] as [number, number[]][]) {
      const out = allocateByShare(total, weights);
      expect(out.reduce((a, b) => a + b, 0)).toBe(total);
      expect(out.every((x) => Number.isInteger(x) && x >= 0)).toBe(true);
    }
  });
});

describe("normalizeName + toShopLocalDate", () => {
  it("trims + lowercases fee names", () => {
    expect(normalizeName("  AAA Discount ")).toBe("aaa discount");
    expect(normalizeName("Shop supplies")).toBe("shop supplies");
  });
  it("converts a UTC postedDate to the shop-local calendar date", () => {
    // 01:30 UTC is the prior evening in America/New_York (EDT, UTC-4) → 2026-05-19
    expect(toShopLocalDate("2026-05-20T01:30:00Z", "America/New_York")).toBe("2026-05-19");
    expect(toShopLocalDate("2026-05-19T15:39:04Z", "America/New_York")).toBe("2026-05-19");
  });
});

describe("buildSaleJournalEntry — RO 152805 (waterfall: $25 discount lands entirely on labor)", () => {
  const je = buildSaleJournalEntry(
    snap({
      repairOrderNumber: "152805",
      partsSales: 5386, laborSales: 6494, feeTotal: 1188, discountTotal: 2500, taxes: 634, totalSales: 11202,
      fees: [{ name: "Shop supplies", total: 1188 }],
      jobs: [job({ parts: [{ retail: 5386, quantity: 1, partType: { code: "PART" } }], labor: [{ rate: 6494, hours: 1 }] })],
    }),
    M, S,
  );
  it("debits A/R the net total with NO EntityRef", () => {
    expect(dr(je, "235")).toBe(11202);
    expect(je.arEntityless).toBe(true);
  });
  it("credits labor NET of the whole discount, parts + fee gross, sales tax", () => {
    expect(cr(je, "275")).toBe(3994); // 6494 - 2500
    expect(cr(je, "272")).toBe(5386); // parts untouched (discount exhausted on labor)
    expect(cr(je, "273")).toBe(1188); // fee untouched
    expect(cr(je, "250")).toBe(634);  // tire_qty 0 → all tax is sales tax
  });
  it("balances and records the discount allocation", () => {
    expect(je.balanced).toBe(true);
    expect(je.totalDebitsCents).toBe(je.totalCreditsCents);
    expect(je.discountAllocation).toEqual({ "275": 2500 });
    expect(je.docNumber).toBe("RO 152805");
    expect(je.txnDate).toBe("2026-05-19");
    expect(je.unmapped).toEqual([]);
  });
});

describe("buildSaleJournalEntry — discount waterfall overflow (labor → parts)", () => {
  it("fills labor first then spills to parts; a zeroed labor line is omitted", () => {
    const je = buildSaleJournalEntry(
      snap({ partsSales: 5386, laborSales: 6494, discountTotal: 8000, totalSales: 3880,
        jobs: [job({ parts: [{ retail: 5386, quantity: 1, partType: { code: "PART" } }], labor: [{ rate: 6494, hours: 1 }] })] }),
      M, S,
    );
    expect(cr(je, "275")).toBe(0); // 6494-6494=0 → line omitted
    expect(je.lines.some((l) => l.accountId === "275")).toBe(false);
    expect(cr(je, "272")).toBe(3880); // 5386 - (8000-6494)=1506
    expect(dr(je, "235")).toBe(3880);
    expect(je.balanced).toBe(true);
    expect(je.discountAllocation).toEqual({ "275": 6494, "272": 1506 });
  });
});

describe("buildSaleJournalEntry — multi-category parts + tire fee", () => {
  it("splits parts gross + the parts-bucket discount pro-rata across categories, and books the tire fee (excess above 6%) to PTAL", () => {
    const je = buildSaleJournalEntry(
      snap({
        // taxes 880 = round(6% × 8000 base) = 480 sales tax + 4 tires × $1 = 400 fee (realistic).
        laborSales: 1000, partsSales: 10000, discountTotal: 3000, taxes: 880, totalSales: 8880,
        jobs: [job({
          labor: [{ rate: 1000, hours: 1 }],
          parts: [
            { retail: 6000, quantity: 1, partType: { code: "PART" } },
            { retail: 1000, quantity: 4, partType: { code: "TIRE" } }, // 4000 gross, 4 tires
          ],
        })],
      }),
      M, S,
    );
    // labor: 1000-1000=0 (omitted). parts bucket discount = 3000-1000 = 2000.
    // gross split 10000 by [6000,4000] = [6000,4000]; discount 2000 by [6000,4000] = [1200,800].
    expect(cr(je, "272")).toBe(4800); // PART 6000-1200
    expect(cr(je, "270")).toBe(3200); // TIRE 4000-800
    expect(cr(je, "252")).toBe(400);  // tire fee = 880 − round(6%×8000)=480 → 400, capped at 4×$1
    expect(cr(je, "250")).toBe(480);  // sales tax = 880 − 400 tire fee
    expect(dr(je, "235")).toBe(8880);
    expect(je.balanced).toBe(true);
  });

  it("books NO tire fee when a tire-RO's tax is plain 6% (the C5 clamp fix: 56/85 real tire-ROs charge no fee)", () => {
    // base 10000, taxes 600 = exactly 6% — Tekmetric charged no $1/tire fee on these tires.
    // The OLD unconditional carve-out wrongly booked 2×$1 to PTAL; the clamp books $0.
    const je = buildSaleJournalEntry(
      snap({ partsSales: 10000, taxes: 600, totalSales: 10600,
        jobs: [job({ parts: [{ retail: 5000, quantity: 2, partType: { code: "TIRE" } }] })] }),
      M, S,
    );
    expect(cr(je, "252")).toBe(0);   // NO tire fee — taxes ≤ round(6%×base)
    expect(je.lines.some((l) => l.accountId === "252")).toBe(false);
    expect(cr(je, "250")).toBe(600); // all tax is sales tax
    expect(je.balanced).toBe(true);
  });
});

describe("buildSaleJournalEntry — pass-through fee excluded from the waterfall", () => {
  it("does not discount a pass-through fee; the discount stays within discountable fees", () => {
    const je = buildSaleJournalEntry(
      snap({ feeTotal: 1500, discountTotal: 800, totalSales: 700,
        fees: [{ name: "Shop supplies", total: 1000 }, { name: "State Communication Fee", total: 500 }] }),
      M, S,
    );
    expect(cr(je, "273")).toBe(200); // shop supplies 1000-800 (took the whole discount)
    expect(cr(je, "276")).toBe(500); // state comm fee UNtouched (pass-through, → sublet acct)
    expect(je.discountAllocation).toEqual({ "273": 800 });
    expect(dr(je, "235")).toBe(700);
    expect(je.balanced).toBe(true);
  });
});

describe("buildSaleJournalEntry — guards", () => {
  it("ignores DECLINED (authorized=false) jobs", () => {
    const je = buildSaleJournalEntry(
      snap({ laborSales: 1000, totalSales: 1000,
        jobs: [
          job({ labor: [{ rate: 1000, hours: 1 }] }),
          { authorized: false, parts: [{ retail: 999999, quantity: 9, partType: { code: "PART" } }], labor: [{ rate: 99999, hours: 9 }], fees: [{ name: "Bogus", total: 99999 }] },
        ] }),
      M, S,
    );
    expect(cr(je, "275")).toBe(1000);
    expect(je.lines.some((l) => l.accountId === "272")).toBe(false); // declined parts ignored
    expect(je.balanced).toBe(true);
  });

  it("reports an unmapped fee to the resolution queue and is NOT balanced", () => {
    const je = buildSaleJournalEntry(
      snap({ feeTotal: 500, totalSales: 500, fees: [{ name: "Brand New Fee", total: 500 }] }),
      M, S,
    );
    expect(je.unmapped).toContain("fee:Brand New Fee");
    expect(je.balanced).toBe(false); // missing the income credit → not balanced
    expect(dr(je, "235")).toBe(500);
  });

  it("produces NO lines for a fully-comped $0 RO", () => {
    const je = buildSaleJournalEntry(
      snap({ partsSales: 5000, laborSales: 5000, discountTotal: 10000, taxes: 0, totalSales: 0,
        jobs: [job({ parts: [{ retail: 5000, quantity: 1, partType: { code: "PART" } }], labor: [{ rate: 5000, hours: 1 }] })] }),
      M, S,
    );
    expect(je.lines).toEqual([]);
    expect(je.unmapped).toEqual([]);
    expect(je.balanced).toBe(true); // 0 === 0
  });

  it("flags a tax split that would go negative (corrupt: a net-negative taxable base with tax)", () => {
    // base = 500 − 1500 = −1000 (discounts exceed sales); 1 tire; taxes 50.
    // clamp baseline = round(6%×−1000) = −60 → tireFee = min(50−(−60), 100) = 100 > taxes
    // → salesTax = 50 − 100 = −50 < 0 → queued (never post a negative tax line).
    const je = buildSaleJournalEntry(
      snap({ laborSales: 500, discountTotal: 1500, taxes: 50, totalSales: -950,
        jobs: [job({ labor: [{ rate: 500, hours: 1 }], parts: [{ retail: 0, quantity: 1, partType: { code: "TIRE" } }] })] }),
      M, S,
    );
    expect(je.unmapped.some((u) => u.startsWith("tax_split:"))).toBe(true);
    expect(je.balanced).toBe(false);
  });

  it("sums RO-level AND authorized job-level fees by normalized name", () => {
    const je = buildSaleJournalEntry(
      snap({ feeTotal: 300, totalSales: 300,
        fees: [{ name: "Shop supplies", total: 100 }],
        jobs: [job({ fees: [{ name: "shop supplies ", total: 200 }] })] }), // trailing space + casing
      M, S,
    );
    expect(cr(je, "273")).toBe(300); // merged into one line
    expect(je.lines.filter((l) => l.accountId === "273")).toHaveLength(1);
    expect(je.balanced).toBe(true);
  });
});

describe("C5 round-2 hardening (cross-verify)", () => {
  it("excludes an UNMAPPED fee from the discount waterfall (discount not lost to a non-posting line)", () => {
    // labor (100) can't absorb the 500 discount, so it overflows to the fee bucket; the
    // UNMAPPED 'Mystery Fee' must be excluded so its share isn't lost — all 400 lands on
    // the mapped 'Shop supplies'.
    const je = buildSaleJournalEntry(
      snap({
        laborSales: 100, feeTotal: 2000, discountTotal: 500, totalSales: 1600,
        fees: [{ name: "Shop supplies", total: 1000 }, { name: "Mystery Fee", total: 1000 }],
        jobs: [job({ labor: [{ rate: 100, hours: 1 }] })],
      }),
      M, S,
    );
    expect(cr(je, "273")).toBe(600); // 1000 − 400 (full overflow discount), not 800
    expect(je.discountAllocation["273"]).toBe(400);
    expect(je.unmapped).toContain("fee:Mystery Fee");
    expect(je.balanced).toBe(false); // unmapped → queued
  });

  it("queues parts that can't be weighted (partsSales>0 but zero-weight lines)", () => {
    const je = buildSaleJournalEntry(
      snap({ partsSales: 5000, totalSales: 5000, jobs: [job({ parts: [{ retail: 0, quantity: 0, partType: { code: "PART" } }] })] }),
      M, S,
    );
    expect(je.unmapped).toContain("part_category:unweighted");
    expect(je.balanced).toBe(false);
  });

  it("queues a negative total (a posted sale is never negative)", () => {
    const je = buildSaleJournalEntry(snap({ totalSales: -100, laborSales: -100 }), M, S);
    expect(je.unmapped.some((u) => u.startsWith("negative_total:"))).toBe(true);
    expect(je.balanced).toBe(false);
  });

  it("normalizes the part category code (casing/whitespace) for mapping + the tire fee", () => {
    // taxes 1400 = round(6%×20000)=1200 sales tax + 2 tires × $1 = 200 fee.
    const je = buildSaleJournalEntry(
      snap({ partsSales: 20000, taxes: 1400, totalSales: 21400, jobs: [job({ parts: [{ retail: 10000, quantity: 2, partType: { code: " tire " } }] })] }),
      M, S,
    );
    expect(cr(je, "270")).toBe(20000); // matched the TIRE part-category account
    expect(cr(je, "252")).toBe(200);   // tire fee = 1400 − round(6%×20000)=1200 → 200 (2 × $1.00)
    expect(cr(je, "250")).toBe(1200);  // sales tax = 1400 − 200
    expect(dr(je, "235")).toBe(21400);
    expect(je.balanced).toBe(true);
  });
});
