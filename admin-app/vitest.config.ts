import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Vitest config for admin-app (Phase G test harness — added 2026-06-01).
 *
 * Mirrors scheduler-app/vitest.config.ts (the proven setup):
 * - Vitest 4 + @vitest/coverage-v8 (NOT istanbul — incompatible with SWC)
 * - jsdom environment for component/hook tests; pure-logic tests run fine too
 * - @vitejs/plugin-react: Vitest 4 + Rolldown's oxc parser doesn't transform JSX
 *   by default; the plugin handles the React 19 automatic jsx-runtime in .tsx tests
 * - Playwright owns e2e/; vitest must not pick up those specs
 *
 * Coverage thresholds are intentionally NOT enforced yet — admin-app is just
 * getting its first tests (the audit's A6 finding). Raise to 80% on src/lib/**
 * once the suite fills in, to match scheduler-app's target + admin PLAN.md Phase G.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // Playwright owns e2e/; never let vitest try to run those specs.
    exclude: ["e2e/**", "node_modules/**", ".next/**", "dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/lib/**/*.ts", "src/lib/**/*.tsx", "src/actions/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "**/*.config.*",
        "tests/**",
        "e2e/**",
        "**/index.ts",
        "**/types.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@/app": path.resolve(__dirname, "./app"),
      // `server-only` throws in client bundles; under Vitest (node) stub it to a
      // no-op so server-only modules (e.g. lib/keytag/load-board-state) are testable.
      "server-only": path.resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
});
