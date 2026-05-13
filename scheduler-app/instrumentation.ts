/**
 * Next.js 15 instrumentation file — Sentry server + edge init + onRequestError.
 *
 * Wired per .claude/rules/observability.md rule 4: "instrumentation.ts exports
 * onRequestError = Sentry.captureRequestError — captures Server Component +
 * middleware errors that would otherwise be invisible."
 *
 * Without this file every Server-Component / middleware / RSC error is
 * swallowed by Next.js's recovery boundary; the customer sees error.tsx but
 * no observability surface gets the trace. With it, those errors land in
 * Sentry alongside Server Action + client errors.
 *
 * The dynamic imports below ensure each runtime loads its own
 * sentry.{server|edge}.config.ts only when running in that runtime —
 * the @sentry/nextjs SDK is designed this way (per its v10 docs).
 *
 * NEXT_RUNTIME values per Next.js 15: 'nodejs' | 'edge'. There is no
 * separate 'browser' runtime here — client init runs from
 * instrumentation-client.ts.
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

// Capture Server Component + middleware + RSC errors that the App Router
// would otherwise silently absorb into the recovery boundary.
export const onRequestError = Sentry.captureRequestError;
