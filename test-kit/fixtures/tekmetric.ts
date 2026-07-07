/**
 * Tekmetric integration test fixtures — shared "cookie-cutter" data for the recurring
 * integration failure modes (catalog: ../README.md). Pure TypeScript with NO test-framework
 * imports, so BOTH Vitest (the Node apps) and `deno test` (the edge fns) can import it as plain
 * data. Keep assertions/mocks in the per-runtime suites; this file is fixtures + pure factories
 * only. Sourced from real Tekmetric payload shapes (TEKMETRIC_API_DOCS.md / WEBHOOKS_MAP.md).
 */

/** The subset of a sale-scan event row that the "latest event per RO" selection reads. */
export interface SaleScanEvent {
  event_kind: string;
  /** Tekmetric business time (postedDate) — BACKDATED on unpost/repost; never the sort key. */
  tekmetric_event_at: string | null;
  /** When WE received it — the truthful Tekmetric send order; the correct sort key. */
  received_at: string;
  raw_body: { data: Record<string, unknown> };
}

/**
 * REGRESSION FIXTURE — the RO 153211 incident (2026-06-19, JE 26058 v4 / commits f4e9b83 +
 * 405e38d). An RO was unposted to add a discount and re-posted in a rapid burst. Tekmetric
 * BACKDATED the `ro_unposted` (postedDate 20:43:58 — the original posting time) AHEAD of the
 * corrective repost (postedDate 20:38:50), so ordering each RO's newest event by
 * `tekmetric_event_at` picked the stale unpost and DROPPED the RO ($486.51) from the sales JE.
 *
 * The three events here are the ones inside the 6/15 business-date window, returned in the
 * WRONG (business-time) order on purpose. A correct consumer orders by `received_at`, so the
 * latest event is the repost (the RO is back on 6/15, posted) — never the unpost.
 */
export const backdatedRepostBurst: SaleScanEvent[] = [
  {
    event_kind: "ro_unposted",
    tekmetric_event_at: "2026-06-15T20:43:58Z", // backdated to the ORIGINAL posting time
    received_at: "2026-06-19T20:38:34Z",
    raw_body: { data: { id: 336946898, repairOrderNumber: "153211", postedDate: "2026-06-15T20:43:58Z", totalSales: 57237 } },
  },
  {
    event_kind: "ro_sent_to_ar",
    tekmetric_event_at: "2026-06-15T20:43:58Z",
    received_at: "2026-06-15T20:44:21Z", // the original posting — received first, days earlier
    raw_body: { data: { id: 336946898, repairOrderNumber: "153211", postedDate: "2026-06-15T20:43:58Z", totalSales: 57237 } },
  },
  {
    event_kind: "ro_posted",
    tekmetric_event_at: "2026-06-15T20:38:50Z", // EARLIER business time than the unpost above
    received_at: "2026-06-19T20:39:17Z", // received LAST → the true current state ($486.51)
    raw_body: { data: { id: 336946898, repairOrderNumber: "153211", postedDate: "2026-06-15T20:38:50Z", totalSales: 48651 } },
  },
];

/** The expected current state once correctly ordered by received time. */
export const backdatedRepostExpected = { event_kind: "ro_posted", repairOrderNumber: "153211", totalSales: 48651 } as const;

// ── Posted-status trap: an RO is POSTED when repairOrderStatus.id ∈ {5 (Posted), 6 (A/R)} ──
//    The API/webhook payload carries the status ONLY as the NESTED repairOrderStatus object —
//    there is NO flat repairOrderStatusId field (verified live 2026-07-06 against
//    GET /repair-orders; a flat-field parse turned every status null and made the
//    missed_ro_webhook safety net vacuous — the RO 153886 / $21.38 incident). ──
/** The full posted-status set; a consumer that filters on 5 only drops ~1/5 of revenue (A/R). */
export const TEKMETRIC_POSTED_STATUS_IDS = [5, 6] as const;
const RO_STATUS_META: Record<number, { code: string; name: string; postedOrAccrecv: boolean }> = {
  5: { code: "POSTED", name: "Posted", postedOrAccrecv: true },
  6: { code: "ACCRECV", name: "Accounts Receivable", postedOrAccrecv: true },
  3: { code: "COMPLETE", name: "Complete", postedOrAccrecv: false },
};
export const repairOrderWithStatus = (statusId: number, over: Record<string, unknown> = {}) => ({
  id: 328577176, repairOrderNumber: "153330",
  repairOrderStatus: {
    id: statusId,
    ...(RO_STATUS_META[statusId] ?? { code: "UNKNOWN", name: "Unknown", postedOrAccrecv: false }),
  },
  postedDate: "2026-06-15T10:44:30Z", totalSales: 2400, ...over,
});

// ── Spring-pageable pagination: list endpoints return content[]/totalPages/last, size capped
//    at 100, but a deployment can also return a BARE array. A drain must handle all shapes. ──
export function springPage<T>(content: T[], page: number, totalPages: number): { content: T[]; number: number; totalPages: number; last: boolean; size: number } {
  return { content, number: page, totalPages, last: page + 1 >= totalPages, size: 100 };
}
/** A two-page list (drain must read BOTH). Page 0 is FULL (100 = the size cap) so the drain
 *  can't assume it's the last page; the page-2 item (id 101) is only seen if it keeps going. */
export const multiPageList = [
  springPage(Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })), 0, 2),
  springPage([{ id: 101 }], 1, 2),
];
/** Some deployments return a bare array instead of the envelope. */
export const bareArrayList = [{ id: 1 }, { id: 2 }];
/** An empty result. */
export const emptyPage = springPage<{ id: number }>([], 0, 0);

// ── Customer NAME only via REST (webhook carries only customerId). A business customer stores
//    the company in firstName with lastName blank; both-blank must still yield a non-empty label.
export const customerPerson = { id: 44695835, firstName: "John", lastName: "Smith" };
export const customerBusiness = { id: 100, firstName: "Carmax", lastName: null };
export const customerBlank = { id: 200, firstName: null, lastName: null };
