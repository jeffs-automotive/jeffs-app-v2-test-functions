/**
 * Sale-event observation ordering.
 *
 * Tekmetric BACKDATES unpost/repost events: an `ro_unposted` REUSES the original posting's
 * `postedDate`, and a corrective repost can carry an EARLIER `postedDate` than the unpost it
 * fixes. Real incident (RO 153211, 2026-06-19): an RO was unposted (to add a discount) and
 * re-posted in a rapid burst; the unpost's `postedDate` was 20:43:58 while the corrective
 * repost's was 20:38:50 — EARLIER. Ordering each RO's "newest" event by business time
 * (`tekmetric_event_at`) therefore picked the stale unpost and DROPPED the RO from its
 * (correct) day in the daily sales JE.
 *
 * An RO's CURRENT state must instead be read from the latest OBSERVED event — `received_at`,
 * when WE received it, which IS Tekmetric's real-time send order. `received_at` is NOT NULL on
 * every event; an unparseable one sinks to the bottom rather than corrupting the order.
 */
export function sortByReceivedAtDesc<T extends { received_at: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const ta = Date.parse(a.received_at);
    const tb = Date.parse(b.received_at);
    return (Number.isNaN(tb) ? -Infinity : tb) - (Number.isNaN(ta) ? -Infinity : ta);
  });
}
