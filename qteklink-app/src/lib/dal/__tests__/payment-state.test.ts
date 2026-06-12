/**
 * Unit tests for the payment-state projection DAL (C4 + the 2026-06-12 incremental
 * watermark). Mocks the Supabase admin client (rpc routes by function name; from()
 * routes by TABLE — the watermark table vs the events ledger, events served from a
 * per-call queue so the incremental probe + history reads are distinguishable).
 *
 * Covers: the shop->realm binding; FULL mode (no watermark / opts.full) — tenant-scoped
 * payment-family fetch, snapshot cutoff + deterministic order, multi-page pagination +
 * the MAX_PAGES fail-closed cap, reducer wiring (a void pair collapses to one voided
 * state), the upsert RPC, and the watermark advance to the newest OBSERVED received_at;
 * INCREMENTAL mode — ids-only probe behind the overlap, full-history re-reduce of ONLY
 * the touched payments, watermark advance, and the nothing-new fast path; fail-closed
 * behavior (DB error, corrupt payment_id, corrupt watermark). The reducer's own logic
 * is covered in src/lib/payments/__tests__/reducer.test.ts.
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
  for (const m of ["select", "eq", "not", "lte", "gt", "in", "order", "range", "limit"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF);
  return chain;
}

/** A thenable chain whose page contents depend on the .range() offset (for paging). */
function pagedChain(pageFor: (fromIdx: number) => unknown[]) {
  let lastFrom = 0;
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "not", "lte", "gt", "in", "order", "limit"]) {
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

/** The watermark-table chain (.select().eq().eq().maybeSingle()). */
function wmChain(row: { last_reduced_received_at: string } | null, error: { message: string } | null = null) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) chain[m] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: row, error }));
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

// from() routing: the watermark table gets `watermark`; qteklink_events shifts
// through `eventsQueue` (the last entry is reused once the queue is exhausted, so
// single-chain tests keep working).
let watermark: ReturnType<typeof wmChain>;
let eventsQueue: Record<string, unknown>[];
function routeFrom() {
  fromMock.mockImplementation((table: string) => {
    if (table === "qteklink_projection_state") return watermark;
    return eventsQueue.length > 1 ? eventsQueue.shift()! : eventsQueue[0]!;
  });
}

function routeRealm(realm: string | null = REALM, realmError: { message: string } | null = null) {
  rpcMock.mockImplementation((fn: string) => {
    if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: realm, error: realmError });
    if (fn === "qteklink_upsert_payment_state") return Promise.resolve({ data: 0, error: null });
    if (fn === "qteklink_advance_projection_watermark") return Promise.resolve({ data: "2026-05-01T00:00:01Z", error: null });
    return Promise.resolve({ data: null, error: null });
  });
}

function advanceCalls() {
  return rpcMock.mock.calls.filter((c) => c[0] === "qteklink_advance_projection_watermark");
}

beforeEach(() => {
  vi.clearAllMocks();
  routeRealm();
  watermark = wmChain(null); // default: no watermark → FULL mode (the pre-watermark behavior)
  eventsQueue = [chainResolving({ data: [], error: null })];
  routeFrom();
});

