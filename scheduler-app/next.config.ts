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
/**
 * PLAN-03 Phase 5 (bonus) — Customer-facing route hardening.
 *
 * Security headers applied to every response. CSP starts in Report-Only
 * mode for ~1 week to log violations without blocking, then upgrades to
 * enforced (Content-Security-Policy) after we've verified no production
 * traffic triggers it. Switch by:
 *   1. After 1 week of clean CSP-Report-Only logs in Sentry,
 *   2. Change `Content-Security-Policy-Report-Only` key →
 *      `Content-Security-Policy` (same value).
 *
 * HSTS preload submission (https://hstspreload.org/) requires 1 year of
 * `max-age=31536000` ingestion + `includeSubDomains` + `preload` directive.
 * We set max-age=63072000 (2 years) immediately so DNS-launch day starts
 * the preload countdown.
 *
 * X-Frame-Options DENY + CSP `frame-ancestors 'none'` are belt-and-
 * suspenders for clickjacking — older browsers honor X-Frame-Options,
 * modern browsers honor frame-ancestors.
 *
 * connect-src includes:
 *   - 'self' (covers same-origin fetches + Sentry's /monitoring tunnel)
 *   - the test Supabase URL (NEXT_PUBLIC_SUPABASE_URL — interpolated
 *     from env so prod uses the prod URL)
 * Wildcard https: NOT used — Vercel AI Gateway proxy happens server-
 * side, not client-side; OTP send + diagnose go through Server Actions
 * (same-origin POST), which are covered by 'self'.
 *
 * script-src includes 'unsafe-inline' for Next.js's hydration data
 * scripts. Tightening to nonce-based CSP is a future hardening pass
 * (requires App Router nonce plumbing via middleware). Documented as a
 * follow-up in DEFERRED-AUDIT-ITEMS SEC-NEXT.
 */
function buildCSP(): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://*.supabase.co";
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    `connect-src 'self' ${supabaseUrl}`,
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

const securityHeaders = [
  // 2 years; submit to https://hstspreload.org/ once DNS is live for 1 year.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Defense vs clickjacking. CSP frame-ancestors below is the modern equivalent.
  { key: "X-Frame-Options", value: "DENY" },
  // Defense vs MIME confusion attacks.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak full URL to cross-origin destinations.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Disable browser features we don't use. interest-cohort=() opts out of FLoC.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // CSP in Report-Only mode for the first week post-deploy. Switch the
  // key name to `Content-Security-Policy` (drop -Report-Only) after
  // verifying no production traffic triggers violations.
  {
    key: "Content-Security-Policy-Report-Only",
    value: buildCSP(),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Lint runs via `npm run lint` (eslint .) using eslint.config.mjs.
  // The eslint-config-next 15.x dependency was removed in favor of
  // @next/eslint-plugin-next direct usage to avoid @rushstack/eslint-patch
  // failures on Node 20+. See PLAN-01 Phase 3A.

  // PLAN-03 Phase 5 — security headers on every route.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },

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
