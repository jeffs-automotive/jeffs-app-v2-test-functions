/**
 * PAYMENT JournalEntry builder (C6) — PURE TypeScript (no React/Supabase), so it's
 * directly unit-testable (the Fat-DAL business-logic layer; the DAL
 * `src/lib/dal/payment-je.ts` reads the C4 `qteklink_payment_state` projection +
 * mappings and calls this).
 *
 * Builds ONE per-payment JE draft (plan §5), TxnDate = the payment's date in the
 * shop's local timezone. The input is NORMALIZED (`PaymentForBuild`) and produced
 * by EITHER the C4 projection OR a manual method-pick (a paid RO with no payment
 * event — the RO snapshot shows `amountPaid` but not HOW; the user picks the
 * method + enters the CC fee for a card, plan §5). The builder is source-agnostic.
 *
 *   DEPOSIT route (Card / Cash / Check / any non-"Other" method):
 *     Dr Undeposited [366] = gross  / Cr A/R [235] = gross
 *     then (processing fee > 0, i.e. a card): Dr CC-Fees [309] = fee / Cr Undeposited [366] = fee
 *     → Undeposited nets to (gross − fee), the real deposit (flows into Make Deposits).
 *   NON-CASH route (method "Other"/OTH → `otherPaymentType`):
 *     Dr <mapped noncash_contra by name> = gross / Cr A/R [235] = gross   (no Undeposited, no fee)
 *   REFUND (signed amount NEGATIVE): the SAME route with Debit/Credit FLIPPED — money
 *     out, A/R restored — dated to the refund's own date.
 *   VOID (status 'voided'): SUPPRESSED — no JE. A reversal of an ALREADY-POSTED payment
 *     is the C7 desired-vs-posted diff's job, not the builder's (it can't see posted state).
 *
 * Money is integer cents throughout; a non-integer-cents input is suppressed (fail
 * closed). A missing mapping (undeposited / A/R / cc_fee / the non-cash account)
 * pushes an `unmapped` reason → the row routes to the resolution queue (§9) and is
 * never posted half-built (`balanced` is false unless every line is mapped and Σdr=Σcr).
 */
import { toShopLocalDate } from "@/lib/sales/sale-builder";

/** Normalized payment to post — from the C4 projection OR a manual method-pick. */
export interface PaymentForBuild {
  /** Tekmetric payment id (or a synthetic id for a manual method-pick). */
  paymentId: string;
  repairOrderId: number | null;
  /** Tekmetric `paymentType.name` (Credit Card / Cash / Check / Other / …) or the manual pick. */
  method: string;
  /** Tekmetric `otherPaymentType.name` — the non-cash sub-type when `method` is Other/OTH. */
  otherPaymentType: string | null;
  /** Signed integer cents: a payment is POSITIVE, a refund NEGATIVE. */
  signedAmountCents: number;
  /** CC processing fee (Tekmetric `applicationFee`), integer cents (0 for non-card). */
  signedProcessingFeeCents: number;
  /** ISO UTC timestamp — the TxnDate source (converted to the shop's local date). */
  paymentDate: string;
  /** Reduced payment status — 'voided' suppresses; anything else posts. */
  status: string;
  isRefund: boolean;
  /** True when this came from a manual method-pick (no Tekmetric event) — audit only. */
  manual?: boolean;
}

export interface ResolvedPaymentMappings {
  /** system/undeposited_funds [366]. */
  undepositedAccountId: string | null;
  /** system/accounts_receivable [235]. */
  arAccountId: string | null;
  /** system/cc_fee [309]. */
  ccFeeAccountId: string | null;
  /** noncash_payment_type/<otherPaymentType.name> mapped as a true CONTRA (role
   *  noncash_contra) → account id. */
  noncashAccountsByType: Record<string, string>;
  /** noncash_payment_type/<otherPaymentType.name> mapped as a DEPOSIT (role
   *  undeposited_funds — financing like Synchrony/Affirm) → the deposit account id
   *  (Undeposited Funds or a clearing Other-Current-Asset). Routes Dr <acct> / Cr A/R. */
  depositLikeAccountsByType: Record<string, string>;
}

export interface PaymentSettings {
  shopTimezone: string;
}

export interface PaymentJeLine {
  accountId: string;
  postingType: "Debit" | "Credit";
  amountCents: number;
  description: string;
}

export interface PaymentJournalEntry {
  paymentId: string;
  /** the Tekmetric RO this payment belongs to — the posting's subject (null only for a
   *  malformed payment with no RO; such a draft can't be enqueued as a posting). */
  repairOrderId: number | null;
  docNumber: string;
  txnDate: string;
  route: "deposit" | "non_cash" | "suppressed";
  lines: PaymentJeLine[];
  /** True when the payment should NOT be posted (voided / zero / corrupt) — no lines. */
  suppressed: boolean;
  /** Suppression reasons (e.g. 'voided', 'zero_amount', 'non_integer_cents'). */
  reasons: string[];
  /** Missing-mapping / unroutable reasons → resolution queue (§9). */
  unmapped: string[];
  /** True only when fully mapped, has lines, and Σ debits === Σ credits. */
  balanced: boolean;
  isRefund: boolean;
}

/** Methods that route to the NON-CASH path (matched case-insensitively against
 *  the Tekmetric paymentType name "Other" and its code "OTH"). */
const NONCASH_METHODS = new Set(["other", "oth"]);

function suppressed(
  p: PaymentForBuild,
  txnDate: string,
  reason: string,
): PaymentJournalEntry {
  return {
    paymentId: p.paymentId,
    repairOrderId: p.repairOrderId,
    docNumber: `PAY ${p.paymentId}`,
    txnDate,
    route: "suppressed",
    lines: [],
    suppressed: true,
    reasons: [reason],
    unmapped: [],
    balanced: false,
    isRefund: p.isRefund,
  };
}

