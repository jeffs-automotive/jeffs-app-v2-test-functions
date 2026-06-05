/**
 * Next.js 15 instrumentation file — Sentry server + edge init.
 *
 * Per .claude/rules/observability.md rule 4: instrumentation.ts exports
 * onRequestError = Sentry.captureRequestError so Server Component +
 * middleware errors that the App Router would silently absorb instead
 * land in Sentry. Same pattern as scheduler-app/instrumentation.ts.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
