"use client";

/**
 * ChatBootstrap — client glue that wires the SSR-hydrated session into
 * <Chat />.
 *
 * Phase 1 cookie-resume (2026-05-13): the page Server Component reads
 * the `sched-chat-id` HttpOnly cookie set by middleware, loads initial
 * messages + the wizard's current_step from the DB, and passes them all
 * to this component. We no longer generate the chatId client-side or
 * rely on localStorage as the source of truth.
 *
 * localStorage is still used as a BACKUP read for tab-restore scenarios
 * where the cookie was somehow lost (private mode, manual clear). When
 * cookie + localStorage disagree, COOKIE WINS — it's the durable
 * cross-device key.
 */

import { useEffect } from "react";
import type { UIMessage } from "ai";
import { Chat } from "./Chat";

const STORAGE_KEY = "jeffs-scheduler-chat-id";

export interface ChatBootstrapProps {
  /** UUID from the sched-chat-id cookie (SSR-hydrated by hydrateSession). */
  chatId: string;
  /** Replay-ready messages from the DB (empty array for fresh sessions). */
  initialMessages: UIMessage[];
  /**
   * Authoritative wizard step from the row, or null if no row exists yet.
   * Used to decide whether to render the client-side GreetingCard (only
   * when null/'greeting').
   */
  initialStep: string | null;
}

export function ChatBootstrap({
  chatId,
  initialMessages,
  initialStep,
}: ChatBootstrapProps) {
  // Sync localStorage as a backup pointer for environments where the cookie
  // might be cleared (private-tab boundaries, manual clear). The cookie is
  // still the source of truth on SSR; this just helps us recover faster on
  // the rare cases where we lose it.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, chatId);
    } catch {
      // Ignore — localStorage unavailable. The cookie + DB row are the real
      // persistence.
    }
  }, [chatId]);

  return (
    <Chat
      chatId={chatId}
      initialMessages={initialMessages}
      initialStep={initialStep}
    />
  );
}
