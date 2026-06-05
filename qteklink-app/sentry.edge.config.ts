/**
 * Sentry edge-runtime init for qteklink-app.
 *
 * Auto-loaded by instrumentation.ts when NEXT_RUNTIME === 'edge'. Middleware
 * defaults to edge runtime — this gives Sentry coverage for middleware errors.
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  enableLogs: true,
  initialScope: {
    tags: {
      // shop_id resolved per-request (multi-realm-capable) — not hardcoded.
      surface: "qteklink-app-edge",
    },
  },
});
