/**
 * SEC-7 — per-phone OTP rate limit, backed by Postgres.
 *
 * Replaces the Upstash limiter (PLAN-03 Phase 1B) per the 2026-05-23
 * design pivot. The two layers now live in different places:
 *
 *   - PER-IP  → a Vercel Firewall edge rule (rejects IP-spray before it
 *               reaches our compute; no code here). See
 *               docs/scheduler/DEFERRED-AUDIT-ITEMS.md SEC-7 item 1.
 *   - PER-PHONE → this module: the `check_and_increment_rate_limit`
 *               Postgres RPC (3 sends / phone-hash / hour), called via the
 *               service-role admin client. The phone is encrypted in the
 *               POST body so the edge can't see it — per-phone shaping has
 *               to stay app-layer, but needs no external vendor.
 *
 * Fail-OPEN by default: if the RPC errors (or the client throws), we ALLOW
 * the request + emit a Sentry warning. We don't break OTP for legitimate
 * customers on a transient DB blip — the DB-level `otp_codes`
 * 3/phone/hour cap (enforced inside scheduler-otp-direct) remains the
 * backstop, and BotID is the prior gate. Set
 * `SCHEDULER_REQUIRE_RATE_LIMIT=true` to fail CLOSED instead (see
 * check-bot.ts for the shared flag).
 */
import { createHash } from "node:crypto";
import * as Sentry from "@sentry/nextjs";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isRateLimitStrictMode } from "@/lib/security/check-bot";

/** 3 OTP sends per phone-hash per hour (unchanged from the Upstash config). */
const OTP_PHONE_WINDOW_SECONDS = 3600;
const OTP_PHONE_MAX = 3;

export type RateLimitOutcome =
  | { allowed: true }
  | {
      allowed: false;
      reason: "rate_limited_phone" | "rate_limit_unavailable";
    };

/**
 * SHA-256-hash the phone to 16 hex chars (64-bit prefix) for use as the
 * rate-limit key — raw E.164 phones never leave the app for the bucket
 * store (PII minimization). Pure; exported for tests.
 */
export function hashPhone(phoneE164: string): string {
  return createHash("sha256").update(phoneE164).digest("hex").slice(0, 16);
}

/**
 * Check (and, when allowed, record) the per-phone OTP send limit via the
 * `check_and_increment_rate_limit` RPC. Returns `{ allowed: true }` when
 * under budget, `{ allowed: false, reason: "rate_limited_phone" }` when
 * over. On RPC/DB failure: fail-OPEN by default, fail-CLOSED
 * (`rate_limit_unavailable`) under strict mode.
 */
export async function checkPhoneRateLimit(
  phoneE164: string,
): Promise<RateLimitOutcome> {
  const strict = isRateLimitStrictMode();
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.rpc("check_and_increment_rate_limit", {
      p_key: `otp_phone:${hashPhone(phoneE164)}`,
      p_window_seconds: OTP_PHONE_WINDOW_SECONDS,
      p_max: OTP_PHONE_MAX,
    });
    if (error) return failOnError(error, strict);

    // The RPC RETURNS TABLE(...) → supabase-js returns an array of rows.
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.allowed === false) {
      return { allowed: false, reason: "rate_limited_phone" };
    }
    return { allowed: true };
  } catch (e) {
    return failOnError(e, strict);
  }
}

/** Shared fail-open/closed handler for an RPC error or a thrown client error. */
function failOnError(err: unknown, strict: boolean): RateLimitOutcome {
  Sentry.captureException(err, {
    level: strict ? "error" : "warning",
    tags: { surface: "check_phone_rate_limit", strict_mode: String(strict) },
    extra: {
      note: strict
        ? "check_and_increment_rate_limit failed with SCHEDULER_REQUIRE_RATE_LIMIT=true → failing CLOSED."
        : "check_and_increment_rate_limit failed; failing OPEN. BotID + the DB-level otp_codes 3/hour cap remain as backstops.",
    },
  });
  return strict
    ? { allowed: false, reason: "rate_limit_unavailable" }
    : { allowed: true };
}
