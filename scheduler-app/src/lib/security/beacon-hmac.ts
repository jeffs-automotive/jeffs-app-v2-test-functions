/**
 * Beacon HMAC — server-side authentication for the mark-abandoned beacon.
 *
 * P1.5 post-validator fix (2026-05-25). Validator 2 caught that
 * `/api/scheduler/mark-abandoned` was unauthenticated. An attacker
 * with a leaked chat_id (most likely from a victim's URL history,
 * shared-screen leak, or a misconfigured analytics tag) could fire
 * the beacon to forcibly mark the legitimate session as timed_out
 * and release the held appointment slot.
 *
 * Defense: the customer's wizard page (`BookPageShell` Server
 * Component) signs the chat_id with a server-side HMAC-SHA256 secret
 * and embeds the resulting base64url digest into the IdleTimer prop
 * tree. The browser includes this sig as a query parameter on every
 * mark-abandoned beacon. The route validates the sig before doing
 * any DB work. Attacker-forged beacons (without the sig OR with a
 * wrong one) return 204 without touching the row.
 *
 * Why HMAC instead of "fetch a one-shot token from the server":
 *   - sendBeacon happens during browser tear-down — no time to
 *     round-trip a token request before the beacon fires.
 *   - HMAC is stateless: no Redis / no DB / no per-beacon token row.
 *     The sig is computed once at page-render, attached to the
 *     IdleTimer, and reused for every beacon (idle-timer trigger,
 *     pagehide, beforeunload).
 *   - Replay-resistance is bounded by the route's existing
 *     idempotency (status='active' filter on the row update +
 *     released_at IS NULL on the hold release). An attacker who
 *     replays a captured sig hits a no-op once the session has
 *     ended legitimately.
 *
 * Graceful degradation: if `SCHEDULER_BEACON_HMAC_SECRET` is not
 * configured (local dev OR Vercel not yet set up by Chris), the
 * helpers fall back to fail-OPEN — the server returns "" as the sig,
 * the client sends no sig, the route doesn't validate. Matches the
 * pattern in `rate-limit.ts` so operators don't get a hard 500 from
 * a missing env var. A one-time Sentry warning is emitted so
 * operators can find + fix the misconfiguration. Strict mode
 * (`SCHEDULER_REQUIRE_RATE_LIMIT=true`) bumps the warning to error.
 *
 * Secret rotation: rotating the secret in the middle of a customer
 * session would cause the live page's cached sig to mismatch the
 * new secret + drop beacons. Acceptable failure mode — affected
 * sessions still get reaped by the 70-min cron and Tekmetric's
 * hold TTL bounds the slot-loss exposure. Operators should rotate
 * at low-traffic windows.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import * as Sentry from "@sentry/nextjs";

import { isRateLimitStrictMode } from "@/lib/security/check-bot";

// Lazy-emit-once gate for the missing-secret warning. Without this,
// every render of BookPageShell + every mark-abandoned POST would
// spam Sentry on a misconfigured deploy.
let envWarningEmitted = false;

function emitMissingSecretWarningOnce(): void {
  if (envWarningEmitted) return;
  envWarningEmitted = true;
  const strict = isRateLimitStrictMode();
  Sentry.captureMessage(
    "SCHEDULER_BEACON_HMAC_SECRET not configured — mark-abandoned beacon HMAC validation DISABLED (failing open). " +
      "Set SCHEDULER_BEACON_HMAC_SECRET on Vercel (≥ 32 random hex chars) to enable beacon auth.",
    {
      level: strict ? "error" : "warning",
      tags: {
        surface: "beacon_hmac_init",
        misconfiguration: "secret_missing",
        strict_mode: String(strict),
      },
    },
  );
}

/**
 * Returns true when SCHEDULER_BEACON_HMAC_SECRET is set to a non-trivial
 * value (≥ 32 chars). The length floor prevents accidentally enabling
 * the path with a placeholder secret like "TODO" — HMAC under a
 * 4-char secret has weak collision resistance and is worse than off.
 *
 * Exposed for callers (BookPageShell, mark-abandoned route) that want
 * to log + branch behavior without recomputing the env-var check.
 */
export function isBeaconHmacConfigured(): boolean {
  const secret = process.env.SCHEDULER_BEACON_HMAC_SECRET;
  return typeof secret === "string" && secret.length >= 32;
}

/**
 * Compute the HMAC-SHA256 digest of a chatId using the server secret.
 * Returns the digest as base64url (URL-safe — no padding, no `+`/`/`
 * chars that would need encoding in a query string).
 *
 * Returns an empty string when the secret is not configured (signals
 * to the caller that HMAC is disabled in this deployment posture; the
 * caller should pass "" to the client and the client should not send
 * a sig). Emits a one-time Sentry warning for operator visibility.
 *
 * Pure function — no async, no IO beyond reading process.env.
 *
 * Validator-2 follow-up (2026-05-25): the original P1.5 covered only
 * chatId. An attacker who captured one beacon could replay it with
 * arbitrary `step` / `source` to pollute `scheduler_audit_log`
 * (event_detail.step_at_abandon). Doesn't affect the DB-write gate
 * (the row update only fires on `status='active'`; hold release
 * filters `released_at IS NULL`) — but analytics integrity matters
 * for triage. The chatId-only signature is preserved via a separate
 * `signBeaconPayload` helper below; callers should prefer the
 * payload-binding form.
 */
