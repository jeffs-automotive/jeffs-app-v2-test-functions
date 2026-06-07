/**
 * Unit tests for the SALE JE DAL (C5). Mocks the Supabase admin client; the pure
 * builder's logic is covered in src/lib/sales/__tests__/sale-builder.test.ts —
 * here we verify the DB seam: realm binding, snapshot fetch, mapping resolution,
 * and fail-closed behavior.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock, from: fromMock }),
}));

import { buildShopRoSaleJe } from "../sale-je";

const REALM = "9341455608740708";

function chainResolving(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) chain[m] = vi.fn(() => chain);
  chain.then = (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF);
  return chain;
}

const RO_152805_EVENT = {
  raw_body: {
    data: {
      id: 152805, repairOrderNumber: "152805", postedDate: "2026-05-19T15:39:04Z",
      partsSales: 5386, laborSales: 6494, subletSales: 0, feeTotal: 1188,
      discountTotal: 2500, taxes: 634, totalSales: 11202,
      fees: [{ name: "Shop supplies", total: 1188 }],
      jobs: [{ authorized: true, parts: [{ retail: 5386, quantity: 1, partType: { code: "PART" } }], labor: [{ rate: 6494, hours: 1 }] }],
    },
  },
  received_at: "2026-05-19T15:39:10Z",
};

const MAPPING_ROWS = [
  { kind: "labor", source_key: "Labor", qbo_account_id: "275", posting_role: "income", pass_through: false },
  { kind: "part_category", source_key: "PART", qbo_account_id: "272", posting_role: "income", pass_through: false },
  { kind: "fee", source_key: "Shop supplies", qbo_account_id: "273", posting_role: "income", pass_through: false },
  { kind: "system", source_key: "accounts_receivable", qbo_account_id: "235", posting_role: "accounts_receivable", pass_through: false },
  { kind: "tax", source_key: "Sales tax", qbo_account_id: "250", posting_role: "sales_tax_payable", pass_through: false },
];

function routeRealm(realm: string | null = REALM) {
  rpcMock.mockImplementation((fn: string) =>
    fn === "qbo_resolve_realm_for_shop"
      ? Promise.resolve({ data: realm, error: null })
      : Promise.resolve({ data: null, error: null }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  routeRealm();
});

describe("buildShopRoSaleJe", () => {
  it("short-circuits when the shop has no connection", async () => {
    routeRealm(null);
    expect(await buildShopRoSaleJe(7476, 152805)).toEqual({ realmId: null, je: null });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("fetches the posting snapshot + active mappings and builds a balanced JE", async () => {
    fromMock.mockImplementation((t: string) =>
      t === "qteklink_events"
        ? chainResolving({ data: [RO_152805_EVENT], error: null })
        : chainResolving({ data: MAPPING_ROWS, error: null }),
    );
    const { realmId, je } = await buildShopRoSaleJe(7476, 152805);
    expect(realmId).toBe(REALM);
    expect(je).toBeTruthy();
    expect(je!.balanced).toBe(true);
    expect(je!.docNumber).toBe("RO 152805");
    expect(je!.txnDate).toBe("2026-05-19");
    const ar = je!.lines.find((l) => l.accountId === "235");
    expect(ar).toMatchObject({ postingType: "Debit", amountCents: 11202 });
    expect(je!.lines.find((l) => l.accountId === "275")?.amountCents).toBe(3994); // labor net of $25 discount
    expect(je!.unmapped).toEqual([]);
  });

  it("treats BOTH ro_posted and ro_sent_to_ar as postings (an A/R RO posts only as sent_to_ar)", async () => {
    const evChain = chainResolving({ data: [RO_152805_EVENT], error: null });
    fromMock.mockImplementation((t: string) =>
      t === "qteklink_events" ? evChain : chainResolving({ data: MAPPING_ROWS, error: null }),
    );
    const { je } = await buildShopRoSaleJe(7476, 152805);
    expect(je?.balanced).toBe(true);
    // The ledger query MUST include both posting kinds — filtering ro_posted alone
    // silently drops every A/R sale (≈21% of postings; plan §5).
    expect(evChain.in).toHaveBeenCalledWith("event_kind", ["ro_posted", "ro_sent_to_ar"]);
  });

  it("returns je:null when the RO has no posting snapshot yet", async () => {
    fromMock.mockImplementation((t: string) =>
      t === "qteklink_events" ? chainResolving({ data: [], error: null }) : chainResolving({ data: [], error: null }),
    );
    expect(await buildShopRoSaleJe(7476, 999)).toEqual({ realmId: REALM, je: null });
  });

  it("FAILS CLOSED on an events DB error", async () => {
    fromMock.mockImplementation((t: string) =>
      t === "qteklink_events" ? chainResolving({ data: null, error: { message: "boom" } }) : chainResolving({ data: [], error: null }),
    );
    await expect(buildShopRoSaleJe(7476, 152805)).rejects.toThrow(/buildShopRoSaleJe \(events\) failed/);
  });

  it("FAILS CLOSED on a mappings DB error", async () => {
    fromMock.mockImplementation((t: string) =>
      t === "qteklink_events"
        ? chainResolving({ data: [RO_152805_EVENT], error: null })
        : chainResolving({ data: null, error: { message: "boom" } }),
    );
    await expect(buildShopRoSaleJe(7476, 152805)).rejects.toThrow(/buildShopRoSaleJe \(mappings\) failed/);
  });

  it("FAILS CLOSED on a snapshot missing postedDate", async () => {
    fromMock.mockImplementation((t: string) =>
      t === "qteklink_events"
        ? chainResolving({ data: [{ raw_body: { data: { id: 1, totalSales: 100 } }, received_at: "x" }], error: null })
        : chainResolving({ data: MAPPING_ROWS, error: null }),
    );
    await expect(buildShopRoSaleJe(7476, 1)).rejects.toThrow(/no usable snapshot/);
  });

  it("FAILS CLOSED on a non-integer-cents money total (no 100x / fractional-cent corruption)", async () => {
    fromMock.mockImplementation((t: string) =>
      t === "qteklink_events"
        ? chainResolving({ data: [{ raw_body: { data: { id: 1, repairOrderNumber: "1", postedDate: "2026-05-19T15:39:04Z", partsSales: 12.5, laborSales: 0, subletSales: 0, feeTotal: 0, discountTotal: 0, taxes: 0, totalSales: 12.5 } }, received_at: "x" }], error: null })
        : chainResolving({ data: MAPPING_ROWS, error: null }),
    );
    await expect(buildShopRoSaleJe(7476, 1)).rejects.toThrow(/no usable snapshot/);
  });
});
