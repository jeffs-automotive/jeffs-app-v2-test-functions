// autoResolveReviewsForRo — close every open manual review for an RO as moot
// once its keys have left the shop (terminal release).
//
// A manual review asks "what tag belongs on these keys?" — a question that only
// exists while the keys are physically in the shop (RO open / WIP / A-R). The
// moment the RO terminally closes (posted-paid, A-R paid, or an advisor releases
// the keys) there is nothing left to tag, so every open review for that RO is
// moot regardless of category. This is auto-RESOLVE (close-as-moot), NEVER
// auto-FIX — it delegates to the auto_resolve_reviews_for_ro RPC, which only
// sets resolved_at + writes an audit row and never mutates a key tag.
//
// STRICTLY best-effort: this runs AFTER the release has already succeeded, so it
// must never throw or block the release path. It checks the RPC error (no silent
// failure — observability rule 9) and logs, but always resolves to a count.
//
// ORP guardrail: only call this from CONFIRMING terminal-release sites (webhook
// posted-paid/payment, reconcile forward pass, orchestrator manual release) —
// NEVER from the reverse-pass orphan-release that births an ORP review.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type AutoResolveSource = "webhook" | "cron" | "claude_desktop";

/**
 * Close all open manual reviews for `roId` as moot. Returns the number closed
 * (0 on any error or when there are none). Never throws.
 *
 * @param signal short machine tag for WHY the RO closed (e.g. "ro_posted_paid",
 *               "payment_made", "manual_release") — recorded in resolution_notes
 *               + the audit reason as `moot_ro_closed:<signal>`.
 */
export async function autoResolveReviewsForRo(
  sb: SupabaseClient,
  roId: number | null | undefined,
  signal: string,
  source: AutoResolveSource,
): Promise<number> {
  if (roId === null || roId === undefined) return 0;

  const { data, error } = await sb.rpc("auto_resolve_reviews_for_ro", {
    p_ro_id: roId,
    p_reason: `moot_ro_closed:${signal}`,
    p_source: source,
  });

  if (error) {
    // Best-effort: the release already succeeded; surface but don't rethrow.
    console.error(
      JSON.stringify({
        level: "warning",
        msg: "autoResolveReviewsForRo failed",
        ro_id: roId,
        signal,
        source,
        detail: error.message,
      }),
    );
    return 0;
  }

  const closed = typeof data === "number" ? data : 0;
  if (closed > 0) {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "auto-resolved moot reviews",
        ro_id: roId,
        signal,
        closed,
      }),
    );
  }
  return closed;
}
