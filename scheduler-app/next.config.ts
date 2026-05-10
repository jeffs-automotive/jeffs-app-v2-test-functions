import type { NextConfig } from "next";

/**
 * Next.js config for scheduler-app.
 *
 * Per appointments_design.md §15:
 * - Runtime: nodejs (NOT edge) for the chat endpoint — needed for AI SDK v5
 *   + 3 provider adapters and to avoid the 30s Edge wall-clock cap.
 *   maxDuration is set on the route handler itself (`export const maxDuration = 300`).
 * - Bundle target: Node.js, mainstream Next.js settings.
 *
 * This file is intentionally minimal at scaffolding time. Add reactStrictMode,
 * image domains, redirects, etc. as the app grows.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Required for the experimental Server Actions cookie-write flow if we
  // expand cookie usage; safe default.
  experimental: {
    // Place flags here as we adopt them. Keep empty by default to avoid
    // pulling in unstable behavior.
  },
};

export default nextConfig;
