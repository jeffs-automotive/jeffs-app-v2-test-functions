// Shared Tekmetric constants — imported by every Tekmetric-related edge function.
//
// Why this lives here and not in Vault:
//   These are non-secret URLs and Vault-name labels. Putting them in Vault would
//   add encryption + DB-lookup overhead per call for no security benefit. Keeping
//   them in a shared module gives one source of truth: change here, every function
//   that imports it picks up the change on next deploy.
//
// To switch between sandbox and production: change TEKMETRIC_BASE_URL below.
//   Sandbox    https://sandbox.tekmetric.com  (300 req/min limit)
//   Production https://shop.tekmetric.com     (600 req/min limit)

export const TEKMETRIC_BASE_URL = "https://shop.tekmetric.com";
export const TEKMETRIC_API_PATH = "/api/v1";

/** OAuth token exchange endpoint — POST with Basic auth + grant_type=client_credentials */
export const TEKMETRIC_OAUTH_TOKEN_URL =
  `${TEKMETRIC_BASE_URL}${TEKMETRIC_API_PATH}/oauth/token`;

/** Base for all resource endpoints (e.g., `${TEKMETRIC_API_BASE}/customers`) */
export const TEKMETRIC_API_BASE =
  `${TEKMETRIC_BASE_URL}${TEKMETRIC_API_PATH}`;

/**
 * Vault secret names. Edge functions reference these via tekmetric_get_secret /
 * tekmetric_set_secret RPCs. Keep in sync with the actual secret names added in
 * Studio → Project Settings → Vault.
 */
export const VAULT_NAMES = {
  CLIENT_ID: "tekmetric_client_id",
  CLIENT_SECRET: "tekmetric_client_secret",
  SHOP_ID: "tekmetric_shop_id",
  ACCESS_TOKEN: "tekmetric_access_token",
} as const;

/**
 * Tekmetric repair-order status IDs. Source: Tekmetric API docs (status_id field on
 * repair-order objects + webhook payloads). The keytag webhook only cares about a
 * subset of these. Add new IDs here as needed; never re-purpose an existing constant.
 */
export const TEKMETRIC_RO_STATUS = {
  ESTIMATE: 1,
  WIP: 2,           // Work in progress — keytag gets assigned at this transition
  COMPLETED: 3,
  POSTED_PAID: 5,   // Customer paid in full at posting — keytag released
  POSTED_AR: 6,     // Posted but on A/R balance — keytag held, marked posted
} as const;

/**
 * Edge Function environment variable names. Set via `supabase secrets set` (not Vault).
 * Why env vars instead of Vault: webhook validation tokens are accessed on every
 * incoming request — env var lookup is zero-overhead, Vault is a DB call.
 */
export const ENV_NAMES = {
  WEBHOOK_TOKEN: "TEKMETRIC_WEBHOOK_TOKEN",  // shared secret in webhook URL ?token=<value>
  TEKMETRIC_SHOP_ID: "TEKMETRIC_SHOP_ID",    // optional override; defaults to Vault value
} as const;

/**
 * Tekmetric admin web URL — for building "open in Tekmetric" links in tool responses.
 *
 * Confirmed pattern (Chris 2026-05-08):
 *   https://shop.tekmetric.com/admin/shop/{shopId}/repair-orders/{roId}/estimate
 *
 * The path uses `/estimate` regardless of RO status (WIP, posted, etc. all use this
 * same suffix — Tekmetric's admin uses `estimate` as the canonical RO detail view).
 * Only shopId and roId are needed; customer/vehicle aren't in the URL.
 *
 * Placeholders ({shopId}, {roId}) are replaced at runtime by `buildTekmetricRoUrl(...)`.
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
