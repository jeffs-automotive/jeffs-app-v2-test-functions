/**
 * PLAN-03 Phase 1B — Upstash rate-limit (defense-in-depth on top of BotID).
 *
 * Two-layer rate-limit for SMS-sending Server Actions:
 *
 *   - `otpSendPerIp` — 5 sends per IP per minute. Catches the "single bot
 *     IP rotating phone numbers" attack pattern (SMS pumping at scale).
 *   - `otpSendPerPhone` — 3 sends per phone-hash per hour. Backstop in
 *     case a botnet rotates IPs to evade the per-IP limit.
 *
 * The existing `otp_codes` table enforces a 3-per-phone-per-hour limit
 * server-side (inside the scheduler-otp-direct edge fn), but Upstash adds:
 *
 *   - Per-IP coverage (the DB limit is keyed on phone only — useless
 *     against the "1000 phones, 1 IP" attack)
 *   - Faster rejection (no DB roundtrip on the rate-check fast path —
 *     a hot IP is rejected before we call into the edge fn at all)
 *
 * The two layers compose: BotID (signal-based) → IP limit → phone limit
 * → DB limit. An attacker has to defeat every layer to pump a single
 * phone.
 *
 * Graceful degradation: if UPSTASH_REDIS_REST_URL or
 * UPSTASH_REDIS_REST_TOKEN are missing (Chris hasn't created the Upstash
 * project yet), the limiters ALLOW the request + emit a one-time Sentry
 * warning on first call. We don't want a missing Upstash account to
 * break OTP for legitimate customers — but we DO want operators to see
 * the warning so the account gets set up.
 *
 * Reference docs:
 *   - https://upstash.com/docs/redis/sdks/ratelimit-ts/gettingstarted
 *   - https://upstash.com/docs/redis/sdks/ratelimit-ts/methods
 *
 * Operator setup (one-time): create a free Upstash Redis project at
 * https://console.upstash.com/, copy the REST URL + token from the
 * project dashboard, and set them on Vercel (Production + Preview envs).
 * Free tier (10k commands/day) is sufficient for v1 — each OTP send
 * triggers 2 commands (IP limit + phone limit). See
 * DEFERRED-AUDIT-ITEMS SEC-7 for full setup instructions.
 */
import { createHash } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Lazy-initialized singletons. We can't construct Ratelimit at module
 * scope because:
 *   1. If env vars are missing, `Redis.fromEnv()` throws synchronously,
 *      taking down every module that imports rate-limit.ts (including
 *      the unrelated server boot path).
 *   2. We want to emit the "missing env vars" Sentry warning ONCE per
 *      process — not on every action call.
 */
let cachedState:
  | { kind: "ready"; ipLimiter: Ratelimit; phoneLimiter: Ratelimit }
  | { kind: "disabled" }
  | null = null;

function getRateLimiters():
  | { kind: "ready"; ipLimiter: Ratelimit; phoneLimiter: Ratelimit }
  | { kind: "disabled" } {
  if (cachedState !== null) return cachedState;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    // Emit warning ONCE per process. The Sentry tag identifies the
    // operator-fixable misconfiguration so it gets noticed in triage.
    Sentry.captureMessage(
      "Upstash rate-limit env vars missing — OTP rate limit DISABLED (failing open). " +
        "Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN on Vercel to enable.",
      {
        level: "warning",
        tags: { surface: "rate_limit_init", misconfiguration: "upstash_missing" },
      },
    );
    cachedState = { kind: "disabled" };
    return cachedState;
  }

  const redis = new Redis({ url, token });

  cachedState = {
    kind: "ready",
    ipLimiter: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "1 m"),
      analytics: true,
      prefix: "otp_send_ip",
    }),
    phoneLimiter: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(3, "1 h"),
      analytics: true,
      prefix: "otp_send_phone",
    }),
  };
  return cachedState;
}

export type RateLimitOutcome =
  | { allowed: true; disabled: boolean }
  | { allowed: false; reason: "rate_limited_ip" | "rate_limited_phone" };

/**
 * Check the per-IP rate limit (5/min). Returns `{ allowed: true }` when
 * the request is allowed (or when Upstash is unconfigured), or
 * `{ allowed: false, reason: "rate_limited_ip" }` when over limit.
 *
 * On Upstash transient failure → fail OPEN (log + allow). Same rationale
 * as check-bot.ts: degrading limits during an outage is strictly worse
 * than breaking OTP for legitimate users; BotID + the DB-level phone
 * limit remain as backstops.
 */
export async function checkIpRateLimit(ip: string): Promise<RateLimitOutcome> {
  const state = getRateLimiters();
  if (state.kind === "disabled") {
    return { allowed: true, disabled: true };
  }
  try {
    const result = await state.ipLimiter.limit(ip);
    if (!result.success) {
      return { allowed: false, reason: "rate_limited_ip" };
    }
    return { allowed: true, disabled: false };
  } catch (e) {
    Sentry.captureException(e, {
      level: "warning",
      tags: { surface: "check_ip_rate_limit" },
      extra: {
        note: "Upstash limit() threw; failing OPEN. BotID + DB-level phone limit remain as backstops.",
      },
    });
    return { allowed: true, disabled: false };
  }
}

/**
 * Check the per-phone-hash rate limit (3/hour). Phone is SHA-256-hashed
 * to 16 hex chars before use as the Redis key — keeps raw E.164 phones
 * out of Upstash storage (PII minimization).
 *
 * Same fail-open behavior as checkIpRateLimit on transient failure.
 */
export async function checkPhoneRateLimit(
  phoneE164: string,
): Promise<RateLimitOutcome> {
  const state = getRateLimiters();
  if (state.kind === "disabled") {
    return { allowed: true, disabled: true };
  }
  try {
    const result = await state.phoneLimiter.limit(hashPhone(phoneE164));
    if (!result.success) {
      return { allowed: false, reason: "rate_limited_phone" };
    }
    return { allowed: true, disabled: false };
  } catch (e) {
    Sentry.captureException(e, {
      level: "warning",
      tags: { surface: "check_phone_rate_limit" },
      extra: {
        note: "Upstash limit() threw; failing OPEN. BotID + DB-level phone limit remain as backstops.",
      },
    });
    return { allowed: true, disabled: false };
  }
}

/**
 * SHA-256-hash the phone number to 16 hex chars (64-bit prefix). Used as
 * the Redis key for the per-phone limit so raw E.164 phones never hit
 * Upstash storage. 64 bits of collision resistance is plenty for a
 * keyspace bounded by ~10 billion possible US phone numbers (worst-case
 * birthday collision probability negligible).
 *
 * Pure function — exported for unit tests + so multi-account-choice can
 * reuse the same hashing scheme when it pulls the phone off the row.
 */
export function hashPhone(phoneE164: string): string {
  return createHash("sha256").update(phoneE164).digest("hex").slice(0, 16);
}

/**
 * TEST-ONLY: reset the lazy-init cache. Used by unit tests to flip
 * between "Upstash configured" and "Upstash missing" branches in the
 * same process. Production code never calls this.
 */
export function __resetRateLimitCacheForTests(): void {
  cachedState = null;
}
