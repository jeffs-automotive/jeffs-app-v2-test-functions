import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

/**
 * Next.js config for qteklink-app.
 *
 * Authenticated-only (allowlist-gated), so — like admin-app — no BotID, no
 * custom CSP yet, and no rate limiting (re-evaluate at first abuse signal).
 *
 * The QBO connect-flow routing + legal pages (admin-app's `/qbo/connect`
 * redirect and `/legal/*` + `/qbo/connected` rewrites) are intentionally NOT
 * here yet — they move to qteklink-app in the connect-flow phase (C8) together
 * with the `public/` pages and the Intuit app-profile URL re-registration.
 * Carrying dead rewrites now would 404 (the target pages don't exist in this
 * app).
 *
 * Sentry: wrapped via withSentryConfig at export time; DSN + auth token +
 * org/project slug come from env vars so this file stays committable.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  images: {
    remotePatterns: [],
  },

  // Security headers — minimal sane defaults for an authenticated dashboard.
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
  // Per scheduler-app's P2.11 lesson: source-map upload errors should FAIL the
  // CI build, not silently degrade observability.
  errorHandler: (err: Error) => {
    throw err;
  },
};

export default withSentryConfig(nextConfig, sentryWebpackPluginOptions);
