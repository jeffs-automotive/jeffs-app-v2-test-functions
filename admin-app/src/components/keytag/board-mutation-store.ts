"use client";

/**
 * board-mutation-store — a tiny module-level signal for "a keytag mutation is in
 * flight on the board right now."
 *
 * Why this exists (2026-06-24 board-residual-fixes): the board runs background
 * pollers (LiveBoardPoller every 15s; DashboardPoller every 60s). Each poller
 * fires inside its own React transition. Per react.dev, concurrent transitions
 * are BATCHED and a transition's isPending stays true until ALL batched Actions
 * settle; Next.js also dispatches Server Actions one-at-a-time per client. So
 * when a release/assign lands while a poll is in flight, the user's
 * useActionState isPending gets pinned to the poll's transition and the button
 * spins forever even though the mutation already succeeded server-side.
 *
 * The first fix paused the poll only off BoardClient.busyRows — but the bottom
 * manual forms (BoardBackupTools) live OUTSIDE BoardClient, so they never fed
 * it. This module is a GLOBAL (module-level) ref-counted signal that EVERY
 * mutation source (per-row buttons + bottom forms) increments and EVERY poller
 * reads — independent of the React tree, so it works regardless of which
 * components are mounted. Pollers skip their tick while the count is > 0, so a
 * user mutation never co-batches/serializes with a poll.
 */
import { useEffect, useSyncExternalStore } from "react";

let inFlight = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const boardMutationStore = {
  begin() {
    inFlight += 1;
    emit();
  },
  end() {
    inFlight = Math.max(0, inFlight - 1);
    emit();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  isMutating() {
    return inFlight > 0;
  },
};

/** Reactive read of "is any board mutation in flight" (for the pollers). */
export function useIsMutating(): boolean {
  return useSyncExternalStore(
    boardMutationStore.subscribe,
    boardMutationStore.isMutating,
    () => false, // SSR snapshot: never mutating on the server
  );
}

/**
 * Report a mutation as in flight while `pending` is true. Ref-counted, so
 * concurrent mutations across multiple rows/forms are tracked correctly, and a
 * component unmounting mid-action (e.g. its row gets spliced out on success)
 * still releases its hold via the effect cleanup.
 */
export function useReportMutation(pending: boolean): void {
  useEffect(() => {
    if (!pending) return;
    boardMutationStore.begin();
    return () => boardMutationStore.end();
  }, [pending]);
}
