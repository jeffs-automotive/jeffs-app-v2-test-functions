/**
 * Daily-JE builder (daily-JE rework step 1, docs/qteklink/daily-je-rework-plan.md §2) —
 * PURE TypeScript. Combines one business day's GATED per-RO/payment drafts into AL's
 * daily-category structure (up to 3 non-empty JEs), keeping QTekLink's deposit/contra
 * routing:
 *
 *   sales (`QTL-RO-<date>`)  — itemized Dr A/R per RO (desc "RO <number>", from the C5
 *     draft's debit lines) + credits AGGREGATED per account (income / sales tax / PTAL;
 *     desc "Daily sales <date>"). No discount lines — C5 nets discounts into income.
 *   payments (`QTL-PAY-<date>`) — every payment's `part:"gross"` lines, itemized BOTH
 *     sides, in payment order. Routes (deposit incl. deposits-like financing vs contra)
 *     and refund flips are the C6 builder's — preserved verbatim, NEVER netted (the same
 *     account may legitimately sit on both sides of the day).
 *   fees (`QTL-FEE-<date>`) — every payment's `part:"fee"` lines (Dr CC-Fees / Cr
 *     Undeposited), itemized per payment, matching AL's JA-FEE.
 *
 * The fee split is STRUCTURAL (the C6 `part` tag) — no line-position or description
 * matching, so fees can't be duplicated or dropped. A $0 RO contributes no lines and is
 * NOT a constituent (D4). An empty category returns null — never an empty JE. An
 * unbalanced input draft propagates (balanced:false) — fail closed, never silently
 * dropped or "fixed"; production callers feed only gate-postable drafts. Output is
 * deterministic regardless of input order (ROs by id, payments by id, aggregated credits
 * by account) — stable source hashes depend on it. `overLineCap` flags a category bigger
 * than QBO should be asked to swallow (→ review item, never posted).
 *
 * Money is integer cents; lines are QboJeLineInput-shape compatible.
 */
import type { SaleDraft } from "@/lib/reconcile/daily-rollup";
import type { PaymentJournalEntry } from "@/lib/payments/payment-je-builder";

export type DailyCategory = "sales" | "payments" | "fees";

export interface DailyJeLine {
  accountId: string;
  postingType: "Debit" | "Credit";
  amountCents: number;
  description: string;
}

/** The sorted source membership of a category JE — review-item correlation + the
 *  day-grain source hash (membership changes must trip the hash even when totals
 *  coincide). */
export interface DailyConstituents {
  roIds: number[];
  paymentIds: string[];
}

export interface DailyJournalEntry {
  category: DailyCategory;
  /** `<prefix>-<RO|PAY|FEE>-<businessDate>` — ≤ 18 chars, under QBO's 21-char cap. */
  docNumber: string;
  txnDate: string;
  lines: DailyJeLine[];
  totalDebitsCents: number;
  totalCreditsCents: number;
  balanced: boolean;
  constituents: DailyConstituents;
  /** True when the category exceeds DAILY_LINE_CAP — flag for review, never post. */
  overLineCap: boolean;
}

export interface DailyJeBundle {
  businessDate: string;
  sales: DailyJournalEntry | null;
  payments: DailyJournalEntry | null;
  fees: DailyJournalEntry | null;
}

/** Category → DocNumber tag (kept separate from the category enum — plan §6 D5). */
export const DAILY_DOC_TAG: Record<DailyCategory, "RO" | "PAY" | "FEE"> = {
  sales: "RO",
  payments: "PAY",
  fees: "FEE",
};

/** Jeff's volume is ~100–200 lines/day; QBO's practical cap is far above. A category
 *  bigger than this is almost certainly a build bug — flag it, don't post it. */
export const DAILY_LINE_CAP = 900;

/** Deterministic id ordering ("57852813" < "57984574"; mixed manual ids stable too). */
const byNumericish = (a: string, b: string): number => a.localeCompare(b, "en", { numeric: true });

