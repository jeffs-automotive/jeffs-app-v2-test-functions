/**
 * Payment-state reducer (C4) — PURE TypeScript, no React / Supabase imports, so
 * it's directly unit-testable (the Fat-DAL "business logic" layer; the projection
 * DAL `src/lib/dal/payment-state.ts` fetches events, calls this, and upserts).
 *
 * It consumes payment-family rows from the append-only `qteklink_events` ledger
 * and projects the current DESIRED state of each payment — ONE state per
 * `payment_id`. A payment is recomputed from ALL of its events every run, so the
 * result is order-independent and idempotent (re-reducing yields the same state).
 *
 * Model (empirically verified, plan §1/§3/§5 — 627 real events):
 *   - Ordering: `tekmetric_event_at` asc, tie-break `received_at` asc, then event
 *     `id`. Fallback: when `tekmetric_event_at` is null, the event is ordered by
 *     `received_at` (always present). A VOID reuses the original payment's date, so
 *     `tekmetric_event_at` TIES — `received_at` (always later for the void) breaks it.
 *   - `voided` is TERMINAL: once any event voids the payment, a later SUCCEEDED
 *     can't un-void it. `voided_at` = the EARLIEST observed void (min received_at).
 *   - Immutable facts (amount, fee, type, RO, date) hydrate from whichever event
 *     carries them — so even if the void arrives first, the fee/type still fill in
 *     from the later SUCCEEDED.
 *   - `signed_amount_cents` keeps the SOURCE sign: refund negative; a void KEEPS
 *     its positive face value (status=voided + voided_at drive the C6 reversal).
 *   - `signed_processing_fee_cents` = `applicationFee` (the CC fee), 0 when null.
 *
 * Timestamps — business vs observed (the void event reuses the original
 * `paymentDate`, so its `tekmetric_event_at` is the PAYMENT time, not the void time):
 *   - `paymentDate`     = business event time (`tekmetric_event_at`).
 *   - `voided_at`       = the void event's `received_at` (when WE observed the void —
 *                         the only truthful "when voided" signal Tekmetric gives us).
 *   - `latest_event_at` = MAX `received_at` (latest OBSERVED activity — drives C8's
 *                         settle window; a void received days late must advance it).
 *
 * De-dup: events are folded once per `qteklink_events.id` (a replayed/paginated
 * duplicate ledger row collapses). Genuinely-distinct events (different id) all fold.
 */

/** The slice of `raw_body.data` (the Tekmetric payment object) the reducer reads. */
export interface PaymentData {
  amount?: number | null; // integer cents, source-signed (refund negative)
  applicationFee?: number | null; // CC processing fee cents; null for cash/OTH/refund
  refund?: boolean | null;
  voided?: boolean | null;
  paymentType?: { code?: string | null; name?: string | null } | null;
  otherPaymentType?: { name?: string | null } | null;
}

/** One payment-family event row (the columns + body the reducer consumes). */
export interface PaymentEventInput {
  /** qteklink_events.id (uuid) — audit trail, de-dup key, + final ordering tie-break. */
  id: string;
  /** data.id — the payment id (a refund has its OWN id; a void reuses the original's). */
  paymentId: number;
  /** data.repairOrderId — correlation to the RO sale (C5/C6). */
  tekmetricRoId: number | null;
  /** Parsed event time (nullable) — the primary ordering key + the business payment date. */
  tekmetricEventAt: string | null;
  /** received_at — NOT NULL; the tie-break, the ordering fallback, + the observed clock. */
  receivedAt: string;
  /** raw_body.data. */
  data: PaymentData;
}

export type PaymentStatus = "succeeded" | "voided";

/** The projected desired state for ONE payment (strict plan §3 column set). */
export interface PaymentState {
  paymentId: number;
  signedAmountCents: number;
  signedProcessingFeeCents: number;
  status: PaymentStatus;
  isRefund: boolean;
  paymentType: string | null;
  otherPaymentType: string | null;
  paymentDate: string | null; // ISO — the payment's business date (tekmetric_event_at)
  voidedAt: string | null; // ISO — observed time of the first voiding event (null unless voided)
  repairOrderId: number | null;
  latestEventAt: string | null; // ISO — max received_at (latest observed activity)
  reducedFromEventIds: string[]; // qteklink_events.id values, deduped, in fold order
}

