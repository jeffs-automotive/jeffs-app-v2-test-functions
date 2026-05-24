/**
 * Per-session Next.js data cache helpers for the scheduler wizard.
 *
 * Plan 04 Phase 5B (closes I-OTH-3 — partial; see CLN-15 for the
 * eventual drop of the revalidatePath fallback).
 *
 * Why this exists
 * ───────────────────────────────────────────────────────────────────
 * Before Phase 5B, every wizard step advance fired `revalidatePath` on
 * 3 routes ("/", "/book", "/book-v2"). That invalidates the server-
 * rendered HTML for every concurrent session on those routes — so
 * advancing session A forced sessions B-J to re-render on their next
 * interaction, even though their wizard state hadn't changed.
 *
 * Phase 5B introduces `revalidateTag(\`session-${chatId}\`)` so only
 * the advancing session's RSC payload is invalidated. For that to do
 * anything, the RSC-level reads of `customer_chat_sessions` need to
 * be wrapped in Next.js's `unstable_cache` with the matching tag.
 *
 * What's wrapped (verified by Opus inventory agent 2026-05-25):
 *   - hydrateSession's freshness SELECT in hydrate-session.ts
 *   - getCurrentCard's full-row SELECT in get-current-card.ts
 *
 * Both are RSC-only; both call this helper. Server Action reads of
 * customer_chat_sessions deliberately bypass the cache — caching them
 * would silently stale-on-write inside the same request.
 *
 * Cache lifecycle
 * ───────────────────────────────────────────────────────────────────
 * - Key:  `["scheduler-session-row", chatId]`
 *   → each chatId gets a distinct cache entry
 * - Tag:  `session-${chatId}`
 *   → applyWizardTransition fires revalidateTag(sessionTag(chatId))
 *     after every write to invalidate exactly that session's entry
 * - TTL:  60 seconds backstop
 *   → if the revalidateTag chain ever silently breaks (the spec's
 *     "missing a tag = stale data" failure mode), the cache expires
 *     after 60s instead of forever. Provides a safety net without
 *     defeating the per-session granularity win.
 *
 * Constraints (from Next.js 15.5 docs)
 * ───────────────────────────────────────────────────────────────────
 * - Accessing `cookies()` / `headers()` inside an unstable_cache scope
 *   is unsupported. Callers must read those OUTSIDE the cache and
 *   pass derived values (like chatId) in as arguments. hydrateSession
 *   does this correctly.
 * - keyParts is the cache key; tags is only for invalidation. The
 *   chatId MUST be in keyParts to get per-session entries.
 *
 * Versions / API source-of-truth
 * ───────────────────────────────────────────────────────────────────
 * Verified against installed types at
 * scheduler-app/node_modules/next/dist/server/web/spec-extension/
 * unstable-cache.d.ts (Next.js 15.5.18). Signature:
 *   unstable_cache<T>(cb: T, keyParts?: string[],
 *     options?: { revalidate?: number | false; tags?: string[] }): T
 *
 * Note: Next.js 16 deprecates `unstable_cache` in favor of the
 * `'use cache'` directive + `cacheTag` + `cacheLife`. When this
 * project upgrades to Next.js 16, this module can be rewritten with
 * the new directive. The functional contract (per-session caching +
 * tag invalidation) is preserved across both APIs.
 */
import { unstable_cache } from "next/cache";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/database.types";

type SessionRow = Database["public"]["Tables"]["customer_chat_sessions"]["Row"];

/**
 * Per-session cache tag. Stable + readable + bounded to 256 chars
 * (Next.js limit on tag strings; UUID + prefix is ~44 chars).
 *
 * Used as both:
 *   - the tag passed to `unstable_cache({ tags: [...] })` on reads
 *   - the tag passed to `revalidateTag(...)` after writes
 */
export function sessionTag(chatId: string): string {
  return `session-${chatId}`;
}

/**
 * Cached read of the `customer_chat_sessions` row for the given chatId.
 *
 * Returns the full row (or null if no row exists for the chatId).
 * Callers pluck the fields they need; sharing one cache entry across
 * all RSC-level readers is simpler than maintaining per-projection
 * cache entries with their own keys.
 *
 * Errors are thrown (not returned) so the cache layer doesn't pin a
 * failed read — next request retries fresh. The caller's try/catch
 * (e.g., hydrateSession's outer wrap) handles the throw.
 *
 * Cache-key correctness
 * ───────────────────────────────────────────────────────────────────
 * The chatId is the second arg's keyParts entry — this ensures each
 * chatId has its own cache entry. Without it, Next.js would key only
 * on the function's stringified body, leading to a single shared
 * entry across all sessions (catastrophic correctness bug).
 */
export function getCachedSessionRow(
  chatId: string,
): Promise<SessionRow | null> {
  return unstable_cache(
    async (): Promise<SessionRow | null> => {
      const supabase = createSupabaseAdminClient();
      const { data, error } = await supabase
        .from("customer_chat_sessions")
        .select("*")
        .eq("id", chatId)
        .maybeSingle();
      if (error) {
        // Throw so the cache layer doesn't pin the failure. Caller's
        // try/catch handles the surface (hydrateSession logs to Sentry;
        // getCurrentCard returns null which BookPageShell defaults to
        // a greeting card).
        throw error;
      }
      return (data ?? null) as SessionRow | null;
    },
    ["scheduler-session-row", chatId],
    {
      tags: [sessionTag(chatId)],
      revalidate: 60,
    },
  )();
}
