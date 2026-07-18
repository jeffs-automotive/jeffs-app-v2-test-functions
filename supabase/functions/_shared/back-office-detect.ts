// back-office-detect — pure detection helpers for the back-office-ro-watch cron.
//
// Reopened-RO NET-change reconstruction from a repair order's posting-lifecycle history
// (ro_posted / ro_sent_to_ar / ro_unposted) plus payments (payment_made). Pure +
// side-effect-free so it unit-tests without a DB. Mirrors qteklink's own detection
// primitives (date-moves / posted-day-sweep): order by RECEIVED time (Tekmetric backdates
// unpost/repost postedDate), totalSales is already CENTS, business dates are shop-local.
//
// Model (plan docs/back-office/reopened-ro-history-plan.md):
//   * baseline = the RO's ORIGINAL posted state before the first reopen (or, after a prior
//     issue was VERIFIED, that verified state — the `anchor` — so handled deltas don't re-fire).
//   * final    = the current re-closed state (skip while currently unposted).
//   * A value changed then restored nets out (a "correction") — no false alert.
//   * SAME-DAY carve-out (local time): if the reopen finished on the same shop-local calendar
//     day the RO was originally posted, a TOTAL change is routine and NOT flagged; only a
//     genuine (non-corrected) DATE change is. On a LATER local day, ANY net change is flagged.

export type ChangeType = "date_changed" | "total_changed" | "date_and_total_changed";

