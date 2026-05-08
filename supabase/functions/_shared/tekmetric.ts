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
