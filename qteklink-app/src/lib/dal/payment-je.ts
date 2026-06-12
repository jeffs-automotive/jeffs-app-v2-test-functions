/**
 * PAYMENT mapping resolution + projection adapters (C6) — the seam between the C4
 * `qteklink_payment_state` projection / `qteklink_mappings` rows and the pure payment
 * builder (`@/lib/payments/payment-je-builder`): `resolvePaymentMappings` +
 * `stateRowToPayment` (both pure, consumed by the shared day-draft builder) and
 * `buildShopManualPaymentJe` (the single-RO manual method-pick build — currently
 * exercised only by its unit test; the daily pipeline reads stored manual picks through
 * `day-drafts` rather than calling this, so it has no production caller today). (The
 * per-payment `buildShopPaymentJe` DAL was retired with the per-RO/payment posting path
 * — the daily pipeline builds whole days.)
 *
 * MULTI-TENANT: `shopId` is server-derived; `realmId` from the bound connection
 * (`resolveRealmForShop`). `qteklink_payment_state` / `qteklink_mappings` are
 * service_role-only and service_role bypasses RLS → every query scopes shop_id +
 * realm_id. No silent failures: every DB error throws.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import {
  buildPaymentJournalEntry,
  type PaymentForBuild,
  type PaymentJournalEntry,
  type ResolvedPaymentMappings,
  type PaymentSettings,
} from "@/lib/payments/payment-je-builder";

const DEFAULT_SHOP_TZ = "America/New_York";

interface MappingRow {
  kind: string;
  source_key: string;
  qbo_account_id: string;
  posting_role: string;
}

export interface PaymentStateRow {
  payment_id: number | string;
  signed_amount_cents: number | string;
  signed_processing_fee_cents: number | string;
  status: string;
  is_refund: boolean;
  payment_type: string | null;
  other_payment_type: string | null;
  payment_date: string | null;
  repair_order_id: number | string | null;
}

export interface BuildPaymentResult {
  realmId: string | null;
  /** null when the shop has no connection OR the payment has no projection row. */
  je: PaymentJournalEntry | null;
}

/** A manual method-pick: a paid RO with no payment event — the user supplies how it
 *  was paid (+ the CC fee for a card). plan §5. */
export interface ManualPaymentInput {
  repairOrderId: number;
  /** "Credit Card" | "Cash" | "Check" | "Other" | … (drives deposit vs non-cash routing). */
  method: string;
  /** Non-cash sub-type (otherPaymentType.name) when method is Other/OTH. */
  otherPaymentType?: string | null;
  /** Gross amount paid, integer cents (from the RO's amountPaid). */
  amountCents: number;
  /** CC processing fee, integer cents — user-entered for a manually-classified card. */
  ccFeeCents?: number;
  /** ISO timestamp for the TxnDate (the paid date). */
  paymentDate: string;
  /** Stable id for the synthetic payment (DocNumber + idempotency). */
  manualId: string;
}

/** Parse a projection bigint money/id (number OR numeric string — PostgREST may
 *  serialize bigint as a string — incl. a leading '-' for a signed amount) to a
 *  SAFE integer. Throws on a non-safe value (fail closed; never coerce a
 *  string-bigint to NaN→suppressed or to 0). */
function safeCents(v: number | string, field: string, pid: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`payment-je: payment ${String(pid)} has a non-safe-integer ${field} (${String(v)})`);
  }
  return n;
}

/** Resolve a payment's QBO accounts from the shop's active mappings. */
export function resolvePaymentMappings(rows: MappingRow[]): ResolvedPaymentMappings {
  const m: ResolvedPaymentMappings = {
    undepositedAccountId: null,
    arAccountId: null,
    ccFeeAccountId: null,
    noncashAccountsByType: {},
    depositLikeAccountsByType: {},
  };
  for (const r of rows) {
    if (r.kind === "system") {
      if (r.source_key === "undeposited_funds") m.undepositedAccountId = r.qbo_account_id;
      else if (r.source_key === "accounts_receivable") m.arAccountId = r.qbo_account_id;
      else if (r.source_key === "cc_fee") m.ccFeeAccountId = r.qbo_account_id;
    } else if (r.kind === "noncash_payment_type") {
      // role 'undeposited_funds' = financing that deposits like a card (Synchrony/Affirm);
      // 'noncash_contra' = a true contra (warranty / internal).
      if (r.posting_role === "undeposited_funds") m.depositLikeAccountsByType[r.source_key] = r.qbo_account_id;
      else m.noncashAccountsByType[r.source_key] = r.qbo_account_id;
    }
  }
  return m;
}

/** Map a `qteklink_payment_state` projection row → the normalized PaymentForBuild.
 *  Pure; fail-closed on non-safe-integer money. Throws if payment_date is null. */
export function stateRowToPayment(row: PaymentStateRow): PaymentForBuild {
  if (!row.payment_date) {
    throw new Error(`stateRowToPayment: payment ${String(row.payment_id)} has no payment_date`);
  }
  return {
    paymentId: String(row.payment_id),
    repairOrderId: row.repair_order_id != null ? safeCents(row.repair_order_id, "repair_order_id", row.payment_id) : null,
    method: row.payment_type ?? "",
    otherPaymentType: row.other_payment_type,
    signedAmountCents: safeCents(row.signed_amount_cents, "signed_amount_cents", row.payment_id),
    signedProcessingFeeCents: safeCents(row.signed_processing_fee_cents, "signed_processing_fee_cents", row.payment_id),
    paymentDate: row.payment_date,
    status: row.status,
    isRefund: row.is_refund === true,
  };
}

async function loadMappings(shopId: number, realmId: string): Promise<ResolvedPaymentMappings> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_mappings")
    .select("kind, source_key, qbo_account_id, posting_role")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("active", true)
    .order("effective_from", { ascending: true });
  if (error) throw new Error(`payment-je (mappings) failed: ${error.message}`);
  return resolvePaymentMappings((data ?? []) as MappingRow[]);
}

/**
 * Build a PAYMENT JE from a MANUAL method-pick (a paid RO with no payment event;
 * the user supplied the method + CC fee). Returns {realmId:null, je:null} when the
 * shop has no connection. Throws (FAIL CLOSED) on any DB error.
 */
export async function buildShopManualPaymentJe(
  shopId: number,
  input: ManualPaymentInput,
  opts: { shopTimezone?: string } = {},
): Promise<BuildPaymentResult> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { realmId: null, je: null };

  const settings: PaymentSettings = { shopTimezone: opts.shopTimezone ?? DEFAULT_SHOP_TZ };
  const payment: PaymentForBuild = {
    paymentId: input.manualId,
    repairOrderId: input.repairOrderId,
    method: input.method,
    otherPaymentType: input.otherPaymentType ?? null,
    signedAmountCents: input.amountCents,
    signedProcessingFeeCents: input.ccFeeCents ?? 0,
    paymentDate: input.paymentDate,
    status: "succeeded",
    isRefund: false,
    manual: true,
  };

  const mappings = await loadMappings(shopId, realmId);
  return { realmId, je: buildPaymentJournalEntry(payment, mappings, settings) };
}
