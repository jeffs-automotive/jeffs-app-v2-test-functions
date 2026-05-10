import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config for scheduler-app.
 *
 * Per appointments_design.md §14:
 * - Vitest 4 + @vitest/coverage-v8 (NOT istanbul — incompatible with SWC)
 * - jsdom environment for component tests
 * - 80% line coverage target on src/lib/scheduler/** (DAL functions)
 * - MSW for external API mocks (Tekmetric / Telnyx / Resend)
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: [
        "src/lib/**/*.ts",
        "src/lib/**/*.tsx",
        "app/api/**/*.ts",
      ],
      exclude: [
        "**/*.d.ts",
        "**/*.config.*",
        "tests/**",
        "**/index.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@/app": path.resolve(__dirname, "./app"),
    },
  },
});
