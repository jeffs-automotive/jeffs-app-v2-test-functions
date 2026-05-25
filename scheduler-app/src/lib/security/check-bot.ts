/**
 * PLAN-03 Phase 1A — Vercel BotID wrapper for SMS-triggering Server Actions.
 *
 * SMS pumping has cost X/Twitter ~$60M/year and is the most likely first
 * attack we'll see when DNS goes live. BotID's Basic tier (free) blocks
 * sophisticated bots that run JavaScript, solve CAPTCHAs, and mimic real
 * users via Playwright/Puppeteer — exactly the toolchain attackers use to
 * pump OTP endpoints for SMS-cost amplification.
 *
 * Why this wrapper (and not inline checkBotId() at each call site):
 *
 *   1. Single place to encode the "is this a bot? if so, reject; if
 *      bypassed for E2E, allow" decision — avoids drift across the 3
 *      SMS-sending Server Actions (submit-phone-name, resend-otp,
 *      submit-multi-account-choice).
 *   2. Graceful degradation: if BotID throws (e.g., local dev without the
 *      Vercel integration, or a transient Vercel outage), we ALLOW the
 *      request with a Sentry warning rather than fail-closed. Failing
 *      closed would break OTP for legitimate customers — worse outcome
 *      than the marginal attack-surface widening during a Vercel outage.
 *   3. E2E bypass: VERCEL_AUTOMATION_BYPASS_SECRET set as a Vercel env
 *      var causes checkBotId() to return `bypassed: true` when the test
 *      browser sends `x-vercel-protection-bypass: <secret>`. Playwright
 *      happy-path tests rely on this so we don't have to mock BotID in
 *      the e2e harness.
 *
 * Return shape mirrors WizardTransitionResult's failure path: callers can
 * pass the helper's error directly into their action's return without
 * extra mapping.
 *
 * Reference docs:
 *   - https://vercel.com/docs/botid
 *   - https://vercel.com/docs/botid/get-started
 *   - https://vercel.com/docs/botid/local-development-behavior
 *
 * Vercel dashboard setup (one-time, no code change): Project → BotID →
 * enable Basic (free). Deep Analysis ($1/1k checks) deferred until we see
 * real attack traffic justifying the cost. See DEFERRED-AUDIT-ITEMS SEC-7.
 *
 * The matching client-side `initBotId()` call lives in
 * `scheduler-app/instrumentation-client.ts` — without it, checkBotId()
 * will classify every request as a bot in production. Both halves are
 * required; this helper covers the server half only.
 */
import * as Sentry from "@sentry/nextjs";
import { checkBotId } from "botid/server";

export type CheckBotResult =
  | { ok: true; bypassed: boolean }
  | { ok: false; reason: string };

/**
 * P1.4 post-validator fix (2026-05-25): when SCHEDULER_REQUIRE_RATE_LIMIT
 * is set to "true", checkBotForSensitiveAction fails CLOSED on BotID
 * throw — returns `{ ok: false, reason: "bot_check_unavailable" }`
 * instead of allowing the request through.
 *
 * Recommended deployment posture:
 *   - LOCAL dev: leave unset (fail-OPEN keeps the wizard usable
 *     without Vercel BotID configured).
 *   - PROD pre-launch (DNS pointed, real customers expected): set
 *     SCHEDULER_REQUIRE_RATE_LIMIT=true on Vercel. If BotID infra
 *     hiccups, OTP-sending Server Actions return bot_check_unavailable
 *     instead of letting SMS pumping through. Acceptable trade-off
 *     once activation completes per DEFERRED-AUDIT-ITEMS SEC-7.
 *
 * The shared env-var helper below is also used by rate-limit.ts so
 * both layers flip together — operators don't have to enable
 * fail-closed for each separately.
 */
export function isRateLimitStrictMode(): boolean {
  return process.env.SCHEDULER_REQUIRE_RATE_LIMIT === "true";
}

