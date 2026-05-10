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

  // Disable lint at build time.
  //
  // Reason: eslint-config-next 15.x bundles @rushstack/eslint-patch, which
  // fails on Node 20+ ("Failed to patch ESLint because the calling module
  // was not recognized" — see github.com/microsoft/rushstack/issues). The
  // patch is dropped in eslint-config-next 16.x but that's paired with
  // Next.js 16, which we're holding (see scheduler_project_state.md
  // dependency decision matrix).
  //
  // Lint intent is preserved in eslint.config.mjs and tracked separately;
  // CI / pre-commit can run `npx eslint .` once the config is rewritten
  // to use @next/eslint-plugin-next directly (without the rushstack
  // wrapper). For now: TypeScript strict + Vitest + observability rules
  // are the safety net.
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Required for the experimental Server Actions cookie-write flow if we
  // expand cookie usage; safe default.
  experimental: {
    // Place flags here as we adopt them. Keep empty by default to avoid
    // pulling in unstable behavior.
  },
};

export default nextConfig;
