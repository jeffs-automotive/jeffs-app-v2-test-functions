"use client";

/**
 * ChatBootstrap — client-side glue that picks/persists a chatId and mounts
 * the actual <Chat /> component.
 *
 * Phase 1 (per scheduler_project_state.md): client-side-generated chatId
 * persisted in localStorage. The /api/chat route handler upserts a
 * customer_chat_sessions row keyed on this id on first request.
 *
 * Future: switch to HttpOnly cookie + middleware so the chat survives a
 * device-clear and pairs with the SMS-channel re-discovery flow per
 * design §3.1.
 */

import { useEffect, useState } from "react";
import { Chat } from "./Chat";

const STORAGE_KEY = "jeffs-scheduler-chat-id";

function isUuidV4(v: string | null): v is string {
  return (
    !!v &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

export function ChatBootstrap() {
  const [chatId, setChatId] = useState<string | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      // localStorage unavailable (private mode) — fall through and create a
      // fresh ephemeral id; chat won't survive page refresh in that case.
    }
    if (isUuidV4(stored)) {
      setChatId(stored);
      return;
    }
    const fresh = crypto.randomUUID();
    try {
      localStorage.setItem(STORAGE_KEY, fresh);
    } catch {
      // OK — ephemeral session
    }
    setChatId(fresh);
  }, []);

  if (!chatId) {
    return (
      <p className="text-sm text-gray-500" aria-live="polite">
        Loading chat…
      </p>
    );
  }

  return <Chat chatId={chatId} />;
}
