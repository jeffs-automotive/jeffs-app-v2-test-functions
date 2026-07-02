/**
 * Unit tests for the day-attention assembly (resolution-workflow Part D) — the ONE
 * list the approve lock, the banner, and the fix-it page render. Replays the
 * 2026-06-29 incident: payments v1 posted + v2 failed deposit-locked must yield
 * exactly ONE blocking item carrying the retry/accept actions (not two phantom
 * "payments" and not an unsatisfiable pointer at an empty queue).
 */
import { describe, it, expect } from "vitest";
import { assembleDayAttention, mappingTokenForReason, KIND_LABELS } from "../day-attention";
import type { DailyPostingRow } from "@/lib/dal/daily-postings";
import type { ReviewItemRow } from "@/lib/dal/review-items";
import type { PaymentRedateRow } from "@/lib/dal/payment-redates";

const DATE = "2026-06-29";

function posting(over: Partial<DailyPostingRow>): DailyPostingRow {
  return {
    id: "p1", businessDate: DATE, category: "payments", postingVersion: 1, action: "create",
    status: "posted", docNumber: `QTL-PAY-${DATE}`, txnDate: DATE, lines: [], totalCents: 1220162,
    constituents: { roIds: [], paymentIds: ["a"] }, sourceStateHash: "H1", requestid: "q",
    qboJeId: "26455", qboSyncToken: "3", approvedBy: "accounting@jeffsautomotive.com",
    approvedAt: "2026-06-29T20:48:19Z", createdAt: "2026-06-29T20:48:19Z",
    ...over,
  };
}

function openItem(over: Partial<ReviewItemRow>): ReviewItemRow {
  return {
    id: "ri-1", kind: "qbo_deposit_locked", subjectKind: "day", subjectRef: `${DATE}:payments`,
    detail: { qboError: "QBO ValidationFault (6540): Deposited Transaction cannot be changed" },
    status: "open", createdAt: "2026-07-01T07:00:48Z",
    ...over,
  };
}

function redate(over: Partial<PaymentRedateRow>): PaymentRedateRow {
  return {
    id: "rd-1", paymentId: 61299633, tekmetricRoId: 152630, roNumber: "152630", customerName: "Carmax",
    amountCents: 8357, businessDate: DATE, status: "pending",
    detectedAt: "2026-07-02T01:00:00Z", notifiedAt: "2026-07-02T01:00:01Z",
    approvedBy: null, approvedAt: null, resolvedAt: null,
    ...over,
  };
}

