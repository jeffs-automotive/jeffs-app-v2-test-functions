/**
 * QBO Accounting API client — static config (qteklink-app, Node runtime).
 *
 * Env-var names mirror the shipped `qbo-oauth-callback` edge fn
 * (`QBO_ENVIRONMENT` / `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET`) so the qteklink-app
 * client and the OAuth handshake stay in lockstep. Client ID/Secret are read
 * by `tokens.ts` (via `intuit-oauth`); this module owns the data-call surface
 * (base URL, minor version, retry/timeout caps).
 *
 * See docs/qbo/qbo-api-client-plan.md (+ its 2026-06-02 compliance re-review).
 */

/** "production" = the real Jeff's Automotive books; "sandbox" = Intuit sandbox. */
export type QboEnvironment = "production" | "sandbox";

/**
 * Resolve the QBO environment. Defaults to **production** (plan decision #5);
 * only an explicit `QBO_ENVIRONMENT=sandbox` selects sandbox.
 */
export function resolveQboEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): QboEnvironment {
  return env.QBO_ENVIRONMENT === "sandbox" ? "sandbox" : "production";
}

/** Accounting API base URL for the given environment. */
export function qboBaseUrl(
  environment: QboEnvironment = resolveQboEnvironment(),
): string {
  return environment === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

/**
 * Minor-version pin. `75` is the current Intuit SDK default (the official SDKs
 * ship it) — see Intuit's "Minor versions" page for the authoritative current
 * value. Pinned explicitly so a future bump is deliberate, not a silent SDK
 * default. String form for the query param.
 */
export const QBO_MINORVERSION = "75";

/** Max retries on 429 / 5xx (attestation #2). */
export const QBO_MAX_RETRIES = 3;

/** Backoff (ms) per retry attempt; a `Retry-After` response header overrides. */
export const QBO_BACKOFF_MS: readonly number[] = [250, 1000, 2000];

/** Per-request timeout (ms). */
export const QBO_REQUEST_TIMEOUT_MS = 30_000;
