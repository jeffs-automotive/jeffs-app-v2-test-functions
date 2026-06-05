"use client";

/**
 * Global error boundary — catches crashes the per-segment error.tsx can't
 * (errors thrown inside the root layout, or any uncaught render error escaping
 * segment boundaries).
 *
 * Per .claude/rules/observability.md rule 3:
 *   - MUST include <html> and <body> (it replaces the entire root layout)
 *   - MUST call Sentry.captureException
 *
 * Minimal HTML — the React tree may be partially mounted with no global styles
 * guaranteed. Inline only.
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
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
