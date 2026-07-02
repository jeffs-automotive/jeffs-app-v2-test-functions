/**
 * Unit tests for the late-payment redate queue (resolution-workflow Part A — Chris's
 * spec): a payment landing on a day whose payments JE is already POSTED is detected,
 * HELD out of the day, emailed ONCE ("Void this payment…"), and AUTO-RESOLVES when
 * the void/re-date arrives. Mocks the Supabase admin client (rpc by name, from by
 * table), the posted-JE lookup, settings, and the email sender.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();
const findLatestPostedMock = vi.fn();
const sendEmailMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock, from: fromMock }),
}));
vi.mock("@/lib/dal/realm", () => ({ resolveRealmForShop: vi.fn().mockResolvedValue("realm-A") }));
vi.mock("@/lib/dal/daily-postings", () => ({
  findLatestPostedDaily: (...a: unknown[]) => findLatestPostedMock(...a),
}));
vi.mock("@/lib/dal/notify", () => ({ sendQteklinkEmail: (...a: unknown[]) => sendEmailMock(...a) }));
vi.mock("@/lib/dal/settings", () => ({
  getShopSettings: vi.fn().mockResolvedValue({ settings: { dateChangeAlertEmails: ["om@shop.com"] } }),
}));

import { syncPaymentRedates } from "../payment-redates";
import type { DayPaymentDraft } from "@/lib/dal/day-drafts";

const REALM = "realm-A";
const DATE = "2026-06-29";

function draft(paymentId: number | string, over: { suppressed?: boolean; manual?: boolean; amount?: number; ro?: number | null; roNumber?: string | null } = {}): DayPaymentDraft {
  return {
    input: {
      paymentId,
      repairOrderId: over.ro === undefined ? 152630 : over.ro,
      repairOrderNumber: over.roNumber === undefined ? "152630" : over.roNumber,
      customerName: "Carmax",
      method: "CHK",
      otherPaymentType: null,
      signedAmountCents: over.amount ?? 8357,
      signedProcessingFeeCents: 0,
      paymentDate: `${DATE}T14:00:00Z`,
      status: "succeeded",
      isRefund: false,
      manual: over.manual ?? false,
    },
    je: { suppressed: over.suppressed ?? false } as DayPaymentDraft["je"],
  } as DayPaymentDraft;
}

function thenable(data: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "gte", "lt", "order", "is", "limit"]) chain[m] = vi.fn(() => chain);
  chain.then = (onF: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(onF);
  return chain;
}

/** live posted payments JE containing the given payment ids. */
function posted(ids: string[]) {
  return { action: "update", constituents: { roIds: [], paymentIds: ids }, sourceStateHash: "h1" };
}

function openRedateRow(paymentId: number, over: Record<string, unknown> = {}) {
  return {
    id: `rd-${paymentId}`, payment_id: paymentId, tekmetric_ro_id: 152630, ro_number: "152630",
    customer_name: "Carmax", amount_cents: 8357, business_date: DATE, status: "pending",
    detected_at: "2026-07-02T00:00:00Z", notified_at: "2026-07-02T00:00:01Z",
    approved_by: null, approved_at: null, resolved_at: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sendEmailMock.mockResolvedValue(true);
  fromMock.mockImplementation(() => thenable([])); // no open redates by default
  rpcMock.mockImplementation((fn: string) => {
    if (fn === "qteklink_upsert_payment_redate") return Promise.resolve({ data: [{ id: "rd-new", changed: true }], error: null });
    return Promise.resolve({ data: true, error: null });
  });
});

