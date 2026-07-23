// _shared/tekbridge/constants.ts
//
// Non-secret constants for **tekbridge** — the shared bridge that performs
// Tekmetric actions the PUBLIC API can't, by replaying Tekmetric's INTERNAL
// web API (https://shop.tekmetric.com/api/...). This is DISTINCT from the
// public API (/api/v1, OAuth client-credentials bearer) that
// `_shared/tekmetric-client.ts` handles — different base path, different auth.
//
// Auth for the internal API is a **session JWT in the `x-auth-token` header**
// (recon 2026-07-21 — see docs/tekmetric/headless-automation-research.md §1b).
// The JWT is minted by a human logging the tekbridge bot seat into the
// Tekmetric web app (reCAPTCHA-gated, once per ~16h) and submitted to the
// `tekbridge` edge function, which stores it in Vault under
// TEKBRIDGE_SESSION_JWT_SECRET. tekbridge never handles the bot password.
//
// Sandbox vs production: flip TEKBRIDGE_INTERNAL_BASE_URL below.
//   Sandbox    https://sandbox.tekmetric.com
//   Production https://shop.tekmetric.com   (Jeff's shop 7476 — prod-only per Chris 2026-07-21)

export const TEKBRIDGE_INTERNAL_BASE_URL = "https://shop.tekmetric.com";

/** Base for internal API resource paths, e.g. `${TEKBRIDGE_INTERNAL_API_BASE}/repair-orders/{id}/customer-concerns`. */
export const TEKBRIDGE_INTERNAL_API_BASE = `${TEKBRIDGE_INTERNAL_BASE_URL}/api`;

/**
 * Vault secret name holding the bot session JWT. Read/written via the existing
 * generic `public.tekmetric_get_secret` / `tekmetric_set_secret` RPCs
 * (SECURITY DEFINER, service_role only — migration 20260508020947). We reuse
 * those generic vault wrappers rather than adding tekbridge-specific copies.
 */
export const TEKBRIDGE_SESSION_JWT_SECRET = "tekbridge_session_jwt";

/** Default per-request timeout (ms) for internal-API calls. Mirrors the public
 *  client's 15s deadline so a hung Tekmetric never stalls the caller chain. */
export const TEKBRIDGE_DEFAULT_TIMEOUT_MS = 15_000;

/** Clock-skew tolerance (seconds) when deciding a session JWT is expired. We
 *  treat a token as expired slightly BEFORE its real `exp` so an in-flight call
 *  never lands after the server-side expiry. */
export const TEKBRIDGE_JWT_EXPIRY_SKEW_SECONDS = 60;
