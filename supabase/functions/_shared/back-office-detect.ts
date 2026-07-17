// back-office-detect — pure detection helpers for the back-office-ro-watch cron.
//
// Reopened-RO change classification + the unpost-cycle reconstruction from a repair
// order's sale-scan event history (ro_posted / ro_sent_to_ar / ro_unposted). Pure +
// side-effect-free so it unit-tests without a DB. Mirrors qteklink's own detection
// primitives (date-moves / posted-day-sweep): order by RECEIVED time (Tekmetric backdates
// unpost/repost postedDate), totalSales is already CENTS, business date is shop-local.

export type ChangeType =
  | "unposted" // unposted and not yet reposted
  | "reposted" // reposted with no change to date or total
  | "date_changed"
  | "total_changed"
  | "date_and_total_changed";

export function classifyChangeType(input: {
  hasRepost: boolean;
  originalDate: string | null;
  newDate: string | null;
  originalCents: number | null;
  newCents: number | null;
}): ChangeType {
  if (!input.hasRepost) return "unposted";
  const dateDiff =
    input.originalDate !== null && input.newDate !== null && input.originalDate !== input.newDate;
  const totalDiff =
    input.originalCents !== null && input.newCents !== null && input.originalCents !== input.newCents;
  if (dateDiff && totalDiff) return "date_and_total_changed";
  if (dateDiff) return "date_changed";
  if (totalDiff) return "total_changed";
  return "reposted";
}

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

/** "Repair Order #154224 unposted by zane@jeffsautomotive.com" → "zane@jeffsautomotive.com". */
export function parseUnpostedBy(eventText: string | null): string | null {
  if (!eventText) return null;
  const m = /unposted by\s+(.+?)\s*$/i.exec(eventText);
  return m ? m[1].trim() : null;
}

/** A sale-scan event projected from a qteklink_events row. */
export interface SaleEvent {
  kind: string; // ro_posted | ro_sent_to_ar | ro_unposted
  receivedAt: string; // received_at ISO (ordering key)
  postedDate: string | null; // raw_body.data.postedDate
  totalCents: number | null; // raw_body.data.totalSales (already cents)
  roNumber: string | null; // raw_body.data.repairOrderNumber
  eventText: string | null; // raw_body.event
}

const POSTING_KINDS = new Set(["ro_posted", "ro_sent_to_ar"]);
export function isPosting(kind: string): boolean {
  return POSTING_KINDS.has(kind);
}

export interface ReopenedCycle {
  ro_number: string | null;
  change_type: ChangeType;
  original_posted_date: string | null; // business date
  new_posted_date: string | null; // business date
  original_total_cents: number | null;
  new_total_cents: number | null;
  unposted_by: string | null;
  unposted_at: string; // the unpost event's received_at (dedup key)
}

/**
 * Reconstruct the LATEST unpost cycle for one RO from its full sale-scan history:
 *   original state = the last posting BEFORE the unpost; new state = the first posting
 *   AFTER it (null while still unposted). Returns null when there is no unpost event.
 */
export function buildReopenedCycle(events: SaleEvent[], tz: string): ReopenedCycle | null {
  const sorted = [...events].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  let unpostIdx = -1;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].kind === "ro_unposted") {
      unpostIdx = i;
      break;
    }
  }
  if (unpostIdx === -1) return null;
  const unpost = sorted[unpostIdx];

  let original: SaleEvent | null = null;
  for (let i = unpostIdx - 1; i >= 0; i--) {
    if (isPosting(sorted[i].kind)) {
      original = sorted[i];
      break;
    }
  }
  let repost: SaleEvent | null = null;
  for (let i = unpostIdx + 1; i < sorted.length; i++) {
    if (isPosting(sorted[i].kind)) {
      repost = sorted[i];
      break;
    }
  }

  const originalDate = original ? toShopLocalDate(original.postedDate, tz) : null;
  const newDate = repost ? toShopLocalDate(repost.postedDate, tz) : null;
  const originalCents = original ? original.totalCents : null;
  const newCents = repost ? repost.totalCents : null;

  return {
    ro_number: unpost.roNumber ?? repost?.roNumber ?? original?.roNumber ?? null,
    change_type: classifyChangeType({
      hasRepost: repost !== null,
      originalDate,
      newDate,
      originalCents,
      newCents,
    }),
    original_posted_date: originalDate,
    new_posted_date: newDate,
    original_total_cents: originalCents,
    new_total_cents: newCents,
    unposted_by: parseUnpostedBy(unpost.eventText),
    unposted_at: unpost.receivedAt,
  };
}
