/**
 * chat-store DAL — session-row helpers for customer_chat_sessions.
 *
 * Phase 16 trim (2026-05-16): the AI-SDK chat-stream layer was deleted,
 * so this file no longer carries the loadChat / saveChat / message-array
 * persistence helpers — V2 reads + writes the row directly via Server
 * Actions + getCurrentCard. The only remaining helper is
 * `ensureSessionExists`, the idempotent row creator that the
 * BookPageShell calls on every request.
 *
 * Domain enums + the SessionStatus union are kept as exports because
 * downstream callers (the abandon-route, the cross-cutting actions)
 * reference these literal types.
 *
 * RLS: deny-all to public; this file uses the admin client (bypasses
 * RLS). App-level auth must enforce session/shop scoping (we hardcode
 * shop_id = 7476 Phase 1 per design §6).
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Phase 1 shop scope (per design §6)
const SHOP_ID = 7476;

// -------- Domain enums (CHECK constraints in DB; widened in generated types) --------

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
  | "incomplete"
  | "abandoned";

// -------- DAL functions --------

/**
 * Idempotent session-row creator. Called from BookPageShell on every
 * request so the first hit for a chat id creates the row, and every
 * subsequent hit is a no-op.
 *
 * The customer_chat_sessions row is the source-of-truth for the V2
 * wizard state. The row's current_step + per-step columns are written
 * by Server Actions; getCurrentCard reads them back on every render.
 */
export async function ensureSessionExists(args: {
  chatId: string;
  channel: Channel;
  phone_e164?: string;
  cookie_session?: string;
}): Promise<void> {
  const supabase = createSupabaseAdminClient();
  // INSERT ... ON CONFLICT DO NOTHING via upsert with ignoreDuplicates.
  // Safer than a SELECT-then-INSERT because two concurrent requests for
  // the same id will both succeed without throwing.
  const { error } = await supabase
    .from("customer_chat_sessions")
    .upsert(
      {
        id: args.chatId,
        shop_id: SHOP_ID,
        channel: args.channel,
        phone_e164: args.phone_e164 ?? null,
        cookie_session: args.cookie_session ?? null,
        status: "active",
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (error) {
    throw new Error(`ensureSessionExists failed: ${error.message}`);
  }
}
