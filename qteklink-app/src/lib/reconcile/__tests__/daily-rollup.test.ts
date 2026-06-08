/**
 * Unit tests for the pure §8 daily roll-up — real SALE + PAYMENT builder output.
 */
import { describe, it, expect } from "vitest";
import {
  buildSaleJournalEntry,
  type RoSaleSnapshot, type ResolvedMappings, type SaleSettings, type SnapshotJob,
} from "../../sales/sale-builder";
import {
  buildPaymentJournalEntry,
  type PaymentForBuild, type ResolvedPaymentMappings, type PaymentSettings,
} from "../../payments/payment-je-builder";
import { rollupDay } from "../daily-rollup";
import type { SaleGateSettings } from "../sale-gate";

const SM: ResolvedMappings = {
  laborAccountId: "275", partCategoryAccountIds: { PART: "272", TIRE: "270" },
  feeAccountsByName: {}, subletAccountId: "276", arAccountId: "235",
  salesTaxAccountId: "250", tireFeeAccountId: "252",
};
const SS: SaleSettings = { shopTimezone: "America/New_York", tireFeeCentsPerTire: 100, salesTaxRateBps: 600 };
const G: SaleGateSettings = { salesTaxRateBps: 600 };
const PM: ResolvedPaymentMappings = { undepositedAccountId: "366", arAccountId: "235", ccFeeAccountId: "309", noncashAccountsByType: {} };
const PS: PaymentSettings = { shopTimezone: "America/New_York" };

function snap(over: Partial<RoSaleSnapshot>): RoSaleSnapshot {
  return { repairOrderNumber: "1", repairOrderId: 1, postedDate: "2026-05-19T15:39:04Z",
    partsSales: 0, laborSales: 0, subletSales: 0, feeTotal: 0, discountTotal: 0, taxes: 0, totalSales: 0,
    jobs: [], fees: [], ...over };
}
function job(over: Partial<SnapshotJob>): SnapshotJob { return { authorized: true, parts: [], labor: [], fees: [], ...over }; }
function pay(over: Partial<PaymentForBuild>): PaymentForBuild {
  return { paymentId: "p1", repairOrderId: 1, method: "Credit Card", otherPaymentType: null,
    signedAmountCents: 10000, signedProcessingFeeCents: 0, paymentDate: "2026-05-19T15:39:04Z",
    status: "completed", isRefund: false, ...over };
}
const sumNet = (r: { netByAccount: Record<string, number> }) => Object.values(r.netByAccount).reduce((a, b) => a + b, 0);

const saleDraft = (over: Partial<RoSaleSnapshot>) => {
  const s = snap(over);
  return { snapshot: s, je: buildSaleJournalEntry(s, SM, SS) };
};

describe("rollupDay", () => {
  it("nets a fully-postable day (sale + payment) to ZERO across accounts", () => {
    const sale = saleDraft({ partsSales: 10000, taxes: 600, totalSales: 10600,
      jobs: [job({ parts: [{ retail: 10000, quantity: 1, partType: { code: "PART" } }] })] });
    const payment = buildPaymentJournalEntry(pay({ signedProcessingFeeCents: 300 }), PM, PS);
    const r = rollupDay("2026-05-19", [sale], [payment], G);

    expect(r.postableSales).toBe(1);
    expect(r.postablePayments).toBe(1);
    expect(r.reviewCount).toBe(0);
    expect(sumNet(r)).toBe(0); // double-entry: a balanced day nets to 0
    expect(r.netByAccount["235"]).toBe(600); // A/R: +10600 sale − 10000 payment
  });

  it("collects review items + EXCLUDES the queued draft from the net", () => {
    const ok = saleDraft({ partsSales: 10000, taxes: 600, totalSales: 10600,
      jobs: [job({ parts: [{ retail: 10000, quantity: 1, partType: { code: "PART" } }] })] });
    const queued = saleDraft({ feeTotal: 500, totalSales: 500, fees: [{ name: "Brand New Fee", total: 500 }] });
    const r = rollupDay("2026-05-19", [ok, queued], [], G);

    expect(r.saleCount).toBe(2);
    expect(r.postableSales).toBe(1);
    expect(r.reviewCount).toBe(1);
    expect(r.reviewItems[0]!.kind).toBe("unmapped");
    // the queued RO's A/R (500) is NOT in the net — only the postable one (10600).
    expect(r.netByAccount["235"]).toBe(10600);
  });

  it("excludes benign-suppressed (voided) payments from the counts + raises no review", () => {
    const voided = buildPaymentJournalEntry(pay({ status: "voided" }), PM, PS);
    const r = rollupDay("2026-05-19", [], [voided], G);
    expect(r.paymentCount).toBe(0);
    expect(r.reviewCount).toBe(0);
  });

  it("counts a corrupt payment + raises a review item", () => {
    const corrupt = buildPaymentJournalEntry(pay({ signedAmountCents: 100.5 }), PM, PS);
    const r = rollupDay("2026-05-19", [], [corrupt], G);
    expect(r.paymentCount).toBe(1);
    expect(r.reviewCount).toBe(1);
    expect(r.reviewItems[0]!.kind).toBe("payment_corrupt");
  });
});