/** A Tekmetric ISO timestamp → the shop-local calendar date (YYYY-MM-DD). */
export function toShopLocalDate(iso: string | null, tz: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** An instant → a short shop-local label, e.g. "Jul 16, 2026, 2:51 PM" (what the UI + email show). */
function formatLocalDateTime(iso: string, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/** The actor at the tail of a Tekmetric event sentence: "...by <actor>". Covers posted /
 *  sent to A/R / unposted / "Payment made by <name>". */
export function parseActor(eventText: string | null): string | null {
  if (!eventText) return null;
  const m = /\bby\s+(.+?)\s*$/i.exec(eventText);
  return m ? m[1].trim() : null;
}

/** A sale-scan / payment event projected from a qteklink_events row. */
export interface SaleEvent {
  kind: string; // ro_posted | ro_sent_to_ar | ro_unposted | payment_made
  receivedAt: string; // received_at ISO (ordering key)
  postedDate: string | null; // raw_body.data.postedDate (postings only)
  totalCents: number | null; // raw_body.data.totalSales (already cents; postings only)
  roNumber: string | null; // raw_body.data.repairOrderNumber
  eventText: string | null; // raw_body.event
}

const POSTING_KINDS = new Set(["ro_posted", "ro_sent_to_ar"]);
export function isPosting(kind: string): boolean {
  return POSTING_KINDS.has(kind);
}

/** One entry in the reopened-RO history timeline. Postings carry posted_date + total_cents;
 *  payments carry a payer. `at` is the UTC received_at (the UI renders it in shop-local time). */
export interface HistoryEntry {
  seq: number;
  at: string; // received_at (UTC) — ordering key
  at_local: string; // pre-formatted shop-local label the UI + email display (Chris: use local time)
  kind: string;
  actor: string | null;
  posted_date?: string | null;
  total_cents?: number | null;
  payer?: string | null;
}

/** The state a prior VERIFIED reopened issue settled at — the new baseline for a later reopen. */
export interface SagaAnchor {
  at: string; // the verified issue's final posting received_at (context.final_at)
  posted_date: string | null; // context.final_posted_date (already shop-local business date)
  total_cents: number | null; // context.final_total_cents
}

export interface ReopenedSaga {
  ro_number: string | null;
  change_type: ChangeType;
  saga_started_at: string; // received_at of the current saga's FIRST unpost
  reopened_by: string | null; // actor of that first unpost
  baseline_posted_date: string | null; // shop-local business date
  baseline_total_cents: number | null;
  final_posted_date: string | null;
  final_total_cents: number | null;
  final_at: string; // received_at of the final posting (the D7 re-baseline anchor)
  history: HistoryEntry[]; // ascending
}

export type SagaResult = { skip: true } | { skip: false; saga: ReopenedSaga };

const SKIP: SagaResult = { skip: true };

/**
 * Reconstruct the current reopen saga for one RO and decide whether it is an issue worth
 * tracking. Returns { skip: true } when the RO is currently unposted, never reopened since
 * the anchor, or reopened+reclosed with no *flaggable* net change (per the same-day rule).
 */
export function buildReopenedSaga(
  lifecycle: SaleEvent[],
  payments: SaleEvent[],
  tz: string,
  anchor?: SagaAnchor | null,
): SagaResult {
  const sorted = [...lifecycle].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));

  // Window: everything at/after the anchor (a prior verified final), else the full history.
  const window = anchor?.at ? sorted.filter((e) => e.receivedAt >= anchor.at) : sorted;
  if (window.length === 0) return SKIP;

  // Must contain a reopen; and while currently unposted we wait for the re-close (D3).
  const firstUnpostIdx = window.findIndex((e) => e.kind === "ro_unposted");
  if (firstUnpostIdx === -1) return SKIP;
  const last = window[window.length - 1];
  if (!isPosting(last.kind)) return SKIP; // currently unposted
  const final = last;
  const firstUnpost = window[firstUnpostIdx];

  // Baseline: the anchor state, else the last posting BEFORE the first unpost.
  let baselineAt: string;
  let baselineDate: string | null;
  let baselineCents: number | null;
  let historyStartAt: string;
  if (anchor?.at) {
    baselineAt = anchor.at;
    baselineDate = anchor.posted_date;
    baselineCents = anchor.total_cents;
    historyStartAt = anchor.at;
  } else {
    let basePosting: SaleEvent | null = null;
    for (let i = firstUnpostIdx - 1; i >= 0; i--) {
      if (isPosting(window[i].kind)) {
        basePosting = window[i];
        break;
      }
    }
    if (!basePosting) return SKIP; // no baseline posting available (predates our ledger)
    baselineAt = basePosting.receivedAt;
    baselineDate = toShopLocalDate(basePosting.postedDate, tz);
    baselineCents = basePosting.totalCents;
    historyStartAt = basePosting.receivedAt;
  }

  const finalDate = toShopLocalDate(final.postedDate, tz);
  const finalCents = final.totalCents;

  const netDateChanged = baselineDate !== null && finalDate !== null && baselineDate !== finalDate;
  const netTotalChanged = baselineCents !== null && finalCents !== null && baselineCents !== finalCents;
  const laterDay = toShopLocalDate(baselineAt, tz) !== toShopLocalDate(final.receivedAt, tz);

  // The §2 decision table.
  let change_type: ChangeType;
  if (laterDay) {
    if (netDateChanged && netTotalChanged) change_type = "date_and_total_changed";
    else if (netDateChanged) change_type = "date_changed";
    else if (netTotalChanged) change_type = "total_changed";
    else return SKIP;
  } else {
    // Same shop-local day as the original posting: a total change is routine; only a real
    // (non-corrected) date change is an issue.
    if (netDateChanged) change_type = "date_changed";
    else return SKIP;
  }

  // History: lifecycle (from the baseline posting onward) + payments in the same window.
  const historyEvents = [
    ...window.filter((e) => e.receivedAt >= historyStartAt),
    ...payments.filter((e) => e.receivedAt >= historyStartAt && e.receivedAt <= final.receivedAt),
  ].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));

  const history: HistoryEntry[] = historyEvents.map((e, i) => {
    const actor = parseActor(e.eventText);
    const base = { seq: i + 1, at: e.receivedAt, at_local: formatLocalDateTime(e.receivedAt, tz), kind: e.kind, actor };
    if (e.kind === "payment_made") return { ...base, payer: actor };
    if (isPosting(e.kind)) return { ...base, posted_date: toShopLocalDate(e.postedDate, tz), total_cents: e.totalCents };
    return base;
  });

  return {
    skip: false,
    saga: {
      ro_number: final.roNumber ?? firstUnpost.roNumber ?? null,
      change_type,
      saga_started_at: firstUnpost.receivedAt,
      reopened_by: parseActor(firstUnpost.eventText),
      baseline_posted_date: baselineDate,
      baseline_total_cents: baselineCents,
      final_posted_date: finalDate,
      final_total_cents: finalCents,
      final_at: final.receivedAt,
      history,
    },
  };
}
