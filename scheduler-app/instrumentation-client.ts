/**
 * Sentry client-side init (browser).
 *
 * Auto-loaded by Next.js on first client hydration. The newer
 * `instrumentation-client.ts` filename (vs the legacy
 * `sentry.client.config.ts`) is preferred by @sentry/nextjs v10 per docs.
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