export function buildPaymentJournalEntry(
  p: PaymentForBuild,
  m: ResolvedPaymentMappings,
  settings: PaymentSettings,
): PaymentJournalEntry {
  const docNumber = `PAY ${p.paymentId}`;
  const txnDate = toShopLocalDate(p.paymentDate, settings.shopTimezone);

  // Voided → not posted (a reversal of an already-posted payment is the C7 diff's
  // job). Case-insensitive so a reduced status variant can't slip through and post.
  if (p.status.trim().toLowerCase() === "voided") return suppressed(p, txnDate, "voided");

  // Money MUST be integer cents — never build a JE from corrupt money.
  if (
    !Number.isSafeInteger(p.signedAmountCents) ||
    !Number.isSafeInteger(p.signedProcessingFeeCents)
  ) {
    return suppressed(p, txnDate, "non_integer_cents");
  }

  const amt = Math.abs(p.signedAmountCents);
  if (amt === 0) return suppressed(p, txnDate, "zero_amount");

  const inflow = p.signedAmountCents > 0; // payment (true) vs refund (false)
  const fee = Math.abs(p.signedProcessingFeeCents);
  const desc =
    `${docNumber}` +
    (p.repairOrderId != null ? ` — RO ${p.repairOrderId}` : "") +
    (p.isRefund ? " (refund)" : "");

  const lines: PaymentJeLine[] = [];
  const unmapped: string[] = [];

  if (NONCASH_METHODS.has(p.method.trim().toLowerCase())) {
    const key = (p.otherPaymentType ?? "").trim();

    // FINANCING that DEPOSITS like a card (Synchrony/Affirm — mapped role undeposited_funds):
    // Dr <deposit acct> / Cr A/R (gross, flipped for a refund). NO auto-fee — Tekmetric
    // doesn't give the financing fee; the user enters it in QBO at reconcile (plan §5).
    const depositAcct = key ? m.depositLikeAccountsByType[key] ?? null : null;
    if (depositAcct) {
      if (!m.arAccountId) unmapped.push("accounts_receivable");
      if (m.arAccountId) {
        lines.push({ accountId: depositAcct, postingType: inflow ? "Debit" : "Credit", amountCents: amt, description: desc });
        lines.push({ accountId: m.arAccountId, postingType: inflow ? "Credit" : "Debit", amountCents: amt, description: desc });
      }
      return finalize(p, docNumber, txnDate, "deposit", lines, unmapped);
    }

    // TRUE NON-CASH: Dr <contra> / Cr A/R (flipped for a refund). No Undeposited, no fee.
    const contra = key ? m.noncashAccountsByType[key] ?? null : null;
    if (!contra) unmapped.push(`noncash:${key || "(none)"}`);
    if (!m.arAccountId) unmapped.push("accounts_receivable");
    if (contra && m.arAccountId) {
      lines.push({ accountId: contra, postingType: inflow ? "Debit" : "Credit", amountCents: amt, description: desc });
      lines.push({ accountId: m.arAccountId, postingType: inflow ? "Credit" : "Debit", amountCents: amt, description: desc });
    }
    return finalize(p, docNumber, txnDate, "non_cash", lines, unmapped);
  }

  // DEPOSIT: Dr Undeposited gross / Cr A/R gross (flipped for a refund);
  // then (card fee > 0) Dr CC-Fees / Cr Undeposited (nets the deposit).
  if (!m.undepositedAccountId) unmapped.push("undeposited_funds");
  if (!m.arAccountId) unmapped.push("accounts_receivable");
  if (m.undepositedAccountId && m.arAccountId) {
    lines.push({ accountId: m.undepositedAccountId, postingType: inflow ? "Debit" : "Credit", amountCents: amt, description: desc });
    lines.push({ accountId: m.arAccountId, postingType: inflow ? "Credit" : "Debit", amountCents: amt, description: desc });
  }
  // The CC fee applies to a PAYMENT only (cards). A refund's applicationFee is null
  // (fee=0) in practice; a refund that DOES carry a fee has no defined accounting
  // direction → FLAG it (fail closed → resolution queue) rather than silently drop
  // it or guess the Dr/Cr.
  if (fee > 0 && !inflow) {
    unmapped.push("refund_fee_unsupported");
  } else if (fee > 0) {
    if (!m.ccFeeAccountId) unmapped.push("cc_fee");
    if (m.ccFeeAccountId && m.undepositedAccountId) {
      lines.push({ accountId: m.ccFeeAccountId, postingType: "Debit", amountCents: fee, description: `${docNumber} — CC fee` });
      lines.push({ accountId: m.undepositedAccountId, postingType: "Credit", amountCents: fee, description: `${docNumber} — CC fee` });
    }
  }
  return finalize(p, docNumber, txnDate, "deposit", lines, unmapped);
}

function finalize(
  p: PaymentForBuild,
  docNumber: string,
  txnDate: string,
  route: "deposit" | "non_cash",
  lines: PaymentJeLine[],
  unmapped: string[],
): PaymentJournalEntry {
  let dr = 0;
  let cr = 0;
  for (const l of lines) {
    if (l.postingType === "Debit") dr += l.amountCents;
    else cr += l.amountCents;
  }
  return {
    paymentId: p.paymentId,
    repairOrderId: p.repairOrderId,
    docNumber,
    txnDate,
    route,
    lines,
    suppressed: false,
    reasons: [],
    unmapped,
    balanced: unmapped.length === 0 && lines.length > 0 && dr === cr,
    isRefund: p.isRefund,
  };
}
