/**
 * Late-payment redate queue DAL (resolution-workflow Part A — Chris's spec 2026-07-01)
 * — the payment analog of the RO date-move queue (`date-moves.ts`).
 *
 * A payment dated to a business day whose payments JE is ALREADY POSTED in QuickBooks
 * does not belong there (deposited JEs are immutable — QBO 6540): the payment's date
 * must be fixed in Tekmetric (void it, take it on a different day). Lifecycle
 * (`qteklink_payment_redates`):
 *
 *   pending  — detected; the payment is HELD OUT of the posted day's desired state
 *              (no correction stages, no 6540) and the DATE CHANGE ALERT recipients
 *              got ONE short email: "Void this payment: $X on RO #### — take it on a
 *              different day."
 *   approved — admin chose "post it to this day anyway": the hold lifts; the normal
 *              correction flow stages the update (deposit-locked days then go through
 *              the Retry/Accept resolution).
 *   resolved — the payment was voided / re-dated in Tekmetric (auto-detected from the
 *              void + payment webhooks via the projection) — Chris's auto-resolve.
 *
 * DETECTION + RESOLUTION (`syncPaymentRedates`) run inside the day reconcile (page
 * views re-reconcile live; the nightly sweep covers every posted day), so the queue
 * converges without anyone pressing anything.
 *
 * MULTI-TENANT: shopId server-derived; realmId from the bound connection. No silent
 * failures: DB errors throw; email failures never block the money path (notify.ts).
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { QboClientError } from "@/lib/qbo/errors";
import { findLatestPostedDaily } from "@/lib/dal/daily-postings";
import { sendQteklinkEmail } from "@/lib/dal/notify";
import { getShopSettings } from "@/lib/dal/settings";
import { fmtUsd } from "@/lib/format";
import type { DayPaymentDraft } from "@/lib/dal/day-drafts";

export type PaymentRedateStatus = "pending" | "approved" | "resolved";

export interface PaymentRedateRow {
  id: string;
  paymentId: number;
  tekmetricRoId: number | null;
  roNumber: string | null;
  customerName: string | null;
  amountCents: number;
  businessDate: string;
  status: PaymentRedateStatus;
  detectedAt: string;
  notifiedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  resolvedAt: string | null;
}

interface PaymentRedateDbRow {
  id: string;
  payment_id: number | string;
  tekmetric_ro_id: number | string | null;
  ro_number: string | null;
  customer_name: string | null;
  amount_cents: number | string;
  business_date: string;
  status: string;
  detected_at: string;
  notified_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  resolved_at: string | null;
}

const REDATE_SELECT =
  "id, payment_id, tekmetric_ro_id, ro_number, customer_name, amount_cents, business_date, status, detected_at, notified_at, approved_by, approved_at, resolved_at";

function mapRedate(r: PaymentRedateDbRow): PaymentRedateRow {
  const ro = r.tekmetric_ro_id == null ? null : Number(r.tekmetric_ro_id);
  return {
    id: r.id,
    paymentId: Number(r.payment_id),
    tekmetricRoId: Number.isSafeInteger(ro as number) ? ro : null,
    roNumber: r.ro_number,
    customerName: r.customer_name,
    amountCents: Number(r.amount_cents),
    businessDate: r.business_date,
    status: r.status as PaymentRedateStatus,
    detectedAt: r.detected_at,
    notifiedAt: r.notified_at,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    resolvedAt: r.resolved_at,
  };
}

/** All redates for the UI: open first, then recently-resolved (audit trail). */
export async function listPaymentRedates(
  shopId: number,
): Promise<{ realmId: string | null; open: PaymentRedateRow[]; recentlyResolved: PaymentRedateRow[] }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { realmId: null, open: [], recentlyResolved: [] };

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_payment_redates")
    .select(REDATE_SELECT)
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .order("detected_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`listPaymentRedates failed: ${error.message}`);

  const rows = ((data ?? []) as PaymentRedateDbRow[]).map(mapRedate);
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  return {
    realmId,
    open: rows.filter((m) => m.status === "pending" || m.status === "approved"),
    recentlyResolved: rows.filter((m) => m.status === "resolved" && Date.parse(m.resolvedAt ?? m.detectedAt) >= cutoff),
  };
}

/** PENDING redates for one business day — the HOLD the day-draft builder applies
 *  (the payment is excluded from the posted day's desired state until decided). */