describe("assembleDayAttention — the 2026-06-29 incident replay", () => {
  it("failed latest payments version → ONE blocking retry/accept item, titled from the paired deposit-locked item", () => {
    const r = assembleDayAttention({
      businessDate: DATE,
      emittedItems: [],
      postings: [
        posting({}),
        posting({ id: "p2", postingVersion: 2, action: "update", status: "failed", constituents: { roIds: [], paymentIds: ["a", "61299633", "61299634"] }, sourceStateHash: "H2", qboJeId: null, approvedBy: "system (auto-correction)" }),
      ],
      openItems: [openItem({})],
      openRedates: [],
    });
    expect(r.blockingCount).toBe(1);
    const item = r.items[0]!;
    expect(item.kind).toBe("qbo_deposit_locked");
    expect(item.title).toBe(KIND_LABELS.qbo_deposit_locked);
    expect(item.blocking).toBe(true);
    expect(item.postingId).toBe("p2");
    expect(item.actions).toEqual(["retry_or_accept"]);
    expect(item.summary).toContain("6540");
  });

  it("a failed row with NO paired open item still surfaces (the resolved-queue trap is dead)", () => {
    const r = assembleDayAttention({
      businessDate: DATE,
      emittedItems: [],
      postings: [posting({}), posting({ id: "p2", postingVersion: 2, status: "failed" })],
      openItems: [], // Chris resolved everything — the old code showed a locked day + empty list
      openRedates: [],
    });
    expect(r.blockingCount).toBe(1);
    expect(r.items[0]!.kind).toBe("posting_failed");
    expect(r.items[0]!.actions).toEqual(["retry_or_accept"]);
  });

  it("a posted (non-failed) latest version yields NO failed card", () => {
    const r = assembleDayAttention({
      businessDate: DATE,
      emittedItems: [],
      postings: [posting({}), posting({ id: "p2", postingVersion: 2, status: "rejected" })],
      openItems: [],
      openRedates: [],
    });
    expect(r.blockingCount).toBe(0);
    expect(r.items).toHaveLength(0);
  });

  it("an unmapped gate item is blocking + deep-links its mapping token", () => {
    const r = assembleDayAttention({
      businessDate: DATE,
      emittedItems: [{ kind: "unmapped", subjectKind: "ro", subjectRef: "342107322", detail: { reasons: ["fee:Gas"], docNumber: "RO 153782" } }],
      postings: [],
      openItems: [openItem({ id: "ri-9", kind: "unmapped", subjectKind: "ro", subjectRef: "342107322" })],
      openRedates: [],
    });
    expect(r.blockingCount).toBe(1);
    const item = r.items[0]!;
    expect(item.actions).toEqual(["fix_mapping"]);
    expect(item.mappingTokens).toEqual(["fee|Gas"]);
    expect(item.subjectLabel).toBe("RO 153782");
    expect(item.reviewItemId).toBe("ri-9");
  });

  it("a manual-payment conflict is NON-blocking and carries the delete action", () => {
    const r = assembleDayAttention({
      businessDate: DATE,
      emittedItems: [{ kind: "manual_payment_conflict", subjectKind: "ro", subjectRef: "5", detail: { manualPaymentId: "6f8c0a68-0000-4000-8000-000000000001" } }],
      postings: [],
      openItems: [],
      openRedates: [],
    });
    expect(r.blockingCount).toBe(0);
    expect(r.items[0]!.actions).toEqual(["delete_manual_payment"]);
    expect(r.items[0]!.manualPaymentId).toBe("6f8c0a68-0000-4000-8000-000000000001");
  });

  it("a pending redate is a NON-blocking card with Chris's guidance + the post-anyway action", () => {
    const r = assembleDayAttention({
      businessDate: DATE,
      emittedItems: [],
      postings: [posting({})],
      openItems: [],
      openRedates: [redate({})],
    });
    expect(r.blockingCount).toBe(0);
    const item = r.items[0]!;
    expect(item.kind).toBe("late_payment_redate");
    expect(item.blocking).toBe(false);
    expect(item.cents).toBe(8357);
    expect(item.subjectLabel).toBe("RO 152630 (Carmax)");
    expect(item.summary).toContain("Void this payment");
    expect(item.actions).toEqual(["redate_approve"]);
  });
});

describe("mappingTokenForReason", () => {
  it("maps every unmapped-reason family to its picker token", () => {
    expect(mappingTokenForReason("fee:Gas")).toBe("fee|Gas");
    expect(mappingTokenForReason("part_category:TIRE")).toBe("part_category|TIRE");
    expect(mappingTokenForReason("labor")).toBe("labor|Labor");
    expect(mappingTokenForReason("sublet")).toBe("sublet|Sublet");
    expect(mappingTokenForReason("sales_tax_payable")).toBe("tax|Sales Tax");
    expect(mappingTokenForReason("tire_fee_payable")).toBe("tax|Tire Tax");
    expect(mappingTokenForReason("accounts_receivable")).toBe("system|accounts_receivable");
    expect(mappingTokenForReason("cc_fee")).toBe("system|cc_fee");
    expect(mappingTokenForReason("payment_type:CHK")).toBe("payment_type|CHK");
  });

  it("returns null for non-mapping reasons (no misleading deep-link)", () => {
    expect(mappingTokenForReason("discount_residual:500")).toBeNull();
    expect(mappingTokenForReason("negative_total:-100")).toBeNull();
    expect(mappingTokenForReason("part_category:unknown")).toBeNull();
    expect(mappingTokenForReason("part_category:unweighted")).toBeNull();
  });
});