describe("syncPaymentRedates — detection", () => {
  it("detects a late payment NOT in the posted JE: upserts, holds, emails Chris's wording, stamps notified", async () => {
    findLatestPostedMock.mockResolvedValue(posted(["1", "2"]));
    const r = await syncPaymentRedates(7476, REALM, DATE, [draft(1), draft(2), draft(61299633, { amount: 8357 })], []);

    expect(r.detected).toBe(1);
    expect(r.newlyHeldPaymentIds.has(61299633)).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("qteklink_upsert_payment_redate", expect.objectContaining({
      p_payment_id: 61299633, p_business_date: DATE, p_amount_cents: 8357,
    }));
    // ONE email, Chris's wording, to the DATE CHANGE ALERT list.
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const mail = sendEmailMock.mock.calls[0]![0] as { to: string[]; subject: string; text: string };
    expect(mail.to).toEqual(["om@shop.com"]);
    expect(mail.text).toContain("Void this payment: $83.57 on RO 152630 (Carmax) — take it on a different day.");
    expect(rpcMock).toHaveBeenCalledWith("qteklink_mark_payment_redate_notified", expect.objectContaining({ p_id: "rd-new" }));
  });

  it("never detects: payments already in the posted JE, voided (suppressed), or manual picks", async () => {
    findLatestPostedMock.mockResolvedValue(posted(["1"]));
    const r = await syncPaymentRedates(7476, REALM, DATE, [
      draft(1),                                   // in the JE
      draft(2, { suppressed: true }),             // voided
      draft("manual-uuid", { manual: true }),     // manual pick
    ], []);
    expect(r.detected).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("no live posted payments JE → nothing to detect", async () => {
    findLatestPostedMock.mockResolvedValue(null);
    const r = await syncPaymentRedates(7476, REALM, DATE, [draft(9)], []);
    expect(r.detected).toBe(0);
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_upsert_payment_redate", expect.anything());
  });

  it("an already-notified pending row re-detects WITHOUT re-emailing (nightly quiet)", async () => {
    findLatestPostedMock.mockResolvedValue(posted(["1"]));
    fromMock.mockImplementation(() => thenable([openRedateRow(61299633)])); // notified_at set
    const r = await syncPaymentRedates(7476, REALM, DATE, [draft(1)], [draft(61299633)]);
    expect(r.detected).toBe(1); // still counted as held
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("does NOT stamp notified when the email send fails (retries next reconcile)", async () => {
    findLatestPostedMock.mockResolvedValue(posted(["1"]));
    sendEmailMock.mockResolvedValue(false);
    await syncPaymentRedates(7476, REALM, DATE, [draft(1), draft(7)], []);
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_mark_payment_redate_notified", expect.anything());
  });
});

describe("syncPaymentRedates — auto-resolution (Chris: void/re-date → clears itself)", () => {
  it("resolves an open redate whose payment is now VOIDED (suppressed draft)", async () => {
    findLatestPostedMock.mockResolvedValue(posted(["1"]));
    fromMock.mockImplementation(() => thenable([openRedateRow(61299633)]));
    const r = await syncPaymentRedates(7476, REALM, DATE, [draft(1)], [draft(61299633, { suppressed: true })]);
    expect(r.autoResolved).toBe(1);
    expect(rpcMock).toHaveBeenCalledWith("qteklink_resolve_payment_redate", expect.objectContaining({ p_id: "rd-61299633" }));
  });

  it("resolves an open redate whose payment LEFT the day (re-dated in Tekmetric)", async () => {
    findLatestPostedMock.mockResolvedValue(posted(["1"]));
    fromMock.mockImplementation(() => thenable([openRedateRow(61299633)]));
    const r = await syncPaymentRedates(7476, REALM, DATE, [draft(1)], []); // payment absent from the day
    expect(r.autoResolved).toBe(1);
  });

  it("resolves an APPROVED redate once its payment is IN the live posted JE (post-anyway landed)", async () => {
    findLatestPostedMock.mockResolvedValue(posted(["1", "61299633"]));
    fromMock.mockImplementation(() => thenable([openRedateRow(61299633, { status: "approved" })]));
    const r = await syncPaymentRedates(7476, REALM, DATE, [draft(1), draft(61299633)], []);
    expect(r.autoResolved).toBe(1);
  });

  it("keeps a pending redate open while the payment is still on the day, unvoided", async () => {
    findLatestPostedMock.mockResolvedValue(posted(["1"]));
    fromMock.mockImplementation(() => thenable([openRedateRow(61299633)]));
    const r = await syncPaymentRedates(7476, REALM, DATE, [draft(1)], [draft(61299633)]);
    expect(r.autoResolved).toBe(0);
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_resolve_payment_redate", expect.anything());
  });

  it("an APPROVED redate is not re-detected as pending (post-anyway lifts the hold)", async () => {
    findLatestPostedMock.mockResolvedValue(posted(["1"]));
    fromMock.mockImplementation(() => thenable([openRedateRow(61299633, { status: "approved" })]));
    const r = await syncPaymentRedates(7476, REALM, DATE, [draft(1), draft(61299633)], []);
    expect(r.newlyHeldPaymentIds.has(61299633)).toBe(false);
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_upsert_payment_redate", expect.anything());
  });
});