/**
 * 2026-05-25 unblock — `SCHEDULER_DISABLE_BOT_CHECK=true` skips
 * BotID entirely + returns `{ ok: true, bypassed: true }`.
 *
 * Why this env var exists: Vercel BotID requires THREE wiring
 * pieces to function — (1) `initBotId()` called on the client
 * via instrumentation-client.ts, (2) `botid({...})` config wrapper
 * applied to next.config.ts, (3) the BotID feature enabled in the
 * Vercel project dashboard. Without ALL THREE, `checkBotId()`
 * fails-CLOSED: it classifies legitimate requests as bots because
 * the client never sends the detection signals BotID expects to
 * see in the request. Result: every OTP submit returns
 * `bot_detected` and the wizard appears frozen with no customer-
 * facing error.
 *
 * The other security layers (Upstash rate-limit, HMAC beacon)
 * gracefully degrade when unconfigured (`disabled: true` /
 * `"skipped"`). BotID does not — hence this explicit opt-out.
 *
 * Operator posture:
 *   - TEST sandbox before BotID activation: set
 *     SCHEDULER_DISABLE_BOT_CHECK=true to unblock testing
 *   - PROD pre-launch: complete the BotID wiring per SEC-7 +
 *     unset this env var; the check resumes as the first line
 *     of SMS-pump defense.
 */
export function isBotCheckDisabled(): boolean {
  return process.env.SCHEDULER_DISABLE_BOT_CHECK === "true";
}

/**
 * Validates the current request against Vercel BotID for sensitive
 * Server Actions (OTP send, etc.).
 *
 * On bot detection → returns `{ ok: false, reason: "bot_detected" }`.
 * On bypass (E2E test) → returns `{ ok: true, bypassed: true }`.
 * On human → returns `{ ok: true, bypassed: false }`.
 * On BotID failure with SCHEDULER_REQUIRE_RATE_LIMIT=true → fail CLOSED:
 *   returns `{ ok: false, reason: "bot_check_unavailable" }`.
 * On BotID failure without the strict flag → fail OPEN:
 *   logs Sentry warning + returns `{ ok: true, bypassed: false }`.
 */
export async function checkBotForSensitiveAction(): Promise<CheckBotResult> {
  // 2026-05-25 unblock — short-circuit when the operator explicitly
  // disabled the bot check (see isBotCheckDisabled comment for the
  // full BotID wiring story). Bypass shape matches a verified-human
  // result so callers don't need a new branch.
  if (isBotCheckDisabled()) {
    return { ok: true, bypassed: true };
  }
  try {
    const verification = await checkBotId();

    if (verification.isBot && !verification.bypassed) {
      return { ok: false, reason: "bot_detected" };
    }
    return { ok: true, bypassed: verification.bypassed };
  } catch (e) {
    // checkBotId() can throw when Vercel's bot-protection infra is
    // unreachable (transient outage, local dev without the Vercel
    // integration wired, or a misconfigured proxy).
    //
    // Default (fail-OPEN): a missing bot check is strictly worse than
    // a false-positive bot check during local dev / pre-launch.
    //
    // Strict mode (SCHEDULER_REQUIRE_RATE_LIMIT=true): a missing bot
    // check on production traffic with real SMS-pump exposure is
    // EXACTLY the moment we should NOT be letting requests through.
    // Fail closed; operator gets the Sentry error + customer gets a
    // bot_check_unavailable error they can retry from.
    const strict = isRateLimitStrictMode();
    Sentry.captureException(e, {
      level: strict ? "error" : "warning",
      tags: {
        surface: "check_bot_for_sensitive_action",
        strict_mode: String(strict),
      },
      extra: {
        note: strict
          ? "checkBotId() threw with SCHEDULER_REQUIRE_RATE_LIMIT=true → failing CLOSED."
          : "checkBotId() threw; failing OPEN to avoid breaking legitimate OTPs. Rate-limits remain as backstop.",
      },
    });
    if (strict) {
      return { ok: false, reason: "bot_check_unavailable" };
    }
    return { ok: true, bypassed: false };
  }
}
