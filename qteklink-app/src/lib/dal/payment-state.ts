/**
 * Payment-state projection DAL (C4) — read the payment-family events from the
 * append-only `qteklink_events` ledger for a shop's bound realm, run the pure
 * reducer, and upsert the desired state into `qteklink_payment_state`.
 *
 * Fat-DAL: the business logic is the PURE reducer in `@/lib/payments/reducer`
 * (unit-tested without mocks); this module is the thin DB seam. The nightly cron
 * (`runNightlySync`, C8) calls `reduceShopPaymentState` BEFORE the reconcile; C5/C6 read it.
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
 *
 * INCREMENTAL MODE (live-page performance, Chris 2026-06-12): the projection keeps a
 * per-(shop, realm) watermark (`qteklink_projection_state`) of the newest received_at
 * fully reduced. A normal (page-view) run probes for events NEWER than the watermark
 * minus a small overlap (ids only — no webhook bodies), then re-reduces ONLY the
 * touched payments from their FULL per-payment history — so a void arriving today for
 * a payment dated last week still lands on last week, and the result is byte-identical
 * to a full reduce for those payments. `opts.full` (the nightly verification net)
 * reduces everything and re-anchors the watermark. The watermark only ever advances
 * to a received_at actually OBSERVED (never "now"), and the advance RPC is monotonic.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import {
  reducePaymentEvents,
  type PaymentData,
  type PaymentEventInput,
} from "@/lib/payments/reducer";

// MUST be ≤ PostgREST's max_rows (1000 in supabase/config.toml AND the hosted
// default). If max_rows ever dropped BELOW this, PostgREST would silently cap each
// page and `batch.length < pageSize` would misread a capped page as the last one —
// permanently reducing a partial projection (audit 2026-06-12). Keep them equal or
// keep this smaller.
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
  /** "full" = whole ledger (first run / nightly net); "incremental" = only payments
   *  with events newer than the stored watermark were re-reduced. */
  mode: "full" | "incremental";
}

/** Re-reduce window behind the stored watermark — absorbs DB/app clock skew and
 *  insert-commit latency. Re-reducing an already-reduced payment is idempotent
 *  (full-history reduce + the monotonic upsert guard). */
const INCREMENTAL_OVERLAP_MS = 5 * 60 * 1000;
/** Chunk size for the touched-payments `.in()` re-read (bounded URL + row counts). */
const TOUCHED_CHUNK = 200;

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
 * Default = INCREMENTAL when a watermark exists (page views): probe for newer
 * events, re-reduce only the touched payments from full history. `opts.full`
 * forces the whole-ledger reduce (first run / the nightly verification net).
 * `opts` page sizing is for tests; production uses the module defaults.
 */
export async function reduceShopPaymentState(
  shopId: number,
  opts: { pageSize?: number; maxPages?: number; full?: boolean } = {},
): Promise<ReducePaymentStateResult> {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const maxPages = opts.maxPages ?? MAX_PAGES;

  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { realmId: null, events: 0, payments: 0, mode: opts.full ? "full" : "incremental" };

  const admin = createSupabaseAdminClient();

  // ── Watermark: incremental unless forced full (or no mark exists yet) ──
  let since: string | null = null;
  if (!opts.full) {
    const { data: wmRow, error: wmErr } = await admin
      .from("qteklink_projection_state")
      .select("last_reduced_received_at")
      .eq("shop_id", shopId)
      .eq("realm_id", realmId)
      .maybeSingle();
    if (wmErr) throw new Error(`reduceShopPaymentState (watermark) failed: ${wmErr.message}`);
    const wm = (wmRow as { last_reduced_received_at: string } | null)?.last_reduced_received_at ?? null;
    if (wm) {
      const parsed = Date.parse(wm);
      if (!Number.isFinite(parsed)) throw new Error(`reduceShopPaymentState: corrupt watermark (${wm})`);
      since = new Date(parsed - INCREMENTAL_OVERLAP_MS).toISOString();
    }
  }
  if (since !== null) {
    return reduceIncremental(admin, shopId, realmId, since, { pageSize, maxPages });
  }

  // ── FULL reduce (first run, or the nightly verification net) ──
  // Pin an upper-bound watermark so the paged read is a stable snapshot: the ledger
  // is append-only, so constraining every page to received_at <= cutoff means rows
  // arriving mid-read (received_at > cutoff) can't shift offsets (dupe/skip) — they
  // are simply reduced on the next run. Deterministic order: received_at, then id.
  const cutoff = new Date().toISOString();

  const rows = await pageEvents(admin, shopId, realmId, { lteCutoff: cutoff }, pageSize, maxPages);
  if (rows.length === 0) return { realmId, events: 0, payments: 0, mode: "full" };

  const payments = await reduceAndUpsert(admin, shopId, realmId, rows);
  // Anchor the watermark at the newest received_at actually OBSERVED (never "now" —
  // an in-flight insert could commit behind an unobserved mark; the overlap window
  // covers the rest). Rows are ordered ascending, so the last row is the newest.
  await advanceWatermark(admin, shopId, realmId, rows[rows.length - 1]!.received_at);
  return { realmId, events: rows.length, payments, mode: "full" };
}

