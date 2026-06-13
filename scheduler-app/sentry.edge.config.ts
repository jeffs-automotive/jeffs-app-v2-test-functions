/**
 * Sentry edge-runtime init.
 *
 * Auto-loaded by instrumentation.ts when NEXT_RUNTIME === 'edge'. The
 * scheduler-app's API route (`app/api/scheduler/mark-abandoned/route.ts`) is
 * pinned to Node runtime via `export const runtime = 'nodejs'`. middleware.ts
 * (cookie resume per F14) defaults to the edge runtime and needs Sentry
 * coverage too.
 *
 * Edge runtime is V8-isolate-based — no Node modules, no fs, no
 * opossum-style circuit breakers. The Sentry SDK has a slimmer edge build
 * that we get for free by importing @sentry/nextjs.
 */

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // PLAN-02 Phase 2B (I-OBS-8) — enable structured logs. See
  // sentry.server.config.ts for full rationale. Must be set on every runtime
  // (server, edge, client) per Sentry docs; defaults to false.
  enableLogs: true,

  initialScope: {
    tags: {
      surface: "scheduler-app-edge",
      shop_id: "7476",
    },
  },
});
