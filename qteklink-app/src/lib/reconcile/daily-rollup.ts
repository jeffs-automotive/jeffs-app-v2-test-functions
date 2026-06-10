/**
 * §8 pure daily reconciliation roll-up. Given a business day's built SALE + PAYMENT
 * JE drafts, gate each, collect every §9 review item, and net the POSTABLE drafts'
 * lines per account — the QTL side of the daily "QTL vs Accounting Link" comparison.
 *
 * Pure TS (no DB): the DAL (`runDailyReconciliation`) fetches the day's drafts, calls
 * this, then persists `reviewItems` via `upsertReviewItem`. Signed net per account =
 * Σ(debit) − Σ(credit), so a balanced day nets to 0 across all accounts.
 */
import type { RoSaleSnapshot, SaleJournalEntry } from "@/lib/sales/sale-builder";
import type { PaymentJournalEntry } from "@/lib/payments/payment-je-builder";
import type { UpsertReviewItemInput } from "@/lib/dal/review-items";
import { gateSaleDraft, type SaleGateSettings } from "./sale-gate";
import { gatePaymentDraft } from "./payment-gate";

export interface SaleDraft {
  snapshot: RoSaleSnapshot;
  je: SaleJournalEntry;
}

export interface DayRollup {
  businessDate: string;
  /** ROs considered (every posting RO for the day). */
  saleCount: number;
  /** Payments considered (EXCLUDES benign-suppressed voids/zeros). */
  paymentCount: number;
  postableSales: number;
  postablePayments: number;
  /** Drafts that need a human (== reviewItems.length). */
  reviewCount: number;
  /** accountId → signed net cents (Dr − Cr) across POSTABLE drafts only. */
  netByAccount: Record<string, number>;
  /** Every §9 review item the gates emitted (the daily job persists these). */
  reviewItems: UpsertReviewItemInput[];
  /** The drafts that passed the gate — the daily job combines these into the day's
   *  category JEs and enqueues them into qteklink_daily_postings. */
  postableSaleDrafts: SaleDraft[];
  postablePaymentDrafts: PaymentJournalEntry[];
}

interface PostingLine {
  accountId: string;
  postingType: "Debit" | "Credit";
  amountCents: number;
}

export function rollupDay(
  businessDate: string,
  sales: SaleDraft[],
  payments: PaymentJournalEntry[],
  saleGateSettings: SaleGateSettings,
): DayRollup {
  const reviewItems: UpsertReviewItemInput[] = [];
  const netByAccount: Record<string, number> = {};
  const postableSaleDrafts: SaleDraft[] = [];
  const postablePaymentDrafts: PaymentJournalEntry[] = [];
  let postableSales = 0;
  let postablePayments = 0;

  const addLines = (lines: PostingLine[]) => {
    for (const l of lines) {
      const signed = l.postingType === "Debit" ? l.amountCents : -l.amountCents;
      netByAccount[l.accountId] = (netByAccount[l.accountId] ?? 0) + signed;
    }
  };

  for (const draft of sales) {
    const g = gateSaleDraft(draft.snapshot, draft.je, saleGateSettings);
    reviewItems.push(...g.reviewItems);
    if (g.postable) {
      postableSales++;
      postableSaleDrafts.push(draft);
      addLines(draft.je.lines);
    }
  }

  let paymentCount = 0;
  for (const je of payments) {
    const g = gatePaymentDraft(je);
    // A benign-suppressed payment (voided / zero) isn't "considered" for posting and
    // raises no review item — skip it from the counts entirely.
    if (je.suppressed && g.reviewItems.length === 0) continue;
    paymentCount++;
    reviewItems.push(...g.reviewItems);
    if (g.postable) {
      postablePayments++;
      postablePaymentDrafts.push(je);
      addLines(je.lines);
    }
  }

  return {
    businessDate,
    saleCount: sales.length,
    paymentCount,
    postableSales,
    postablePayments,
    reviewCount: reviewItems.length,
    netByAccount,
    reviewItems,
    postableSaleDrafts,
    postablePaymentDrafts,
  };
}
