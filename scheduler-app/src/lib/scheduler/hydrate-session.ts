/**
 * Server-side session hydration for App Router pages.
 *
 * Phase 16 trim (2026-05-16): the V1 AI-SDK chat flow was deleted, so
 * this helper no longer needs to return UIMessages or the current step
 * — both were V1-only consumers. V2 pages call BookPageShell which uses
 * getCurrentCard to read the row, and the only field still needed from
 * hydration is the cookie-bound chat id.
 *
 * Kept here (vs inlined into BookPageShell) because:
 *   - Middleware is the source-of-truth for the cookie value; this
 *     helper centralises the cookie name + validation logic.
 *   - Defensive UUID regen handles the edge case where a page renders
 *     before middleware has set the cookie (rare but observed during
 *     local dev when the cookie path doesn't match).
 */

import { cookies } from "next/headers";

export const COOKIE_NAME = "sched-chat-id";

export interface HydratedSession {
  /** UUID from the HttpOnly cookie. Always set — middleware guarantees it. */
  chatId: string;
}

/**
 * Read the cookie and return the chat id. Safe to call from any Server
 * Component during SSR; cheap (single cookie read, no DB hop).
 *
 * If the cookie is missing or malformed (shouldn't happen — middleware
 * sets it pre-route — but defensive), generate a fresh UUID and treat
 * as a new session. The client picks up the real cookie on the next
 * navigation.
 */
export async function hydrateSession(): Promise<HydratedSession> {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(COOKIE_NAME)?.value;

  const chatId =
    cookieValue && /^[0-9a-f-]{36}$/i.test(cookieValue)
      ? cookieValue
      : crypto.randomUUID();

  return { chatId };
}