function parseMs(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function toIso(s: string | null | undefined): string | null {
  const t = parseMs(s);
  return t === null ? null : new Date(t).toISOString();
}

/** Effective ordering time in ms: the business event time, else received_at. */
function effectiveMs(e: PaymentEventInput): number {
  return parseMs(e.tekmetricEventAt) ?? parseMs(e.receivedAt) ?? 0;
}

/** Deterministic order: effective time → received_at → event id (all ascending).
 *  The received_at tie-break is load-bearing: a void reuses the original payment's
 *  `tekmetric_event_at`, so effective time TIES and received_at is what orders the
 *  void after the original. */
function compareEvents(a: PaymentEventInput, b: PaymentEventInput): number {
  const ea = effectiveMs(a);
  const eb = effectiveMs(b);
  if (ea !== eb) return ea - eb;
  const ra = parseMs(a.receivedAt) ?? 0;
  const rb = parseMs(b.receivedAt) ?? 0;
  if (ra !== rb) return ra - rb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Reduce ALL events of a SINGLE payment id into its desired state. Throws on an
 * empty list, on mixed payment ids (misuse — the caller groups first), or on an
 * unparseable received_at (corruption — fail closed, never silently mis-order).
 */
export function reducePayment(events: PaymentEventInput[]): PaymentState {
  const sorted = [...events].sort(compareEvents);
  const first = sorted[0];
  if (first === undefined) {
    throw new Error("reducePayment: no events to reduce");
  }
  const paymentId = first.paymentId;

  const state: PaymentState = {
    paymentId,
    signedAmountCents: 0,
    signedProcessingFeeCents: 0,
    status: "succeeded",
    isRefund: false,
    paymentType: null,
    otherPaymentType: null,
    paymentDate: null,
    voidedAt: null,
    repairOrderId: null,
    latestEventAt: null,
    reducedFromEventIds: [],
  };
  let amountSet = false;
  let feeSet = false;
  let maxReceivedMs = -Infinity;
  let minVoidReceivedMs = Infinity;
  const seen = new Set<string>();

  for (const e of sorted) {
    // All events must belong to this payment (reducePayment is single-payment).
    if (e.paymentId !== paymentId) {
      throw new Error(
        `reducePayment: mixed payment ids (${paymentId} vs ${e.paymentId}) — group by payment id first`,
      );
    }
    // Collapse a replayed / paginated-duplicate ledger row (same qteklink_events.id).
    if (seen.has(e.id)) continue;
    seen.add(e.id);

    // received_at is the NOT-NULL ingestion clock; an unparseable one is corruption
    // → fail closed rather than degrade to epoch and mis-order / break the DB CHECK.
    const rMs = parseMs(e.receivedAt);
    if (rMs === null) {
      throw new Error(
        `reducePayment: event ${e.id} has an unparseable received_at (${e.receivedAt})`,
      );
    }
    const rIso = new Date(rMs).toISOString();

    state.reducedFromEventIds.push(e.id);
    const d = e.data ?? {};

    // latest_event_at = latest OBSERVED activity (max received_at), independent of
    // business-time ordering (a void received late carries a stale event time).
    if (rMs > maxReceivedMs) {
      maxReceivedMs = rMs;
      state.latestEventAt = rIso;
    }

    // Immutable facts: fill from the first event that carries each — so a void that
    // arrives first (and lacks the fee/type) still gets them from the later SUCCEEDED,
    // and a true value is never clobbered by a later null.
    if (!amountSet && typeof d.amount === "number") {
      // Cents must be a safe integer — a non-integer or > 2^53 value would corrupt
      // (round) before the bigint cast. Fail closed rather than store a wrong amount.
      if (!Number.isSafeInteger(d.amount)) {
        throw new Error(`reducePayment: event ${e.id} has a non-safe-integer amount (${d.amount})`);
      }
      state.signedAmountCents = d.amount;
      amountSet = true;
    }
    if (!feeSet && typeof d.applicationFee === "number") {
      if (!Number.isSafeInteger(d.applicationFee)) {
        throw new Error(
          `reducePayment: event ${e.id} has a non-safe-integer applicationFee (${d.applicationFee})`,
        );
      }
      state.signedProcessingFeeCents = d.applicationFee;
      feeSet = true;
    }
    if (state.repairOrderId === null && typeof e.tekmetricRoId === "number") {
      state.repairOrderId = e.tekmetricRoId;
    }
    if (state.paymentType === null && d.paymentType?.code) {
      state.paymentType = d.paymentType.code;
    }
    if (state.otherPaymentType === null && d.otherPaymentType?.name) {
      state.otherPaymentType = d.otherPaymentType.name;
    }
    if (state.paymentDate === null) {
      const pd = toIso(e.tekmetricEventAt);
      if (pd) state.paymentDate = pd;
    }

    if (d.refund === true) state.isRefund = true;

    // voided is TERMINAL; voided_at = the EARLIEST observed void (min received_at
    // among void events) — independent of business-time sort order, never un-set by
    // a later succeeded.
    if (d.voided === true) {
      state.status = "voided";
      if (rMs < minVoidReceivedMs) {
        minVoidReceivedMs = rMs;
        state.voidedAt = rIso;
      }
    }
  }

  // Invariant guard (matches the DB CHECK: voided ⇒ voided_at NOT NULL). With the
  // received_at fail-closed above this is unreachable, but keep it belt-and-suspenders.
  if (state.status === "voided" && state.voidedAt === null) {
    state.voidedAt = state.latestEventAt;
  }

  return state;
}

/**
 * Group events by payment id, reduce each, and return the states ordered by
 * payment id (deterministic for stable upserts + tests). [] for no events.
 */
export function reducePaymentEvents(events: PaymentEventInput[]): PaymentState[] {
  const groups = new Map<number, PaymentEventInput[]>();
  for (const e of events) {
    const g = groups.get(e.paymentId);
    if (g) g.push(e);
    else groups.set(e.paymentId, [e]);
  }
  const states: PaymentState[] = [];
  for (const evs of groups.values()) states.push(reducePayment(evs));
  states.sort((a, b) => a.paymentId - b.paymentId);
  return states;
}
