/**
 * chat-store DAL — load/save/create/find for customer_chat_sessions +
 * customer_chat_messages.
 *
 * Per appointments_design.md §7.1 Topic 2 + scheduler-research/01-frontend-ai-sdk.md:
 *
 * AI SDK v5 persistence pattern:
 *   - Server-side IDs via toUIMessageStreamResponse({ generateMessageId })
 *   - loadChat(id) returns UIMessage[] for useChat({ messages })
 *   - saveChat({ chatId, messages }) called from streamText().toUIMessageStreamResponse({ onFinish })
 *   - Tool call replay: store the FULL parts[] array per message; no special
 *     replay logic needed — useChat reconstructs from parts
 *
 * Two channels:
 *   - Web: cookie-bound chatId; sessions persist per cookie session
 *   - SMS: phone-keyed; lookup by phone with Telnyx-verified MSISDN
 *
 * RLS: deny-all to public; this file uses the admin client (bypasses RLS).
 * App-level auth must enforce session/shop scoping (we hardcode shop_id =
 * 7476 Phase 1 per design §6).
 *
 * Type story: until the migration applies + we regen `database.types.ts`,
 * we hand-roll the row shapes here. Replace with `Database['public']['Tables']`
 * imports once `npx supabase gen types typescript` produces the canonical
 * file. (TODO: tracked in design §17.)
 */
import type { UIMessage } from "ai";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Phase 1 shop scope (per design §6)
const SHOP_ID = 7476;

// -------- Hand-rolled row types — replace with database.types.ts after regen --------

export type Channel = "web" | "sms";
export type SessionStatus =
  | "active"
  | "idle"
  | "ended"
  | "escalated"
  | "timed_out";
export type SessionOutcome =
  | "scheduled"
  | "info_only"
  | "escalation"
  | "incomplete";
export type CustomerSelfIdentified = "returning" | "new" | "unsure";
export type Sentiment = "positive" | "neutral" | "negative";
export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface SessionRow {
  id: string;
  shop_id: number;
  channel: Channel;
  phone_e164: string | null;
  customer_self_identified: CustomerSelfIdentified | null;
  customer_id: number | null;
  vehicle_id: number | null;
  cookie_session: string | null;
  status: SessionStatus;
  outcome: SessionOutcome | null;
  appointment_id: number | null;
  opted_out_at: string | null;
  sentiment: Sentiment | null;
  started_at: string;
  last_active_at: string;
  ended_at: string | null;
}

export interface MessageRow {
  id: string;
  session_id: string;
  shop_id: number;
  role: MessageRole;
  parts: UIMessage["parts"];
  created_at: string;
}

// -------- DAL functions --------

/**
 * Create a new chat session row.
 */
export async function createChat(args: {
  channel: Channel;
  phone_e164?: string;
  cookie_session?: string;
}): Promise<string> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("customer_chat_sessions")
    .insert({
      shop_id: SHOP_ID,
      channel: args.channel,
      phone_e164: args.phone_e164 ?? null,
      cookie_session: args.cookie_session ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `createChat failed: ${error?.message ?? "no row returned"}`,
    );
  }
  return data.id as string;
}

/**
 * Load all messages for a chat session, oldest-first, as v5 UIMessage[].
 * Used by:
 *   - The page's Server Component (web): hydrates initialMessages
 *   - The chat route handler: server-side history before streamText
 *   - The telnyx-webhook (SMS): same purpose, different surface
 */
export async function loadChat(chatId: string): Promise<UIMessage[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("customer_chat_messages")
    .select("id, role, parts, created_at")
    .eq("session_id", chatId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`loadChat(${chatId}) failed: ${error.message}`);
  }
  if (!data) return [];

  return data.map((r) => {
    const row = r as Pick<MessageRow, "id" | "role" | "parts">;
    return {
      id: row.id,
      role: row.role as UIMessage["role"],
      parts: row.parts,
    } as UIMessage;
  });
}

/**
 * Save (upsert) the full message list for a chat session.
 *
 * Called from streamText().toUIMessageStreamResponse({ onFinish:
 * ({ messages }) => saveChat({ chatId, messages }) }).
 *
 * Idempotent on message.id (server-generated via generateMessageId in
 * the route handler) — re-running a save with the same messages is a no-op
 * thanks to ON CONFLICT (id) DO NOTHING semantics via .upsert().
 *
 * Touches last_active_at on the parent session.
 */
export async function saveChat(args: {
  chatId: string;
  messages: UIMessage[];
}): Promise<void> {
  const { chatId, messages } = args;
  const supabase = createSupabaseAdminClient();

  if (messages.length > 0) {
    const rows = messages.map((m) => ({
      id: m.id,
      session_id: chatId,
      shop_id: SHOP_ID,
      role: m.role,
      parts: m.parts as unknown,
    }));

    const { error: upsertError } = await supabase
      .from("customer_chat_messages")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true });

    if (upsertError) {
      throw new Error(
        `saveChat(${chatId}) message upsert failed: ${upsertError.message}`,
      );
    }
  }

  // Bump last_active_at so idle-timeout cron + UX know the session is alive
  const { error: touchError } = await supabase
    .from("customer_chat_sessions")
    .update({ last_active_at: new Date().toISOString() })
    .eq("id", chatId);

  if (touchError) {
    throw new Error(
      `saveChat(${chatId}) session touch failed: ${touchError.message}`,
    );
  }
}

/**
 * Find the most recent ACTIVE chat for a phone number within `within_minutes`.
 * Used for cookie-expired re-discovery on web (per design §3.1) and for
 * SMS session resumption (per design §3.2).
 *
 * Returns null if no recent active session exists.
 */
export async function findRecentChatByPhone(args: {
  phone_e164: string;
  within_minutes?: number;
}): Promise<string | null> {
  const within = args.within_minutes ?? 60;
  const supabase = createSupabaseAdminClient();
  const cutoff = new Date(Date.now() - within * 60_000).toISOString();

  const { data, error } = await supabase
    .from("customer_chat_sessions")
    .select("id")
    .eq("phone_e164", args.phone_e164)
    .eq("shop_id", SHOP_ID)
    .eq("status", "active")
    .gte("last_active_at", cutoff)
    .order("last_active_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`findRecentChatByPhone failed: ${error.message}`);
  }
  if (!data || data.length === 0) return null;

  return data[0]!.id as string;
}

/**
 * Mark a session as ended with the outcome, AND set ended_at.
 * Triggers transcript-dispatch enqueue (caller's responsibility).
 */
export async function markSessionEnded(args: {
  chatId: string;
  outcome: SessionOutcome;
  status?: Exclude<SessionStatus, "active" | "idle">;
}): Promise<void> {
  const status = args.status ?? "ended";
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("customer_chat_sessions")
    .update({
      status,
      outcome: args.outcome,
      ended_at: new Date().toISOString(),
    })
    .eq("id", args.chatId);

  if (error) {
    throw new Error(
      `markSessionEnded(${args.chatId}) failed: ${error.message}`,
    );
  }
}

/**
 * Set the customer_self_identified bucket on a session. Called from the
 * chat route handler after the chat agent classifies the customer's answer
 * to "Have you been here before?" (per design §4.2).
 */
export async function setCustomerSelfIdentified(args: {
  chatId: string;
  value: CustomerSelfIdentified;
}): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("customer_chat_sessions")
    .update({ customer_self_identified: args.value })
    .eq("id", args.chatId);

  if (error) {
    throw new Error(
      `setCustomerSelfIdentified(${args.chatId}) failed: ${error.message}`,
    );
  }
}
