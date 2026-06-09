/**
 * Unit tests for buildPaymentMethodsView — first-class methods are fixed (→ Undeposited);
 * OTH sub-types reflect their mapping role (undeposited_funds → deposit, noncash_contra →
 * contra, none → unmapped); sort + case-insensitive subtype match.
 */
import { describe, it, expect } from "vitest";
import { buildPaymentMethodsView, type MethodAgg } from "../payment-methods";

const noncash = [
  { sourceKey: "Synchrony", role: "undeposited_funds", accountLabel: "Undeposited Funds", accountId: "366" },
  { sourceKey: "Mistake", role: "noncash_contra", accountLabel: "6605 · Bad Debt", accountId: "323" },
];

describe("buildPaymentMethodsView", () => {
  it("first-class methods always book to Undeposited (fixed, not configurable)", () => {
    const aggs: MethodAgg[] = [{ paymentType: "CC", subtype: null, seen: 489, amountCents: 220000 }];
    const [m] = buildPaymentMethodsView(aggs, [], "Undeposited Funds");
    expect(m).toMatchObject({
      label: "Credit Card", code: "CC", booking: "deposit_undeposited",
      accountLabel: "Undeposited Funds", configurable: false,
    });
  });

  it("OTH sub-type mapped undeposited_funds → deposit (Synchrony)", () => {
    const aggs: MethodAgg[] = [{ paymentType: "OTH", subtype: "Synchrony", seen: 2, amountCents: 785 }];
    const [m] = buildPaymentMethodsView(aggs, noncash, "Undeposited Funds");
    expect(m).toMatchObject({ label: "Synchrony", code: "OTH", booking: "deposit_undeposited", accountId: "366", configurable: true });
  });

  it("OTH sub-type mapped noncash_contra → contra (Mistake)", () => {
    const aggs: MethodAgg[] = [{ paymentType: "OTH", subtype: "Mistake", seen: 2, amountCents: 117 }];
    const [m] = buildPaymentMethodsView(aggs, noncash, "Undeposited Funds");
    expect(m).toMatchObject({ booking: "contra", accountLabel: "6605 · Bad Debt", accountId: "323" });
  });

  it("OTH sub-type with no mapping → unmapped", () => {
    const aggs: MethodAgg[] = [{ paymentType: "OTH", subtype: "Brand New Financing", seen: 1, amountCents: 500 }];
    const [m] = buildPaymentMethodsView(aggs, noncash, "Undeposited Funds");
    expect(m).toMatchObject({ booking: "unmapped", accountId: null, configurable: true });
  });

  it("sorts first-class before OTH (each by amount desc) + matches subtype case-insensitively", () => {
    const aggs: MethodAgg[] = [
      { paymentType: "OTH", subtype: "synchrony", seen: 2, amountCents: 785 }, // lowercase
      { paymentType: "CC", subtype: null, seen: 489, amountCents: 220000 },
      { paymentType: "CASH", subtype: null, seen: 14, amountCents: 3689 },
    ];
    const v = buildPaymentMethodsView(aggs, noncash, "Undeposited Funds");
    expect(v.map((m) => m.label)).toEqual(["Credit Card", "Cash", "synchrony"]);
    expect(v[2]?.booking).toBe("deposit_undeposited"); // case-insensitive match to the Synchrony mapping
  });
});
