import { defineConfig, devices } from "@playwright/test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Playwright config for admin-app (Phase G).
 *
 * Two surfaces:
 *  - **auth gate** (`*.spec.ts`, unauthenticated): a protected route must redirect to /login
 *    (requireAdmin, src/lib/auth.ts). No session needed.
 *  - **authed** (`*.authed.spec.ts`): a seeded @supabase/ssr session (project "setup" →
 *    auth.setup.ts) proves requireAdmin PASSES for a real @jeffsautomotive.com user. READ-ONLY —
 *    no write flows (those drive the real orchestrator → real Tekmetric/keytag data).
 *
 * `loadEnvConfig` pulls admin-app/.env.local into this process so the setup can read
 * NEXT_PUBLIC_SUPABASE_URL + the anon/publishable key (the same creds the dev server uses).
 *
 * Run locally (auto-starts `next dev -p 3001`):
 *   npx playwright install chromium            # one-time browser fetch
 *   E2E_TEST_USER_PASSWORD=… npm run test:e2e  # password NEVER committed — env only
 * Without E2E_TEST_USER_PASSWORD the authed specs skip cleanly; the auth-gate spec still runs.
 *
 * Against a deployed target: PLAYWRIGHT_BASE_URL=https://… (+ VERCEL_AUTOMATION_BYPASS_SECRET).
 */
// @next/env is CommonJS — bridge via createRequire so Playwright's ESM loader can use it.
const { loadEnvConfig } = createRequire(import.meta.url)("@next/env") as typeof import("@next/env");
loadEnvConfig(process.cwd());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_STATE = path.join(__dirname, "e2e", ".auth", "state.json");

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
  projects: [
    // Seeds the @supabase/ssr session into STORAGE_STATE (empty state if no creds).
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    // Unauthenticated — the auth-gate spec.
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: [/auth\.setup\.ts/, /\.authed\.spec\.ts/],
    },
    // Authenticated — uses the seeded session; runs only the *.authed.spec.ts files.
    {
      name: "chromium-authed",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
      testMatch: /\.authed\.spec\.ts/,
    },
  ],
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
