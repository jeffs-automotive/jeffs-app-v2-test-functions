import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for scheduler-app — PLAN-01 Phase 4D.
 *
 * Test target: the customer-facing wizard at appointments.jeffsautomotive.com
 * (or a Vercel preview / local dev server). The wizard hits real Supabase +
 * real LLMs, so this is an integration / smoke surface, NOT a hermetic test.
 *
 * Run locally:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3000 npm run test:e2e
 *
 * Run against a Vercel preview:
 *   PLAYWRIGHT_BASE_URL=https://scheduler-app-<sha>.vercel.app \
 *   VERCEL_AUTOMATION_BYPASS_SECRET=<from Vercel project settings> \
 *   npm run test:e2e
 *
 * Run against prod (smoke only — uses real Supabase rows + real Telnyx):
 *   PLAYWRIGHT_BASE_URL=https://appointments.jeffsautomotive.com \
 *   npm run test:e2e
 *
 * OTP bypass: the spec uses the existing `SCHEDULER_TEST_PHONE_E164` +
 * `SCHEDULER_TEST_OTP_CODE` env-gated bypass already wired in
 * `supabase/functions/_shared/tools/scheduler-otp.ts`. The bypass:
 * - REQUIRES both env vars set on the Supabase project (NOT the app)
 * - The test spec types `SCHEDULER_TEST_PHONE_E164` for the phone and
 *   `SCHEDULER_TEST_OTP_CODE` for the OTP — the wizard receives the static
 *   code immediately + skips Telnyx send entirely
 *
 * If those env vars are unset on the target Supabase project, the OTP step
 * needs a real phone to receive the SMS — the spec will time out at the
 * verify step. Skip the spec by setting `SKIP_PLAYWRIGHT_E2E=1`.
 */
export default defineConfig({
  testDir: "./e2e",

  // Wizard latency: LLM diagnose call alone can take 8-30s; total e2e budget
  // is generous to absorb that without flaking.
  timeout: 120_000,

  // One retry covers transient Vercel-preview cold starts + AI Gateway hiccups.
  retries: process.env.CI ? 1 : 0,

  // Limit parallelism — the wizard touches shared session state per
  // customer + the test Supabase project has rate limits.
  workers: 1,

  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",

    // Capture on first retry only — keeps storage usage sane.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",

    // Vercel preview deployments require this header to bypass the
    // authentication wall. Set the secret in Vercel project settings →
    // Deployment Protection → Bypass.
    extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? {
          "x-vercel-protection-bypass":
            process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
          "x-vercel-set-bypass-cookie": "true",
        }
      : undefined,

    // Most of the wizard is generously sized at desktop. Mobile project
    // below exercises the responsive layout.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
    },
  ],

  // Only auto-start dev server when running locally without a target URL.
  webServer:
    process.env.PLAYWRIGHT_BASE_URL || process.env.CI
      ? undefined
      : {
          command: "npm run dev",
          url: "http://localhost:3000",
          timeout: 120_000,
          reuseExistingServer: true,
          stdout: "pipe",
          stderr: "pipe",
        },
});
