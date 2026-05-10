/**
 * ESLint flat config for scheduler-app.
 *
 * Per appointments_design.md §13 observability rules:
 * - @typescript-eslint/no-floating-promises: error
 * - @typescript-eslint/no-misused-promises: error
 * - no-empty with allowEmptyCatch: false (silent-failure prevention)
 *
 * Plus the Next.js + React conventions from eslint-config-next.
 */
import next from "eslint-config-next";

export default [
  ...next(),
  {
    rules: {
      "no-empty": ["error", { allowEmptyCatch: false }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      // Forbid console.log(error) in production code per observability rule 14
      "no-console": [
        "warn",
        {
          allow: ["info", "warn", "error"],
        },
      ],
    },
  },
];
