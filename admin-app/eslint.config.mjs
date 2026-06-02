import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
  },
  // File-size guardrail — WARN only (a tripwire, not a hard law). Counts
  // code-only lines. See docs/code-quality/file-size-audit-and-strategy-2026-05-31.md.
  {
    rules: {
      "max-lines": ["warn", { max: 500, skipBlankLines: true, skipComments: true }],
    },
  },
  // Honor the `_`-prefix convention for intentionally-unused vars/args/catch bindings.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  // Exempt generated DB types if present.
  {
    files: ["src/lib/database.types.ts", "**/database.types.ts"],
    rules: { "max-lines": "off" },
  },
];

export default eslintConfig;
