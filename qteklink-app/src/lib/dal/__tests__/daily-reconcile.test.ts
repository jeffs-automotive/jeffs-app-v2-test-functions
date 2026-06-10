/**
 * Tests for the daily reconciliation DAL (C7). The pure window helper +
 * an integration pass over a mocked Supabase admin client (from routed by table,
 * rpc routed by name).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock, from: fromMock }),
}));

import { runDailyReconciliation, utcWindowForLocalDay } from "../daily-reconcile";

const REALM = "9341455608740708";

const MAPPINGS = [
  { kind: "system", source_key: "accounts_receivable", qbo_account_id: "235", posting_role: "accounts_receivable", pass_through: false },
  { kind: "system", source_key: "undeposited_funds", qbo_account_id: "366", posting_role: "undeposited_funds", pass_through: false },
  { kind: "system", source_key: "cc_fee", qbo_account_id: "309", posting_role: "cc_fee", pass_through: false },
  { kind: "part_category", source_key: "PART", qbo_account_id: "272", posting_role: "parts_income", pass_through: false },
  { kind: "tax", source_key: "sales_tax", qbo_account_id: "250", posting_role: "sales_tax_payable", pass_through: false },
  { kind: "tax", source_key: "tire_fee", qbo_account_id: "252", posting_role: "tire_fee_payable", pass_through: false },
];

// A mapped, balanced parts RO (base 10000, 6% tax 600).
function roEvent(roId: number, postedDate: string, over: Record<string, unknown> = {}) {
  return {
    tekmetric_ro_id: roId, received_at: postedDate,
    raw_body: { data: {
      id: roId, repairOrderNumber: String(roId), postedDate,
      partsSales: 10000, laborSales: 0, subletSales: 0, feeTotal: 0, discountTotal: 0, taxes: 600, totalSales: 10600,
      jobs: [{ authorized: true, parts: [{ retail: 10000, quantity: 1, partType: { code: "PART" } }], labor: [], fees: [] }], fees: [],
      ...over,
    } },
  };
}

function thenable(data: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "gte", "lt", "order", "is", "limit"]) chain[m] = vi.fn(() => chain);
  chain.then = (onF: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(onF);
  return chain;
}

function routeFrom(tables: Record<string, unknown[]>) {
  fromMock.mockImplementation((table: string) => thenable(tables[table] ?? []));
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockImplementation((fn: string) => {
    if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: REALM, error: null });
    if (fn === "qteklink_upsert_review_item") return Promise.resolve({ data: "item-id", error: null });
    if (fn === "qteklink_enqueue_daily_posting") return Promise.resolve({ data: "daily-posting-uuid", error: null });
    return Promise.resolve({ data: null, error: null });
  });
});

describe("utcWindowForLocalDay", () => {
  it("returns a generous [date−1, date+2) UTC window", () => {
    expect(utcWindowForLocalDay("2026-05-19")).toEqual({
      startIso: "2026-05-18T00:00:00.000Z",
      endIso: "2026-05-21T00:00:00.000Z",
    });
  });
});

describe("runDailyReconciliation", () => {
  it("builds + gates the day's ROs, EXCLUDES other local days, nets postable, persists nothing when clean", async () => {
    routeFrom({
      qteklink_mappings: MAPPINGS,
      // both are inside the UTC window; only the first is local date 2026-05-19 (ET).
      qteklink_events: [roEvent(101, "2026-05-19T15:39:04Z"), roEvent(102, "2026-05-18T02:00:00Z")],
      qteklink_payment_state: [],
      qteklink_manual_payments: [],
    });
    const r = await runDailyReconciliation(7476, "2026-05-19");
    expect(r.realmId).toBe(REALM);
    expect(r.saleCount).toBe(1); // RO 102 (local 2026-05-17) excluded
    expect(r.postableSales).toBe(1);
    expect(r.reviewCount).toBe(0);
    expect(r.persistedReviewItems).toBe(0);
    expect(r.netByAccount["235"]).toBe(10600); // A/R debit
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_upsert_review_item", expect.anything());
    // The day's SALES category JE was enqueued into qteklink_daily_postings (daily-JE
    // model: ≤3 rows/day; the empty payments/fees categories are noops). No QBO write.
    expect(r.enqueuedPostings).toBe(1);
    expect(r.dailyEnqueue).toEqual({ sales: "new", payments: "noop", fees: "noop" });
    expect(rpcMock).toHaveBeenCalledWith("qteklink_enqueue_daily_posting", expect.objectContaining({
      p_category: "sales", p_business_date: "2026-05-19", p_posting_version: 1, p_action: "create",
      p_constituents: { ro_ids: [101], payment_ids: [] },
    }));
  });

  it("an RO whose NEWEST event is ro_unposted is DROPPED (benign reversal — no sale, no review item)", async () => {
    const posted = roEvent(101, "2026-05-19T15:39:04Z");
    // The unpost arrives AFTER the posting event (newer tekmetric_event_at) — same RO.
    const unposted = {
      tekmetric_ro_id: 101, received_at: "2026-05-19T16:00:00Z", event_kind: "ro_unposted",
      raw_body: { event: "Repair Order #101 unposted by x", data: { id: 101, shopId: 7476, postedDate: "2026-05-19T15:39:04Z" } },
    };
    routeFrom({
      qteklink_mappings: MAPPINGS,
      // ordered DESC by event time in the real query; the mock returns as-is → newest first.
      qteklink_events: [unposted, { ...posted, event_kind: "ro_posted" }],
      qteklink_payment_state: [],
      qteklink_manual_payments: [],
    });
    const r = await runDailyReconciliation(7476, "2026-05-19");
    expect(r.saleCount).toBe(0); // the reversed RO never builds a sale
    expect(r.reviewCount).toBe(0); // benign — not a review item
    expect(r.dailyEnqueue.sales).toBe("noop");
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_upsert_review_item", expect.anything());
  });

  it("a re-post AFTER an unpost recognizes the sale again (newest event wins)", async () => {
    const reposted = { ...roEvent(101, "2026-05-19T17:00:00Z"), event_kind: "ro_posted" };
    const unposted = {
      tekmetric_ro_id: 101, received_at: "2026-05-19T16:00:00Z", event_kind: "ro_unposted",
      raw_body: { event: "Repair Order #101 unposted by x", data: { id: 101, shopId: 7476, postedDate: "2026-05-19T15:39:04Z" } },
    };
    routeFrom({
      qteklink_mappings: MAPPINGS,
      qteklink_events: [reposted, unposted], // newest (the re-post) first
      qteklink_payment_state: [],
      qteklink_manual_payments: [],
    });
    const r = await runDailyReconciliation(7476, "2026-05-19");
    expect(r.saleCount).toBe(1);
    expect(r.postableSales).toBe(1);
  });

  it("persists a §9 review item for a non-postable (unmapped) RO", async () => {
    routeFrom({
      qteklink_mappings: MAPPINGS,
      // an RO with an UNMAPPED fee → gate emits an 'unmapped' review item.
      qteklink_events: [roEvent(201, "2026-05-19T15:39:04Z", {
        partsSales: 0, taxes: 0, feeTotal: 500, totalSales: 500,
        jobs: [], fees: [{ name: "Brand New Fee", total: 500 }],
      })],
      qteklink_payment_state: [],
      qteklink_manual_payments: [],
    });
    const r = await runDailyReconciliation(7476, "2026-05-19");
    expect(r.reviewCount).toBe(1);
    expect(r.persistedReviewItems).toBe(1);
    expect(rpcMock).toHaveBeenCalledWith("qteklink_upsert_review_item", expect.objectContaining({
      p_kind: "unmapped", p_subject_kind: "ro", p_subject_ref: "201",
    }));
  });

  it("ANTI-JOIN: suppresses a manual pick whose RO has a real payment + flags the conflict", async () => {
    const realPayment = {
      payment_id: 555, signed_amount_cents: 5000, signed_processing_fee_cents: 0,
      status: "succeeded", is_refund: false, payment_type: "Cash", other_payment_type: null,
      payment_date: "2026-05-19T15:00:00Z", repair_order_id: 101, voided_at: null,
    };
    routeFrom({
      qteklink_mappings: MAPPINGS,
      qteklink_events: [roEvent(101, "2026-05-19T15:39:04Z")],
      qteklink_payment_state: [realPayment], // returned for the day query AND the anti-join
      qteklink_manual_payments: [{
        id: "m1", repair_order_id: 101, method: "Credit Card", other_payment_type: null,
        amount_cents: "5000", cc_fee_cents: "0", payment_date: "2026-05-19T15:00:00Z", created_by: "x@y.com",
      }],
    });
    const r = await runDailyReconciliation(7476, "2026-05-19");
    // the REAL Cash payment posts; the manual pick is suppressed → a conflict review item.
    expect(r.postablePayments).toBe(1);
    expect(rpcMock).toHaveBeenCalledWith("qteklink_upsert_review_item", expect.objectContaining({
      p_kind: "manual_payment_conflict", p_subject_ref: "101",
    }));
  });

  it("surfaces a corrupt/unparseable RO snapshot as a review item (no silent skip)", async () => {
    routeFrom({
      qteklink_mappings: MAPPINGS,
      // no postedDate → parseSnapshot returns null.
      qteklink_events: [{ tekmetric_ro_id: 301, received_at: "2026-05-19T15:00:00Z", raw_body: { data: { id: 301, repairOrderNumber: "301" } } }],
      qteklink_payment_state: [],
      qteklink_manual_payments: [],
    });
    const r = await runDailyReconciliation(7476, "2026-05-19");
    expect(r.saleCount).toBe(0); // not built
    expect(rpcMock).toHaveBeenCalledWith("qteklink_upsert_review_item", expect.objectContaining({
      p_kind: "snapshot_unparseable", p_subject_ref: "301",
    }));
  });

  it("returns an empty summary when the shop has no connection", async () => {
    rpcMock.mockImplementation((fn: string) =>
      fn === "qbo_resolve_realm_for_shop" ? Promise.resolve({ data: null, error: null }) : Promise.resolve({ data: null, error: null }),
    );
    const r = await runDailyReconciliation(7476, "2026-05-19");
    expect(r).toEqual({
      realmId: null, businessDate: "2026-05-19", saleCount: 0, paymentCount: 0, postableSales: 0, postablePayments: 0,
      reviewCount: 0, persistedReviewItems: 0, enqueuedPostings: 0,
      dailyEnqueue: { sales: "noop", payments: "noop", fees: "noop" }, netByAccount: {},
    });
    expect(fromMock).not.toHaveBeenCalled();
  });
});
