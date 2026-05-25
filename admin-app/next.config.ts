import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

/**
 * Next.js config for admin-app.
 *
 * Differs from scheduler-app in three intentional ways (see
 * docs/admin-dashboard/PLAN.md §3 + §8):
 *
 *  1. NO BotID — admin-app is authenticated-only; the SMS-pump
 *     attack surface that BotID guards on scheduler-app does not
 *     exist here. Skipping the dep keeps the bundle smaller +
 *     the auth flow simpler.
 *  2. NO custom CSP yet — internal employee tool, low priority
 *     for v1. Defaults to Next's standard hardening. Can revisit
 *     post-launch if it shipped to a wider audience.
 *  3. NO rate limiting — authenticated employee traffic only.
 *     Re-evaluate at first abuse signal.
 *
 * Sentry: wrapped via withSentryConfig at export time. DSN +
 * auth token + org/project slug come from env vars so this file
 * stays committable. See feedback_vercel_cli_env_bug.md for the
 * "set env vars via Dashboard UI, NOT CLI" gotcha.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Same image / asset config as scheduler-app for consistency.
  images: {
    remotePatterns: [],
  },

  // Security headers — minimal sane defaults for an authenticated
  // employee dashboard.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

const sentryWebpackPluginOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: true,
  hideSourceMaps: true,
  disableLogger: true,
  // Per scheduler-app's P2.11 lesson: source-map upload errors should
  // FAIL the CI build, not silently degrade observability.
  errorHandler: (err: Error) => {
    throw err;
  },
};

export default withSentryConfig(nextConfig, sentryWebpackPluginOptions);
