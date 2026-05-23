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
 * Validates the current request against Vercel BotID for sensitive
 * Server Actions (OTP send, etc.).
 *
 * On bot detection → returns `{ ok: false, reason: "bot_detected" }`.
 * On bypass (E2E test) → returns `{ ok: true, bypassed: true }`.
 * On human → returns `{ ok: true, bypassed: false }`.
 * On BotID failure → logs Sentry warning + returns `{ ok: true, bypassed: false }`
 *   (graceful degradation — see file header for rationale).
 */
export async function checkBotForSensitiveAction(): Promise<CheckBotResult> {
  try {
    const verification = await checkBotId();

    if (verification.isBot && !verification.bypassed) {
      return { ok: false, reason: "bot_detected" };
    }
    return { ok: true, bypassed: verification.bypassed };
  } catch (e) {
    // checkBotId() can throw when Vercel's bot-protection infra is
    // unreachable (transient outage, local dev without the Vercel
    // integration wired, or a misconfigured proxy). Fail-OPEN rather
    // than fail-closed: a missing bot check is strictly worse than a
    // false-positive bot check (the former lets a few extra bots through
    // for the outage window; the latter blocks legitimate customers
    // from ever receiving an OTP).
    //
    // The Sentry warning surfaces the misconfiguration so the operator
    // sees it. Rate-limit defense-in-depth (rate-limit.ts) is the
    // backstop here — even if BotID is down, IP + phone-hash limits
    // still cap abuse to a survivable level.
    Sentry.captureException(e, {
      level: "warning",
      tags: { surface: "check_bot_for_sensitive_action" },
      extra: {
        note: "checkBotId() threw; failing OPEN to avoid breaking legitimate OTPs. Rate-limits remain as backstop.",
      },
    });
    return { ok: true, bypassed: false };
  }
}
