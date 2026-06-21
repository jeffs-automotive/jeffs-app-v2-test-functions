/**
 * Contract suite — signed-money invariant (test-kit/README.md "signed money" family): refunds
 * are SIGNED/negative and must SUBTRACT, voids are excluded from the active net but kept at
 * positive face value, and money is NEVER Math.abs()-then-summed. Asserted against the real
 * aggregatePaymentMethodStates + fmtUsdSigned. Locks in commit 6f7c89b.
 */
import { describe, it, expect } from "vitest";
import { aggregatePaymentMethodStates, type PaymentStateMethodRow } from "../payment-methods";
import { fmtUsdSigned } from "@/lib/format";

const row = (p: Partial<PaymentStateMethodRow> & Pick<PaymentStateMethodRow, "signed_amount_cents">): PaymentStateMethodRow => ({
  payment_type: "CC", other_payment_type: null, status: "succeeded", ...p,
});

describe("contract: signed money — refunds subtract, voids hold face value, never abs()-summed", () => {
  it("a refund NETS the per-method total down (signed), not abs-added", () => {
    const [cc] = aggregatePaymentMethodStates([
      row({ signed_amount_cents: 10000 }), // payment +$100.00
      row({ signed_amount_cents: -1062 }), // refund −$10.62 (signed negative)
    ]);
    expect(cc!.amountCents).toBe(8938); // 10000 − 1062, NOT 11062
  });

  it("a fully-refunded method nets to zero", () => {
    const [cc] = aggregatePaymentMethodStates([
      row({ signed_amount_cents: 2513 }),
      row({ signed_amount_cents: -2513 }),
    ]);
    expect(cc!.amountCents).toBe(0);
  });

  it("a void is EXCLUDED from the active net and kept at POSITIVE face value", () => {
    const [cc] = aggregatePaymentMethodStates([
      row({ signed_amount_cents: 10000 }),
      row({ signed_amount_cents: 5000, status: "voided" }),
    ]);
    expect(cc!.amountCents).toBe(10000); // void not in the active net
    expect(cc!.voidedAmountCents).toBe(5000); // face value in the voided bucket
  });

  it("fmtUsdSigned renders a negative as −$ (not the raw $-10.62)", () => {
    expect(fmtUsdSigned(-1062)).toBe("−$10.62");
    expect(fmtUsdSigned(1062)).toBe("$10.62");
  });
});
