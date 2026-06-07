/**
 * Unit tests for the payment-state projection DAL (C4). Mocks the Supabase admin
 * client (rpc routes by function name; from() returns a thenable chain). Covers
 * the shop->realm binding, tenant-scoped + payment-family-only event fetch, the
 * snapshot watermark + deterministic order, multi-page pagination + the MAX_PAGES
 * fail-closed cap, the reducer wiring (a void pair collapses to one terminal-voided
 * state), the upsert RPC call, and fail-closed behavior (DB error, corrupt
 * payment_id). The reducer's own logic is covered in
 * src/lib/payments/__tests__/reducer.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock, from: fromMock }),
}));

import { reduceShopPaymentState } from "../payment-state";

const REALM = "9341455608740708";

/** A thenable PostgREST-builder stand-in returning a fixed page. */
function chainResolving(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "not", "lte", "order", "range", "limit"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF);
  return chain;
}

/** A thenable chain whose page contents depend on the .range() offset (for paging). */
function pagedChain(pageFor: (fromIdx: number) => unknown[]) {
  let lastFrom = 0;
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "not", "lte", "order", "limit"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.range = vi.fn((from: number) => {
    lastFrom = from;
    return chain;
  });
  chain.then = (onF: (v: unknown) => unknown) =>
    Promise.resolve({ data: pageFor(lastFrom), error: null }).then(onF);
  return chain;
}

function evRow(paymentId: number, over: Record<string, unknown> = {}) {
  return {
    id: `e${paymentId}`,
    payment_id: paymentId,
    tekmetric_ro_id: 100 + paymentId,
    tekmetric_event_at: "2026-05-01T00:00:00Z",
    received_at: "2026-05-01T00:00:01Z",
    raw_body: { data: { amount: 1000 + paymentId, paymentType: { code: "CC" } } },
    ...over,
  };
}

function routeRealm(realm: string | null = REALM, realmError: { message: string } | null = null) {
  rpcMock.mockImplementation((fn: string) => {
    if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: realm, error: realmError });
    if (fn === "qteklink_upsert_payment_state") return Promise.resolve({ data: 0, error: null });
    return Promise.resolve({ data: null, error: null });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  routeRealm();
});

