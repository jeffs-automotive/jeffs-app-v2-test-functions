/**
 * Unit tests for buildPaymentMethodsView — first-class methods fixed (→ Undeposited); OTH
 * sub-types reflect their mapping role (undeposited_funds → deposit, noncash_contra → contra,
 * none → unmapped); a voided-only method is SHOWN but kept OUT of the active count/amount;
 * sort + case-insensitive subtype match.
 */
import { describe, it, expect } from "vitest";
import { buildPaymentMethodsView, aggregatePaymentMethodStates, type MethodAgg, type PaymentStateMethodRow } from "../payment-methods";

const row = (p: Partial<PaymentStateMethodRow> & Pick<PaymentStateMethodRow, "signed_amount_cents">): PaymentStateMethodRow => ({
  payment_type: "CC",
  other_payment_type: null,
  status: "succeeded",
  ...p,
});

const noncash = [
  { sourceKey: "Synchrony", role: "undeposited_funds", accountLabel: "Undeposited Funds", accountId: "366" },
  { sourceKey: "Mistake", role: "noncash_contra", accountLabel: "6605 · Bad Debt", accountId: "323" },
];

/** Build a MethodAgg, defaulting the voided tallies to 0. */
const agg = (p: Partial<MethodAgg> & Pick<MethodAgg, "paymentType" | "subtype">): MethodAgg => ({
  seen: 0,
  amountCents: 0,
  voidedCount: 0,
  voidedAmountCents: 0,
  ...p,
});

describe("buildPaymentMethodsView", () => {
  it("first-class methods always book to Undeposited (fixed, not configurable)", () => {
    const [m] = buildPaymentMethodsView([agg({ paymentType: "CC", subtype: null, seen: 489, amountCents: 220000 })], [], "Undeposited Funds");
    expect(m).toMatchObject({ label: "Credit Card", code: "CC", booking: "deposit_undeposited", accountLabel: "Undeposited Funds", configurable: false });
  });

  it("OTH sub-type mapped undeposited_funds → deposit (Synchrony)", () => {
    const [m] = buildPaymentMethodsView([agg({ paymentType: "OTH", subtype: "Synchrony", seen: 2, amountCents: 785 })], noncash, "Undeposited Funds");
    expect(m).toMatchObject({ label: "Synchrony", code: "OTH", booking: "deposit_undeposited", accountId: "366", configurable: true });
  });

  it("OTH sub-type mapped noncash_contra → contra (Mistake)", () => {
    const [m] = buildPaymentMethodsView([agg({ paymentType: "OTH", subtype: "Mistake", seen: 2, amountCents: 117 })], noncash, "Undeposited Funds");
    expect(m).toMatchObject({ booking: "contra", accountLabel: "6605 · Bad Debt", accountId: "323" });
  });

  it("OTH sub-type with no mapping → unmapped", () => {
    const [m] = buildPaymentMethodsView([agg({ paymentType: "OTH", subtype: "Brand New Financing", seen: 1, amountCents: 500 })], noncash, "Undeposited Funds");
    expect(m).toMatchObject({ booking: "unmapped", accountId: null, configurable: true });
  });

  it("shows a voided-only method but keeps it OUT of the active count/amount", () => {
    const [m] = buildPaymentMethodsView(
      [agg({ paymentType: "OTH", subtype: null, seen: 0, amountCents: 0, voidedCount: 1, voidedAmountCents: 49800 })],
      noncash,
      "Undeposited Funds",
    );
    expect(m).toMatchObject({ label: "(unspecified Other)", seen: 0, amountCents: 0, voidedCount: 1, voidedAmountCents: 49800 });
  });

  it("nets a refund into the active amount (signed) and still counts it in seen", () => {
    // A CC payment + its CC refund (status succeeded, signed negative — like live payment 60216784).
    const [agg] = aggregatePaymentMethodStates([
      row({ signed_amount_cents: 10000 }),
      row({ signed_amount_cents: -1062 }),
    ]);
    // The refund NETS the lifetime amount down (10000 − 1062 = 8938), not abs-added (11062).
    expect(agg).toMatchObject({ paymentType: "CC", subtype: null, seen: 2, amountCents: 8938, voidedCount: 0, voidedAmountCents: 0 });
  });

  it("a voided payment keeps its POSITIVE face value in the voided bucket (a void is not a refund)", () => {
    const [agg] = aggregatePaymentMethodStates([
      row({ signed_amount_cents: 5000, status: "voided" }),
    ]);
    expect(agg).toMatchObject({ seen: 0, amountCents: 0, voidedCount: 1, voidedAmountCents: 5000 });
  });

  it("groups by (payment_type, other_payment_type), parses a string amount, and fails closed on an unsafe integer", () => {
    const aggs = aggregatePaymentMethodStates([
      row({ signed_amount_cents: "12000" }), // bigint arrives as a string from PostgREST
      row({ payment_type: "OTH", other_payment_type: "Synchrony", signed_amount_cents: 700 }),
      row({ signed_amount_cents: Number.MAX_SAFE_INTEGER + 1 }), // unsafe → contributes 0, still seen
    ]);
    const cc = aggs.find((a) => a.paymentType === "CC")!;
    expect(cc).toMatchObject({ seen: 2, amountCents: 12000 }); // 12000 + 0 (the unsafe row)
    const oth = aggs.find((a) => a.paymentType === "OTH")!;
    expect(oth).toMatchObject({ subtype: "Synchrony", seen: 1, amountCents: 700 });
  });

  it("sorts first-class before OTH (each by amount desc) + matches subtype case-insensitively", () => {
    const v = buildPaymentMethodsView(
      [
        agg({ paymentType: "OTH", subtype: "synchrony", seen: 2, amountCents: 785 }), // lowercase
        agg({ paymentType: "CC", subtype: null, seen: 489, amountCents: 220000 }),
        agg({ paymentType: "CASH", subtype: null, seen: 14, amountCents: 3689 }),
      ],
      noncash,
      "Undeposited Funds",
    );
    expect(v.map((m) => m.label)).toEqual(["Credit Card", "Cash", "synchrony"]);
    expect(v[2]?.booking).toBe("deposit_undeposited"); // case-insensitive match to the Synchrony mapping
  });
});
