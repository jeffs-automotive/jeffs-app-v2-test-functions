/**
 * Unit tests for the §8 SALE reconciliation gate. Pure: builds a real JE with the C5
 * builder, then gates it — calibrated to the C7 §8 data validation (685 real ROs).
 */
import { describe, it, expect } from "vitest";
import {
  buildSaleJournalEntry,
  type RoSaleSnapshot,
  type ResolvedMappings,
  type SaleSettings,
  type SaleJournalEntry,
  type SnapshotJob,
} from "../../sales/sale-builder";
import { gateSaleDraft, type SaleGateSettings } from "../sale-gate";

const M: ResolvedMappings = {
  laborAccountId: "275",
  partCategoryAccountIds: { PART: "272", TIRE: "270", BATTERY: "271" },
  feeAccountsByName: { "shop supplies": { accountId: "273", passThrough: false } },
  subletAccountId: "276",
  arAccountId: "235",
  salesTaxAccountId: "250",
  tireFeeAccountId: "252",
};
const S: SaleSettings = { shopTimezone: "America/New_York", tireFeeCentsPerTire: 100, salesTaxRateBps: 600 };
const G: SaleGateSettings = { salesTaxRateBps: 600 };

function snap(over: Partial<RoSaleSnapshot>): RoSaleSnapshot {
  return {
    repairOrderNumber: "152805", repairOrderId: 42, postedDate: "2026-05-19T15:39:04Z",
    partsSales: 0, laborSales: 0, subletSales: 0, feeTotal: 0, discountTotal: 0, taxes: 0, totalSales: 0,
    jobs: [], fees: [], ...over,
  };
}
function job(over: Partial<SnapshotJob>): SnapshotJob {
  return { authorized: true, parts: [], labor: [], fees: [], ...over };
}
const kinds = (r: { reviewItems: { kind: string }[] }) => r.reviewItems.map((i) => i.kind);

describe("gateSaleDraft — postable", () => {
  it("passes a clean, fully-mapped, balanced RO with exact-6% tax", () => {
    const s = snap({ partsSales: 10000, taxes: 600, totalSales: 10600,
      jobs: [job({ parts: [{ retail: 10000, quantity: 1, partType: { code: "PART" } }] })] });
    const r = gateSaleDraft(s, buildSaleJournalEntry(s, M, S), G);
    expect(r.postable).toBe(true);
    expect(r.reviewItems).toEqual([]);
  });

  it("does NOT flag a legitimately tax-EXEMPT RO (tax well below 6% — the no-false-positive case)", () => {
    // base 10000, taxes 300 (3%) — an exempt customer; the payload has no taxable flags
    // so we must NOT low-side-flag it.
    const s = snap({ partsSales: 10000, taxes: 300, totalSales: 10300,
      jobs: [job({ parts: [{ retail: 10000, quantity: 1, partType: { code: "PART" } }] })] });
    const r = gateSaleDraft(s, buildSaleJournalEntry(s, M, S), G);
    expect(r.postable).toBe(true);
    expect(kinds(r)).not.toContain("tax_high");
  });

  it("passes a multi-source RO (RO 152805) end-to-end", () => {
    const s = snap({ partsSales: 5386, laborSales: 6494, feeTotal: 1188, discountTotal: 2500, taxes: 634, totalSales: 11202,
      fees: [{ name: "Shop supplies", total: 1188 }],
      jobs: [job({ parts: [{ retail: 5386, quantity: 1, partType: { code: "PART" } }], labor: [{ rate: 6494, hours: 1 }] })] });
    const r = gateSaleDraft(s, buildSaleJournalEntry(s, M, S), G);
    expect(r.postable).toBe(true);
    expect(r.reviewItems).toEqual([]);
  });

  it("passes a tire RO that legitimately charged the $1/tire fee (taxes = 6% + tire×$1)", () => {
    // base 10000 → 6% = 600 sales tax; + 1 tire × $1 = 100 fee → taxes 700.
    const s = snap({ partsSales: 10000, taxes: 700, totalSales: 10700,
      jobs: [job({ parts: [{ retail: 10000, quantity: 1, partType: { code: "TIRE" } }] })] });
    const je = buildSaleJournalEntry(s, M, S);
    // salesTax = 700 − tireFee(100) = 600 == baseline → within tolerance, not flagged.
    expect(je.taxSplit).toEqual({ tireFeeCents: 100, salesTaxCents: 600 });
    const r = gateSaleDraft(s, je, G);
    expect(r.postable).toBe(true);
    expect(kinds(r)).not.toContain("tax_high");
  });
});

