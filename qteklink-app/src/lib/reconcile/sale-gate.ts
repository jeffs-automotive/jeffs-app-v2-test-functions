/**
 * §8 deterministic reconciliation gate — SALE side. Pure TS: given an RO's parsed
 * snapshot + its built SALE JournalEntry, decide whether the draft is POSTABLE and
 * emit a typed review item (the §9 resolution-queue shape) for every reason it isn't.
 * No DB, no side effects — the daily reconciliation job (C7) persists the drafts via
 * `upsertReviewItem` and the daily-approvals UI surfaces them.
 *
 * Checks (calibrated to 685 real ro_posted ROs — see the C7 §8 data validation):
 *   1. UNMAPPED / unbalanced — the builder already collected every missing mapping,
 *      negative total, unweighted parts, residual discount, or negative tax split into
 *      `je.unmapped`; the gate forwards them as ONE 'unmapped' review item per RO.
 *   2. tax_identity (HARD) — totalSales must equal labor+parts+sublet+fees−disc+taxes
 *      (held 685/685; a break means the snapshot is internally inconsistent → never post).
 *   3. tax_high (SOFT) — the sales-tax portion can't exceed rate×(full base) + 2¢. The
 *      real taxable base ≤ the full base, so 6% of the full base is the ceiling (held
 *      514/514). We do NOT lower-bound tax: exempt customers legitimately pay <6% and the
 *      payload has no per-line taxable flags, so a low-side check would false-flag them.
 *   4. negative_component — a posted sale's components are non-negative (the DAL enforces
 *      integer cents but not sign); a negative one is corrupt input → review.
 *   5. unbalanced — fail-closed catch-all: a non-postable draft with no specific reason
 *      above is surfaced rather than silently dropped from the day.
 *
 * postable = no review items AND the JE balances.
 */
import type { RoSaleSnapshot, SaleJournalEntry } from "@/lib/sales/sale-builder";
import type { UpsertReviewItemInput } from "@/lib/dal/review-items";

export interface SaleGateSettings {
  /** Sales-tax rate in basis points (PA = 600). Must match the builder's split rate. */
  salesTaxRateBps: number;
}

export interface SaleGateResult {
  postable: boolean;
  reviewItems: UpsertReviewItemInput[];
}

/** Rounding slack for the soft tax upper bound (cents). */
const TAX_TOLERANCE_CENTS = 2;

export function gateSaleDraft(
  snapshot: RoSaleSnapshot,
  je: SaleJournalEntry,
  settings: SaleGateSettings,
): SaleGateResult {
  const subjectRef = String(snapshot.repairOrderId);
  const reviewItems: UpsertReviewItemInput[] = [];

  // 1) Everything the builder couldn't post cleanly (unmapped account, negative total,
  //    unweighted parts, discount residual, negative tax split). One item per RO — the
  //    human resolves the RO, not each token; the full list rides in `detail`.
  if (je.unmapped.length > 0) {
    reviewItems.push({
      kind: "unmapped",
      subjectKind: "ro",
      subjectRef,
      detail: { reasons: [...je.unmapped], docNumber: je.docNumber },
    });
  }

  // 2) HARD identity — the snapshot's own totals must be self-consistent.
  const componentSum =
    snapshot.laborSales + snapshot.partsSales + snapshot.subletSales +
    snapshot.feeTotal - snapshot.discountTotal + snapshot.taxes;
  if (componentSum !== snapshot.totalSales) {
    reviewItems.push({
      kind: "tax_identity",
      subjectKind: "ro",
      subjectRef,
      detail: {
        totalSales: snapshot.totalSales,
        componentSum,
        differenceCents: snapshot.totalSales - componentSum,
        docNumber: je.docNumber,
      },
    });
  }

  // 3) SOFT upper bound — the sales-tax portion can't exceed rate × full base (+slack).
  const base =
    snapshot.laborSales + snapshot.partsSales + snapshot.subletSales +
    snapshot.feeTotal - snapshot.discountTotal;
  const baselineSalesTax = Math.round((settings.salesTaxRateBps / 10000) * base);
  const salesTaxCents = je.taxSplit.salesTaxCents;
  if (salesTaxCents > baselineSalesTax + TAX_TOLERANCE_CENTS) {
    reviewItems.push({
      kind: "tax_high",
      subjectKind: "ro",
      subjectRef,
      detail: {
        salesTaxCents,
        baselineSalesTaxCents: baselineSalesTax,
        rateBps: settings.salesTaxRateBps,
        baseCents: base,
        tireFeeCents: je.taxSplit.tireFeeCents,
        taxesCents: snapshot.taxes,
        docNumber: je.docNumber,
      },
    });
  }

  // 4) Defensive: a posted sale's components are non-negative (the DAL enforces integer
  //    cents but not sign). A negative component is corrupt input → review, never post.
  const negativeComponents = (
    [
      ["laborSales", snapshot.laborSales], ["partsSales", snapshot.partsSales],
      ["subletSales", snapshot.subletSales], ["feeTotal", snapshot.feeTotal],
      ["discountTotal", snapshot.discountTotal], ["taxes", snapshot.taxes],
    ] as const
  ).filter(([, v]) => v < 0).map(([k]) => k);
  if (negativeComponents.length > 0) {
    reviewItems.push({
      kind: "negative_component",
      subjectKind: "ro",
      subjectRef,
      detail: { negative: negativeComponents, docNumber: je.docNumber },
    });
  }

  // 5) Fail-closed catch-all: a non-postable draft with NO specific reason above would
  //    otherwise be silently dropped from the day (excluded from the net, never queued).
  if (reviewItems.length === 0 && !je.balanced) {
    reviewItems.push({
      kind: "unbalanced",
      subjectKind: "ro",
      subjectRef,
      detail: { totalDebitsCents: je.totalDebitsCents, totalCreditsCents: je.totalCreditsCents, docNumber: je.docNumber },
    });
  }

  return { postable: reviewItems.length === 0 && je.balanced, reviewItems };
}