function finalizeJe(
  category: DailyCategory,
  businessDate: string,
  docPrefix: string,
  lines: DailyJeLine[],
  constituents: DailyConstituents,
): DailyJournalEntry | null {
  if (lines.length === 0) return null;
  let dr = 0;
  let cr = 0;
  for (const l of lines) {
    if (l.postingType === "Debit") dr += l.amountCents;
    else cr += l.amountCents;
  }
  return {
    category,
    docNumber: `${docPrefix}-${DAILY_DOC_TAG[category]}-${businessDate}`,
    txnDate: businessDate,
    lines,
    totalDebitsCents: dr,
    totalCreditsCents: cr,
    balanced: dr === cr,
    constituents,
    overLineCap: lines.length > DAILY_LINE_CAP,
  };
}

function buildSalesJe(businessDate: string, sales: SaleDraft[], docPrefix: string): DailyJournalEntry | null {
  // A $0 RO yields no lines → not a constituent (D4). Order by RO id for determinism.
  const contributing = sales
    .filter((d) => d.je.lines.length > 0)
    .sort((a, b) => a.snapshot.repairOrderId - b.snapshot.repairOrderId);

  const debits: DailyJeLine[] = [];
  const creditByAccount = new Map<string, number>();
  for (const d of contributing) {
    for (const l of d.je.lines) {
      if (l.postingType === "Debit") {
        // Itemized per RO — the C5 debit description is already "RO <number>".
        debits.push({ accountId: l.accountId, postingType: "Debit", amountCents: l.amountCents, description: l.description });
      } else {
        creditByAccount.set(l.accountId, (creditByAccount.get(l.accountId) ?? 0) + l.amountCents);
      }
    }
  }
  const credits: DailyJeLine[] = [...creditByAccount.entries()]
    .filter(([, cents]) => cents !== 0)
    .sort(([a], [b]) => byNumericish(a, b))
    .map(([accountId, amountCents]) => ({
      accountId,
      postingType: "Credit" as const,
      amountCents,
      description: `Daily sales ${businessDate}`,
    }));

  return finalizeJe("sales", businessDate, docPrefix, [...debits, ...credits], {
    roIds: contributing.map((d) => d.snapshot.repairOrderId),
    paymentIds: [],
  });
}

function buildPaymentsAndFeesJes(
  businessDate: string,
  payments: PaymentJournalEntry[],
  docPrefix: string,
): { payments: DailyJournalEntry | null; fees: DailyJournalEntry | null } {
  const ordered = payments
    .filter((je) => !je.suppressed && je.lines.length > 0)
    .sort((a, b) => byNumericish(a.paymentId, b.paymentId));

  const grossLines: DailyJeLine[] = [];
  const feeLines: DailyJeLine[] = [];
  const grossIds: string[] = [];
  const feeIds: string[] = [];
  for (const je of ordered) {
    let hasGross = false;
    let hasFee = false;
    for (const l of je.lines) {
      const out: DailyJeLine = { accountId: l.accountId, postingType: l.postingType, amountCents: l.amountCents, description: l.description };
      if (l.part === "fee") {
        feeLines.push(out);
        hasFee = true;
      } else {
        grossLines.push(out);
        hasGross = true;
      }
    }
    if (hasGross) grossIds.push(je.paymentId);
    if (hasFee) feeIds.push(je.paymentId);
  }

  return {
    payments: finalizeJe("payments", businessDate, docPrefix, grossLines, { roIds: [], paymentIds: grossIds }),
    fees: finalizeJe("fees", businessDate, docPrefix, feeLines, { roIds: [], paymentIds: feeIds }),
  };
}

/**
 * Build the day's category JE bundle from the gate-postable drafts (rollupDay's
 * `postableSaleDrafts` / `postablePaymentDrafts`). Pure + deterministic.
 */
export function buildDailyJournalEntries(
  businessDate: string,
  postableSales: SaleDraft[],
  postablePayments: PaymentJournalEntry[],
  opts: { docPrefix?: string } = {},
): DailyJeBundle {
  const docPrefix = opts.docPrefix ?? "QTL";
  const sales = buildSalesJe(businessDate, postableSales, docPrefix);
  const { payments, fees } = buildPaymentsAndFeesJes(businessDate, postablePayments, docPrefix);
  return { businessDate, sales, payments, fees };
}
