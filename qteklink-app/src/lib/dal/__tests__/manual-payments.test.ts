/**
 * Unit tests for the manual-payments DAL (C6 method-pick storage + C7 hardening:
 * the amount + date are SERVER-DERIVED from the RO snapshot, and a real payment in
 * payment_state ANTI-JOINs the pick). Mocks the Supabase admin client.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock, from: fromMock }),
}));

import { recordManualPayment, listManualPayments } from "../manual-payments";

const REALM = "9341455608740708";

function chainResolving(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "in", "is", "limit"]) chain[m] = vi.fn(() => chain);
  chain.then = (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF);
  return chain;
}

function routeRealm(realm: string | null = REALM) {
  rpcMock.mockImplementation((fn: string) => {
    if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: realm, error: null });
    return Promise.resolve({ data: null, error: null });
  });
}

/** Route from() by table → the snapshot (events) + the anti-join (payment_state). */
function routeFrom(opts: { events?: { data: unknown; error: unknown }; paymentState?: { data: unknown; error: unknown } }) {
  fromMock.mockImplementation((table: string) => {
    if (table === "qteklink_events") return chainResolving(opts.events ?? { data: [], error: null });
    if (table === "qteklink_payment_state") return chainResolving(opts.paymentState ?? { data: [], error: null });
    return chainResolving({ data: [], error: null });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  routeRealm();
});

describe("recordManualPayment", () => {
  const INPUT = { repairOrderId: 330295704, method: "Credit Card", ccFeeCents: 481 };
  const SNAPSHOT = { data: [{ raw_body: { data: { amountPaid: "18900", postedDate: "2026-05-26T13:46:12Z" } } }], error: null };

  function recordReady() {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: REALM, error: null });
      if (fn === "qteklink_record_manual_payment") return Promise.resolve({ data: "new-uuid", error: null });
      return Promise.resolve({ data: null, error: null });
    });
  }

  it("SERVER-DERIVES the amount + date from the RO snapshot and upserts (ignores any client amount)", async () => {
    recordReady();
    routeFrom({ events: SNAPSHOT, paymentState: { data: [], error: null } });
    const res = await recordManualPayment(7476, INPUT, "chris@jeffsautomotive.com");
    expect(rpcMock).toHaveBeenCalledWith("qteklink_record_manual_payment", {
      p_shop_id: 7476, p_realm_id: REALM, p_repair_order_id: 330295704, p_method: "Credit Card",
      p_other_payment_type: null, p_amount_cents: 18900, p_cc_fee_cents: 481,
      p_payment_date: "2026-05-26T13:46:12Z", p_created_by: "chris@jeffsautomotive.com",
    });
    expect(res).toEqual({ id: "new-uuid" });
  });

  it("REJECTS when the RO has no posting snapshot", async () => {
    recordReady();
    routeFrom({ events: { data: [], error: null } });
    await expect(recordManualPayment(7476, INPUT, "x@y.com")).rejects.toThrow(/no posting snapshot/i);
  });

  it("REJECTS when the RO shows no amount paid (amountPaid 0)", async () => {
    recordReady();
    routeFrom({ events: { data: [{ raw_body: { data: { amountPaid: "0", postedDate: "2026-05-26T13:46:12Z" } } }], error: null } });
    await expect(recordManualPayment(7476, INPUT, "x@y.com")).rejects.toThrow(/no amount paid/i);
  });

  it("ANTI-JOIN: REJECTS when a real payment already exists for the RO (would double-post)", async () => {
    recordReady();
    routeFrom({ events: SNAPSHOT, paymentState: { data: [{ payment_id: "999" }], error: null } });
    await expect(recordManualPayment(7476, INPUT, "x@y.com")).rejects.toThrow(/already has a real payment/i);
  });

  it("FAILS CLOSED with reconnect_required when the shop has no connection", async () => {
    routeRealm(null);
    await expect(recordManualPayment(7476, INPUT, "x@y.com")).rejects.toThrow(/not connected/i);
  });

  it("translates a P0001 validation rejection to a clean message", async () => {
    rpcMock.mockImplementation((fn: string) =>
      fn === "qbo_resolve_realm_for_shop"
        ? Promise.resolve({ data: REALM, error: null })
        : Promise.resolve({ data: null, error: { code: "P0001", message: "amount must be >= 0" } }),
    );
    routeFrom({ events: SNAPSHOT, paymentState: { data: [], error: null } });
    await expect(recordManualPayment(7476, INPUT, "x@y.com")).rejects.toThrow(/amount must be >= 0/);
  });

  it("FAILS CLOSED on a non-uuid result", async () => {
    rpcMock.mockImplementation((fn: string) =>
      fn === "qbo_resolve_realm_for_shop"
        ? Promise.resolve({ data: REALM, error: null })
        : Promise.resolve({ data: 123, error: null }),
    );
    routeFrom({ events: SNAPSHOT, paymentState: { data: [], error: null } });
    await expect(recordManualPayment(7476, INPUT, "x@y.com")).rejects.toThrow(/non-uuid/);
  });
});

describe("listManualPayments", () => {
  it("reads + maps rows (bigint cents → number)", async () => {
    fromMock.mockReturnValue(chainResolving({
      data: [{ id: "m1", repair_order_id: "330295704", method: "Credit Card", other_payment_type: null, amount_cents: "18900", cc_fee_cents: "481", payment_date: "2026-05-26T13:00:00Z", created_by: "chris@jeffsautomotive.com" }],
      error: null,
    }));
    const res = await listManualPayments(7476);
    expect(fromMock).toHaveBeenCalledWith("qteklink_manual_payments");
    expect(res.realmId).toBe(REALM);
    expect(res.manualPayments[0]).toEqual({
      id: "m1", repairOrderId: 330295704, method: "Credit Card", otherPaymentType: null,
      amountCents: 18900, ccFeeCents: 481, paymentDate: "2026-05-26T13:00:00Z", createdBy: "chris@jeffsautomotive.com",
    });
  });

  it("returns {realmId:null, manualPayments:[]} when the shop has no connection", async () => {
    routeRealm(null);
    expect(await listManualPayments(7476)).toEqual({ realmId: null, manualPayments: [] });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED on a non-safe-integer cents value", async () => {
    fromMock.mockReturnValue(chainResolving({
      data: [{ id: "m2", repair_order_id: "1", method: "Cash", other_payment_type: null, amount_cents: "9007199254740993", cc_fee_cents: "0", payment_date: "2026-05-26T13:00:00Z", created_by: "x@y.com" }],
      error: null,
    }));
    await expect(listManualPayments(7476)).rejects.toThrow(/non-safe-integer amount_cents/);
  });

  it("FAILS CLOSED on a DB error", async () => {
    fromMock.mockReturnValue(chainResolving({ data: null, error: { message: "boom" } }));
    await expect(listManualPayments(7476)).rejects.toThrow(/listManualPayments failed/);
  });
});