export function signBeaconChatId(chatId: string): string {
  if (!isBeaconHmacConfigured()) {
    emitMissingSecretWarningOnce();
    return "";
  }
  const secret = process.env.SCHEDULER_BEACON_HMAC_SECRET as string;
  return createHmac("sha256", secret).update(chatId).digest("base64url");
}

/**
 * Canonicalize the beacon payload for HMAC. Order: chatId, step,
 * source — separated by `|` (a char that never appears in a chatId
 * UUID or in the enum-bounded step/source values). Empty fields render
 * as the empty string; the separators alone distinguish missing-field
 * from a different-field-value collision.
 */
function canonicalizeBeaconPayload(
  chatId: string,
  step: string | null | undefined,
  source: string | null | undefined,
): string {
  return `${chatId}|${step ?? ""}|${source ?? ""}`;
}

/**
 * Compute the HMAC over the FULL beacon payload (chatId + step + source).
 * Use this when callers need replay-resistance for non-chatId fields.
 *
 * The mark-abandoned route validates payload-bound sigs first via
 * `verifyBeaconPayloadSig`; falls back to the chatId-only sig for
 * compatibility with any in-flight client pages that loaded before
 * this rollout.
 */
export function signBeaconPayload(
  chatId: string,
  step: string | null | undefined,
  source: string | null | undefined,
): string {
  if (!isBeaconHmacConfigured()) {
    emitMissingSecretWarningOnce();
    return "";
  }
  const secret = process.env.SCHEDULER_BEACON_HMAC_SECRET as string;
  return createHmac("sha256", secret)
    .update(canonicalizeBeaconPayload(chatId, step, source))
    .digest("base64url");
}

export type BeaconHmacResult =
  | "verified"
  | "mismatch"
  | "missing_sig"
  | "skipped";

/**
 * Verify a beacon sig against a chatId. Returns one of:
 *
 *   - "verified"   — sig is correct; caller proceeds with the beacon.
 *   - "mismatch"   — sig is present but wrong; caller REJECTS (204).
 *   - "missing_sig" — secret is configured but request had no sig;
 *                    caller REJECTS (204).
 *   - "skipped"    — secret not configured; caller proceeds without
 *                    HMAC enforcement (matches the dev / pre-launch
 *                    posture; one-time Sentry warning already emitted).
 *
 * Uses timing-safe comparison to defeat any sig-byte-by-byte timing
 * attack. Both expected and actual sigs are the same length (43 base64url
 * chars for a 32-byte SHA-256 digest) so a length mismatch immediately
 * fails — no timing leak from the early return.
 */
export function verifyBeaconSig(
  chatId: string,
  sig: string | null | undefined,
): BeaconHmacResult {
  return verifyBeaconPayloadSig(chatId, null, null, sig);
}

/**
 * Verify a beacon sig against the FULL payload (chatId + step + source).
 * Same return values as `verifyBeaconSig`.
 *
 * Acceptance: a sig matching the payload-bound signature is `verified`.
 * A sig matching the chatId-only signature is ALSO `verified` —
 * compatibility window for clients whose pages loaded before this
 * rollout. The chatId-only fallback is acceptable because the worst
 * case it permits is the original P1.5 surface (replay step/source
 * fields for analytics pollution — no DB write impact).
 */
export function verifyBeaconPayloadSig(
  chatId: string,
  step: string | null | undefined,
  source: string | null | undefined,
  sig: string | null | undefined,
): BeaconHmacResult {
  if (!isBeaconHmacConfigured()) {
    emitMissingSecretWarningOnce();
    return "skipped";
  }
  if (!sig) {
    return "missing_sig";
  }
  // Try payload-bound sig first.
  const expectedPayload = signBeaconPayload(chatId, step, source);
  if (
    sig.length === expectedPayload.length &&
    timingSafeEqual(Buffer.from(sig), Buffer.from(expectedPayload))
  ) {
    return "verified";
  }
  // Fallback: chatId-only sig (legacy compat for in-flight pages).
  const expectedChatId = createHmac(
    "sha256",
    process.env.SCHEDULER_BEACON_HMAC_SECRET as string,
  )
    .update(chatId)
    .digest("base64url");
  if (
    sig.length === expectedChatId.length &&
    timingSafeEqual(Buffer.from(sig), Buffer.from(expectedChatId))
  ) {
    return "verified";
  }
  return "mismatch";
}

/**
 * TEST-ONLY: reset the lazy-init warning gate. Used by unit tests to
 * exercise the missing-secret branch without polluting other tests'
 * Sentry call counts. Production code never calls this.
 */
export function __resetBeaconHmacWarningForTests(): void {
  envWarningEmitted = false;
}
