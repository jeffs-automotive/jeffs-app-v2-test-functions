/**
 * Manual-payments DAL (C6) — the method-pick storage. When a paid RO has no
 * `payment_made` event (the RO snapshot shows `amountPaid` but not HOW it was
 * paid), the user classifies it: method + CC fee. `recordManualPayment` persists
 * the pick (one per RO; re-classify replaces) via the SECURITY DEFINER RPC;
 * `listManualPayments` reads them back so the C6 payment-JE builder
 * (`buildShopManualPaymentJe`) can post each like a real payment.
 *
 * Fat-DAL: pure TS, unit-testable. MULTI-TENANT: shopId server-derived; realmId from
 * the bound connection; `qteklink_manual_payments` is service_role-only (writes via
 * the RPC). No silent failures: every DB error throws; a non-safe-integer money
 * value read back fails closed.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { RO_POSTING_EVENT_KINDS } from "@/lib/events/kinds";
import { QboClientError } from "@/lib/qbo/errors";

export interface RecordManualPaymentInput {
  repairOrderId: number;
  /** paymentType: Credit Card / Cash / Check / Other. */
  method: string;
  /** Non-cash sub-type (otherPaymentType.name) when method is Other/OTH. */
  otherPaymentType?: string | null;
  /** User-entered CC fee, integer cents (card). The GROSS amount + paid date are NOT
   *  taken from the client — they are server-derived from the RO's posting snapshot. */
  ccFeeCents?: number;
}

/** Parse a money value (number or all-digits string) → integer cents, else null. */
function parseCents(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isSafeInteger(n) ? n : null;
}

export interface ManualPaymentRow {
  id: string;
  repairOrderId: number;
  method: string;
  otherPaymentType: string | null;
  amountCents: number;
  ccFeeCents: number;
  paymentDate: string;
  createdBy: string;
}

interface ManualPaymentDbRow {
  id: string;
  repair_order_id: number | string;
  method: string;
  other_payment_type: string | null;
  amount_cents: number | string;
  cc_fee_cents: number | string;
  payment_date: string;
  created_by: string;
}

/** Parse a DB bigint (number or all-digits string) → safe integer, else throw. */
function safeInt(v: number | string, field: string, id: string): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`listManualPayments: manual payment ${id} has a non-safe-integer ${field} (${String(v)})`);
  }
  return n;
}

/**
 * Record (upsert) a manual-payment pick for a paid RO with no payment event.
 *
 * The GROSS amount + paid date are SERVER-DERIVED from the RO's latest posting
 * snapshot (`amountPaid` / `postedDate`) — never trusted from the client (a tampered
 * amount would mis-post A/R). The pick is also ANTI-JOINED against the real payment
 * projection: if `qteklink_payment_state` already has a live (non-voided) payment for
 * the RO, the manual pick is REJECTED (it would double-post beside the real payment;
 * resolve the real payment instead). Fails closed when the shop has no connection.
 * Throws on DB error. Returns the id.
 */
