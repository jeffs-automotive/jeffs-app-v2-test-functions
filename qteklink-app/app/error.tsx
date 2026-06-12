"use client";

/**
 * Segment error boundary — catches render/data errors in the app tree. Per
 * .claude/rules/observability.md rule 3: call Sentry.captureException in a
 * useEffect (React otherwise swallows the error) and render error.digest to
 * the user, NEVER error.message (it can leak internals).
 */
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { boundary: "app-error" } });
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        The error has been logged{error.digest ? ` (ref ${error.digest})` : ""}.
      </p>
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