/** Incremental: probe ids-only for new events, re-reduce ONLY touched payments. */
async function reduceIncremental(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  shopId: number,
  realmId: string,
  sinceIso: string,
  paging: { pageSize: number; maxPages: number },
): Promise<ReducePaymentStateResult> {
  // A) The newness probe — ids + received_at only (no webhook bodies).
  const probe: { payment_id: number | string; received_at: string }[] = [];
  for (let page = 0; ; page++) {
    if (page >= paging.maxPages) {
      throw new Error(
        `reduceShopPaymentState: incremental probe exceeded ${paging.maxPages} pages for shop ${shopId} — aborting rather than risk a partial reduction`,
      );
    }
    const fromIdx = page * paging.pageSize;
    const { data, error } = await admin
      .from("qteklink_events")
      .select("payment_id, received_at")
      .eq("shop_id", shopId)
      .eq("realm_id", realmId)
      .not("payment_id", "is", null)
      .gt("received_at", sinceIso)
      .order("received_at", { ascending: true })
      .order("id", { ascending: true })
      .range(fromIdx, fromIdx + paging.pageSize - 1);
    if (error) throw new Error(`reduceShopPaymentState (probe) failed: ${error.message}`);
    const batch = (data ?? []) as { payment_id: number | string; received_at: string }[];
    probe.push(...batch);
    if (batch.length < paging.pageSize) break;
  }
  if (probe.length === 0) return { realmId, events: 0, payments: 0, mode: "incremental" };

  const touched = [...new Set(probe.map((p) => {
    const id = toSafeId(p.payment_id);
    if (id === null) throw new Error(`reduceShopPaymentState: probe row has an invalid payment_id (${String(p.payment_id)})`);
    return id;
  }))];

  // B) FULL per-payment history for just the touched payments (chunked), so the
  // reduce is deterministic and byte-identical to a full reduce for those payments
  // — a void arriving today for a payment dated last week lands on last week.
  const cutoff = new Date().toISOString();
  const rows: EventDbRow[] = [];
  for (let i = 0; i < touched.length; i += TOUCHED_CHUNK) {
    const chunk = touched.slice(i, i + TOUCHED_CHUNK);
    rows.push(...(await pageEvents(admin, shopId, realmId, { lteCutoff: cutoff, paymentIds: chunk }, paging.pageSize, paging.maxPages)));
  }

  const payments = await reduceAndUpsert(admin, shopId, realmId, rows);
  await advanceWatermark(admin, shopId, realmId, probe[probe.length - 1]!.received_at);
  return { realmId, events: rows.length, payments, mode: "incremental" };
}

/** Paged, snapshot-stable event read (ascending received_at, id). */
async function pageEvents(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  shopId: number,
  realmId: string,
  filter: { lteCutoff: string; paymentIds?: number[] },
  pageSize: number,
  maxPages: number,
): Promise<EventDbRow[]> {
  const rows: EventDbRow[] = [];
  for (let page = 0; ; page++) {
    if (page >= maxPages) {
      throw new Error(
        `reduceShopPaymentState: event pagination exceeded ${maxPages} pages for shop ${shopId} — aborting rather than risk a partial reduction`,
      );
    }
    const fromIdx = page * pageSize;
    let q = admin
      .from("qteklink_events")
      .select("id, payment_id, tekmetric_ro_id, tekmetric_event_at, received_at, raw_body")
      .eq("shop_id", shopId)
      .eq("realm_id", realmId)
      .not("payment_id", "is", null)
      .lte("received_at", filter.lteCutoff);
    if (filter.paymentIds) q = q.in("payment_id", filter.paymentIds);
    const { data, error } = await q
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
  return rows;
}

/** Monotonic watermark advance (the RPC takes GREATEST — never moves backwards). */
async function advanceWatermark(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  shopId: number,
  realmId: string,
  watermark: string,
): Promise<void> {
  const { error } = await admin.rpc("qteklink_advance_projection_watermark", {
    p_shop_id: shopId,
    p_realm_id: realmId,
    p_watermark: watermark,
  });
  if (error) throw new Error(`qteklink_advance_projection_watermark failed: ${error.message}`);
}

/** Map rows → reducer inputs (fail closed on corrupt ids), reduce, upsert. */
async function reduceAndUpsert(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  shopId: number,
  realmId: string,
  rows: EventDbRow[],
): Promise<number> {
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
  if (states.length === 0) return 0;

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

  return count;
}
