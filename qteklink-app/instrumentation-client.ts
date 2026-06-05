/**
 * Client-side instrumentation (browser). Auto-loaded by Next.js on first
 * client hydration. No Replay (internal tool; privacy review out of scope for
 * v1); qteklink-app is authenticated-only, so no BotID surface to defend.
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  enableLogs: true,
  initialScope: {
    tags: {
      surface: "qteklink-app-client",
    },
  },
});

// Required export for @sentry/nextjs router instrumentation per the v10
// instrumentation-client.ts pattern.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
