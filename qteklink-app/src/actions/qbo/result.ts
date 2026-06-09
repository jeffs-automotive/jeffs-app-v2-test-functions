import * as Sentry from "@sentry/nextjs";
import { QboClientError, type QboClientErrorKind } from "@/lib/qbo/errors";

/**
 * Discriminated result for the thin QBO server actions. `reason` carries the
 * QboClientError `kind` on failure so the UI can branch (e.g.
 * `reconnect_required` → show a "Reconnect QuickBooks" CTA).
 */
export type QboActionResult<T> =
  | { ok: true; data: T; timestamp: number }
  | {
      ok: false;
      reason: QboClientErrorKind | "validation" | "unknown";
      message: string;
      timestamp: number;
    };

/**
 * Next.js redirect()/notFound() throw control-flow errors carrying a `NEXT_*`
 * digest — these MUST propagate (they perform navigation, e.g. requireQtekUser()
 * redirecting an unauthorized caller), never be swallowed into a failure
 * envelope. qboFailure() re-throws them centrally so every action's catch can be
 * a bare `return qboFailure(e)`.
 */
function isNextControlFlowError(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") ||
      digest === "NEXT_NOT_FOUND" ||
      // Next 15 notFound()/forbidden()/unauthorized() => "NEXT_HTTP_ERROR_FALLBACK;<code>"
      digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"))
  );
}

/**
 * Map a thrown error to a typed action failure. No silent failures.
 * Re-throws Next.js control-flow errors so redirect()/notFound() still navigate.
 * `timestamp` lets the UI key `useActionState` toasts (project convention —
 * avoids stale re-toasts).
 */
export function qboFailure(e: unknown): {
  ok: false;
  reason: QboClientErrorKind | "unknown";
  message: string;
  timestamp: number;
} {
  if (isNextControlFlowError(e)) throw e;
  if (e instanceof QboClientError) {
    // Deliberate, user-facing business error — surface its (clean) message.
    return { ok: false, reason: e.kind, message: e.message, timestamp: Date.now() };
  }
  // Unexpected system error — capture server-side; surface a GENERIC message so
  // we never leak SQL / table / constraint / realm internals to the browser.
  Sentry.captureException(e);
  return {
    ok: false,
    reason: "unknown",
    message: "Something went wrong. Please try again, or contact support if it persists.",
    timestamp: Date.now(),
  };
}
