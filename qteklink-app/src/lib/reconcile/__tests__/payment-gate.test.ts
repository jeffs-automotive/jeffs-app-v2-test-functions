/**
 * Unit tests for the §8 PAYMENT reconciliation gate — built against real C6
 * payment-builder output (pure, no mocks).
 */
import { describe, it, expect } from "vitest";
import {
  buildPaymentJournalEntry,
  type PaymentForBuild,
  type PaymentJournalEntry,
  type ResolvedPaymentMappings,
  type PaymentSettings,
} from "../../payments/payment-je-builder";
import { gatePaymentDraft } from "../payment-gate";

const M: ResolvedPaymentMappings = {
  undepositedAccountId: "366",
  arAccountId: "235",
  ccFeeAccountId: "309",
  noncashAccountsByType: { "Tire Protection Plan": "1150040010" },
};
const S: PaymentSettings = { shopTimezone: "America/New_York" };

function pay(over: Partial<PaymentForBuild>): PaymentForBuild {
  return {
    paymentId: "p1", repairOrderId: 99, method: "Credit Card", otherPaymentType: null,
    signedAmountCents: 10000, signedProcessingFeeCents: 0, paymentDate: "2026-05-19T15:39:04Z",
    status: "completed", isRefund: false, ...over,
  };
}
const kinds = (r: { reviewItems: { kind: string }[] }) => r.reviewItems.map((i) => i.kind);

describe("gatePaymentDraft — postable", () => {
  it("passes a clean, fully-mapped, balanced card deposit", () => {
    const r = gatePaymentDraft(buildPaymentJournalEntry(pay({ signedProcessingFeeCents: 300 }), M, S));
    expect(r.postable).toBe(true);
    expect(r.reviewItems).toEqual([]);
  });

  it("passes a clean non-cash payment", () => {
    const je = buildPaymentJournalEntry(pay({ method: "Other", otherPaymentType: "Tire Protection Plan" }), M, S);
    const r = gatePaymentDraft(je);
    expect(r.postable).toBe(true);
    expect(r.reviewItems).toEqual([]);
  });
});

describe("gatePaymentDraft — benign non-posting (NO review item)", () => {
  it("a VOIDED payment is suppressed → not postable, no review item", () => {
    const r = gatePaymentDraft(buildPaymentJournalEntry(pay({ status: "voided" }), M, S));
    expect(r.postable).toBe(false);
    expect(r.reviewItems).toEqual([]);
  });

  it("a ZERO-amount payment is suppressed → not postable, no review item", () => {
    const r = gatePaymentDraft(buildPaymentJournalEntry(pay({ signedAmountCents: 0 }), M, S));
    expect(r.postable).toBe(false);
    expect(r.reviewItems).toEqual([]);
  });
});

describe("gatePaymentDraft — review items", () => {
  it("flags corrupt money (non-integer cents) as 'payment_corrupt'", () => {
    const r = gatePaymentDraft(buildPaymentJournalEntry(pay({ signedAmountCents: 100.5 }), M, S));
    expect(r.postable).toBe(false);
    expect(kinds(r)).toEqual(["payment_corrupt"]);
    expect(r.reviewItems[0]!.subjectKind).toBe("payment");
  });

  it("flags a missing mapping as 'unmapped' (subjectKind payment)", () => {
    const noUndeposited: ResolvedPaymentMappings = { ...M, undepositedAccountId: null };
    const r = gatePaymentDraft(buildPaymentJournalEntry(pay({}), noUndeposited, S));
    expect(r.postable).toBe(false);
    expect(kinds(r)).toEqual(["unmapped"]);
    expect((r.reviewItems[0]!.detail!.reasons as string[])).toContain("undeposited_funds");
    expect(r.reviewItems[0]!.subjectRef).toBe("p1");
  });

  it("flags an unroutable refund fee (refund_fee_unsupported) as 'unmapped'", () => {
    const r = gatePaymentDraft(buildPaymentJournalEntry(
      pay({ signedAmountCents: -5000, signedProcessingFeeCents: -200, isRefund: true }), M, S));
    expect(r.postable).toBe(false);
    expect((r.reviewItems[0]!.detail!.reasons as string[])).toContain("refund_fee_unsupported");
  });

  it("fail-closed catch-all: a non-suppressed unbalanced JE with no unmapped → 'unbalanced'", () => {
    const fakeJe: PaymentJournalEntry = {
      paymentId: "p9", repairOrderId: 1, docNumber: "PAY p9", txnDate: "2026-05-19", route: "deposit",
      lines: [], suppressed: false, reasons: [], unmapped: [], balanced: false, isRefund: false,
    };
    const r = gatePaymentDraft(fakeJe);
    expect(r.postable).toBe(false);
    expect(kinds(r)).toEqual(["unbalanced"]);
  });
});
