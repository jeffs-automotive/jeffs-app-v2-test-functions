/**
 * Unit tests for the back-office vendor-doc mappers (@/lib/qbo/vendor-docs) — the pure
 * QBO Bill/Purchase → candidate mapping the "Add" modal relies on: RO# from the customer
 * line, cents conversion, Purchase-vs-Bill vendor field, and the QBL injection guard.
 */
import { describe, it, expect } from "vitest";
import {
  dollarsToCents,
  extractRoCandidates,
  pickRoNumber,
  mapBillToCandidate,
  mapPurchaseToCandidate,
  assertQueryableDocNumber,
} from "../vendor-docs";
import type { QboBill, QboPurchase } from "../entities";

describe("dollarsToCents", () => {
  it("converts dollars to integer cents without float drift", () => {
    expect(dollarsToCents(1234.56)).toBe(123456);
    expect(dollarsToCents(0.1 + 0.2)).toBe(30); // 0.30000000000000004 → 30
    expect(dollarsToCents(81.4)).toBe(8140);
  });
  it("returns null for missing / non-finite amounts", () => {
    expect(dollarsToCents(null)).toBeNull();
    expect(dollarsToCents(undefined)).toBeNull();
    expect(dollarsToCents(Number.NaN)).toBeNull();
  });
});

describe("extractRoCandidates", () => {
  it("reads CustomerRef.name from expense lines (account- and item-based)", () => {
    const lines = [
      { AccountBasedExpenseLineDetail: { CustomerRef: { value: "1", name: "154157" } } },
      { ItemBasedExpenseLineDetail: { CustomerRef: { value: "2", name: "RO 154200" } } },
    ];
    expect(extractRoCandidates(lines)).toEqual(["154157", "RO 154200"]);
  });
  it("de-duplicates and preserves order", () => {
    const lines = [
      { AccountBasedExpenseLineDetail: { CustomerRef: { name: "154157" } } },
      { AccountBasedExpenseLineDetail: { CustomerRef: { name: "154157" } } },
    ];
    expect(extractRoCandidates(lines)).toEqual(["154157"]);
  });
  it("falls back to an RO-looking token in the description only when no customer line", () => {
    const lines = [{ Description: "brake pads for RO 149292", AccountBasedExpenseLineDetail: {} }];
    expect(extractRoCandidates(lines)).toEqual(["149292"]);
  });
  it("prefers the customer line over the description", () => {
    const lines = [
      { Description: "job 999999", AccountBasedExpenseLineDetail: { CustomerRef: { name: "154157" } } },
    ];
    expect(extractRoCandidates(lines)).toEqual(["154157"]);
  });
  it("returns [] for no lines", () => {
    expect(extractRoCandidates(null)).toEqual([]);
    expect(extractRoCandidates([])).toEqual([]);
  });
});

describe("pickRoNumber", () => {
  it("prefers an RO-number-looking candidate", () => {
    expect(pickRoNumber(["Acme Fleet", "154157"])).toBe("154157");
  });
  it("extracts the digits from a labeled candidate", () => {
    expect(pickRoNumber(["RO 154200"])).toBe("154200");
  });
  it("falls back to the first candidate raw when none look like an RO#", () => {
    expect(pickRoNumber(["stock", "misc"])).toBe("stock");
  });
  it("returns null for no candidates", () => {
    expect(pickRoNumber([])).toBeNull();
  });
});

describe("mapBillToCandidate", () => {
  it("maps a real-shaped Bill with vendor, docnumber, date, amount, RO#", () => {
    const bill: QboBill = {
      Id: "5001",
      DocNumber: "110381",
      TxnDate: "2026-01-07",
      TotalAmt: 342.19,
      VendorRef: { value: "77", name: "Koch 33 Mazda" },
      Line: [{ AccountBasedExpenseLineDetail: { CustomerRef: { value: "9", name: "149292" } } }],
    };
    expect(mapBillToCandidate(bill)).toEqual({
      qboTxnType: "Bill",
      qboTxnId: "5001",
      vendorName: "Koch 33 Mazda",
      billNo: "110381",
      billDate: "2026-01-07",
      totalCents: 34219,
      roNumber: "149292",
      roCandidates: ["149292"],
    });
  });
  it("tolerates a bill with no lines / no vendor name", () => {
    const bill: QboBill = { Id: "5002", DocNumber: "40789553" };
    const c = mapBillToCandidate(bill);
    expect(c.vendorName).toBeNull();
    expect(c.roNumber).toBeNull();
    expect(c.totalCents).toBeNull();
    expect(c.billNo).toBe("40789553");
  });
});

describe("mapPurchaseToCandidate", () => {
  it("uses EntityRef (not VendorRef) for the payee vendor on an expense", () => {
    const purchase: QboPurchase = {
      Id: "8001",
      DocNumber: "01877130133",
      TxnDate: "2026-04-01",
      TotalAmt: 51.25,
      PaymentType: "CreditCard",
      EntityRef: { value: "3", name: "AutoZone" },
      Line: [{ ItemBasedExpenseLineDetail: { CustomerRef: { name: "151383" } } }],
    };
    const c = mapPurchaseToCandidate(purchase);
    expect(c.qboTxnType).toBe("Purchase");
    expect(c.vendorName).toBe("AutoZone");
    expect(c.billNo).toBe("01877130133"); // leading zero preserved (string)
    expect(c.totalCents).toBe(5125);
    expect(c.roNumber).toBe("151383");
  });
});

describe("assertQueryableDocNumber", () => {
  it("accepts real invoice-number shapes", () => {
    expect(assertQueryableDocNumber("110381")).toBe("110381");
    expect(assertQueryableDocNumber("112-0217505-9695443")).toBe("112-0217505-9695443");
    expect(assertQueryableDocNumber("6IV941884")).toBe("6IV941884");
    expect(assertQueryableDocNumber("  01877130133  ")).toBe("01877130133"); // trimmed
  });
  it("rejects QBL-injection attempts", () => {
    expect(() => assertQueryableDocNumber("1' OR '1'='1")).toThrow();
    expect(() => assertQueryableDocNumber("1; DROP TABLE")).toThrow();
    expect(() => assertQueryableDocNumber("")).toThrow();
  });
});
