/**
 * Tekmetric event-kind vocabulary shared across QTekLink consumers.
 *
 * RO POSTING kinds — an RO whose sale is FINALIZED + recognized. Tekmetric posts
 * an RO via EITHER:
 *   - "Repair Order #N posted by …"      → `ro_posted`     (posted AND paid)
 *   - "Repair Order #N sent to A/R by …" → `ro_sent_to_ar` (posted on A/R, unpaid)
 * BOTH recognize the sale identically (Dr A/R / Cr income); an A/R RO simply gets
 * its A/R-clearing PAYMENT JE later. Any consumer that builds or reconciles the
 * SALE side MUST treat both as a posting — filtering on `ro_posted` alone silently
 * drops every A/R sale.
 *
 * Verified on live shop data (plan §5): of 685 in-window postings, 144 (≈21%)
 * arrived ONLY as `ro_sent_to_ar`. `ro_sent_to_ar` carries the identical RO
 * snapshot (totalSales / jobs / fees / postedDate), so `parseSnapshot` is unchanged.
 */
export const RO_POSTING_EVENT_KINDS = ["ro_posted", "ro_sent_to_ar"] as const;

/** A posting REVERSAL — "Repair Order #N unposted by …" (~2/day in real traffic): the RO
 *  returns to WIP and its sale must NOT be recognized (until a later re-post). */
export const RO_UNPOST_EVENT_KIND = "ro_unposted" as const;

/** The sale-side LATEST-EVENT scan set: the posting kinds + the unpost reversal. A
 *  consumer picking "the RO's newest event" MUST scan all three — scanning only the
 *  posting kinds resurrects an unposted RO's stale sale from its superseded posted event. */
export const RO_SALE_SCAN_EVENT_KINDS = [...RO_POSTING_EVENT_KINDS, RO_UNPOST_EVENT_KIND] as const;
