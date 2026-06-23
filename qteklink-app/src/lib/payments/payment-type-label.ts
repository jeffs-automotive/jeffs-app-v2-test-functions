/**
 * Friendly payment-type labels — PURE, shared by the payment JE builder (line
 * descriptions) and the /mappings methods view, so the two never drift.
 *
 * `method` is the Tekmetric paymentType CODE on a projected payment (CC/CASH/CHK/OTH/…),
 * OR an already-friendly name on a manual method-pick ("Credit Card"). For Other/OTH the
 * real type is the `otherPaymentType` sub-type (Synchrony / Tire Protection Plan / …).
 */
export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  CC: "Credit Card",
  CASH: "Cash",
  CHK: "Check",
  DEBIT: "Debit",
  AFFIRM: "Affirm",
  KLARNA: "Klarna",
  STORE_CREDIT: "Store Credit",
};

/** The display payment type: Other/OTH → its sub-type (else "Other"); else the mapped
 *  code (CC → Credit Card …), falling back to the raw method (already a label for a
 *  manual pick) or "Payment" when blank. */
export function paymentTypeLabel(method: string, otherPaymentType?: string | null): string {
  const m = (method ?? "").trim();
  if (m.toLowerCase() === "other" || m.toLowerCase() === "oth") {
    return (otherPaymentType ?? "").trim() || "Other";
  }
  return PAYMENT_TYPE_LABELS[m.toUpperCase()] ?? (m || "Payment");
}