export async function listPendingRedatePaymentIds(
  shopId: number,
  realmId: string,
  businessDate: string,
): Promise<Set<number>> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_payment_redates")
    .select("payment_id")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("business_date", businessDate)
    .eq("status", "pending");
  if (error) throw new Error(`listPendingRedatePaymentIds failed: ${error.message}`);
  return new Set(((data ?? []) as { payment_id: number | string }[]).map((r) => Number(r.payment_id)).filter(Number.isSafeInteger));
}

/** OPEN (pending/approved) redates for one business day — the day-attention list. */
export async function listOpenPaymentRedatesForDay(
  shopId: number,
  realmId: string,
  businessDate: string,
): Promise<PaymentRedateRow[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_payment_redates")
    .select(REDATE_SELECT)
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("business_date", businessDate)
    .in("status", ["pending", "approved"])
    .order("detected_at", { ascending: true });
  if (error) throw new Error(`listOpenPaymentRedatesForDay failed: ${error.message}`);
  return ((data ?? []) as PaymentRedateDbRow[]).map(mapRedate);
}

/** Admin escape hatch: "post it to this day anyway" (pending → approved; the hold lifts). */
export async function approvePaymentRedate(
  shopId: number,
  id: string,
  approvedBy: string,
): Promise<{ approved: boolean }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) throw new QboClientError("QuickBooks is not connected for this shop.", { kind: "reconnect_required" });
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_approve_payment_redate", {
    p_shop_id: shopId, p_realm_id: realmId, p_id: id, p_approved_by: approvedBy,
  });
  if (error) {
    if (error.code === "P0001") throw new QboClientError(error.message, { kind: "unknown" });
    throw new Error(`qteklink_approve_payment_redate failed: ${error.message}`);
  }
  return { approved: data === true };
}

export interface RedateSyncResult {
  /** Payment ids that JUST entered pending (the caller must drop them from the day's
   *  desired payments before bundling — the hold applies from THIS build, not the next). */
  newlyHeldPaymentIds: Set<number>;
  detected: number;
  autoResolved: number;
  emailed: boolean;
}

/** The redate line for one payment, in Chris's exact voice. */
function redateLine(p: { amountCents: number; roNumber: string | null; customerName: string | null; businessDate: string }): string {
  const who = p.roNumber
    ? `on RO ${p.roNumber}${p.customerName ? ` (${p.customerName})` : ""}`
    : p.customerName
      ? `from ${p.customerName}`
      : "(unattached payment)";
  return `Void this payment: ${fmtUsd(Math.abs(p.amountCents))} ${who} — take it on a different day. (It came in for ${p.businessDate}, which is already posted to QuickBooks.)`;
}

/**
 * Detect + auto-resolve late-payment redates for ONE business day. Runs inside the
 * day reconcile AFTER the drafts are built (page view + nightly sweep):
 *
 *   DETECT: a real (non-manual), non-voided payment in the day's build whose id is
 *   NOT in the live posted payments JE → upsert a pending redate; NEW rows get ONE
 *   consolidated email to the DATE CHANGE ALERT recipients + notified_at stamped.
 *
 *   AUTO-RESOLVE (Chris's spec — "watching for void webhooks and payment webhooks"):
 *   an OPEN redate whose payment is now voided/suppressed or has LEFT this day
 *   (re-dated) → resolved. An APPROVED redate whose payment made it into the live
 *   posted JE → resolved.
 *
 * No live posted payments JE (never-posted day) → nothing to detect; open rows for
 * the day are resolved (the premise disappeared, e.g. the JE was deleted).
 */
