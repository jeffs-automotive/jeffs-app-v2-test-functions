/**
 * Unit tests for the PURE daily-JE builder (daily-JE rework step 1, plan
 * docs/qteklink/daily-je-rework-plan.md §2/§7). Fixtures are produced by the REAL
 * C5/C6 builders so the contract (line shapes, `part` tags, refund flips, routes)
 * is locked end-to-end, with real-data amounts (card 22510¢/573¢, TPP 19550¢,
 * refund −2513¢).
 *
 * The invariants under test (the cross-verify's explicit list):
 *   balanced-from-balanced aggregation; structural fee extraction (no dup/drop);
 *   refund flip preserved (NO netting — same account on both sides stays itemized);
 *   contra inside the payments JE (D6); $0-RO skip (D4); empty categories → null;
 *   deterministic ordering regardless of input order; the line-count guard; and
 *   QBO payload compatibility (toQboJournalEntry accepts the lines).
 */
import { describe, it, expect } from "vitest";
import {
  buildDailyJournalEntries,
  DAILY_LINE_CAP,
  type DailyJeBundle,
} from "../daily-je-builder";
import {
  buildSaleJournalEntry,
  type ResolvedMappings,
  type RoSaleSnapshot,
  type SaleSettings,
} from "@/lib/sales/sale-builder";
import {
  buildPaymentJournalEntry,
  type PaymentForBuild,
  type PaymentJournalEntry,
  type ResolvedPaymentMappings,
} from "@/lib/payments/payment-je-builder";
import type { SaleDraft } from "@/lib/reconcile/daily-rollup";
import { toQboJournalEntry } from "@/lib/qbo/journal-entry";

const DATE = "2026-06-05";

// ─── real-builder fixtures ───────────────────────────────────────────────────

const SALE_M: ResolvedMappings = {
  laborAccountId: "275",
  partCategoryAccountIds: { PART: "272", TIRE: "270" },
  feeAccountsByName: {},
  subletAccountId: null,
  arAccountId: "235",
  salesTaxAccountId: "250",
  tireFeeAccountId: "252",
};
const SALE_S: SaleSettings = { shopTimezone: "America/New_York", tireFeeCentsPerTire: 100, salesTaxRateBps: 600 };

/** A labor-only RO: laborSales + 6% tax → Dr A/R (total) / Cr Labor / Cr Sales tax. */
function laborRo(roId: number, roNumber: string, laborCents: number): SaleDraft {
  const taxes = Math.round(laborCents * 0.06);
  const snapshot: RoSaleSnapshot = {
    repairOrderNumber: roNumber,
    repairOrderId: roId,
    postedDate: `${DATE}T18:30:00Z`, // 14:30 ET → local date = DATE
    partsSales: 0,
    laborSales: laborCents,
    subletSales: 0,
    feeTotal: 0,
    discountTotal: 0,
    taxes,
    totalSales: laborCents + taxes,
    jobs: [{ authorized: true, labor: [{ rate: laborCents, hours: 1 }] }],
    fees: [],
  };
  return { snapshot, je: buildSaleJournalEntry(snapshot, SALE_M, SALE_S) };
}

/** A fully-comped $0 RO (no lines — the D4 skip case). */
function zeroRo(roId: number, roNumber: string): SaleDraft {
  const snapshot: RoSaleSnapshot = {
    repairOrderNumber: roNumber,
    repairOrderId: roId,
    postedDate: `${DATE}T18:30:00Z`,
    partsSales: 0,
    laborSales: 0,
    subletSales: 0,
    feeTotal: 0,
    discountTotal: 0,
    taxes: 0,
    totalSales: 0,
    jobs: [],
    fees: [],
  };
  return { snapshot, je: buildSaleJournalEntry(snapshot, SALE_M, SALE_S) };
}

const PAY_M: ResolvedPaymentMappings = {
  undepositedAccountId: "366",
  arAccountId: "235",
  ccFeeAccountId: "309",
  noncashAccountsByType: { "Tire Protection Plan": "6834" },
  depositLikeAccountsByType: { Synchrony: "366" },
};

function payment(over: Partial<PaymentForBuild>): PaymentJournalEntry {
  const p: PaymentForBuild = {
    paymentId: "57852813",
    repairOrderId: 326283459,
    method: "Credit Card",
    otherPaymentType: null,
    signedAmountCents: 22510,
    signedProcessingFeeCents: 573,
    paymentDate: `${DATE}T17:12:42Z`,
    status: "succeeded",
    isRefund: false,
    ...over,
  };
  return buildPaymentJournalEntry(p, PAY_M, { shopTimezone: "America/New_York" });
}

