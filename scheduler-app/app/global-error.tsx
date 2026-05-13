"use client";

/**
 * Global error boundary — catches crashes the (root)/error.tsx can't
 * (e.g., errors thrown inside the root layout, or any uncaught render
 * error that escapes the per-segment boundaries).
 *
 * Per .claude/rules/observability.md rule 3 + Next.js docs:
 *   - MUST include <html> and <body> (replaces the entire root layout)
 *   - MUST call Sentry.captureException so the error reaches our dashboard
 *
 * Intentionally minimal HTML — at this level the React tree may be
 * partially mounted; we can't rely on global styles or fonts being
 * loaded. Inline styles only.
 */

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { boundary: "global-error" },
    });
  }, [error]);

  return (
    <html lang="en">
      <body>
        {/* NextError is the built-in Next.js error page component. Its
            type definition requires a statusCode; we pass 0 so it
            renders the generic message. */}
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
