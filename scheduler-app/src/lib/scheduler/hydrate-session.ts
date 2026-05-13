/**
 * Server-side session hydration for App Router pages.
 *
 * Bridges the cookie-set-by-middleware (sched-chat-id) to a fully-loaded
 * { chatId, initialMessages, currentStep } tuple that page Server
 * Components can hand to the client.
 *
 * Why this lives here vs in the route handler:
 *   - Pages need server-side data for first paint (no flash of empty
 *     state when a returning customer's tab reloads mid-flow).
 *   - The route handler (`app/api/chat/route.ts`) already does its own
 *     loadChat on EACH message turn; this hydration is only for first
 *     paint.
 *   - Calling `cookies()` from inside a Server Component is App-Router
 *     idiomatic; this helper keeps that cookie surface in one place.
 */

import type { UIMessage } from "ai";
import { cookies } from "next/headers";
import { loadChat } from "@/lib/scheduler/chat-store";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { WizardStep } from "@/lib/scheduler/session-state";

export const COOKIE_NAME = "sched-chat-id";

export interface HydratedSession {
  /** UUID from the HttpOnly cookie. Always set — middleware guarantees it. */
  chatId: string;
  /** Replay-ready UIMessages from customer_chat_messages, in chronological order. */
  initialMessages: UIMessage[];
  /** Authoritative wizard step from the row; null if the row doesn't exist yet. */
  currentStep: WizardStep | null;
  /** True iff this is the first time we're seeing this cookie (no row, no messages). */
  isFreshSession: boolean;
}

/**
 * Read the cookie + load messages + read the wizard step. Safe to call
 * from any Server Component during SSR; runs on every page navigation
 * (per middleware matcher) but is cheap (one DB read for messages + one
 * for the session row, both keyed on the indexed PK).
 *
 * If the cookie is missing or invalid (shouldn't happen — middleware
 * sets it pre-route — but defensive), generate a fresh one and treat as
 * a new session.
 */
export async function hydrateSession(): Promise<HydratedSession> {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(COOKIE_NAME)?.value;

  // Middleware should have set this, but be defensive — if a request
  // somehow reaches a page without it (e.g., on the very first request
  // before middleware caches), fall back to a fresh UUID. The client
  // will pick up the real cookie on the next navigation.
  const chatId =
    cookieValue && /^[0-9a-f-]{36}$/i.test(cookieValue)
      ? cookieValue
      : crypto.randomUUID();

  // Read messages (replay) + row (current_step). Run in parallel.
  const [initialMessages, currentStep] = await Promise.all([
    loadChat(chatId).catch(() => [] as UIMessage[]),
    readCurrentStep(chatId),
  ]);

  const isFreshSession =
    initialMessages.length === 0 && currentStep === null;

  return {
    chatId,
    initialMessages,
    currentStep,
    isFreshSession,
  };
}

async function readCurrentStep(chatId: string): Promise<WizardStep | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("customer_chat_sessions")
    .select("current_step")
    .eq("id", chatId)
    .maybeSingle();
  if (error || !data) return null;
  return (data.current_step as WizardStep | null) ?? null;
}
