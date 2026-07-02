/**
 * Shared discriminated-union state for the /schedulerconfig direct webform
 * actions (sub-feature A). Client components key toasts on `timestamp`
 * (admin-app convention — avoids stale re-toasts).
 */
import type { DirectWriteResult } from "@/lib/scheduler/write-dal";

export type DirectFormState =
  | { status: "idle" }
  | { status: "validation_error"; error: string; timestamp: number }
  | { status: "stale"; error: string; timestamp: number }
  | { status: "error"; error: string; timestamp: number }
  | { status: "success"; timestamp: number; updated_at?: string; id?: string | number };

export function stateFromResult(result: DirectWriteResult): DirectFormState {
  if (result.ok) {
    return {
      status: "success",
      timestamp: Date.now(),
      updated_at: result.updated_at,
      id: result.id,
    };
  }
  if (result.code === "stale_write") {
    return {
      status: "stale",
      error:
        "This row changed since the page loaded — refresh to see the latest values, then re-apply your edit.",
      timestamp: Date.now(),
    };
  }
  return { status: "error", error: result.error, timestamp: Date.now() };
}

export function validationError(error: string): DirectFormState {
  return { status: "validation_error", error, timestamp: Date.now() };
}
