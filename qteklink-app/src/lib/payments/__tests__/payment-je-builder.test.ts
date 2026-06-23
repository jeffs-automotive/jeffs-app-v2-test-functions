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
  storeCreditAccountId: "260", // Customer Store Credit (Other Current Liability)
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

  it("tags every line with its daily-category part: gross pair vs fee pair (the structural split)", () => {
    const je = buildPaymentJournalEntry(pay(), M, S);
    const gross = je.lines.filter((l) => l.part === "gross");
    const fee = je.lines.filter((l) => l.part === "fee");
    expect(gross).toHaveLength(2);
    expect(fee).toHaveLength(2);
    expect(gross.every((l) => l.amountCents === 22510)).toBe(true);
    expect(fee.every((l) => l.amountCents === 573)).toBe(true);
    expect(fee.map((l) => l.accountId).sort()).toEqual(["309", "366"]);
    // non-card routes are all-gross
    const tpp = buildPaymentJournalEntry(
      pay({ method: "Other", otherPaymentType: "Tire Protection Plan", signedProcessingFeeCents: 0 }),
      M, S,
    );
    expect(tpp.lines.every((l) => l.part === "gross")).toBe(true);
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

describe("buildPaymentJournalEntry — store credit (Flexicon, live 6/22-6/23)", () => {
  // Redemption: a STORE_CREDIT-type payment on an RO. Real numbers: $147.15 on RO 326180629.
  const redeem = (over: Partial<PaymentForBuild> = {}): PaymentForBuild =>
    pay({ paymentId: "60822951", repairOrderId: 326180629, method: "STORE_CREDIT", signedAmountCents: 14715, signedProcessingFeeCents: 0, ...over });
  // Issuance: an UNATTACHED real check (no RO). Real numbers: $281.15, repairOrderId null.
  const issue = (over: Partial<PaymentForBuild> = {}): PaymentForBuild =>
    pay({ paymentId: "60746251", repairOrderId: null, method: "CHK", signedAmountCents: 28115, signedProcessingFeeCents: 0, ...over });

  it("REDEMPTION: Dr Store-Credit liability / Cr A/R — no Undeposited, no fee, route non_cash", () => {
    const je = buildPaymentJournalEntry(redeem(), M, S);
    expect(je.route).toBe("non_cash");
    expect(je.balanced).toBe(true);
    expect(je.lines).toHaveLength(2);
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: "260", postingType: "Debit", amountCents: 14715, part: "gross" }));
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: "235", postingType: "Credit", amountCents: 14715 }));
    expect(je.lines.some((l) => l.accountId === "366")).toBe(false); // never touches Undeposited
  });

  it("REDEMPTION refund flips: Dr A/R / Cr Store-Credit liability", () => {
    const je = buildPaymentJournalEntry(redeem({ signedAmountCents: -14715, isRefund: true }), M, S);
    expect(je.balanced).toBe(true);
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: "235", postingType: "Debit", amountCents: 14715 }));
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: "260", postingType: "Credit", amountCents: 14715 }));
  });

  it("REDEMPTION with no store-credit mapping → unmapped (resolution queue), never mis-posted", () => {
    const je = buildPaymentJournalEntry(redeem(), { ...M, storeCreditAccountId: null }, S);
    expect(je.unmapped).toContain("store_credit");
    expect(je.balanced).toBe(false);
    expect(je.lines).toHaveLength(0);
  });

  it("ISSUANCE (unattached check, no RO): Dr Undeposited / Cr Store-Credit liability, route deposit", () => {
    const je = buildPaymentJournalEntry(issue(), M, S);
    expect(je.route).toBe("deposit");
    expect(je.balanced).toBe(true);
    expect(je.lines).toHaveLength(2);
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: "366", postingType: "Debit", amountCents: 28115, part: "gross" }));
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: "260", postingType: "Credit", amountCents: 28115 }));
    expect(je.lines.some((l) => l.accountId === "235")).toBe(false); // no A/R — there's no sale
  });

  it("ISSUANCE refund/payout flips: Dr Store-Credit liability / Cr Undeposited", () => {
    const je = buildPaymentJournalEntry(issue({ signedAmountCents: -28115, isRefund: true }), M, S);
    expect(je.balanced).toBe(true);
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: "260", postingType: "Debit", amountCents: 28115 }));
    expect(je.lines).toContainEqual(expect.objectContaining({ accountId: "366", postingType: "Credit", amountCents: 28115 }));
  });

  it("ISSUANCE with no store-credit mapping → unmapped (resolution queue)", () => {
    const je = buildPaymentJournalEntry(issue(), { ...M, storeCreditAccountId: null }, S);
    expect(je.unmapped).toContain("store_credit");
    expect(je.balanced).toBe(false);
  });

  it("labels: redemption 'Store Credit · RO# · Customer'; issuance '<Type> · Store Credit · <payer>' (Type included)", () => {
    const r = buildPaymentJournalEntry(redeem({ repairOrderNumber: "152805", customerName: "Flexicon" }), M, S);
    expect(r.lines.every((l) => l.description === "Store Credit · RO 152805 · Flexicon")).toBe(true);
    // issuance (CHK) → "Check · Store Credit · <payer>" — like a normal check line, with the tender + payer.
    const i = buildPaymentJournalEntry(issue({ payerName: "Flexicon" }), M, S);
    expect(i.lines.every((l) => l.description === "Check · Store Credit · Flexicon")).toBe(true);
    const noPayer = buildPaymentJournalEntry(issue(), M, S);
    expect(noPayer.lines.every((l) => l.description === "Check · Store Credit")).toBe(true);
    const refundPayout = buildPaymentJournalEntry(issue({ payerName: "Flexicon", signedAmountCents: -28115, isRefund: true }), M, S);
    expect(refundPayout.lines.every((l) => l.description === "Check · Store Credit · Flexicon (refund)")).toBe(true);
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
  it("voided payment → suppressed (no lines; reversal-if-posted is the day-grain diff's job)", () => {
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

describe("buildPaymentJournalEntry — line descriptions (Type · RO# · Customer)", () => {
  it("uses the friendly type + human RO number + customer name when resolved (CC code → Credit Card)", () => {
    const je = buildPaymentJournalEntry(
      pay({ method: "CC", repairOrderNumber: "153330", customerName: "John Smith", signedProcessingFeeCents: 0 }),
      M, S,
    );
    expect(je.lines.length).toBeGreaterThan(0);
    expect(je.lines.every((l) => l.description === "Credit Card · RO 153330 · John Smith")).toBe(true);
  });

  it("card-fee lines carry the same identity + ' — card fee' (gross lines do not)", () => {
    const je = buildPaymentJournalEntry(
      pay({ method: "CC", repairOrderNumber: "153330", customerName: "John Smith" }), // default fee 573
      M, S,
    );
    const gross = je.lines.filter((l) => l.part === "gross");
    const fee = je.lines.filter((l) => l.part === "fee");
    expect(gross.every((l) => l.description === "Credit Card · RO 153330 · John Smith")).toBe(true);
    expect(fee.every((l) => l.description === "Credit Card · RO 153330 · John Smith — card fee")).toBe(true);
  });

  it("falls back to the RO id when the human number is unresolved, and drops the customer when uncached", () => {
    const je = buildPaymentJournalEntry(
      pay({ method: "CHK", repairOrderId: 328577176, repairOrderNumber: null, customerName: null, signedAmountCents: 2400, signedProcessingFeeCents: 0 }),
      M, S,
    );
    expect(je.lines.every((l) => l.description === "Check · RO 328577176")).toBe(true);
  });

  it("a refund appends ' (refund)' to the description", () => {
    const je = buildPaymentJournalEntry(
      pay({ method: "CC", repairOrderNumber: "153330", customerName: "John Smith", signedAmountCents: -1062, signedProcessingFeeCents: 0, isRefund: true }),
      M, S,
    );
    expect(je.lines.every((l) => l.description === "Credit Card · RO 153330 · John Smith (refund)")).toBe(true);
  });

  it("Other shows its sub-type as the payment type (Synchrony)", () => {
    const MD: ResolvedPaymentMappings = { ...M, depositLikeAccountsByType: { Synchrony: "366" } };
    const je = buildPaymentJournalEntry(
      pay({ method: "Other", otherPaymentType: "Synchrony", repairOrderNumber: "153331", customerName: "Carmax", signedAmountCents: 12000, signedProcessingFeeCents: 0 }),
      MD, S,
    );
    expect(je.lines.every((l) => l.description === "Synchrony · RO 153331 · Carmax")).toBe(true);
  });
});