describe("reduceShopPaymentState — full mode (no watermark / opts.full)", () => {
  it("short-circuits when the shop has no connection (no event fetch)", async () => {
    routeRealm(null);
    const res = await reduceShopPaymentState(7476);
    expect(res).toEqual({ realmId: null, events: 0, payments: 0, mode: "incremental" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("fetches payment-family events tenant-scoped + within the cutoff, reduces, upserts, and ADVANCES the watermark to the newest observed received_at", async () => {
    const eventsChain = chainResolving({
      data: [
        { id: "ok", payment_id: 57984574, tekmetric_ro_id: 318590708, tekmetric_event_at: "2026-05-12T19:47:34Z", received_at: "2026-05-12T19:47:40Z", raw_body: { data: { amount: 19550, applicationFee: 250, voided: false, paymentType: { code: "CC" } } } },
        { id: "void", payment_id: 57984574, tekmetric_ro_id: 318590708, tekmetric_event_at: "2026-05-12T19:47:34Z", received_at: "2026-05-12T19:48:09Z", raw_body: { data: { amount: 19550, applicationFee: null, voided: true, paymentType: { code: "CC" } } } },
        { id: "p2", payment_id: 59001338, tekmetric_ro_id: 330902500, tekmetric_event_at: "2026-05-28T14:47:22Z", received_at: "2026-05-28T14:47:25Z", raw_body: { data: { amount: 11202, applicationFee: 290, paymentType: { code: "CC" } } } },
      ],
      error: null,
    });
    eventsQueue = [eventsChain];
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: REALM, error: null });
      if (fn === "qteklink_upsert_payment_state") return Promise.resolve({ data: 2, error: null });
      if (fn === "qteklink_advance_projection_watermark") return Promise.resolve({ data: "x", error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const res = await reduceShopPaymentState(7476);

    // tenant scoping + payment-family + snapshot cutoff + deterministic order
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

    // watermark advances to the newest received_at actually OBSERVED (never "now")
    expect(advanceCalls()).toHaveLength(1);
    expect(advanceCalls()[0]![1]).toMatchObject({ p_shop_id: 7476, p_realm_id: REALM, p_watermark: "2026-05-28T14:47:25Z" });

    expect(res).toEqual({ realmId: REALM, events: 3, payments: 2, mode: "full" });
  });

  it("opts.full bypasses the watermark read entirely (the nightly verification net)", async () => {
    eventsQueue = [chainResolving({ data: [evRow(1)], error: null })];
    await reduceShopPaymentState(7476, { full: true });
    expect(fromMock).not.toHaveBeenCalledWith("qteklink_projection_state");
  });

  it("pages through a ledger larger than one page and reduces every page", async () => {
    // pageSize 2: page0 [1,2] (full → keep going), page1 [3] (short → stop).
    eventsQueue = [pagedChain((from) => (from === 0 ? [evRow(1), evRow(2)] : from === 2 ? [evRow(3)] : []))];
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: REALM, error: null });
      if (fn === "qteklink_upsert_payment_state") return Promise.resolve({ data: 3, error: null });
      if (fn === "qteklink_advance_projection_watermark") return Promise.resolve({ data: "x", error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const res = await reduceShopPaymentState(7476, { pageSize: 2 });
    expect(res).toEqual({ realmId: REALM, events: 3, payments: 3, mode: "full" });
    const call = rpcMock.mock.calls.find((c) => c[0] === "qteklink_upsert_payment_state")!;
    expect((call[1] as { p_states: unknown[] }).p_states).toHaveLength(3); // all 3 pages reduced
  });

  it("FAILS CLOSED when pagination exceeds maxPages (no partial reduction)", async () => {
    // every page is full → the loop can never break → the cap must abort.
    eventsQueue = [pagedChain(() => [evRow(1), evRow(2)])];
    await expect(reduceShopPaymentState(7476, { pageSize: 2, maxPages: 2 })).rejects.toThrow(
      /pagination exceeded 2 pages/,
    );
    // never upserts a partial set, never advances the mark
    expect(rpcMock.mock.calls.some((c) => c[0] === "qteklink_upsert_payment_state")).toBe(false);
    expect(advanceCalls()).toHaveLength(0);
  });

  it("FAILS CLOSED on a corrupt / out-of-safe-range payment_id (no silent drop)", async () => {
    eventsQueue = [chainResolving({ data: [evRow(1, { payment_id: "99999999999999999999" })], error: null })];
    await expect(reduceShopPaymentState(7476)).rejects.toThrow(/invalid payment_id/);
  });

  it("FAILS CLOSED on a present-but-unsafe tekmetric_ro_id (no silent loss of RO correlation)", async () => {
    eventsQueue = [chainResolving({ data: [evRow(1, { tekmetric_ro_id: "99999999999999999999" })], error: null })];
    await expect(reduceShopPaymentState(7476)).rejects.toThrow(/invalid tekmetric_ro_id/);
  });

  it("does not call the upsert RPC (or advance the mark) when there are no payment events", async () => {
    const res = await reduceShopPaymentState(7476);
    expect(res).toEqual({ realmId: REALM, events: 0, payments: 0, mode: "full" });
    expect(rpcMock.mock.calls.some((c) => c[0] === "qteklink_upsert_payment_state")).toBe(false);
    expect(advanceCalls()).toHaveLength(0);
  });

  it("FAILS CLOSED on an event-fetch DB error", async () => {
    eventsQueue = [chainResolving({ data: null, error: { message: "boom" } })];
    await expect(reduceShopPaymentState(7476)).rejects.toThrow(/reduceShopPaymentState \(events\) failed/);
  });

  it("FAILS CLOSED on a watermark-read DB error", async () => {
    watermark = wmChain(null, { message: "wm boom" });
    await expect(reduceShopPaymentState(7476)).rejects.toThrow(/reduceShopPaymentState \(watermark\) failed/);
  });

  it("FAILS CLOSED when the upsert RPC errors", async () => {
    eventsQueue = [chainResolving({ data: [evRow(1)], error: null })];
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: REALM, error: null });
      return Promise.resolve({ data: null, error: { message: "rpc boom" } });
    });
    await expect(reduceShopPaymentState(7476)).rejects.toThrow(/qteklink_upsert_payment_state failed/);
  });

  it("FAILS CLOSED on a non-numeric upsert result", async () => {
    eventsQueue = [chainResolving({ data: [evRow(1)], error: null })];
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: REALM, error: null });
      if (fn === "qteklink_upsert_payment_state") return Promise.resolve({ data: "nope", error: null });
      return Promise.resolve({ data: null, error: null });
    });
    await expect(reduceShopPaymentState(7476)).rejects.toThrow(/non-numeric result/);
  });
});

