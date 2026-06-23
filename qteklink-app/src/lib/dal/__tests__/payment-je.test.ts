/**
 * Unit tests for the PAYMENT mapping/projection seam (payment-je): the pure
 * `resolvePaymentMappings` + `stateRowToPayment` adapters (consumed by day-drafts)
 * and the manual method-pick DAL (`buildShopManualPaymentJe`). The pure builder is
 * covered in src/lib/payments/__tests__/payment-je-builder.test.ts. (The per-payment
 * `buildShopPaymentJe` DAL was retired with the per-RO posting path.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock, from: fromMock }),
}));

import {
  buildShopManualPaymentJe,
  resolvePaymentMappings,
  stateRowToPayment,
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
beforeEach(() => {
  vi.clearAllMocks();
  routeRealm();
});

describe("stateRowToPayment", () => {
  it("maps a projection row (incl. string-bigint cents — PostgREST may serialize bigint as a string)", () => {
    const p = stateRowToPayment({ ...CARD_STATE, signed_amount_cents: "22510", signed_processing_fee_cents: "573", repair_order_id: "326283459" });
    expect(p).toMatchObject({
      paymentId: "57852813", repairOrderId: 326283459, method: "Credit Card",
      signedAmountCents: 22510, signedProcessingFeeCents: 573, status: "succeeded", isRefund: false,
    });
  });

  it("FAILS CLOSED on a non-safe-integer cents value from the projection", () => {
    expect(() => stateRowToPayment({ ...CARD_STATE, signed_amount_cents: "9007199254740993" })).toThrow(/non-safe-integer signed_amount_cents/);
  });

  it("FAILS CLOSED on a row with no payment_date", () => {
    expect(() => stateRowToPayment({ ...CARD_STATE, payment_date: null })).toThrow(/no payment_date/);
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
      depositLikeAccountsByType: {},
      storeCreditAccountId: null,
    });
  });

  it("maps the system/store_credit account → storeCreditAccountId", () => {
    const m = resolvePaymentMappings([
      { kind: "system", source_key: "store_credit", qbo_account_id: "260", posting_role: "store_credit" },
    ]);
    expect(m.storeCreditAccountId).toBe("260");
  });

  it("splits a non-cash type by role: undeposited_funds → deposit-like, else → contra", () => {
    const m = resolvePaymentMappings([
      { kind: "noncash_payment_type", source_key: "Synchrony", qbo_account_id: "366", posting_role: "undeposited_funds" },
      { kind: "noncash_payment_type", source_key: "Shop Vehicle", qbo_account_id: "6101", posting_role: "noncash_contra" },
    ]);
    expect(m.depositLikeAccountsByType).toEqual({ Synchrony: "366" });
    expect(m.noncashAccountsByType).toEqual({ "Shop Vehicle": "6101" });
  });
});
