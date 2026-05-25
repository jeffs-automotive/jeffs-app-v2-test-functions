import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
// 2026-05-25 BotID proper wiring — per botid@1.5.11 README. The
// `withBotId` wrap adds the proxy rewrites that hide BotID's
// challenge endpoint behind a randomized path. Without this wrap,
// the matching `initBotId({...})` call in `instrumentation-client.ts`
// has nowhere to fetch detection tokens from, and `checkBotId()`
// on the server side classifies every request as a bot. Replaces
// the prior `SCHEDULER_DISABLE_BOT_CHECK` env-var bandaid.
import { withBotId } from "botid/next/config";

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
 * Security headers applied to every response.
 *
 * P2.9 post-validator fix (2026-05-25): CSP mode now defaults to
 * ENFORCED (Content-Security-Policy header). Was Report-Only.
 *
 * Why the flip: this is the test-sandbox project (no real customer
 * traffic). Enforced mode in test catches CSP violations BEFORE prod
 * cutover. Report-Only here would have buried violations in Sentry
 * forever without ever surfacing as "this would have broken the
 * wizard" pressure.
 *
 * Rollback path: set env var `SCHEDULER_CSP_REPORT_ONLY=true` on
 * Vercel to revert this deployment to Report-Only mode. Useful if a
 * legitimate-but-uncatalogued resource starts loading post-flip
 * (e.g., a new analytics tag) — flip the env var to Report-Only,
 * triage the violations, add the source to buildCSP, then unset the
 * env var. No code redeploy needed for the rollback.
 *
 * Documented in DEFERRED-AUDIT-ITEMS SEC-NEXT (nonce-based CSP) for
 * the next hardening pass — that's a separate concern (tighten
 * script-src away from 'unsafe-inline' via App Router nonce plumbing).
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
  // P2.9-followup (2026-05-25): with CSP now in enforce mode by default
  // (was Report-Only), the prior wildcard fallback `https://*.supabase.co`
  // becomes an actual security boundary, not just a comment. In CI/
  // Vercel builds with a missing env var, the wildcard would silently
  // allow connections to ANY Supabase project — defeating multi-
  // tenant boundary intent. Fail the build loudly instead so operators
  // notice the misconfiguration before the deploy lands.
  //
  // Local dev (no CI, no Vercel) keeps the wildcard fallback so
  // `npm run dev` works without env-var plumbing. The Sentry
  // CSP-Report-Only fallback (set via SCHEDULER_CSP_REPORT_ONLY=true)
  // can also be used to revert enforce mode if a misconfigured deploy
  // does land.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    if (process.env.CI || process.env.VERCEL) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL is required at build time for CSP connect-src. " +
          "Set it on Vercel (Production + Preview envs both) before building.",
      );
    }

    console.warn(
      "[next.config] NEXT_PUBLIC_SUPABASE_URL not set — CSP connect-src falling back to `https://*.supabase.co`. " +
        "Set the env var before deploying to prod (CI/Vercel will fail the build if missing).",
    );
  }
  const connectSrcSupabase = supabaseUrl ?? "https://*.supabase.co";
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    `connect-src 'self' ${connectSrcSupabase}`,
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

// P2.9 (2026-05-25): CSP header key is now selected by env var. Default
// is ENFORCED ("Content-Security-Policy"); set SCHEDULER_CSP_REPORT_ONLY=true
// on Vercel to revert this deployment to Report-Only (the original
// posture). Operator can flip without a code redeploy.
const CSP_HEADER_KEY =
  process.env.SCHEDULER_CSP_REPORT_ONLY === "true"
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";

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
  // P2.9: enforced by default. Set SCHEDULER_CSP_REPORT_ONLY=true to
  // revert (see CSP_HEADER_KEY above).
  {
    key: CSP_HEADER_KEY,
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
// BotID wrap goes INSIDE withSentryConfig (Sentry as the outermost
// wrap is the documented Sentry pattern). BotID modifies the
// nextConfig's `rewrites` to add its challenge endpoint; Sentry then
// wraps that for source-map + instrumentation injection.
export default withSentryConfig(withBotId(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Quiet local builds; print upload logs in CI / Vercel only.
  silent: !process.env.CI && !process.env.VERCEL,

  // P2.11 post-validator fix (2026-05-25): production source-map upload
  // failures used to console.warn silently — meaning Sentry stack
  // traces in prod were unmapped (file:line referred to compiled
  // bundle names like /chunks/4912-abc.js instead of src/lib/scheduler/...).
  // Now: local dev (no CI, no Vercel) continues to warn-and-proceed
  // (no SENTRY_AUTH_TOKEN expected; upload no-ops anyway). CI + Vercel
  // builds THROW so the build fails loudly + ops sees the regression
  // before it lands on appointments.jeffsautomotive.com.
  errorHandler: (err) => {
    if (process.env.CI || process.env.VERCEL) {
       
      console.error(
        "[sentry] source-map upload failed in CI/Vercel build — failing build to prevent unmapped prod stack traces:",
        err.message,
      );
      throw err;
    }
     
    console.warn(
      "[sentry] source-map upload failed (local build):",
      err.message,
    );
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
