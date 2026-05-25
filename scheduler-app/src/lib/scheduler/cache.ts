/**
 * Per-request session-row reader for the scheduler wizard.
 *
 * Plan 04 Phase 5B (initial) + 2026-05-25 architectural correction.
 *
 * History
 * ───────────────────────────────────────────────────────────────────
 * Phase 5B originally wrapped this read in `unstable_cache` with a
 * `session-${chatId}` tag, invalidated by `revalidateTag(...)` from
 * `applyWizardTransition` after every wizard step write. The idea was
 * to skip the DB read across renders for sessions whose state hadn't
 * changed.
 *
 * That design used the wrong cache primitive for this data class.
 * `unstable_cache` is backed by Vercel's Data Cache, which is
 * **eventually consistent** — `revalidateTag` propagates "within a
 * small number of seconds" across the global edge network per Vercel's
 * Data Cache docs. For read-mostly data (product catalog, marketing
 * page) that lag is invisible to users. For the wizard's session row,
 * which mutates on EVERY click and needs to be read fresh on the
 * router.refresh() that fires ~50ms after the Server Action returns,
 * the propagation lag was visible as "first click does nothing,
 * second click works" — the GET request lands on a Vercel lambda that
 * still has the pre-write cache entry because the revalidation hasn't
 * propagated there yet.
 *
 * Correction: use React `cache()` instead. React `cache()` is a
 * different primitive entirely — it memoizes within a SINGLE render
 * (RSC + Server Action invocation share the dedup), and resets between
 * renders. No cross-request cache → no propagation lag → no stale
 * reads after writes. The only benefit Phase 5B was actually delivering
 * (don't hit the DB twice when both hydrateSession + getCurrentCard
 * fetch the same row in one render) is preserved by React `cache()`;
 * the broken cross-request "optimization" is gone.
 *
 * The `revalidateTag(sessionTag(chatId))` calls in
 * `applyWizardTransition`, `mark-abandoned/route.ts`, and
 * `hydrate-session.ts` are now no-ops at runtime (nothing to
 * invalidate) but kept as future-ready signals: when a true
 * cross-instance cache lands (e.g., Upstash-backed cache handler),
 * those calls will start mattering again without a code refactor.
 *
 * What's wrapped (verified by Opus inventory agent 2026-05-25):
 *   - getCurrentCard's full-row SELECT in get-current-card.ts
 *
 * hydrate-session.ts deliberately bypasses this helper and reads
 * supabase directly. That bypass was added by C1 to defeat the
 * unstable_cache propagation lag. With this correction the
 * lag is gone, but hydrate-session's direct path is harmless — it
 * just does its own DB read instead of sharing one with
 * getCurrentCard. Future cleanup can route hydrate-session through
 * this helper to share the per-render dedup.
 *
 * Versions / API source-of-truth
 * ───────────────────────────────────────────────────────────────────
 * React `cache()` is stable in React 19, which Next.js 15.5 ships
 * with. Per-render memoization scope = the React render in progress;
 * Server Components and Server Actions called during that render
 * share the cache. Reference:
 * https://react.dev/reference/react/cache
 */
import { cache } from "react";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/database.types";

type SessionRow = Database["public"]["Tables"]["customer_chat_sessions"]["Row"];

/**
 * Per-session tag string. Stable + readable + bounded to 256 chars
 * (Next.js limit on tag strings; UUID + prefix is ~44 chars).
 *
 * Today it's used as a no-op signal — kept so a future cross-instance
 * cache handler (e.g., Upstash-backed) can wire into the same tag
 * vocabulary without a refactor of every `revalidateTag` callsite.
 */
export function sessionTag(chatId: string): string {
  return `session-${chatId}`;
}

/**
 * Per-render-memoized read of the `customer_chat_sessions` row for the
 * given chatId. Multiple callers in the same render share one DB
 * fetch; a fresh request gets a fresh fetch.
 *
 * Returns the full row (or null if no row exists for the chatId).
 *
 * Errors are thrown (not returned) so the React `cache()` memo doesn't
 * pin a failed read — next render retries fresh. The caller's
 * try/catch (e.g., hydrateSession's outer wrap) handles the throw.
 */
export const getCachedSessionRow = cache(
  async (chatId: string): Promise<SessionRow | null> => {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("customer_chat_sessions")
      .select("*")
      .eq("id", chatId)
      .maybeSingle();
    if (error) {
      // Throw so React's per-render memo doesn't cache the failure.
      // Caller's try/catch handles the surface (hydrateSession logs to
      // Sentry; getCurrentCard returns null which BookPageShell defaults
      // to a greeting card).
      throw error;
    }
    return (data ?? null) as SessionRow | null;
  },
);
