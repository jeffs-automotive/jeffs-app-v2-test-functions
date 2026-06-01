import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for admin-app (Phase G — added 2026-06-01).
 *
 * The dashboard is Microsoft-Entra-gated, so the hermetic smoke surface that
 * needs NO Microsoft session is the AUTH GATE: an unauthenticated request to a
 * protected route must redirect to /login (requireAdmin(), src/lib/auth.ts).
 * Authenticated read/write E2E (mocked OAuth session cookie) is a follow-up.
 *
 * Run locally (auto-starts `next dev -p 3001`):
 *   npm run test:e2e
 *   (first time: `npx playwright install chromium` to fetch the browser)
 *
 * Against a deployed preview/prod:
 *   PLAYWRIGHT_BASE_URL=https://...vercel.app \
 *   VERCEL_AUTOMATION_BYPASS_SECRET=<Vercel project → Deployment Protection → Bypass> \
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? {
          "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
          "x-vercel-set-bypass-cookie": "true",
        }
      : undefined,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Only auto-start the dev server when running locally without a target URL.
  webServer:
    process.env.PLAYWRIGHT_BASE_URL || process.env.CI
      ? undefined
      : {
          command: "npm run dev",
          url: "http://localhost:3001",
          timeout: 120_000,
          reuseExistingServer: true,
          stdout: "pipe",
          stderr: "pipe",
        },
});
