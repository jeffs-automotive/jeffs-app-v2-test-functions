import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Vitest config for scheduler-app.
 *
 * Per appointments_design.md §14:
 * - Vitest 4 + @vitest/coverage-v8 (NOT istanbul — incompatible with SWC)
 * - jsdom environment for component tests
 * - 80% line coverage target on src/lib/scheduler/** (DAL functions)
 * - MSW for external API mocks (Tekmetric / Telnyx / Resend)
 *
 * @vitejs/plugin-react: required because Vitest 4 + Rolldown's oxc parser
 * doesn't transform JSX by default. The plugin handles the React 17+
 * automatic jsx-runtime for `<PhoneEntry />` etc. in .tsx test files.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // Playwright owns e2e/; vitest must not try to run those specs.
    exclude: ["e2e/**", "node_modules/**", ".next/**", "dist/**"],
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
