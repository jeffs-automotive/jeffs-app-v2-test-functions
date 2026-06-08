/**
 * Unit tests for the PURE PAYMENT JE builder (C6). Fixtures use REAL numbers from
 * Jeff's backfilled data: card+fee 22510¢/573¢, non-cash TPP 19550¢, refund −2513¢,
 * a voided payment, + a manual method-pick (user-entered fee).
 */
import { describe, it, expect } from "vitest";
import {
  buildPaymentJournalEntry,
  type PaymentForBuild,
  type ResolvedPaymentMappings,
  type PaymentSettings,
} from "../payment-je-builder";

const M: ResolvedPaymentMappings = {
  undepositedAccountId: "366",
  arAccountId: "235",
  ccFeeAccountId: "309",
  noncashAccountsByType: { "Tire Protection Plan": "6834", "Shop Vehicle": "6101" },
  depositLikeAccountsByType: {},
};
const S: PaymentSettings = { shopTimezone: "America/New_York" };

function pay(over: Partial<PaymentForBuild> = {}): PaymentForBuild {
  return {
    paymentId: "57852813",
    repairOrderId: 326283459,
    method: "Credit Card",
    otherPaymentType: null,
    signedAmountCents: 22510,
    signedProcessingFeeCents: 573,
    paymentDate: "2026-05-11T13:12:42Z",
    status: "succeeded",
    isRefund: false,
    ...over,
  };
}

const sum = (lines: { postingType: string; amountCents: number }[], t: string) =>
  lines.filter((l) => l.postingType === t).reduce((a, l) => a + l.amountCents, 0);

describe("buildPaymentJournalEntry — deposit route", () => {
  it("card + CC fee: Dr Undeposited gross / Cr A/R gross, then Dr CC-fee / Cr Undeposited (nets the deposit)", () => {
    const je = buildPaymentJournalEntry(pay(), M, S);
    expect(je.route).toBe("deposit");
    expect(je.suppressed).toBe(false);
    expect(je.balanced).toBe(true);
    expect(je.txnDate).toBe("2026-05-11");
    expect(je.docNumber).toBe("PAY 57852813");
    expect(je.lines).toHaveLength(4);
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: "366", postingType: "Debit", amountCents: 22510 }));
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: "235", postingType: "Credit", amountCents: 22510 }));
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: "309", postingType: "Debit", amountCents: 573 }));
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: "366", postingType: "Credit", amountCents: 573 }));
    // Undeposited nets to the actual deposit (gross − fee).
    const undeposited = je.lines.filter((l) => l.accountId === "366");
    expect(sum(undeposited, "Debit") - sum(undeposited, "Credit")).toBe(22510 - 573); // 21937
  });

  it("cash (no fee): two lines, no CC-fee line", () => {
    const je = buildPaymentJournalEntry(pay({ method: "Cash", signedProcessingFeeCents: 0 }), M, S);
    expect(je.route).toBe("deposit");
    expect(je.balanced).toBe(true);
    expect(je.lines).toHaveLength(2);
    expect(je.lines.some((l) => l.accountId === "309")).toBe(false);
  });

  it("check (no fee): Dr Undeposited / Cr A/R", () => {
    const je = buildPaymentJournalEntry(pay({ method: "Check", signedAmountCents: 8600, signedProcessingFeeCents: 0 }), M, S);
    expect(je.balanced).toBe(true);
    expect(sum(je.lines, "Debit")).toBe(8600);
    expect(sum(je.lines, "Credit")).toBe(8600);
  });

  it("refund (negative): Debit/Credit FLIPPED — Dr A/R / Cr Undeposited, refund-dated", () => {
    const je = buildPaymentJournalEntry(
      pay({ paymentId: "58173686", repairOrderId: 327346069, signedAmountCents: -2513, signedProcessingFeeCents: 0, paymentDate: "2026-05-14T20:48:40Z", isRefund: true }),
      M, S,
    );
    expect(je.route).toBe("deposit");
    expect(je.isRefund).toBe(true);
    expect(je.balanced).toBe(true);
    expect(je.txnDate).toBe("2026-05-14");
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: "235", postingType: "Debit", amountCents: 2513 }));
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: "366", postingType: "Credit", amountCents: 2513 }));
  });

  it("a refund with a stray fee is FLAGGED (fail closed), never a guessed fee pair", () => {
    const je = buildPaymentJournalEntry(
      pay({ signedAmountCents: -2513, signedProcessingFeeCents: 100, isRefund: true }),
      M, S,
    );
    expect(je.unmapped).toContain("refund_fee_unsupported");
    expect(je.balanced).toBe(false);
    expect(je.lines.some((l) => l.accountId === "309")).toBe(false);
  });
});

