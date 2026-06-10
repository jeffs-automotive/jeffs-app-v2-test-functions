import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Vitest config for qteklink-app.
 *
 * Mirrors scheduler-app/vitest.config.ts (the proven setup):
 * - Vitest 4 + @vitest/coverage-v8 (NOT istanbul — incompatible with SWC)
 * - jsdom environment for component/hook tests; pure-logic tests run fine too
 * - @vitejs/plugin-react: Vitest 4 + Rolldown's oxc parser doesn't transform JSX
 *   by default; the plugin handles the React 19 automatic jsx-runtime in .tsx tests
 *
 * Coverage thresholds are intentionally NOT enforced yet. Raise to 80% on src/lib/**
 * once the suite stabilizes, matching the project-wide DAL coverage target.
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
    },
  },
});
