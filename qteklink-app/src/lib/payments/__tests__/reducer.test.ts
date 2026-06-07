/**
 * Unit tests for the pure payment-state reducer (C4). No mocks — the reducer is
 * pure TS over already-fetched events (the Fat-DAL "business logic" layer).
 *
 * Every case is grounded in the 627 real payment events sampled from
 * keytag_webhook_events (plan §1/§3): SUCCEEDED (amount +, fee number|null),
 * REFUND_SUCCEEDED (separate id, amount -, fee null), VOIDED (same id flipped,
 * amount unchanged, reuses the original paymentDate so received_at breaks the tie).
 */
import { describe, it, expect } from "vitest";
import {
  reducePayment,
  reducePaymentEvents,
  type PaymentEventInput,
} from "../reducer";

const iso = (s: string) => new Date(s).toISOString();

/** Build a payment-family event row (qteklink_events shape the reducer consumes). */
function mk(over: Partial<PaymentEventInput> & { id: string; paymentId: number }): PaymentEventInput {
  return {
    tekmetricRoId: 330902500,
    tekmetricEventAt: "2026-05-28T14:47:22Z",
    receivedAt: "2026-05-28T14:47:25Z",
    data: {},
    ...over,
  };
}

describe("reducePayment — single normal payment", () => {
  it("projects a SUCCEEDED credit-card payment (positive amount + CC fee)", () => {
    const s = reducePayment([
      mk({
        id: "e1",
        paymentId: 59001338,
        tekmetricRoId: 330902500,
        tekmetricEventAt: "2026-05-28T14:47:22Z",
        receivedAt: "2026-05-28T14:47:25Z",
        data: {
          amount: 11202,
          applicationFee: 290,
          refund: false,
          voided: false,
          paymentType: { code: "CC", name: "Credit Card" },
          otherPaymentType: null,
        },
      }),
    ]);
    expect(s).toEqual({
      paymentId: 59001338,
      signedAmountCents: 11202,
      signedProcessingFeeCents: 290,
      status: "succeeded",
      isRefund: false,
      paymentType: "CC",
      otherPaymentType: null,
      paymentDate: iso("2026-05-28T14:47:22Z"), // business date = tekmetric_event_at
      voidedAt: null,
      repairOrderId: 330902500,
      latestEventAt: iso("2026-05-28T14:47:25Z"), // observed = received_at
      reducedFromEventIds: ["e1"],
    });
  });

  it("treats applicationFee 0 and null both as a 0 processing fee", () => {
    const zero = reducePayment([mk({ id: "z", paymentId: 1, data: { amount: 8262, applicationFee: 0 } })]);
    expect(zero.signedProcessingFeeCents).toBe(0);
    const nul = reducePayment([mk({ id: "n", paymentId: 2, data: { amount: 4710, applicationFee: null } })]);
    expect(nul.signedProcessingFeeCents).toBe(0);
  });
});

