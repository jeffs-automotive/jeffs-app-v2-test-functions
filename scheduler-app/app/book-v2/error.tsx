"use client";

/**
 * Per-segment error boundary for /book-v2 (the V2 wizard route).
 *
 * Mirrors app/error.tsx but tags the Sentry event with the wizard surface
 * so ops triage can filter "wizard rendering errors" without manual route
 * inspection. The root error.tsx still catches any other route's failures.
 *
 * Created 2026-05-16 per R6 Stream A IMPORTANT-A-1.
 */

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function WizardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { boundary: "wizard-error", surface: "book-v2" },
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
          Sorry about that — we hit a snag while booking. You can try again,
          or give the shop a call at <strong>(610) 253-6565</strong> and we&apos;ll
          get you scheduled directly.
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
