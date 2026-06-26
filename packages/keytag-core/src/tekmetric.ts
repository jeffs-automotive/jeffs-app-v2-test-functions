// Shared Tekmetric constants — PURE (no Deno, no HTTP client, no env).
//
// COPY for the @jeffs/keytag-core read package (Phase 0 build-seam spike,
// 2026-06-26). Source of truth is still
// `supabase/functions/_shared/tekmetric.ts`; this is a verbatim copy of the
// PURE constants + `buildTekmetricRoUrl` the read closure needs. Only the
// helpers the reads actually consume are carried here:
//   - TEKMETRIC_RO_STATUS  (status-id map; used by keytag-reads.ts)
//   - buildTekmetricRoUrl  (RO deep-link builder; used by dashboard + reads)
// The runtime Tekmetric HTTP client (`tekmetric-client.ts`, `tekmetricGetJson`)
// is deliberately NOT copied — it is Deno-only and stays on the gateway.

export const TEKMETRIC_BASE_URL = "https://shop.tekmetric.com";
export const TEKMETRIC_API_PATH = "/api/v1";

/** Base for all resource endpoints (e.g., `${TEKMETRIC_API_BASE}/customers`) */
export const TEKMETRIC_API_BASE = `${TEKMETRIC_BASE_URL}${TEKMETRIC_API_PATH}`;

/**
 * Tekmetric repair-order status IDs. Source: Tekmetric API docs (status_id field
 * on repair-order objects + webhook payloads). The keytag webhook only cares
 * about a subset of these.
 */
export const TEKMETRIC_RO_STATUS = {
  ESTIMATE: 1,
  WIP: 2, // Work in progress — keytag gets assigned at this transition
  COMPLETED: 3,
  POSTED_PAID: 5, // Customer paid in full at posting — keytag released
  POSTED_AR: 6, // Posted but on A/R balance — keytag held, marked posted
} as const;

/**
 * Tekmetric admin web URL — for building "open in Tekmetric" links.
 *   https://shop.tekmetric.com/admin/shop/{shopId}/repair-orders/{roId}/estimate
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
    TEKMETRIC_RO_URL_TEMPLATE.replace("{shopId}", String(args.shopId)).replace(
      "{roId}",
      String(args.roId),
    )
  );
}
