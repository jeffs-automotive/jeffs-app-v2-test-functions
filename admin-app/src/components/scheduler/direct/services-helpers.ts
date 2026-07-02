/**
 * Shared helpers for ServicesDirectTab (routine + testing services).
 *
 * Prices live as BIGINT `_cents` in the DB (money convention) but are edited
 * in DOLLARS in the UI. These pure functions do the boundary conversion, plus
 * the DirectFormState → toast dispatch that every imperative submit reuses.
 */
import { toast } from "sonner";
import type { DirectFormState } from "@/lib/scheduler/direct-form-state";

/** Cents (nullable) → dollars string for a text/number input. "" when null. */
export function centsToDollarsInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

/**
 * A dollars input string → integer cents. Returns:
 *   - `null` when the field is blank (means "no price" / clear).
 *   - `{ error }` when the value can't be parsed as non-negative money.
 *   - `{ cents }` otherwise.
 */
export function dollarsInputToCents(
  raw: string,
): { cents: number | null } | { error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { cents: null };
  const normalized = trimmed.replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return { error: "Price must be a dollar amount like 49 or 49.99." };
  }
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isFinite(cents) || cents < 0) {
    return { error: "Price must be zero or greater." };
  }
  return { cents };
}

/**
 * Route a DirectFormState (returned imperatively from a server action) to the
 * right sonner toast. Returns true on success so the caller can close its
 * editor row. `onStale` lets the caller trigger router.refresh() for staleness.
 */
export function toastFromState(
  state: DirectFormState,
  successMessage: string,
): boolean {
  switch (state.status) {
    case "success":
      toast.success(successMessage);
      return true;
    case "stale":
      toast.warning("Row is out of date", { description: state.error });
      return false;
    case "validation_error":
      toast.error("Check your input", { description: state.error });
      return false;
    case "error":
      toast.error("Save failed", { description: state.error });
      return false;
    default:
      return false;
  }
}
