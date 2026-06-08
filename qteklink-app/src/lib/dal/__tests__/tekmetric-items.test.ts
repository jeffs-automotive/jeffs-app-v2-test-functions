/**
 * Tests for the Tekmetric-item picker: derivePostingRole (pure) + listTekmetricItems
 * (mocks the discovery RPC + listMappings).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { derivePostingRole } from "@/lib/mappings/catalog";

const rpcMock = vi.fn();
const listMappingsMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock, from: vi.fn() }),
}));
vi.mock("@/lib/dal/mappings", () => ({ listMappings: (...a: unknown[]) => listMappingsMock(...a) }));

import { listTekmetricItems } from "../tekmetric-items";

const REALM = "9341455608740708";

describe("derivePostingRole", () => {
  it("income for labor/part/fee/sublet; contra for non-cash", () => {
    expect(derivePostingRole("labor", "Labor")).toBe("income");
    expect(derivePostingRole("part_category", "PART")).toBe("income");
    expect(derivePostingRole("fee", "Shop supplies")).toBe("income");
    expect(derivePostingRole("sublet", "Sublet")).toBe("income");
    expect(derivePostingRole("noncash_payment_type", "Affirm")).toBe("noncash_contra");
  });
  it("maps the tax + system keys to their specific roles (case-insensitive)", () => {
    expect(derivePostingRole("tax", "Sales Tax")).toBe("sales_tax_payable");
    expect(derivePostingRole("tax", "tire tax")).toBe("tire_fee_payable");
    expect(derivePostingRole("system", "accounts_receivable")).toBe("accounts_receivable");
    expect(derivePostingRole("system", "undeposited_funds")).toBe("undeposited_funds");
    expect(derivePostingRole("system", "cc_fee")).toBe("cc_fee");
  });
  it("returns null for an unknown tax/system key", () => {
    expect(derivePostingRole("tax", "bogus")).toBeNull();
    expect(derivePostingRole("system", "bogus")).toBeNull();
  });
});

describe("listTekmetricItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: REALM, error: null });
      if (fn === "qteklink_discover_tekmetric_items") {
        return Promise.resolve({
          data: [
            { kind: "fee", source_key: "Shop supplies", seen: 625 },
            { kind: "fee", source_key: "SHIPPING", seen: 1 },
            { kind: "fee", source_key: "Shipping", seen: 1 }, // casing variant → deduped
            { kind: "part_category", source_key: "PART", seen: 3316 },
            { kind: "noncash_payment_type", source_key: "Synchrony", seen: 2 },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    listMappingsMock.mockResolvedValue({
      realmId: REALM,
      mappings: [
        { kind: "fee", sourceKey: "Shop supplies", qboAccountId: "273", accountName: "Sales–Shop Supplies", accountNum: "273", passThrough: false },
        { kind: "system", sourceKey: "accounts_receivable", qboAccountId: "235", accountName: "Accounts Receivable", accountNum: "120", passThrough: false },
      ],
    });
  });

  it("merges fixed + discovered, annotates the current mapping, derives the role", async () => {
    const { realmId, items } = await listTekmetricItems(7476);
    expect(realmId).toBe(REALM);
    const byToken = new Map(items.map((i) => [i.token, i]));

    // a mapped fee shows its account "(273 · Sales–Shop Supplies)"
    const shop = byToken.get("fee|Shop supplies")!;
    expect(shop.mappedAccountLabel).toBe("273 · Sales–Shop Supplies");
    expect(shop.mappedQboAccountId).toBe("273");
    expect(shop.postingRole).toBe("income");
    expect(shop.group).toBe("Fees");

    // a fixed mapped item (A/R) annotated "120 · Accounts Receivable"
    expect(byToken.get("system|accounts_receivable")!.mappedAccountLabel).toBe("120 · Accounts Receivable");

    // a fixed UNMAPPED item shows nothing
    expect(byToken.get("labor|Labor")!.mappedAccountLabel).toBeNull();
    expect(byToken.get("tax|Sales Tax")!.postingRole).toBe("sales_tax_payable");

    // an unmapped discovered item (Synchrony) is present, unmapped
    expect(byToken.get("noncash_payment_type|Synchrony")!.mappedAccountLabel).toBeNull();
  });

  it("dedupes casing variants (SHIPPING / Shipping → one item)", async () => {
    const { items } = await listTekmetricItems(7476);
    const shipping = items.filter((i) => i.kind === "fee" && i.sourceKey.toLowerCase() === "shipping");
    expect(shipping).toHaveLength(1);
  });

  it("includes all 7 fixed items", async () => {
    const { items } = await listTekmetricItems(7476);
    for (const t of ["labor|Labor", "sublet|Sublet", "tax|Sales Tax", "tax|Tire Tax", "system|accounts_receivable", "system|undeposited_funds", "system|cc_fee"]) {
      expect(items.some((i) => i.token === t)).toBe(true);
    }
  });

  it("returns {realmId:null, items:[]} when the shop has no connection", async () => {
    rpcMock.mockImplementation(() => Promise.resolve({ data: null, error: null }));
    expect(await listTekmetricItems(7476)).toEqual({ realmId: null, items: [] });
  });
});
