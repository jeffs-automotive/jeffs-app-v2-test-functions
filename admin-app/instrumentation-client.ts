/**
 * Client-side instrumentation (browser).
 *
 * Auto-loaded by Next.js on first client hydration. Simpler than
 * scheduler-app's — no Vercel BotID (admin-app is authenticated-only,
 * no SMS-pump surface to defend), no Replay (internal tool; replay
 * privacy review is out of scope for v1).
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  enableLogs: true,
  initialScope: {
    tags: {
      surface: "admin-app-client",
      shop_id: "7476",
    },
  },
});

// Required export for @sentry/nextjs router instrumentation per the v10
// instrumentation-client.ts pattern.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
