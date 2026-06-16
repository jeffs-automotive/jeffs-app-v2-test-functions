import { describe, it, expect } from "vitest";
import { paymentTypeLabel } from "../payment-type-label";

describe("paymentTypeLabel", () => {
  it("maps the Tekmetric codes to friendly labels", () => {
    expect(paymentTypeLabel("CC", null)).toBe("Credit Card");
    expect(paymentTypeLabel("cash", null)).toBe("Cash"); // case-insensitive
    expect(paymentTypeLabel("CHK", null)).toBe("Check");
    expect(paymentTypeLabel("AFFIRM", null)).toBe("Affirm");
  });

  it("uses the sub-type for Other/OTH", () => {
    expect(paymentTypeLabel("Other", "Synchrony")).toBe("Synchrony");
    expect(paymentTypeLabel("OTH", "Tire Protection Plan")).toBe("Tire Protection Plan");
    expect(paymentTypeLabel("Other", null)).toBe("Other"); // blank sub-type
    expect(paymentTypeLabel("OTH", "  ")).toBe("Other");
  });

  it("passes through an already-friendly manual-pick name; blank → 'Payment'", () => {
    expect(paymentTypeLabel("Credit Card", null)).toBe("Credit Card");
    expect(paymentTypeLabel("", null)).toBe("Payment");
  });
});
