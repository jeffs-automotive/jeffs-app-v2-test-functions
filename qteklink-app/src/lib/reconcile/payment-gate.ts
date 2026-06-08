/**
 * §8 deterministic reconciliation gate — PAYMENT side. Pure TS: given a built
 * PAYMENT JournalEntry (C6 `buildPaymentJournalEntry`), decide whether it's POSTABLE
 * and emit a §9 review item for every reason it isn't. No DB — the daily job persists.
 *
 * Suppression is NOT always an error:
 *   - 'voided' / 'zero_amount' → a legitimate non-posting payment → NOT postable, NO
 *     review item (nothing to resolve; the void reversal of an already-posted payment
 *     is the desired-vs-posted diff's job, not the gate's).
 *   - 'non_integer_cents' → corrupt money → a 'payment_corrupt' review item.
 * A missing mapping / unroutable fee (`unmapped`) → an 'unmapped' review item.
 *
 * postable = not suppressed AND no review items AND the JE balances.
 */
import type { PaymentJournalEntry } from "@/lib/payments/payment-je-builder";
import type { UpsertReviewItemInput } from "@/lib/dal/review-items";

export interface PaymentGateResult {
  postable: boolean;
  reviewItems: UpsertReviewItemInput[];
}

/** Suppression reasons that are NORMAL (no human action) vs a data problem. */
const BENIGN_SUPPRESSIONS = new Set(["voided", "zero_amount"]);

export function gatePaymentDraft(je: PaymentJournalEntry): PaymentGateResult {
  const subjectRef = je.paymentId;
  const reviewItems: UpsertReviewItemInput[] = [];

  if (je.suppressed) {
    // Only a NON-benign suppression (corrupt money) needs a human; voided/zero just don't post.
    const problems = je.reasons.filter((r) => !BENIGN_SUPPRESSIONS.has(r));
    if (problems.length > 0) {
      reviewItems.push({
        kind: "payment_corrupt",
        subjectKind: "payment",
        subjectRef,
        detail: { reasons: [...je.reasons], docNumber: je.docNumber },
      });
    }
    return { postable: false, reviewItems };
  }

  // Missing mapping (undeposited / A/R / cc_fee / non-cash account) or an unroutable
  // refund fee → resolution queue.
  if (je.unmapped.length > 0) {
    reviewItems.push({
      kind: "unmapped",
      subjectKind: "payment",
      subjectRef,
      detail: { reasons: [...je.unmapped], docNumber: je.docNumber, route: je.route },
    });
  }

  // Fail-closed catch-all: a non-suppressed, non-postable draft with no specific reason
  // would otherwise be silently dropped (excluded from the net, never queued).
  if (reviewItems.length === 0 && !je.balanced) {
    reviewItems.push({
      kind: "unbalanced",
      subjectKind: "payment",
      subjectRef,
      detail: { docNumber: je.docNumber, route: je.route },
    });
  }

  return { postable: reviewItems.length === 0 && je.balanced, reviewItems };
}
