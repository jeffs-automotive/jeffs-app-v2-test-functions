/**
 * ESLint flat config for scheduler-app.
 *
 * Direct @next/eslint-plugin-next import — bypasses eslint-config-next 15.x
 * which transitively pulls in @rushstack/eslint-patch and fails on Node 20+
 * ("Failed to patch ESLint because the calling module was not recognized").
 * The patch is dropped in eslint-config-next 16.x, but that's paired with
 * Next.js 16 which we're holding. See PLAN-01 Phase 3A.
 *
 * Per appointments_design.md §13 + .claude/rules/observability.md:
 * - @typescript-eslint/no-floating-promises: error  (TYPED rule)
 * - @typescript-eslint/no-misused-promises: error   (TYPED rule)
 *   `checksVoidReturn.attributes = false` so async onClick handlers in React
 *   don't trip — they're a normal idiom and not the silent-failure shape
 *   the rule was meant to catch (the actual silent-failure shape is async
 *   inside a sync `void` context, e.g. Array.forEach callback).
 * - no-empty with allowEmptyCatch: false (silent-failure prevention)
 * - no-console warning (allow .info/.warn/.error per observability rule 14)
 *
 * Plus Next.js + Core Web Vitals + React + React-hooks rules
 * direct from the plugins. (eslint-config-next used to register these
 * automatically; we register them directly to avoid @rushstack/eslint-patch.)
 *
 * Config block layout:
 * 1. Global ignores
 * 2. Typed-aware block for app/ + src/ TS/TSX (parserOptions.project = tsconfig)
 * 3. Untyped block for top-level configs + scripts/ (no project, lighter rules)
 */
import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

// Rules common to BOTH blocks (no type-info needed).
const commonRules = {
  ...nextPlugin.configs.recommended.rules,
  ...nextPlugin.configs["core-web-vitals"].rules,
  ...reactPlugin.configs.recommended.rules,
  ...reactHooksPlugin.configs.recommended.rules,
  // React 19 — JSX runtime is automatic; these rules are obsolete in 17+
  "react/react-in-jsx-scope": "off",
  "react/prop-types": "off",
  // eslint-plugin-react-hooks v6+ ships React-Compiler-aware rules that
  // flag pre-existing scheduler-app patterns (refs accessed in render
  // bodies, setState called sync inside useEffect on mount). Real signal,
  // but not failure-grade for the v1 launch — tracked as DEFERRED in
  // docs/scheduler/DEFERRED-AUDIT-ITEMS.md for a focused refactor pass.
  "react-hooks/refs": "warn",
  "react-hooks/set-state-in-effect": "warn",
  "no-empty": ["error", { allowEmptyCatch: false }],
  // Forbid console.log(error) in production code per observability rule 14
  "no-console": [
    "warn",
    {
      allow: ["info", "warn", "error"],
    },
  ],
  // File-size guardrail — WARN only (a tripwire, not a hard law). Counts
  // code-only lines. See docs/code-quality/file-size-audit-and-strategy-2026-05-31.md.
  "max-lines": ["warn", { max: 500, skipBlankLines: true, skipComments: true }],
};

const commonPlugins = {
  "@next/next": nextPlugin,
  "@typescript-eslint": tseslint,
  react: reactPlugin,
  "react-hooks": reactHooksPlugin,
};

const commonSettings = {
  react: { version: "detect" },
};

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },
  // Typed-aware block — app/ and src/ TS+TSX (covered by tsconfig.json "include")
  {
    files: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: commonPlugins,
    settings: commonSettings,
    rules: {
      ...commonRules,
      // TYPED rules (require parserOptions.project) — observability essentials
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          // Async onClick={async () => ...} on React event attributes is a
          // normal idiom — don't false-positive on it. Other silent-failure
          // shapes (async passed to forEach, void-return contexts) still
          // trip the rule.
          checksVoidReturn: { attributes: false },
        },
      ],
    },
  },
  // Untyped block — configs + scripts/ (excluded from tsconfig.json)
  {
    files: [
      "*.{ts,mjs,js,cjs}",
      "scripts/**/*.{ts,mjs,js,cjs}",
      "playwright.config.ts",
      "vitest.config.ts",
    ],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
        // NO `project` — these files aren't in tsconfig.json
      },
    },
    plugins: commonPlugins,
    settings: commonSettings,
    rules: commonRules,
  },
  // max-lines-per-function — WARN, scoped to logic modules (DAL/lib/api).
  // Off for UI/route/tests where long render/describe blocks are legitimate.
  {
    files: ["src/lib/**/*.ts", "app/api/**/*.ts"],
    rules: {
      "max-lines-per-function": [
        "warn",
        { max: 100, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },
  // Tests + config: function-length rule off (describe/it blocks run long).
  {
    files: ["**/*.test.{ts,tsx}", "tests/**", "**/*.config.{ts,mts}"],
    rules: { "max-lines-per-function": "off" },
  },
  // Exempt GENERATED + pure-DATA files from the file-size rule.
  {
    files: [
      "src/lib/database.types.ts", // generated by `supabase gen types`
      "scripts/catalog/categories/**/*.ts", // pure data; one cohesive unit per file
    ],
    rules: { "max-lines": "off" },
  },
];
