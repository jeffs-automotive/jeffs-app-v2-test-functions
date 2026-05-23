import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

/**
 * Next.js config for scheduler-app.
 *
 * Per appointments_design.md §15:
 * - Runtime: nodejs (NOT edge) for the chat endpoint — needed for AI SDK v5
 *   + 3 provider adapters and to avoid the 30s Edge wall-clock cap.
 *   maxDuration is set on the route handler itself (`export const maxDuration = 300`).
 * - Bundle target: Node.js, mainstream Next.js settings.
 *
 * Sentry: wrapped via withSentryConfig at export time. Per
 * .claude/rules/observability.md rule 4 + 13. DSN + auth token + org/project
 * slug come from env vars so this file stays committable.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Lint runs via `npm run lint` (eslint .) using eslint.config.mjs.
  // The eslint-config-next 15.x dependency was removed in favor of
  // @next/eslint-plugin-next direct usage to avoid @rushstack/eslint-patch
  // failures on Node 20+. See PLAN-01 Phase 3A.

  // Required for the experimental Server Actions cookie-write flow if we
  // expand cookie usage; safe default.
  experimental: {
    // Place flags here as we adopt them. Keep empty by default to avoid
    // pulling in unstable behavior.
  },
};

// withSentryConfig handles source-map upload + auto-instrumentation. If
// SENTRY_AUTH_TOKEN is missing (local dev), the upload step no-ops and
// the wrapper falls back to ID-only error reporting (still useful).
//
// Env vars (set in Vercel):
//   SENTRY_AUTH_TOKEN   — created in Sentry → User Settings → Auth Tokens
//   NEXT_PUBLIC_SENTRY_DSN — public DSN, exposed to browser bundle
//   SENTRY_DSN          — server DSN (usually same value, sometimes scoped)
//   SENTRY_ORG          — Sentry org slug (e.g. "jeffs-automotive")
//   SENTRY_PROJECT      — Sentry project slug (e.g. "scheduler-app")
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Quiet local builds; print upload logs in CI / Vercel only.
  silent: !process.env.CI && !process.env.VERCEL,

  // Don't fail the build if Sentry upload fails (e.g., no auth token in a
  // local build). Errors will still be captured at runtime via
  // instrumentation.ts; only source-map upload is affected.
  errorHandler: (err) => {
    // eslint-disable-next-line no-console
    console.warn("[sentry] source-map upload failed:", err.message);
  },

  // Forward `/monitoring` requests to Sentry servers. Helps with ad-blockers
  // that block requests to *.sentry.io. Set to false if you want direct
  // Sentry transport.
  tunnelRoute: "/monitoring",

  // Bundler-specific options live under `webpack.*` (and `_experimental.*`
  // for Turbopack) since @sentry/nextjs v10. The top-level form is deprecated
  // and slated for removal in a future major (likely v11). See:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/build/
  webpack: {
    // Disable the React component name plugin — it's noisy at compile time
    // and the value-add is minimal for our wizard surface.
    reactComponentAnnotation: { enabled: false },
  },

  // Source-map upload is fine to keep on by default; auth-token-gated.
});