const card = () => payment({}); // 22510 gross / 573 fee
const cash = () => payment({ paymentId: "57900001", repairOrderId: 326300000, method: "Cash", signedAmountCents: 3689, signedProcessingFeeCents: 0 });
const tpp = () => payment({ paymentId: "57984574", repairOrderId: 328522334, method: "Other", otherPaymentType: "Tire Protection Plan", signedAmountCents: 19550, signedProcessingFeeCents: 0 });
const refund = () => payment({ paymentId: "58173686", repairOrderId: 327346069, signedAmountCents: -2513, signedProcessingFeeCents: 0, isRefund: true });
const manualPick = () => payment({ paymentId: "manual-330295704", repairOrderId: 330295704, signedAmountCents: 18900, signedProcessingFeeCents: 481, manual: true });

const sum = (lines: { postingType: string; amountCents: number }[], t: "Debit" | "Credit") =>
  lines.filter((l) => l.postingType === t).reduce((a, l) => a + l.amountCents, 0);

// ─── sales JE ────────────────────────────────────────────────────────────────

describe("buildDailyJournalEntries — sales JE", () => {
  it("itemizes Dr A/R per RO and aggregates credits per account (the AL JA-RO shape)", () => {
    const b = buildDailyJournalEntries(DATE, [laborRo(101, "152001", 10000), laborRo(102, "152002", 20000)], []);
    const s = b.sales!;
    expect(s.category).toBe("sales");
    expect(s.docNumber).toBe(`QTL-RO-${DATE}`);
    expect(s.txnDate).toBe(DATE);

    // 2 itemized A/R debits, RO-labelled.
    const debits = s.lines.filter((l) => l.postingType === "Debit");
    expect(debits).toHaveLength(2);
    expect(debits[0]).toMatchObject({ accountId: "235", amountCents: 10600, description: "RO 152001" });
    expect(debits[1]).toMatchObject({ accountId: "235", amountCents: 21200, description: "RO 152002" });

    // Credits aggregated per account: ONE labor line (30000), ONE tax line (1800).
    const credits = s.lines.filter((l) => l.postingType === "Credit");
    expect(credits).toHaveLength(2);
    expect(credits).toContainEqual(expect.objectContaining({ accountId: "275", amountCents: 30000, description: `Daily sales ${DATE}` }));
    expect(credits).toContainEqual(expect.objectContaining({ accountId: "250", amountCents: 1800 }));

    expect(s.balanced).toBe(true);
    expect(s.totalDebitsCents).toBe(31800);
    expect(s.totalCreditsCents).toBe(31800);
    expect(s.constituents).toEqual({ roIds: [101, 102], paymentIds: [] });
  });

  it("skips a $0 RO entirely (no line, not a constituent) — D4", () => {
    const b = buildDailyJournalEntries(DATE, [laborRo(101, "152001", 10000), zeroRo(103, "152003")], []);
    expect(b.sales!.constituents.roIds).toEqual([101]);
    expect(b.sales!.lines.filter((l) => l.postingType === "Debit")).toHaveLength(1);
  });

  it("a day with ONLY $0 ROs has no sales JE (null, never an empty JE)", () => {
    const b = buildDailyJournalEntries(DATE, [zeroRo(103, "152003")], []);
    expect(b.sales).toBeNull();
  });

  it("an unbalanced input draft propagates (fail closed — never silently dropped or 'fixed')", () => {
    const broken = laborRo(104, "152004", 10000);
    broken.je = { ...broken.je, lines: broken.je.lines.filter((l) => l.postingType !== "Credit"), balanced: false };
    const b = buildDailyJournalEntries(DATE, [laborRo(101, "152001", 10000), broken], []);
    expect(b.sales!.balanced).toBe(false);
    expect(b.sales!.totalDebitsCents).not.toBe(b.sales!.totalCreditsCents);
  });
});

// ─── payments + fees JEs ─────────────────────────────────────────────────────