describe("reducePayment — void (same id flipped, terminal)", () => {
  // Real pair 57984574: SUCCEEDED received 19:47:40, VOIDED received 19:48:09,
  // BOTH paymentDate 19:47:34 (the void reuses it → tekmetric_event_at ties).
  const succeeded = mk({
    id: "ok",
    paymentId: 57984574,
    tekmetricRoId: 318590708,
    tekmetricEventAt: "2026-05-12T19:47:34Z",
    receivedAt: "2026-05-12T19:47:40Z",
    data: { amount: 19550, applicationFee: 250, refund: false, voided: false, paymentType: { code: "CC" } },
  });
  const voided = mk({
    id: "void",
    paymentId: 57984574,
    tekmetricRoId: 318590708,
    tekmetricEventAt: "2026-05-12T19:47:34Z", // same date as the original
    receivedAt: "2026-05-12T19:48:09Z",       // received later → tie-break orders it last
    data: { amount: 19550, applicationFee: null, refund: false, voided: true, paymentType: { code: "CC" } },
  });

  it("is terminal voided, KEEPS the face amount, hydrates the fee from the original", () => {
    const s = reducePayment([succeeded, voided]);
    expect(s.status).toBe("voided");
    expect(s.signedAmountCents).toBe(19550);          // face value kept (plan §5)
    expect(s.signedProcessingFeeCents).toBe(250);     // hydrated from the SUCCEEDED event
    expect(s.voidedAt).toBe(iso("2026-05-12T19:48:09Z"));   // OBSERVED time (void's received_at)
    expect(s.latestEventAt).toBe(iso("2026-05-12T19:48:09Z")); // max received_at
    expect(s.reducedFromEventIds).toEqual(["ok", "void"]); // received_at tie-break order
  });

  it("a late SUCCEEDED can never un-void (order-independent)", () => {
    const s = reducePayment([voided, succeeded]); // fed in reverse
    expect(s.status).toBe("voided");
    expect(s.reducedFromEventIds).toEqual(["ok", "void"]); // still sorted by received_at
  });

  it("hydrates immutable facts even when the void sorts FIRST (out of order)", () => {
    // Contrived ordering: the void has the earlier effective time, and is missing
    // the fee + type that only the later SUCCEEDED carries.
    const voidFirst = mk({
      id: "v",
      paymentId: 700,
      tekmetricEventAt: "2026-05-12T19:00:00Z",
      receivedAt: "2026-05-12T19:00:05Z",
      data: { amount: 19550, applicationFee: null, voided: true, paymentType: null },
    });
    const okLater = mk({
      id: "o",
      paymentId: 700,
      tekmetricEventAt: "2026-05-12T19:30:00Z",
      receivedAt: "2026-05-12T19:30:05Z",
      data: { amount: 19550, applicationFee: 250, voided: false, paymentType: { code: "CC" } },
    });
    const s = reducePayment([voidFirst, okLater]);
    expect(s.status).toBe("voided");                 // terminal
    expect(s.signedProcessingFeeCents).toBe(250);    // hydrated from the later SUCCEEDED
    expect(s.paymentType).toBe("CC");                // hydrated from the later SUCCEEDED
    expect(s.voidedAt).toBe(iso("2026-05-12T19:00:05Z"));   // the void's received_at (observed)
    expect(s.latestEventAt).toBe(iso("2026-05-12T19:30:05Z")); // max received_at
  });

  it("voided_at is sticky to the FIRST observed void (a later re-void never moves it)", () => {
    const base = { paymentId: 800, tekmetricEventAt: "2026-05-12T10:00:00Z", data: { amount: 5000, voided: true } as const };
    const firstVoid = mk({ ...base, id: "v-early", receivedAt: "2026-05-12T10:00:30Z" });
    const reVoid = mk({ ...base, id: "v-late", receivedAt: "2026-05-13T08:00:00Z" });
    const s = reducePayment([reVoid, firstVoid]); // fed out of order
    expect(s.status).toBe("voided");
    expect(s.voidedAt).toBe(iso("2026-05-12T10:00:30Z"));    // first observed void, not the re-void
    expect(s.latestEventAt).toBe(iso("2026-05-13T08:00:00Z")); // but latest activity advances
  });
});

describe("reducePayment — refund (separate negative id)", () => {
  it("keeps the negative amount, 0 fee, flags is_refund, status stays succeeded", () => {
    const s = reducePayment([
      mk({
        id: "r",
        paymentId: 59699728,
        tekmetricRoId: 336569246,
        tekmetricEventAt: "2026-06-06T15:10:30Z",
        receivedAt: "2026-06-06T15:10:30Z",
        data: { amount: -2461, applicationFee: null, refund: true, voided: false, paymentType: { code: "CC" } },
      }),
    ]);
    expect(s.signedAmountCents).toBe(-2461);
    expect(s.signedProcessingFeeCents).toBe(0);
    expect(s.isRefund).toBe(true);
    expect(s.status).toBe("succeeded");
    expect(s.voidedAt).toBeNull();
  });
});

describe("reducePayment — non-cash (OTH)", () => {
  it("projects paymentType code + otherPaymentType name", () => {
    const s = reducePayment([
      mk({
        id: "oth",
        paymentId: 58455033,
        data: {
          amount: 44110,
          applicationFee: null,
          paymentType: { code: "OTH", name: "Other" },
          otherPaymentType: { name: "Tire Protection Plan" },
        },
      }),
    ]);
    expect(s.paymentType).toBe("OTH");
    expect(s.otherPaymentType).toBe("Tire Protection Plan");
    expect(s.signedAmountCents).toBe(44110);
  });
});

describe("reducePayment — ordering, tie-break, fallback", () => {
  it("orders by received_at when tekmetric_event_at ties", () => {
    const a = mk({ id: "a", paymentId: 9, tekmetricEventAt: "2026-05-01T00:00:00Z", receivedAt: "2026-05-01T00:00:09Z", data: { amount: 100 } });
    const b = mk({ id: "b", paymentId: 9, tekmetricEventAt: "2026-05-01T00:00:00Z", receivedAt: "2026-05-01T00:00:02Z", data: { amount: 100 } });
    expect(reducePayment([a, b]).reducedFromEventIds).toEqual(["b", "a"]);
  });

  it("falls back to received_at ordering when tekmetric_event_at is null, and leaves paymentDate null", () => {
    const bad = mk({ id: "bad", paymentId: 10, tekmetricEventAt: null, receivedAt: "2026-05-02T00:00:00Z", data: { amount: 500 } });
    const s = reducePayment([bad]);
    expect(s.paymentDate).toBeNull();
    expect(s.latestEventAt).toBe(iso("2026-05-02T00:00:00Z")); // fallback to received_at
    expect(s.signedAmountCents).toBe(500);
  });

  it("final tie-break by event id when both timestamps tie", () => {
    const a = mk({ id: "zzz", paymentId: 11, tekmetricEventAt: "2026-05-01T00:00:00Z", receivedAt: "2026-05-01T00:00:00Z", data: { amount: 1 } });
    const b = mk({ id: "aaa", paymentId: 11, tekmetricEventAt: "2026-05-01T00:00:00Z", receivedAt: "2026-05-01T00:00:00Z", data: { amount: 1 } });
    expect(reducePayment([a, b]).reducedFromEventIds).toEqual(["aaa", "zzz"]);
  });
});

