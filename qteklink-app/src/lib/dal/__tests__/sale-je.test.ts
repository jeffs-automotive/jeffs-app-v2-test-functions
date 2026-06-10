/**
 * Unit tests for the SALE snapshot/mapping seam (sale-je): `parseSnapshot` (fail-closed
 * payload → typed snapshot) + `resolveMappings` (mapping rows → the builder's account
 * lookups), and their composition with the PURE sale builder. (The per-RO
 * `buildShopRoSaleJe` DAL was retired with the per-RO posting path; the day pipeline
 * consumes these seams via `day-drafts.ts`, whose tests cover the DB plumbing.)
 */
import { describe, it, expect } from "vitest";

import { parseSnapshot, resolveMappings, type MappingRow } from "../sale-je";
import { buildSaleJournalEntry } from "@/lib/sales/sale-builder";

const RO_152805_DATA = {
  id: 152805, repairOrderNumber: "152805", postedDate: "2026-05-19T15:39:04Z",
  partsSales: 5386, laborSales: 6494, subletSales: 0, feeTotal: 1188,
  discountTotal: 2500, taxes: 634, totalSales: 11202,
  fees: [{ name: "Shop supplies", total: 1188 }],
  jobs: [{ authorized: true, parts: [{ retail: 5386, quantity: 1, partType: { code: "PART" } }], labor: [{ rate: 6494, hours: 1 }] }],
};

const MAPPING_ROWS: MappingRow[] = [
  { kind: "labor", source_key: "Labor", qbo_account_id: "275", posting_role: "income", pass_through: false },
  { kind: "part_category", source_key: "PART", qbo_account_id: "272", posting_role: "income", pass_through: false },
  { kind: "fee", source_key: "Shop supplies", qbo_account_id: "273", posting_role: "income", pass_through: false },
  { kind: "system", source_key: "accounts_receivable", qbo_account_id: "235", posting_role: "accounts_receivable", pass_through: false },
  { kind: "tax", source_key: "Sales tax", qbo_account_id: "250", posting_role: "sales_tax_payable", pass_through: false },
];

describe("parseSnapshot", () => {
  it("maps a real posting payload into the typed snapshot", () => {
    const s = parseSnapshot(RO_152805_DATA)!;
    expect(s).toBeTruthy();
    expect(s.repairOrderId).toBe(152805);
    expect(s.repairOrderNumber).toBe("152805");
    expect(s.totalSales).toBe(11202);
    expect(s.discountTotal).toBe(2500);
    expect(s.fees).toEqual([{ name: "Shop supplies", total: 1188 }]);
    expect(s.jobs?.[0]?.authorized).toBe(true);
  });

  it("FAILS CLOSED (null) on a snapshot missing postedDate", () => {
    expect(parseSnapshot({ id: 1, totalSales: 100 })).toBeNull();
  });

  it("FAILS CLOSED (null) on non-integer-cents money (no 100x / fractional-cent corruption)", () => {
    expect(parseSnapshot({
      id: 1, repairOrderNumber: "1", postedDate: "2026-05-19T15:39:04Z",
      partsSales: 12.5, laborSales: 0, subletSales: 0, feeTotal: 0, discountTotal: 0, taxes: 0, totalSales: 12.5,
    })).toBeNull();
  });
});

describe("resolveMappings", () => {
  it("resolves the account lookups from active mapping rows", () => {
    const m = resolveMappings(MAPPING_ROWS);
    expect(m.laborAccountId).toBe("275");
    expect(m.partCategoryAccountIds.PART).toBe("272");
    expect(m.feeAccountsByName["shop supplies"]).toEqual({ accountId: "273", passThrough: false });
    expect(m.arAccountId).toBe("235");
    expect(m.salesTaxAccountId).toBe("250");
  });
});

describe("parseSnapshot + resolveMappings + the pure builder", () => {
  it("composes into a balanced JE from a real payload (the day pipeline's exact path)", () => {
    const snapshot = parseSnapshot(RO_152805_DATA)!;
    const je = buildSaleJournalEntry(snapshot, resolveMappings(MAPPING_ROWS), {
      shopTimezone: "America/New_York", tireFeeCentsPerTire: 100, salesTaxRateBps: 600,
    });
    expect(je.balanced).toBe(true);
    expect(je.docNumber).toBe("RO 152805");
    expect(je.txnDate).toBe("2026-05-19");
    expect(je.lines.find((l) => l.accountId === "235")).toMatchObject({ postingType: "Debit", amountCents: 11202 });
    expect(je.lines.find((l) => l.accountId === "275")?.amountCents).toBe(3994); // labor net of $25 discount
    expect(je.unmapped).toEqual([]);
  });
});
