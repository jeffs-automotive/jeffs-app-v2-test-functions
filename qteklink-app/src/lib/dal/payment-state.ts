/**
 * Payment-state projection DAL (C4) — read the payment-family events from the
 * append-only `qteklink_events` ledger for a shop's bound realm, run the pure
 * reducer, and upsert the desired state into `qteklink_payment_state`.
 *
 * Fat-DAL: the business logic is the PURE reducer in `@/lib/payments/reducer`
 * (unit-tested without mocks); this module is the thin DB seam. The nightly cron
 * (C8) calls `reduceShopPaymentState`; C5/C6 read the projection.
 *
 * MULTI-TENANT: `shopId` is server-derived; the QBO `realmId` is resolved from the
 * bound connection (`resolveRealmForShop`). `qteklink_events` /
 * `qteklink_payment_state` are service_role-only and service_role bypasses RLS, so
 * EVERY query is scoped by `shop_id` + `realm_id` (plan §3/§14). Writes go through
 * the SECURITY DEFINER `qteklink_upsert_payment_state` RPC.
 *
 * No silent failures (observability.md): every DB error throws; an unparseable
 * payment_id throws (fail closed, never a silent skip); and the event read is
 * SNAPSHOT-SAFE — it pins an upper-bound `received_at` watermark and pages within it
 * (the ledger is append-only, so the bounded set is stable for the whole read), with
 * a fail-closed page cap so a large ledger can never silently truncate into a partial
 * projection. Events arriving after the watermark are picked up on the next run.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import {
  reducePaymentEvents,
  type PaymentData,
  type PaymentEventInput,
} from "@/lib/payments/reducer";

const PAGE_SIZE = 1000;
// Fail-closed guard against an unbounded fetch loop (200k payment events is far
// beyond any real shop's ledger; hitting it means something is wrong → abort
// rather than reduce a partial set).
const MAX_PAGES = 200;

interface EventDbRow {
  id: string;
  payment_id: number | string;
  tekmetric_ro_id: number | string | null;
  tekmetric_event_at: string | null;
  received_at: string;
  raw_body: { data?: PaymentData } | null;
}

export interface ReducePaymentStateResult {
  realmId: string | null;
  /** Payment-family events read (within the watermark). */
  events: number;
  /** Rows actually inserted/updated by the upsert. The monotonic guard no-ops a
   *  stale row, so this can be < the number of distinct payment states computed. */
  payments: number;
}

/**
 * Parse a DB bigint id to a JS number, mirroring the C3 webhook's `numOrNull`:
 * accept a JSON integer or an all-digits string, and REJECT anything that isn't a
 * safe integer (a bigint above 2^53 would silently collide reducer groups). Returns
 * null on rejection — the caller decides whether that's fatal.
 */
function toSafeId(v: number | string | null): number | null {
  if (typeof v === "number") return Number.isSafeInteger(v) ? v : null;
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

/**
 * Recompute + upsert the payment-state projection for one shop's bound realm.
 * Returns {realmId:null, ...0} when the shop has no QBO connection (nothing to
 * reduce). Throws (FAIL CLOSED) on any DB / RPC error or a corrupt payment_id.
 *
 * `opts` (page sizing) is for tests; production uses the module defaults.
 */
export async function reduceShopPaymentState(
  shopId: number,
  opts: { pageSize?: number; maxPages?: number } = {},
): Promise<ReducePaymentStateResult> {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const maxPages = opts.maxPages ?? MAX_PAGES;

  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { realmId: null, events: 0, payments: 0 };

  const admin = createSupabaseAdminClient();

  // Pin an upper-bound watermark so the paged read is a stable snapshot: the ledger
  // is append-only, so constraining every page to received_at <= cutoff means rows
  // arriving mid-read (received_at > cutoff) can't shift offsets (dupe/skip) — they
  // are simply reduced on the next run. Deterministic order: received_at, then id.
  const cutoff = new Date().toISOString();

  const rows: EventDbRow[] = [];
  for (let page = 0; ; page++) {
    if (page >= maxPages) {
      throw new Error(
        `reduceShopPaymentState: event pagination exceeded ${maxPages} pages for shop ${shopId} — aborting rather than risk a partial reduction`,
      );
    }
    const fromIdx = page * pageSize;
    const { data, error } = await admin
      .from("qteklink_events")
      .select("id, payment_id, tekmetric_ro_id, tekmetric_event_at, received_at, raw_body")
      .eq("shop_id", shopId)
      .eq("realm_id", realmId)
      .not("payment_id", "is", null)
      .lte("received_at", cutoff)
      .order("received_at", { ascending: true })
      .order("id", { ascending: true })
      .range(fromIdx, fromIdx + pageSize - 1);
    if (error) {
      throw new Error(`reduceShopPaymentState (events) failed: ${error.message}`);
    }
    const batch = (data ?? []) as EventDbRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  if (rows.length === 0) return { realmId, events: 0, payments: 0 };

  const events: PaymentEventInput[] = rows.map((r) => {
    const paymentId = toSafeId(r.payment_id);
    if (paymentId === null) {
      // The .not(payment_id,is,null) filter guarantees a value, so a null here means
      // a corrupt / out-of-safe-range bigint — fail closed rather than drop the event.
      throw new Error(
        `reduceShopPaymentState: event ${r.id} has an invalid payment_id (${String(r.payment_id)})`,
      );
    }
    // tekmetric_ro_id is legitimately null on some events, but a PRESENT-but-unsafe
    // value is corruption that would silently drop RO correlation (C5/C6) — fail closed.
    let tekmetricRoId: number | null = null;
    if (r.tekmetric_ro_id !== null) {
      tekmetricRoId = toSafeId(r.tekmetric_ro_id);
      if (tekmetricRoId === null) {
        throw new Error(
          `reduceShopPaymentState: event ${r.id} has an invalid tekmetric_ro_id (${String(r.tekmetric_ro_id)})`,
        );
      }
    }
    return {
      id: r.id,
      paymentId,
      tekmetricRoId,
      tekmetricEventAt: r.tekmetric_event_at,
      receivedAt: r.received_at,
      data: r.raw_body?.data ?? {},
    };
  });

  const states = reducePaymentEvents(events);
  if (states.length === 0) return { realmId, events: rows.length, payments: 0 };

  const payload = states.map((s) => ({
    payment_id: s.paymentId,
    signed_amount_cents: s.signedAmountCents,
    signed_processing_fee_cents: s.signedProcessingFeeCents,
    status: s.status,
    is_refund: s.isRefund,
    payment_type: s.paymentType,
    other_payment_type: s.otherPaymentType,
    payment_date: s.paymentDate,
    voided_at: s.voidedAt,
    repair_order_id: s.repairOrderId,
    latest_event_at: s.latestEventAt,
    reduced_from_event_ids: s.reducedFromEventIds,
  }));

  const { data: count, error } = await admin.rpc("qteklink_upsert_payment_state", {
    p_shop_id: shopId,
    p_realm_id: realmId,
    p_states: payload,
  });
  if (error) {
    throw new Error(`qteklink_upsert_payment_state failed: ${error.message}`);
  }
  if (typeof count !== "number") {
    throw new Error(
      `qteklink_upsert_payment_state returned a non-numeric result: ${JSON.stringify(count)}`,
    );
  }

  return { realmId, events: rows.length, payments: count };
}
