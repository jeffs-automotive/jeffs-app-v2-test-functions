/**
 * Unit tests for the PAYMENT JE DAL (C6). Mocks the Supabase admin client; the pure
 * builder is covered in src/lib/payments/__tests__/payment-je-builder.test.ts —
 * here we verify the DB seam: realm binding, projection fetch, mapping resolution,
 * the manual method-pick path, and fail-closed behavior.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock, from: fromMock }),
}));

import {
  buildShopPaymentJe,
  buildShopManualPaymentJe,
  resolvePaymentMappings,
} from "../payment-je";

const REALM = "9341455608740708";

function chainResolving(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) chain[m] = vi.fn(() => chain);
  chain.then = (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF);
  return chain;
}

const CARD_STATE = {
  payment_id: 57852813, signed_amount_cents: 22510, signed_processing_fee_cents: 573,
  status: "succeeded", is_refund: false, payment_type: "Credit Card", other_payment_type: null,
  payment_date: "2026-05-11T13:12:42Z", repair_order_id: 326283459,
};

const MAPPING_ROWS = [
  { kind: "system", source_key: "undeposited_funds", qbo_account_id: "366", posting_role: "undeposited_funds" },
  { kind: "system", source_key: "accounts_receivable", qbo_account_id: "235", posting_role: "accounts_receivable" },
  { kind: "system", source_key: "cc_fee", qbo_account_id: "309", posting_role: "cc_fee" },
  { kind: "noncash_payment_type", source_key: "Tire Protection Plan", qbo_account_id: "6834", posting_role: "noncash_contra" },
];

function routeRealm(realm: string | null = REALM) {
  rpcMock.mockImplementation((fn: string) =>
    fn === "qbo_resolve_realm_for_shop"
      ? Promise.resolve({ data: realm, error: null })
      : Promise.resolve({ data: null, error: null }),
  );
}
function routeTables(stateRes: { data: unknown; error: unknown }, mapRes: { data: unknown; error: unknown }) {
  fromMock.mockImplementation((t: string) =>
    t === "qteklink_payment_state" ? chainResolving(stateRes) : chainResolving(mapRes),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  routeRealm();
});

describe("buildShopPaymentJe", () => {
  it("short-circuits when the shop has no connection", async () => {
    routeRealm(null);
    expect(await buildShopPaymentJe(7476, 57852813)).toEqual({ realmId: null, je: null });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("reads the projection row + mappings and builds a balanced card JE (gross→net)", async () => {
    routeTables({ data: [CARD_STATE], error: null }, { data: MAPPING_ROWS, error: null });
    const { realmId, je } = await buildShopPaymentJe(7476, 57852813);
    expect(realmId).toBe(REALM);
    expect(je?.balanced).toBe(true);
    expect(je?.route).toBe("deposit");
    expect(je?.txnDate).toBe("2026-05-11");
    expect(je?.docNumber).toBe("PAY 57852813");
    expect(je?.lines).toHaveLength(4);
    const undeposited = je!.lines.filter((l) => l.accountId === "366");
    expect(undeposited.reduce((a, l) => a + (l.postingType === "Debit" ? l.amountCents : -l.amountCents), 0)).toBe(22510 - 573);
  });

  it("returns je:null when the payment has no projection row yet", async () => {
    routeTables({ data: [], error: null }, { data: MAPPING_ROWS, error: null });
    expect(await buildShopPaymentJe(7476, 999)).toEqual({ realmId: REALM, je: null });
  });

  it("FAILS CLOSED on a projection row with no payment_date", async () => {
    routeTables({ data: [{ ...CARD_STATE, payment_date: null }], error: null }, { data: MAPPING_ROWS, error: null });
    await expect(buildShopPaymentJe(7476, 57852813)).rejects.toThrow(/no payment_date/);
  });

  it("FAILS CLOSED on a projection DB error", async () => {
    routeTables({ data: null, error: { message: "boom" } }, { data: MAPPING_ROWS, error: null });
    await expect(buildShopPaymentJe(7476, 57852813)).rejects.toThrow(/buildShopPaymentJe \(state\) failed/);
  });

  it("FAILS CLOSED on a mappings DB error", async () => {
    routeTables({ data: [CARD_STATE], error: null }, { data: null, error: { message: "boom" } });
    await expect(buildShopPaymentJe(7476, 57852813)).rejects.toThrow(/buildShopPaymentJe \(mappings\) failed/);
  });

  it("safe-parses string-bigint cents (PostgREST may serialize bigint as a string)", async () => {
    routeTables(
      { data: [{ ...CARD_STATE, signed_amount_cents: "22510", signed_processing_fee_cents: "573", repair_order_id: "326283459" }], error: null },
      { data: MAPPING_ROWS, error: null },
    );
    const { je } = await buildShopPaymentJe(7476, 57852813);
    expect(je?.balanced).toBe(true);
    expect(je?.lines).toHaveLength(4);
  });

  it("FAILS CLOSED on a non-safe-integer cents value from the projection", async () => {
    routeTables({ data: [{ ...CARD_STATE, signed_amount_cents: "9007199254740993" }], error: null }, { data: MAPPING_ROWS, error: null });
    await expect(buildShopPaymentJe(7476, 57852813)).rejects.toThrow(/non-safe-integer signed_amount_cents/);
  });
});

describe("buildShopManualPaymentJe (method-pick)", () => {
  it("builds a balanced card JE from a manual pick with a user-entered CC fee", async () => {
    fromMock.mockImplementation(() => chainResolving({ data: MAPPING_ROWS, error: null }));
    const { je } = await buildShopManualPaymentJe(7476, {
      repairOrderId: 330295704, method: "Credit Card", amountCents: 18900, ccFeeCents: 481,
      paymentDate: "2026-05-26T13:00:00Z", manualId: "manual-330295704",
    });
    expect(je?.balanced).toBe(true);
    expect(je?.route).toBe("deposit");
    expect(je?.docNumber).toBe("PAY manual-330295704");
    expect(je?.lines).toHaveLength(4);
  });

  it("short-circuits when the shop has no connection", async () => {
    routeRealm(null);
    const r = await buildShopManualPaymentJe(7476, {
      repairOrderId: 1, method: "Cash", amountCents: 100, paymentDate: "2026-05-26T13:00:00Z", manualId: "m1",
    });
    expect(r).toEqual({ realmId: null, je: null });
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("resolvePaymentMappings", () => {
  it("maps system accounts + non-cash types", () => {
    const m = resolvePaymentMappings(MAPPING_ROWS);
    expect(m).toEqual({
      undepositedAccountId: "366",
      arAccountId: "235",
      ccFeeAccountId: "309",
      noncashAccountsByType: { "Tire Protection Plan": "6834" },
    });
  });
});