export async function syncPaymentRedates(
  shopId: number,
  realmId: string,
  businessDate: string,
  payments: DayPaymentDraft[],
  heldPayments: DayPaymentDraft[],
): Promise<RedateSyncResult> {
  const admin = createSupabaseAdminClient();
  const result: RedateSyncResult = { newlyHeldPaymentIds: new Set(), detected: 0, autoResolved: 0, emailed: false };

  const livePosted = await findLatestPostedDaily(shopId, realmId, businessDate, "payments");
  const liveIds = livePosted && livePosted.action !== "delete"
    ? new Set(livePosted.constituents.paymentIds.map(String))
    : null;

  // Open redates for THIS day (pending + approved).
  const { data: openRows, error: openErr } = await admin
    .from("qteklink_payment_redates")
    .select(REDATE_SELECT)
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("business_date", businessDate)
    .in("status", ["pending", "approved"]);
  if (openErr) throw new Error(`syncPaymentRedates (open) failed: ${openErr.message}`);
  const open = ((openRows ?? []) as PaymentRedateDbRow[]).map(mapRedate);
  const openByPayment = new Map(open.map((r) => [r.paymentId, r]));

  // The day's REAL payments (manual picks can't be redated — they're app records),
  // keyed by numeric payment id; held drafts included (their state still drives resolution).
  const all = [...payments, ...heldPayments];
  const byId = new Map<number, DayPaymentDraft>();
  for (const p of all) {
    if (p.input.manual === true) continue;
    const id = Number(p.input.paymentId);
    if (Number.isSafeInteger(id)) byId.set(id, p);
  }

  // ── AUTO-RESOLVE ──
  const resolve = async (id: string): Promise<void> => {
    const { error } = await admin.rpc("qteklink_resolve_payment_redate", {
      p_shop_id: shopId, p_realm_id: realmId, p_id: id,
    });
    if (error) throw new Error(`qteklink_resolve_payment_redate failed: ${error.message}`);
    result.autoResolved++;
  };
  for (const row of open) {
    const draft = byId.get(row.paymentId);
    const voidedOrGone = !draft || draft.je.suppressed === true; // re-dated off the day, or voided
    const postedAnyway = row.status === "approved" && liveIds !== null && liveIds.has(String(row.paymentId));
    if (liveIds === null || voidedOrGone || postedAnyway) {
      await resolve(row.id);
      openByPayment.delete(row.paymentId);
    }
  }

  // ── DETECT (only when a live posted payments JE exists) ──
  if (liveIds === null) return result;

  const fresh: PaymentRedateRow[] = [];
  for (const [paymentId, draft] of byId.entries()) {
    if (draft.je.suppressed === true) continue;           // voided/zero — nothing to redate
    if (liveIds.has(String(paymentId))) continue;          // already in the posted JE
    const existing = openByPayment.get(paymentId);
    if (existing?.status === "approved") continue;         // admin said post-anyway — hold lifted

    const { data, error } = await admin.rpc("qteklink_upsert_payment_redate", {
      p_shop_id: shopId,
      p_realm_id: realmId,
      p_payment_id: paymentId,
      p_tekmetric_ro_id: draft.input.repairOrderId ?? null,
      p_ro_number: draft.input.repairOrderNumber ?? null,
      p_customer_name: draft.input.customerName ?? draft.input.payerName ?? null,
      p_amount_cents: draft.input.signedAmountCents,
      p_business_date: businessDate,
    });
    if (error) throw new Error(`qteklink_upsert_payment_redate failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as { id: string; changed: boolean } | undefined;

    result.newlyHeldPaymentIds.add(paymentId);
    result.detected++;
    // Email rows never successfully notified: new detections, plus a pending row
    // whose earlier send failed/bounced (notified_at stays NULL → retried here).
    // An already-notified pending row stays quiet on nightly re-detects.
    const neverNotified = !existing || existing.notifiedAt == null;
    if (row && neverNotified) {
      fresh.push({
        id: row.id,
        paymentId,
        tekmetricRoId: draft.input.repairOrderId ?? null,
        roNumber: draft.input.repairOrderNumber ?? null,
        customerName: draft.input.customerName ?? draft.input.payerName ?? null,
        amountCents: draft.input.signedAmountCents,
        businessDate,
        status: "pending",
        detectedAt: new Date().toISOString(),
        notifiedAt: null,
        approvedBy: null,
        approvedAt: null,
        resolvedAt: null,
      });
    }
  }

  // ── ONE consolidated email for the fresh detections (Chris's wording per line) ──
  if (fresh.length > 0) {
    const { settings } = await getShopSettings(shopId);
    const lines = fresh.map((f) => `• ${redateLine(f)}`);
    const sent = await sendQteklinkEmail({
      to: settings.dateChangeAlertEmails,
      subject: fresh.length === 1
        ? "QTekLink: void + re-date a payment"
        : `QTekLink: void + re-date ${fresh.length} payments`,
      text: [
        ...lines,
        "",
        "Once the payment is voided and taken again on a different day, QTekLink clears this automatically — nothing else to do in the app.",
      ].join("\n"),
    });
    // Stamp regardless of send success? NO — stamp only when the send succeeded, so a
    // bounced/skipped email retries on the next reconcile (send failures never throw).
    if (sent) {
      result.emailed = true;
      for (const f of fresh) {
        const { error } = await admin.rpc("qteklink_mark_payment_redate_notified", {
          p_shop_id: shopId, p_realm_id: realmId, p_id: f.id,
        });
        if (error) throw new Error(`qteklink_mark_payment_redate_notified failed: ${error.message}`);
      }
    }
  }

  return result;
}