describe("buildDailyJournalEntries — payments + fees JEs", () => {
  it("itemizes both sides per payment; splits the fee pair into the fees JE structurally (no dup, no drop)", () => {
    const perPayment = [card(), cash()];
    const b = buildDailyJournalEntries(DATE, [], perPayment);
    const p = b.payments!;
    const f = b.fees!;

    expect(p.docNumber).toBe(`QTL-PAY-${DATE}`);
    expect(f.docNumber).toBe(`QTL-FEE-${DATE}`);

    // payments JE: the two gross pairs only — no CC-fee account anywhere.
    expect(p.lines).toHaveLength(4);
    expect(p.lines.some((l) => l.accountId === "309")).toBe(false);
    expect(p.lines).toContainEqual(expect.objectContaining({ accountId: "366", postingType: "Debit", amountCents: 22510 }));
    expect(p.lines).toContainEqual(expect.objectContaining({ accountId: "235", postingType: "Credit", amountCents: 22510 }));
    expect(p.lines).toContainEqual(expect.objectContaining({ accountId: "366", postingType: "Debit", amountCents: 3689 }));
    expect(p.balanced).toBe(true);

    // fees JE: exactly the card's fee pair.
    expect(f.lines).toHaveLength(2);
    expect(f.lines).toContainEqual(expect.objectContaining({ accountId: "309", postingType: "Debit", amountCents: 573 }));
    expect(f.lines).toContainEqual(expect.objectContaining({ accountId: "366", postingType: "Credit", amountCents: 573 }));
    expect(f.balanced).toBe(true);

    // No dup / no drop: payments + fees lines === the per-payment lines, exactly.
    const flat = perPayment.flatMap((je) => je.lines);
    expect(p.lines.length + f.lines.length).toBe(flat.length);
    expect(sum(p.lines, "Debit") + sum(f.lines, "Debit")).toBe(sum(flat, "Debit"));
    expect(sum(p.lines, "Credit") + sum(f.lines, "Credit")).toBe(sum(flat, "Credit"));

    // Constituents: both payments moved money; only the card paid a fee.
    expect(p.constituents.paymentIds).toEqual(["57852813", "57900001"]);
    expect(f.constituents.paymentIds).toEqual(["57852813"]);
  });

  it("a contra payment books inside the payments JE on its own Dr account (D6)", () => {
    const b = buildDailyJournalEntries(DATE, [], [card(), tpp()]);
    const p = b.payments!;
    expect(p.lines).toContainEqual(expect.objectContaining({ accountId: "6834", postingType: "Debit", amountCents: 19550 }));
    expect(p.lines).toContainEqual(expect.objectContaining({ accountId: "235", postingType: "Credit", amountCents: 19550 }));
    expect(p.balanced).toBe(true);
  });

  it("a refund keeps its FLIPPED direction itemized — never netted against other payments", () => {
    const b = buildDailyJournalEntries(DATE, [], [card(), refund()]);
    const p = b.payments!;
    // A/R appears on BOTH sides: Cr (the card) and Dr (the refund) — both itemized.
    expect(p.lines).toContainEqual(expect.objectContaining({ accountId: "235", postingType: "Credit", amountCents: 22510 }));
    expect(p.lines).toContainEqual(expect.objectContaining({ accountId: "235", postingType: "Debit", amountCents: 2513 }));
    expect(p.lines).toContainEqual(expect.objectContaining({ accountId: "366", postingType: "Credit", amountCents: 2513 }));
    expect(p.balanced).toBe(true);
  });

  it("includes a manual method-pick (UUID-ish payment id) — the old per-RO identity skip is gone", () => {
    const b = buildDailyJournalEntries(DATE, [], [manualPick()]);
    expect(b.payments!.constituents.paymentIds).toEqual(["manual-330295704"]);
    expect(b.fees!.constituents.paymentIds).toEqual(["manual-330295704"]);
    expect(b.payments!.balanced).toBe(true);
    expect(b.fees!.lines).toContainEqual(expect.objectContaining({ accountId: "309", amountCents: 481 }));
  });

  it("no fee payments → fees JE is null; no payments at all → both null", () => {
    expect(buildDailyJournalEntries(DATE, [], [cash()]).fees).toBeNull();
    const empty = buildDailyJournalEntries(DATE, [], []);
    expect(empty.payments).toBeNull();
    expect(empty.fees).toBeNull();
    expect(empty.sales).toBeNull();
  });
});

// ─── determinism + guards + QBO compatibility ────────────────────────────────

describe("buildDailyJournalEntries — determinism, guards, QBO compatibility", () => {
  it("is deterministic regardless of input order (stable hashes depend on this)", () => {
    const sales = [laborRo(102, "152002", 20000), laborRo(101, "152001", 10000)];
    const pays = [refund(), tpp(), cash(), card()];
    const a = buildDailyJournalEntries(DATE, sales, pays);
    const b = buildDailyJournalEntries(DATE, [...sales].reverse(), [...pays].reverse());
    expect(a).toEqual(b as DailyJeBundle);
  });

  it("flags (never posts) a category over the line cap", () => {
    // 451 cash payments → 902 gross lines > the 900-line cap.
    const many = Array.from({ length: 451 }, (_, i) =>
      payment({ paymentId: String(60000000 + i), repairOrderId: 326300000 + i, method: "Cash", signedAmountCents: 1000 + i, signedProcessingFeeCents: 0 }),
    );
    const b = buildDailyJournalEntries(DATE, [], many);
    expect(b.payments!.lines.length).toBeGreaterThan(DAILY_LINE_CAP);
    expect(b.payments!.overLineCap).toBe(true);
    expect(b.payments!.balanced).toBe(true); // balanced is about money; the cap is a separate guard
  });

  it("its lines build a QBO JournalEntry payload without modification", () => {
    const b = buildDailyJournalEntries(DATE, [laborRo(101, "152001", 10000)], [card()]);
    for (const je of [b.sales!, b.payments!, b.fees!]) {
      const body = toQboJournalEntry({ docNumber: je.docNumber, txnDate: je.txnDate, privateNote: "QTL|test", lines: je.lines });
      expect(Array.isArray(body.Line)).toBe(true);
      expect(body.DocNumber).toBe(je.docNumber);
    }
  });
});
