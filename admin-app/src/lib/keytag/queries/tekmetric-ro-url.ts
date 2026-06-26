// Pure Tekmetric RO-URL + status constants.
//
// Ported (Node idiom) from the PURE bits of
// supabase/functions/_shared/tekmetric.ts — `buildTekmetricRoUrl` +
// `TEKMETRIC_RO_STATUS`. The edge module also carries secret/Vault labels and
// the Tekmetric HTTP base; the keytag DIRECT reads only need the link builder +
// status IDs, so only those are ported here (keeps the closure free of the
// Tekmetric HTTP client). Behavior IDENTICAL to the edge source.

/**
 * Tekmetric repair-order status IDs. Source: Tekmetric API docs (status_id field
 * on repair-order objects + webhook payloads). Kept here so the ported pure reads
 * stay self-contained; the keytag webhook only cares about a subset of these.
 */
export const TEKMETRIC_RO_STATUS = {
  ESTIMATE: 1,
  WIP: 2,           // Work in progress — keytag gets assigned at this transition
  COMPLETED: 3,
  POSTED_PAID: 5,   // Customer paid in full at posting — keytag released
  POSTED_AR: 6,     // Posted but on A/R balance — keytag held, marked posted
} as const;

/**
 * Tekmetric admin web URL — for building "open in Tekmetric" links in read
 * results. Confirmed pattern (Chris 2026-05-08):
 *   https://shop.tekmetric.com/admin/shop/{shopId}/repair-orders/{roId}/estimate
 *
 * The path uses `/estimate` regardless of RO status (WIP, posted, etc. all use
 * this same suffix — Tekmetric's admin uses `estimate` as the canonical RO
 * detail view). Only shopId and roId are needed.
 */
export const TEKMETRIC_ADMIN_BASE_URL = "https://shop.tekmetric.com";
export const TEKMETRIC_RO_URL_TEMPLATE =
  "/admin/shop/{shopId}/repair-orders/{roId}/estimate";

export function buildTekmetricRoUrl(args: {
  roId: number;
  shopId: number;
}): string {
  return (
    TEKMETRIC_ADMIN_BASE_URL +
    TEKMETRIC_RO_URL_TEMPLATE
      .replace("{shopId}", String(args.shopId))
      .replace("{roId}", String(args.roId))
  );
}