describe("buildPaymentJournalEntry — non-cash route", () => {
  it("non-cash (Other → Tire Protection Plan): Dr contra / Cr A/R, no Undeposited, no fee", () => {
    const je = buildPaymentJournalEntry(
      pay({ paymentId: "57984574", repairOrderId: 328522334, method: "Other", otherPaymentType: "Tire Protection Plan", signedAmountCents: 19550, signedProcessingFeeCents: 0 }),
      M, S,
    );
    expect(je.route).toBe("non_cash");
    expect(je.balanced).toBe(true);
    expect(je.lines).toHaveLength(2);
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: "6834", postingType: "Debit", amountCents: 19550 }));
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: "235", postingType: "Credit", amountCents: 19550 }));
    expect(je.lines.some((l) => l.accountId === "366")).toBe(false);
  });

  it("non-cash with an UNMAPPED other_payment_type → resolution queue (unmapped, not balanced)", () => {
    const je = buildPaymentJournalEntry(
      pay({ method: "Other", otherPaymentType: "Synchrony", signedProcessingFeeCents: 0 }),
      M, S,
    );
    expect(je.unmapped).toContain("noncash:Synchrony");
    expect(je.balanced).toBe(false);
    expect(je.lines).toHaveLength(0);
  });
});

describe("buildPaymentJournalEntry — financing 'deposits like a card'", () => {
  // Synchrony mapped as deposit-like (role undeposited_funds → the deposit account 366).
  const MD: ResolvedPaymentMappings = { ...M, depositLikeAccountsByType: { Synchrony: "366" } };

  it("Synchrony (financing) → DEPOSIT: Dr Undeposited / Cr A/R (gross, NO auto-fee)", () => {
    const je = buildPaymentJournalEntry(
      pay({ method: "Other", otherPaymentType: "Synchrony", signedAmountCents: 12000, signedProcessingFeeCents: 0 }),
      MD, S,
    );
    expect(je.route).toBe("deposit");
    expect(je.balanced).toBe(true);
    expect(je.unmapped).toEqual([]);
    expect(je.lines).toHaveLength(2); // deposit leg only — the financing fee is entered in QBO
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: "366", postingType: "Debit", amountCents: 12000 }));
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: "235", postingType: "Credit", amountCents: 12000 }));
    expect(je.lines.some((l) => l.accountId === "309")).toBe(false); // no CC-fee line
  });

  it("a deposit-like financing REFUND flips: Dr A/R / Cr deposit account", () => {
    const je = buildPaymentJournalEntry(
      pay({ method: "Other", otherPaymentType: "Synchrony", signedAmountCents: -5000, signedProcessingFeeCents: 0, isRefund: true }),
      MD, S,
    );
    expect(je.route).toBe("deposit");
    expect(je.balanced).toBe(true);
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: "235", postingType: "Debit", amountCents: 5000 }));
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: "366", postingType: "Credit", amountCents: 5000 }));
  });

  it("a non-deposit non-cash type still routes non_cash (TPP not flagged deposit-like)", () => {
    const je = buildPaymentJournalEntry(
      pay({ method: "Other", otherPaymentType: "Tire Protection Plan", signedAmountCents: 19550, signedProcessingFeeCents: 0 }),
      MD, S,
    );
    expect(je.route).toBe("non_cash");
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: "6834", postingType: "Debit", amountCents: 19550 }));
  });
});

describe("buildPaymentJournalEntry — suppress + fail-closed", () => {
  it("voided payment → suppressed (no lines; reversal-if-posted is C7's job)", () => {
    const je = buildPaymentJournalEntry(pay({ status: "voided" }), M, S);
    expect(je.suppressed).toBe(true);
    expect(je.route).toBe("suppressed");
    expect(je.reasons).toContain("voided");
    expect(je.lines).toHaveLength(0);
    expect(je.balanced).toBe(false);
  });

  it("suppresses a voided payment case-insensitively (VOIDED / Voided / ' voided ')", () => {
    for (const s of ["VOIDED", "Voided", " voided "]) {
      expect(buildPaymentJournalEntry(pay({ status: s }), M, S).suppressed).toBe(true);
    }
  });

  it("zero amount → suppressed", () => {
    const je = buildPaymentJournalEntry(pay({ signedAmountCents: 0, signedProcessingFeeCents: 0 }), M, S);
    expect(je.suppressed).toBe(true);
    expect(je.reasons).toContain("zero_amount");
  });

  it("non-integer cents → suppressed (no 100x / fractional-cent corruption)", () => {
    const je = buildPaymentJournalEntry(pay({ signedAmountCents: 225.1 }), M, S);
    expect(je.suppressed).toBe(true);
    expect(je.reasons).toContain("non_integer_cents");
  });

  it("missing undeposited mapping → unmapped, not balanced", () => {
    const je = buildPaymentJournalEntry(pay({ signedProcessingFeeCents: 0 }), { ...M, undepositedAccountId: null }, S);
    expect(je.unmapped).toContain("undeposited_funds");
    expect(je.balanced).toBe(false);
  });
});

describe("buildPaymentJournalEntry — manual method-pick", () => {
  it("a manually-classified card with a user-entered CC fee builds the same gross→net JE", () => {
    const je = buildPaymentJournalEntry(
      pay({ paymentId: "manual-330295704", method: "Credit Card", signedAmountCents: 18900, signedProcessingFeeCents: 481, manual: true }),
      M, S,
    );
    expect(je.route).toBe("deposit");
    expect(je.balanced).toBe(true);
    expect(je.lines).toHaveLength(4);
    expect(je.docNumber).toBe("PAY manual-330295704");
    const undeposited = je.lines.filter((l) => l.accountId === "366");
    expect(sum(undeposited, "Debit") - sum(undeposited, "Credit")).toBe(18900 - 481);
  });
});
