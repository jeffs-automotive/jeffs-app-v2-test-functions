"use client";

/**
 * App Router error boundary — captures errors inside the (root)/ segment
 * (everything under app/ except global crashes which use global-error.tsx).
 *
 * Per .claude/rules/observability.md rule 3: "app/error.tsx and
 * app/global-error.tsx BOTH call Sentry.captureException(error) in a
 * useEffect — otherwise React silently absorbs the error into its
 * fallback. Render error.digest to the user (never error.message)."
 *
 * The customer-facing copy is intentionally warm (matches Jeff's voice
 * from chat-design.md) — we don't expose stack traces or raw error
 * messages to customers; only the digest, which they can read to a
 * service advisor for triage.
 */

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { boundary: "app-error" },
    });
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        backgroundColor: "#F5F1E8",
        color: "#2A2622",
        fontFamily: '"Poppins", system-ui, -apple-system, sans-serif',
      }}
    >
      <div style={{ maxWidth: "32rem", textAlign: "center" }}>
        <h1
          style={{
            fontFamily: '"Poppins", system-ui, -apple-system, sans-serif',
            fontSize: "2rem",
            fontWeight: 700,
            marginBottom: "1rem",
            color: "#96003C",
          }}
        >
          Something went sideways.
        </h1>
        <p style={{ marginBottom: "1.5rem", lineHeight: 1.6 }}>
          Sorry about that — we hit a snag on our end. You can try again, or
          give the shop a call at <strong>(610) 253-6565</strong> and someone
          will get you scheduled directly.
        </p>
        {error.digest ? (
          <p
            style={{
              fontSize: "0.875rem",
              color: "#6B6259",
              marginBottom: "1.5rem",
            }}
          >
            Reference: <code>{error.digest}</code>
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => reset()}
          style={{
            padding: "0.75rem 2rem",
            backgroundColor: "#96003C",
            color: "white",
            border: "none",
            borderRadius: "0.25rem",
            fontWeight: 500,
            cursor: "pointer",
            fontSize: "1rem",
          }}
        >
          Try again
        </button>
      </div>
    </main>
  );
}
