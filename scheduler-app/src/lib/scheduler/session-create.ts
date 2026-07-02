/**
 * session-create — the idempotent customer_chat_sessions row creator.
 *
 * Renamed from chat-store.ts (revamp Phase 0, 2026-07-02): the chat-era
 * name was the last vestige of the deleted AI-SDK chat-stream layer
 * (Phase 16 trim, 2026-05-16, removed loadChat/saveChat). The one helper
 * live in V2 is `ensureSessionExists`, called by BookPageShell on every
 * request.
 *
 * RLS: deny-all to public; this file uses the admin client (bypasses
 * RLS). App-level auth must enforce session/shop scoping (we hardcode
 * shop_id = 7476 Phase 1 per design §6).
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
// P2.8 (2026-05-25): single source of truth for SHOP_ID. Was a
// duplicate `const SHOP_ID = 7476` declared 13× across the codebase;
// now centralized so multi-shop migration touches one file.
import { SHOP_ID } from "@/lib/scheduler/shop-config";

// -------- Domain enums (CHECK constraints in DB; widened in generated types) --------

export type Channel = "web" | "sms";

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
