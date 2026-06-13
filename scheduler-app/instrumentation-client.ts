/**
 * Client-side instrumentation (browser).
 *
 * Auto-loaded by Next.js on first client hydration. The newer
 * `instrumentation-client.ts` filename (vs the legacy
 * `sentry.client.config.ts`) is preferred by @sentry/nextjs v10 per docs.
 *
 * Wires:
 *   - Sentry browser SDK (DSN + replay sampling)
 *   - Vercel BotID client (token attachment for protected POST routes)
 *
 * Vercel BotID (2026-05-25 — proper wiring per botid@1.5.11 README):
 *   `initBotId({ protect: [...] })` registers the route patterns whose
 *   POST requests get a bot-detection token attached at fetch time.
 *   The matching `checkBotId()` calls in `src/lib/security/check-bot.ts`
 *   verify those tokens server-side. The `withBotId()` wrap in
 *   `next.config.ts` is the third leg of the tripod — it sets up the
 *   proxy rewrites BotID's challenge endpoint hides behind.
 *
 *   What's protected: every wizard route's POSTs (where Server Actions
 *   submit). The wizard renders at `/` and `/book` per `BookPageShell.tsx`.
 *   Every Server Action POSTs to the page that called it, so protecting
 *   both routes covers the 3 SMS-triggering actions (submit-phone-name,
 *   resend-otp, submit-multi-account-choice) AND attaches harmless tokens
 *   to the other ~24 Server Actions (which don't call checkBotId
 *   server-side so the tokens are simply ignored).
 *
 *   What's NOT protected: `/api/scheduler/mark-abandoned` — that beacon
 *   has its own HMAC auth (P1.5 / SEC-8) and is fired via sendBeacon
 *   during browser tear-down, when the BotID client SDK can't reliably
 *   attach tokens anyway.
 *
 * DSN comes from NEXT_PUBLIC_SENTRY_DSN (must be NEXT_PUBLIC_-prefixed for
 * Vercel to expose to the browser bundle).
 *
 * Replays are opt-in at 10% baseline + 100% on error so we can play back
 * the customer's wizard interaction when something goes wrong. Critical
 * for diagnosing "the card froze" symptoms that don't reproduce on a
 * fresh session.
 */

import * as Sentry from "@sentry/nextjs";
import { initBotId } from "botid/client/core";

initBotId({
  protect: [
    { path: "/", method: "POST" },
    { path: "/book", method: "POST" },
  ],
});

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // PLAN-02 Phase 2B (I-OBS-8) — enable structured logs. See
  // sentry.server.config.ts for full rationale. Must be set on every runtime
  // (server, edge, client) per Sentry docs; defaults to false.
  enableLogs: true,

  sendDefaultPii: true,

  integrations: [
    Sentry.replayIntegration({
      // Mask all text input + textareas; the customer's phone + name + concern
      // notes are all entered through these. The card-level inputs use real
      // <input>/<textarea> so this masking covers them.
      maskAllText: true,
      maskAllInputs: true,
      // Don't block any media (avatars, vehicle photos if added Phase 2).
      blockAllMedia: false,
    }),
  ],

  // 10% baseline replay capture; ramp on error.
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  initialScope: {
    tags: {
      surface: "scheduler-app-client",
      shop_id: "7476",
    },
  },
});

// Instrument App Router navigations for tracing per Sentry NextJS v10 docs.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