describe("reduceShopPaymentState", () => {
  it("short-circuits when the shop has no connection (no event fetch)", async () => {
    routeRealm(null);
    const res = await reduceShopPaymentState(7476);
    expect(res).toEqual({ realmId: null, events: 0, payments: 0 });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("fetches payment-family events tenant-scoped + within the watermark, reduces, and upserts", async () => {
    const eventsChain = chainResolving({
      data: [
        { id: "ok", payment_id: 57984574, tekmetric_ro_id: 318590708, tekmetric_event_at: "2026-05-12T19:47:34Z", received_at: "2026-05-12T19:47:40Z", raw_body: { data: { amount: 19550, applicationFee: 250, voided: false, paymentType: { code: "CC" } } } },
        { id: "void", payment_id: 57984574, tekmetric_ro_id: 318590708, tekmetric_event_at: "2026-05-12T19:47:34Z", received_at: "2026-05-12T19:48:09Z", raw_body: { data: { amount: 19550, applicationFee: null, voided: true, paymentType: { code: "CC" } } } },
        { id: "p2", payment_id: 59001338, tekmetric_ro_id: 330902500, tekmetric_event_at: "2026-05-28T14:47:22Z", received_at: "2026-05-28T14:47:25Z", raw_body: { data: { amount: 11202, applicationFee: 290, paymentType: { code: "CC" } } } },
      ],
      error: null,
    });
    fromMock.mockReturnValue(eventsChain);
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: REALM, error: null });
      if (fn === "qteklink_upsert_payment_state") return Promise.resolve({ data: 2, error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const res = await reduceShopPaymentState(7476);

    // tenant scoping + payment-family + watermark + deterministic order
    expect(fromMock).toHaveBeenCalledWith("qteklink_events");
    expect(eventsChain.eq).toHaveBeenCalledWith("shop_id", 7476);
    expect(eventsChain.eq).toHaveBeenCalledWith("realm_id", REALM);
    expect(eventsChain.not).toHaveBeenCalledWith("payment_id", "is", null);
    expect(eventsChain.lte).toHaveBeenCalledWith("received_at", expect.any(String));
    expect(eventsChain.order).toHaveBeenCalledWith("received_at", { ascending: true });
    expect(eventsChain.order).toHaveBeenCalledWith("id", { ascending: true });

    // the upsert got the reduced states: the void pair collapsed to ONE voided row
    const call = rpcMock.mock.calls.find((c) => c[0] === "qteklink_upsert_payment_state");
    expect(call).toBeTruthy();
    const args = call![1] as { p_shop_id: number; p_realm_id: string; p_states: Array<Record<string, unknown>> };
    expect(args.p_shop_id).toBe(7476);
    expect(args.p_realm_id).toBe(REALM);
    expect(args.p_states).toHaveLength(2);
    const voided = args.p_states.find((s) => s.payment_id === 57984574)!;
    expect(voided.status).toBe("voided");
    expect(voided.signed_amount_cents).toBe(19550);
    expect(voided.signed_processing_fee_cents).toBe(250); // hydrated from the SUCCEEDED event
    expect(voided.voided_at).toBe(new Date("2026-05-12T19:48:09Z").toISOString()); // observed time
    expect(voided.reduced_from_event_ids).toEqual(["ok", "void"]);
    const normal = args.p_states.find((s) => s.payment_id === 59001338)!;
    expect(normal.status).toBe("succeeded");
    expect(normal.signed_amount_cents).toBe(11202);

    expect(res).toEqual({ realmId: REALM, events: 3, payments: 2 });
  });

  it("pages through a ledger larger than one page and reduces every page", async () => {
    // pageSize 2: page0 [1,2] (full → keep going), page1 [3] (short → stop).
    fromMock.mockReturnValue(
      pagedChain((from) => (from === 0 ? [evRow(1), evRow(2)] : from === 2 ? [evRow(3)] : [])),
    );
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: REALM, error: null });
      if (fn === "qteklink_upsert_payment_state") return Promise.resolve({ data: 3, error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const res = await reduceShopPaymentState(7476, { pageSize: 2 });
    expect(res).toEqual({ realmId: REALM, events: 3, payments: 3 });
    const call = rpcMock.mock.calls.find((c) => c[0] === "qteklink_upsert_payment_state")!;
    expect((call[1] as { p_states: unknown[] }).p_states).toHaveLength(3); // all 3 pages reduced
  });

  it("FAILS CLOSED when pagination exceeds maxPages (no partial reduction)", async () => {
    // every page is full → the loop can never break → the cap must abort.
    fromMock.mockReturnValue(pagedChain(() => [evRow(1), evRow(2)]));
    await expect(reduceShopPaymentState(7476, { pageSize: 2, maxPages: 2 })).rejects.toThrow(
      /pagination exceeded 2 pages/,
    );
    // never upserts a partial set
    expect(rpcMock.mock.calls.some((c) => c[0] === "qteklink_upsert_payment_state")).toBe(false);
  });

  it("FAILS CLOSED on a corrupt / out-of-safe-range payment_id (no silent drop)", async () => {
    fromMock.mockReturnValue(
      chainResolving({ data: [evRow(1, { payment_id: "99999999999999999999" })], error: null }),
    );
    await expect(reduceShopPaymentState(7476)).rejects.toThrow(/invalid payment_id/);
  });

  it("FAILS CLOSED on a present-but-unsafe tekmetric_ro_id (no silent loss of RO correlation)", async () => {
    fromMock.mockReturnValue(
      chainResolving({ data: [evRow(1, { tekmetric_ro_id: "99999999999999999999" })], error: null }),
    );
    await expect(reduceShopPaymentState(7476)).rejects.toThrow(/invalid tekmetric_ro_id/);
  });

  it("does not call the upsert RPC when there are no payment events", async () => {
    fromMock.mockReturnValue(chainResolving({ data: [], error: null }));
    const res = await reduceShopPaymentState(7476);
    expect(res).toEqual({ realmId: REALM, events: 0, payments: 0 });
    expect(rpcMock.mock.calls.some((c) => c[0] === "qteklink_upsert_payment_state")).toBe(false);
  });

  it("FAILS CLOSED on an event-fetch DB error", async () => {
    fromMock.mockReturnValue(chainResolving({ data: null, error: { message: "boom" } }));
    await expect(reduceShopPaymentState(7476)).rejects.toThrow(/reduceShopPaymentState \(events\) failed/);
  });

  it("FAILS CLOSED when the upsert RPC errors", async () => {
    fromMock.mockReturnValue(chainResolving({ data: [evRow(1)], error: null }));
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: REALM, error: null });
      return Promise.resolve({ data: null, error: { message: "rpc boom" } });
    });
    await expect(reduceShopPaymentState(7476)).rejects.toThrow(/qteklink_upsert_payment_state failed/);
  });

  it("FAILS CLOSED on a non-numeric upsert result", async () => {
    fromMock.mockReturnValue(chainResolving({ data: [evRow(1)], error: null }));
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: REALM, error: null });
      if (fn === "qteklink_upsert_payment_state") return Promise.resolve({ data: "nope", error: null });
      return Promise.resolve({ data: null, error: null });
    });
    await expect(reduceShopPaymentState(7476)).rejects.toThrow(/non-numeric result/);
  });
});