describe("reducePayment — duplicates + guards", () => {
  it("folds distinct-id events without double-counting the amount", () => {
    const e1 = mk({ id: "d1", paymentId: 12, data: { amount: 8858, applicationFee: 231, paymentType: { code: "CC" } } });
    const e2 = mk({ id: "d2", paymentId: 12, data: { amount: 8858, applicationFee: 231, paymentType: { code: "CC" } } });
    const s = reducePayment([e1, e2]);
    expect(s.signedAmountCents).toBe(8858);            // not 17716
    expect(s.signedProcessingFeeCents).toBe(231);
    expect(s.reducedFromEventIds).toEqual(["d1", "d2"]); // both recorded for audit
  });

  it("collapses a replayed/paginated duplicate ledger row (same event id)", () => {
    const row = mk({ id: "same", paymentId: 13, data: { amount: 5000, applicationFee: 150, paymentType: { code: "CC" } } });
    const s = reducePayment([row, { ...row }]); // same qteklink_events.id twice
    expect(s.signedAmountCents).toBe(5000);
    expect(s.reducedFromEventIds).toEqual(["same"]); // deduped, not ["same","same"]
  });

  it("throws on an empty event list", () => {
    expect(() => reducePayment([])).toThrow(/no events/i);
  });

  it("throws when fed events from MORE THAN ONE payment id", () => {
    const a = mk({ id: "a", paymentId: 1, data: { amount: 1 } });
    const b = mk({ id: "b", paymentId: 2, data: { amount: 1 } });
    expect(() => reducePayment([a, b])).toThrow(/mixed payment ids/i);
  });

  it("fails closed on an unparseable received_at", () => {
    const bad = mk({ id: "x", paymentId: 14, receivedAt: "not-a-date", data: { amount: 1 } });
    expect(() => reducePayment([bad])).toThrow(/unparseable received_at/i);
  });

  it("fails closed on a non-safe-integer amount (money corruption)", () => {
    const bad = mk({ id: "amt", paymentId: 15, data: { amount: 1.5 } });
    expect(() => reducePayment([bad])).toThrow(/non-safe-integer amount/i);
  });
});

describe("reducePaymentEvents — grouping", () => {
  it("groups by payment id (a payment and its separate refund are distinct states)", () => {
    const states = reducePaymentEvents([
      mk({ id: "p", paymentId: 100, data: { amount: 5000, applicationFee: 150, paymentType: { code: "CC" } } }),
      mk({ id: "ref", paymentId: 101, data: { amount: -5000, refund: true, applicationFee: null, paymentType: { code: "CC" } } }),
      mk({ id: "v1", paymentId: 102, tekmetricEventAt: "2026-05-01T00:00:00Z", receivedAt: "2026-05-01T00:00:01Z", data: { amount: 700, voided: false } }),
      mk({ id: "v2", paymentId: 102, tekmetricEventAt: "2026-05-01T00:00:00Z", receivedAt: "2026-05-01T00:00:09Z", data: { amount: 700, voided: true } }),
    ]);
    expect(states).toHaveLength(3); // 100, 101, 102
    const byId = new Map(states.map((s) => [s.paymentId, s]));
    expect(byId.get(100)!.isRefund).toBe(false);
    expect(byId.get(101)!.isRefund).toBe(true);
    expect(byId.get(101)!.signedAmountCents).toBe(-5000);
    expect(byId.get(102)!.status).toBe("voided");
  });

  it("returns [] for no events", () => {
    expect(reducePaymentEvents([])).toEqual([]);
  });

  it("emits states deterministically ordered by payment id", () => {
    const states = reducePaymentEvents([
      mk({ id: "b", paymentId: 30, data: { amount: 1 } }),
      mk({ id: "a", paymentId: 20, data: { amount: 1 } }),
      mk({ id: "c", paymentId: 40, data: { amount: 1 } }),
    ]);
    expect(states.map((s) => s.paymentId)).toEqual([20, 30, 40]);
  });
});