export async function recordManualPayment(
  shopId: number,
  input: RecordManualPaymentInput,
  createdBy: string,
): Promise<{ id: string }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) {
    throw new QboClientError("QuickBooks is not connected for this shop.", { kind: "reconnect_required" });
  }

  // The CC fee is the ONE user-supplied money value — validate it at the DAL trust
  // boundary too (the action also validates): a safe, non-negative whole-cent integer.
  const ccFeeCents = input.ccFeeCents ?? 0;
  if (!Number.isSafeInteger(ccFeeCents) || ccFeeCents < 0) {
    throw new QboClientError(`A CC fee must be a non-negative whole number of cents (got ${String(input.ccFeeCents)}).`, { kind: "unknown" });
  }

  const admin = createSupabaseAdminClient();

  // (1) SERVER-DERIVE the gross amount + paid date from the RO's latest posting snapshot.
  const { data: evRows, error: evErr } = await admin
    .from("qteklink_events")
    .select("raw_body")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("tekmetric_ro_id", input.repairOrderId)
    .in("event_kind", [...RO_POSTING_EVENT_KINDS])
    .order("tekmetric_event_at", { ascending: false, nullsFirst: false })
    .order("received_at", { ascending: false })
    .limit(1);
  if (evErr) throw new Error(`recordManualPayment (RO snapshot) failed: ${evErr.message}`);
  const ro = ((evRows ?? [])[0] as { raw_body: { data?: Record<string, unknown> } | null } | undefined)?.raw_body?.data;
  if (!ro) {
    throw new QboClientError(`RO ${input.repairOrderId} has no posting snapshot — it can't be manually classified yet.`, { kind: "unknown" });
  }
  const amountCents = parseCents(ro.amountPaid);
  if (amountCents === null || amountCents <= 0) {
    throw new QboClientError(`RO ${input.repairOrderId} shows no amount paid (amountPaid=${String(ro.amountPaid)}).`, { kind: "unknown" });
  }
  const paymentDate = typeof ro.postedDate === "string" && ro.postedDate.length > 0 ? ro.postedDate : null;
  if (!paymentDate) {
    throw new QboClientError(`RO ${input.repairOrderId} has no posted date.`, { kind: "unknown" });
  }

  // (2) ANTI-JOIN: a manual pick must NOT coexist with a real payment for the same RO.
  const { data: pmRows, error: pmErr } = await admin
    .from("qteklink_payment_state")
    .select("payment_id")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("repair_order_id", input.repairOrderId)
    .is("voided_at", null)
    .limit(1);
  if (pmErr) throw new Error(`recordManualPayment (anti-join) failed: ${pmErr.message}`);
  if ((pmRows ?? []).length > 0) {
    throw new QboClientError(
      `RO ${input.repairOrderId} already has a real payment — a manual pick would double-post. Resolve the real payment instead.`,
      { kind: "unknown" },
    );
  }

  // (3) Persist the pick with the SERVER-DERIVED amount + date.
  const { data, error } = await admin.rpc("qteklink_record_manual_payment", {
    p_shop_id: shopId,
    p_realm_id: realmId,
    p_repair_order_id: input.repairOrderId,
    p_method: input.method,
    p_other_payment_type: input.otherPaymentType ?? null,
    p_amount_cents: amountCents,
    p_cc_fee_cents: ccFeeCents,
    p_payment_date: paymentDate,
    p_created_by: createdBy,
  });
  if (error) {
    // P0001 = a deliberate validation rejection from the RPC.
    if (error.code === "P0001") throw new QboClientError(error.message, { kind: "unknown" });
    throw new Error(`qteklink_record_manual_payment failed: ${error.message}`);
  }
  if (typeof data !== "string") {
    throw new Error(`qteklink_record_manual_payment returned a non-uuid result: ${JSON.stringify(data)}`);
  }
  return { id: data };
}

/**
 * List the manual-payment picks for a shop's bound realm. Returns
 * {realmId:null, manualPayments:[]} when the shop has no connection. Throws on DB error.
 */
export async function listManualPayments(
  shopId: number,
): Promise<{ realmId: string | null; manualPayments: ManualPaymentRow[] }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { realmId: null, manualPayments: [] };

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_manual_payments")
    .select("id, repair_order_id, method, other_payment_type, amount_cents, cc_fee_cents, payment_date, created_by")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .order("payment_date", { ascending: true });
  if (error) throw new Error(`listManualPayments failed: ${error.message}`);

  const manualPayments = ((data ?? []) as ManualPaymentDbRow[]).map((r) => ({
    id: r.id,
    repairOrderId: safeInt(r.repair_order_id, "repair_order_id", r.id),
    method: r.method,
    otherPaymentType: r.other_payment_type,
    amountCents: safeInt(r.amount_cents, "amount_cents", r.id),
    ccFeeCents: safeInt(r.cc_fee_cents, "cc_fee_cents", r.id),
    paymentDate: r.payment_date,
    createdBy: r.created_by,
  }));
  return { realmId, manualPayments };
}
