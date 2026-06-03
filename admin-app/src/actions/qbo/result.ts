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
 * Map a thrown error to a typed action failure. No silent failures.
 * `timestamp` lets the UI key `useActionState` toasts (project convention —
 * avoids stale re-toasts).
 */
export function qboFailure(e: unknown): {
  ok: false;
  reason: QboClientErrorKind | "unknown";
  message: string;
  timestamp: number;
} {
  if (e instanceof QboClientError) {
    return { ok: false, reason: e.kind, message: e.message, timestamp: Date.now() };
  }
  return {
    ok: false,
    reason: "unknown",
    message: e instanceof Error ? e.message : String(e),
    timestamp: Date.now(),
  };
}