describe("reduceShopPaymentState — incremental mode (watermark present)", () => {
  beforeEach(() => {
    watermark = wmChain({ last_reduced_received_at: "2026-06-12T12:00:00Z" });
  });

  it("probes ids-only behind the overlap, re-reduces ONLY touched payments from FULL history, and advances the mark", async () => {
    const probeChain = chainResolving({
      data: [
        { payment_id: 57984574, received_at: "2026-06-12T12:01:00Z" },
        { payment_id: 57984574, received_at: "2026-06-12T12:02:00Z" },
      ],
      error: null,
    });
    const historyChain = chainResolving({
      data: [
        { id: "ok", payment_id: 57984574, tekmetric_ro_id: 318590708, tekmetric_event_at: "2026-05-12T19:47:34Z", received_at: "2026-06-12T12:01:00Z", raw_body: { data: { amount: 19550, applicationFee: 250, voided: false, paymentType: { code: "CC" } } } },
        { id: "void", payment_id: 57984574, tekmetric_ro_id: 318590708, tekmetric_event_at: "2026-05-12T19:47:34Z", received_at: "2026-06-12T12:02:00Z", raw_body: { data: { amount: 19550, applicationFee: null, voided: true, paymentType: { code: "CC" } } } },
      ],
      error: null,
    });
    eventsQueue = [probeChain, historyChain];
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: REALM, error: null });
      if (fn === "qteklink_upsert_payment_state") return Promise.resolve({ data: 1, error: null });
      if (fn === "qteklink_advance_projection_watermark") return Promise.resolve({ data: "x", error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const res = await reduceShopPaymentState(7476);

    // the probe reads ids-only NEWER than (watermark − overlap)…
    expect(probeChain.select).toHaveBeenCalledWith("payment_id, received_at");
    expect(probeChain.gt).toHaveBeenCalledWith("received_at", "2026-06-12T11:55:00.000Z"); // 12:00 − 5 min
    // …and the history re-read targets ONLY the touched payment, full per-payment history
    expect(historyChain.in).toHaveBeenCalledWith("payment_id", [57984574]);
    expect(historyChain.lte).toHaveBeenCalledWith("received_at", expect.any(String));

    const call = rpcMock.mock.calls.find((c) => c[0] === "qteklink_upsert_payment_state")!;
    const states = (call[1] as { p_states: Array<Record<string, unknown>> }).p_states;
    expect(states).toHaveLength(1);
    expect(states[0]!.payment_id).toBe(57984574);
    expect(states[0]!.status).toBe("voided"); // reduced from FULL history, not just the new event

    expect(advanceCalls()).toHaveLength(1);
    expect(advanceCalls()[0]![1]).toMatchObject({ p_watermark: "2026-06-12T12:02:00Z" }); // max OBSERVED
    expect(res).toEqual({ realmId: REALM, events: 2, payments: 1, mode: "incremental" });
  });

  it("nothing new → no body reads, no upsert, no advance (the page-view fast path)", async () => {
    eventsQueue = [chainResolving({ data: [], error: null })];
    const res = await reduceShopPaymentState(7476);
    expect(res).toEqual({ realmId: REALM, events: 0, payments: 0, mode: "incremental" });
    // exactly ONE events call (the probe) — no full-body history read
    expect(fromMock.mock.calls.filter((c) => c[0] === "qteklink_events")).toHaveLength(1);
    expect(rpcMock.mock.calls.some((c) => c[0] === "qteklink_upsert_payment_state")).toBe(false);
    expect(advanceCalls()).toHaveLength(0);
  });

  it("FAILS CLOSED on a corrupt stored watermark", async () => {
    watermark = wmChain({ last_reduced_received_at: "not-a-date" });
    await expect(reduceShopPaymentState(7476)).rejects.toThrow(/corrupt watermark/);
  });

  it("FAILS CLOSED when the probe errors", async () => {
    eventsQueue = [chainResolving({ data: null, error: { message: "probe boom" } })];
    await expect(reduceShopPaymentState(7476)).rejects.toThrow(/reduceShopPaymentState \(probe\) failed/);
  });
});
