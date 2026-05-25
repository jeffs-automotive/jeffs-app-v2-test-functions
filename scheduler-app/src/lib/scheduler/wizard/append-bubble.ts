/**
 * appendBubble — write a transcript-only chat-bubble row.
 *
 * Per chat-design.md "Architecture amendment — 2026-05-14": the new
 * `customer_chat_messages` shape is simple `{ session_id, shop_id, role,
 * parts: [{ type: 'text', text }] }`. No tool calls. No AI SDK lifecycle
 * shape. The legacy multi-part rows (with `tool-…` parts) coexist during the
 * migration; phase 16 prunes the legacy shape entirely.
 *
 * Each call creates a NEW row. Double-fire protection (e.g., when the user
 * double-clicks Submit) is the responsibility of the calling Server Action
 * + the card component's pending state, NOT this helper.
 *
 * Best-effort failure handling: a bubble-write failure shouldn't break the
 * wizard advance. The Server Action's row update is the load-bearing
 * operation; bubble persistence is a visible-history concern. We log via
 * Sentry-warning level + structured console; we don't throw.
 */
import * as Sentry from "@sentry/nextjs";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/database.types";
// P2.8 (2026-05-25): single source of truth for the Phase-1 SHOP_ID
// fallback (was a duplicate literal 7476 inline).
import { SHOP_ID } from "@/lib/scheduler/shop-config";

export type BubbleRole = "user" | "assistant" | "system";

export interface AppendBubbleArgs {
  chatId: string;
  role: BubbleRole;
  text: string;
}

/**
 * Write a single text bubble to `customer_chat_messages` for the given chat
 * session. Resolves shop_id from the session row (Phase 1 single-shop, but
 * the resolution stays correct for future multi-shop).
 */
export async function appendBubble(args: AppendBubbleArgs): Promise<void> {
  if (!args.text || args.text.length === 0) return; // empty bubbles are no-ops

  const supabase = createSupabaseAdminClient();

  // Look up shop_id for the session. Default to the Phase 1 SHOP_ID
  // helper if the row is somehow missing — better to write the bubble
  // against the default than drop it. P2.8 (2026-05-25): the literal
  // 7476 here used to be a duplicate of 12 other declarations;
  // centralized via shop-config.
  let shopId: number = SHOP_ID;
  try {
    const { data: sessionRow } = await supabase
      .from("customer_chat_sessions")
      .select("shop_id")
      .eq("id", args.chatId)
      .maybeSingle();
    if (sessionRow?.shop_id) {
      shopId = sessionRow.shop_id as number;
    }
  } catch (lookupErr) {
    Sentry.captureException(lookupErr, {
      tags: { surface: "append_bubble_shop_lookup" },
      level: "warning",
    });
  }

  const parts: Json = [{ type: "text", text: args.text }];

  const { error } = await supabase.from("customer_chat_messages").insert({
    id: crypto.randomUUID(),
    session_id: args.chatId,
    shop_id: shopId,
    role: args.role,
    parts,
  });

  if (error) {
    Sentry.captureException(error, {
      tags: { surface: "append_bubble_insert", role: args.role },
      level: "warning",
    });
     
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "append_bubble_insert_failed",
        session_id: args.chatId,
        role: args.role,
        detail: error.message,
      }),
    );
  }
}