describe("gateSaleDraft — review items", () => {
  it("emits ONE 'unmapped' item (with all reasons) for a draft with a missing mapping", () => {
    const s = snap({ feeTotal: 500, totalSales: 500, fees: [{ name: "Brand New Fee", total: 500 }] });
    const r = gateSaleDraft(s, buildSaleJournalEntry(s, M, S), G);
    expect(r.postable).toBe(false);
    expect(kinds(r)).toEqual(["unmapped"]);
    expect((r.reviewItems[0]!.detail!.reasons as string[])).toContain("fee:Brand New Fee");
    expect(r.reviewItems[0]!.subjectKind).toBe("ro");
    expect(r.reviewItems[0]!.subjectRef).toBe("42");
  });

  it("flags a broken accounting identity (totalSales ≠ component sum)", () => {
    const s = snap({ partsSales: 10000, taxes: 600, totalSales: 99999, // inconsistent
      jobs: [job({ parts: [{ retail: 10000, quantity: 1, partType: { code: "PART" } }] })] });
    const r = gateSaleDraft(s, buildSaleJournalEntry(s, M, S), G);
    expect(r.postable).toBe(false);
    expect(kinds(r)).toContain("tax_identity");
    const item = r.reviewItems.find((i) => i.kind === "tax_identity")!;
    expect(item.detail!.differenceCents).toBe(99999 - 10600);
  });

  it("flags too-much tax (sales-tax portion exceeds 6% of base, no tires)", () => {
    // base 10000, taxes 700, 0 tires → salesTax 700 > round(6%×10000)=600 + 2 → tax_high.
    const s = snap({ partsSales: 10000, taxes: 700, totalSales: 10700,
      jobs: [job({ parts: [{ retail: 10000, quantity: 1, partType: { code: "PART" } }] })] });
    const r = gateSaleDraft(s, buildSaleJournalEntry(s, M, S), G);
    expect(r.postable).toBe(false);
    expect(kinds(r)).toContain("tax_high");
    const item = r.reviewItems.find((i) => i.kind === "tax_high")!;
    expect(item.detail!.salesTaxCents).toBe(700);
    expect(item.detail!.baselineSalesTaxCents).toBe(600);
  });

  it("can emit multiple distinct review items for one RO", () => {
    // unmapped fee AND too-high tax on the same RO → two items (different kinds).
    const s = snap({ partsSales: 10000, feeTotal: 500, taxes: 700, totalSales: 11200,
      fees: [{ name: "Brand New Fee", total: 500 }],
      jobs: [job({ parts: [{ retail: 10000, quantity: 1, partType: { code: "PART" } }] })] });
    const r = gateSaleDraft(s, buildSaleJournalEntry(s, M, S), G);
    expect(r.postable).toBe(false);
    expect(kinds(r).sort()).toEqual(["tax_high", "unmapped"]);
  });

  it("flags a negative component (corrupt input) as 'negative_component'", () => {
    // identity still holds (10000 + (-50) = 9950) but a negative tax component is corrupt.
    const s = snap({ partsSales: 10000, taxes: -50, totalSales: 9950,
      jobs: [job({ parts: [{ retail: 10000, quantity: 1, partType: { code: "PART" } }] })] });
    const r = gateSaleDraft(s, buildSaleJournalEntry(s, M, S), G);
    expect(r.postable).toBe(false);
    expect(kinds(r)).toContain("negative_component");
  });

  it("fail-closed catch-all: an unbalanced draft with no specific reason → 'unbalanced'", () => {
    // a self-consistent snapshot (no identity/negative/tax issue) but a hand-built JE that
    // doesn't balance + has nothing in unmapped → must NOT be silently dropped.
    const s = snap({ partsSales: 100, taxes: 0, totalSales: 100 });
    const fakeJe: SaleJournalEntry = {
      docNumber: "RO 1", txnDate: "2026-05-19", lines: [], arEntityless: true,
      discountAllocation: {}, taxSplit: { tireFeeCents: 0, salesTaxCents: 0 },
      unmapped: [], balanced: false, totalDebitsCents: 100, totalCreditsCents: 50,
    };
    const r = gateSaleDraft(s, fakeJe, G);
    expect(r.postable).toBe(false);
    expect(kinds(r)).toEqual(["unbalanced"]);
  });
});
