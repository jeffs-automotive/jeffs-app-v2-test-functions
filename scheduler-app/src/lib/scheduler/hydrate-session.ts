/**
 * Server-side session hydration for App Router pages.
 *
 * 2026-05-16 ephemeral-session rewrite. Per Chris's spec:
 *
 *   "If a customer leaves the page or times out they will need to start
 *    over. The appointment process will time out after 5 minutes of
 *    inactivity. If it times out it will reload the page and start at
 *    step one. The only thing that needs to persist is the appointment
 *    block. If the customer gets to that step and picks an appointment
 *    time it should block that appointment time or category while the
 *    customer finishes. However if the customer leaves the page or
 *    times out it resets."
 *
 * What this helper now does:
 *
 *   1. Read the cookie-bound chatId (middleware sets the cookie on
 *      every page nav). If missing/malformed, generate a fresh UUID.
 *   2. Look up the row. If no row → return chatId; BookPageShell's
 *      ensureSessionExists upsert creates it on the next call.
 *   3. STALE-ROW CHECK: a row is "stale" when status != 'active' OR
 *      last_active_at is more than 5 minutes ago. Stale rows are
 *      WIPED IN PLACE (same chatId, all wizard columns reset, status
 *      → 'active'). Any unconsumed appointment_hold for the session
 *      is released.
 *   4. ACTIVE rows are passed through untouched — same-tab refresh
 *      mid-flow resumes where the customer left off.
 *
 * Why wipe-in-place instead of issuing a fresh cookie: Server Components
 * can't mutate cookies in Next.js 15 (must be done in a Server Action or
 * Route Handler). Reusing the same chatId + resetting the row is the
 * cleanest server-side-only approach.
 *
 * Tab-close path: the IdleTimer fires `pagehide` beacon to
 * /api/scheduler/mark-abandoned → row.status='timed_out' + hold released.
 * Customer's next visit reads the timed_out row → wipe-in-place → fresh
 * greeting card.
 *
 * Active-timeout path: IdleTimer fires after 5 min idle → beacon →
 * window.location.reload() → middleware passes cookie through → this
 * helper detects status='timed_out' OR last_active_at > 5 min →
 * wipe-in-place → fresh greeting card.
 */

import { cookies } from "next/headers";
import { revalidateTag } from "next/cache";
import { after } from "next/server";
import * as Sentry from "@sentry/nextjs";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sessionTag } from "@/lib/scheduler/cache";
import { logError } from "@/lib/scheduler/wizard/log-error";

export const COOKIE_NAME = "sched-chat-id";

/** Active-session threshold per the 2026-05-16 spec. */
const STALE_AFTER_MS = 5 * 60 * 1000;

export interface HydratedSession {
  /** UUID from the HttpOnly cookie. Always set — middleware guarantees it. */
  chatId: string;
}

/**
 * Read the cookie + check freshness. Stale rows are wiped in place.
 * Returns the chatId the page should hydrate against.
 *
 * Safe to call from any Server Component. Performs at most 2 DB
 * operations:
 *   - 1 read (the row freshness check) — DIRECT supabase read, NOT
 *     via the per-session cache. Reason: Next.js's revalidateTag is
 *     deferred-to-post-render, so if hydrate-session populated the
 *     cache with the pre-wipe row, the downstream getCurrentCard call
 *     in the same request would still serve stale state. By reading
 *     direct, the cache is never primed with the pre-wipe row, and
 *     getCurrentCard's cache miss reads the post-wipe state.
 *   - 1 RPC call to hydrate_session_reset (only if stale) — atomically
 *     releases the prior hold(s), wipes wizard columns, and clears the
 *     bubble transcript (Plan 04 Phase 1B — closes I-COR-2). After
 *     RPC success, fires revalidateTag(sessionTag(chatId)) for
 *     cross-request invalidation of the per-session cache used by
 *     getCurrentCard.
 *
 * On a fresh tab with no cookie, performs 0 DB operations.
 */
export async function hydrateSession(): Promise<HydratedSession> {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(COOKIE_NAME)?.value;

  const chatId =
    cookieValue && /^[0-9a-f-]{36}$/i.test(cookieValue)
      ? cookieValue
      : crypto.randomUUID();

  // If the cookie was missing/malformed, there's no row yet — bail and
  // let ensureSessionExists create one fresh.
  if (!cookieValue || cookieValue !== chatId) {
    return { chatId };
  }

  // Cookie was valid. Check whether the row exists + is still fresh.
  try {
    // Plan 04 Phase 5B post-validation (Validator 1 C1 fix 2026-05-25):
    // hydrate-session uses a DIRECT (uncached) supabase read here —
    // NOT getCachedSessionRow. Rationale: Next.js's revalidateTag is
    // deferred-to-post-render (see node_modules/next/dist/server/web/
    // spec-extension/revalidate.js:147-157 — it only adds to
    // store.pendingRevalidatedTags). So if hydrate-session populates
    // the per-session cache here with the PRE-wipe row, then RPC-wipes,
    // then revalidateTag's, the in-render cache STILL serves the
    // pre-wipe row to BookPageShell's downstream getCurrentCard call —
    // defeating Phase 1B's wipe-in-place purpose.
    //
    // By reading direct, the cache is never primed with the pre-wipe
    // row from hydrate-session. getCurrentCard's later call to
    // getCachedSessionRow is a fresh cache miss → reads post-wipe state.
    //
    // Includes appointment_confirmed_at for the P0.1 post-confirm
    // terminal-state check below.
    const supabase = createSupabaseAdminClient();
    const { data: row, error: rowError } = await supabase
      .from("customer_chat_sessions")
      .select(
        "id, status, last_active_at, hold_token, appointment_confirmed_at",
      )
      .eq("id", chatId)
      .maybeSingle();

    if (rowError) {
      // No-silent-failure (observability.md rule 9): surface a read error
      // instead of treating it as "no row". Don't wipe on a failed read —
      // return the existing chatId and let downstream hydrate against the
      // live row (getCurrentCard does its own read + null-handling).
      Sentry.captureException(new Error(rowError.message), {
        tags: { surface: "hydrate_session_row_read" },
        level: "warning",
        extra: { chatId, code: rowError.code },
      });
      return { chatId };
    }

    if (!row) {
      // No row yet for this cookie — fresh path. ensureSessionExists
      // will create it.
      return { chatId };
    }

    const nowMs = Date.now();
    const lastActive = row.last_active_at
      ? new Date(row.last_active_at as string).getTime()
      : 0;
    const ageMs = nowMs - lastActive;

    // Terminal-state rule (2026-05-17): rows whose status is 'ended' or
    // 'escalated' are NOT wiped on reload regardless of age. The user
    // just finished an appointment (or hit escalation) — they should
    // keep seeing CompletedCard / EscalationCard until they explicitly
    // tap "Start over" or "Schedule another", not be silently reset to
    // GreetingCard by the next router.refresh().
    //
    // POST-VALIDATION FIX (Validator 2 P0.1, 2026-05-25): also exempt
    // rows where appointment_confirmed_at IS NOT NULL. After Tekmetric
    // confirms, the wizard advances to customer_notes (status='active',
    // NOT terminal). The mark-abandoned route has a bookingLanded
    // guard to skip status-flip, BUT hydrate-session previously had
    // no analogous check — a confirmed customer who walked away 5 min
    // and returned would hit the stale-age check, fire
    // hydrate_session_reset, and wipe appointment_id + customer_notes.
    // Tekmetric still has the appointment but our scheduler-app row
    // doesn't know about it. Customer sees a fresh greeting card
    // despite having a confirmed Tekmetric booking. Now: a confirmed
    // row keeps showing the customer_notes/customer_question/completed
    // step the customer was on.
    const isTerminalState =
      row.status === "ended" ||
      row.status === "escalated" ||
      row.appointment_confirmed_at != null;

    const isStale =
      !isTerminalState &&
      (row.status === "timed_out" ||
        row.status === "abandoned" ||
        (row.status === "active" && ageMs > STALE_AFTER_MS));

    if (!isStale) {
      // Active + fresh OR terminal-state — resume in place. Active is
      // the same-tab refresh happy path; terminal-state keeps the
      // completion / escalation surface visible.
      return { chatId };
    }

    // Stale. Atomically release any active hold, wipe wizard columns,
    // and clear the bubble transcript via hydrate_session_reset RPC
    // (Plan 04 Phase 1B — closes I-COR-2). Previously these 4 writes
    // ran in sequence; partial-success left an inconsistent row that
    // looked reset but had un-released holds or ghost bubbles.
    //
    // Source of truth for the wipe column set is the RPC body — see
    // supabase/migrations/20260524230000_rpc_hydrate_session_reset.sql.
    // Reuses the supabase admin client created above for the row read.
    const { error: resetError } = await supabase.rpc(
      "hydrate_session_reset",
      { p_chat_id: chatId },
    );

    if (resetError) {
      // Failed reset is a real customer-visible issue — the next render
      // reads a stale row and shows ghost bubbles. Bumped from warning
      // to error per Plan 04 spec; under the inline-writes design,
      // partial success was harder to detect so warning was the right
      // ceiling. Under the atomic RPC, a non-null error means the
      // entire reset rolled back.
      await logError({
        chatId,
        surface: "hydrate_session_reset",
        level: "error",
        error_code: resetError.code ?? null,
        message: resetError.message,
        context: {
          hint: resetError.hint,
          details: resetError.details,
        },
      });
      Sentry.captureException(new Error(resetError.message), {
        tags: { surface: "hydrate_session_reset" },
        level: "error",
        extra: { chatId, code: resetError.code },
      });
    } else {
      // PLAN 04 Phase 5B (Validator 1 C1) + Sentry JEFFS-APP-V2-TEST-FUNCTIONS-R
      // fix 2026-06-02: after the RPC wipe, invalidate the per-session cache so
      // BookPageShell's downstream getCurrentCard(chatId) can't serve the
      // pre-wipe row. With React cache() (cache.ts) this is a no-op today, kept
      // as a future-ready signal for a cross-instance cache. It MUST run via
      // `after()`: hydrateSession executes during the Server Component render,
      // and revalidateTag is illegal during render (it threw "revalidateTag
      // during render is unsupported" — 142 caught warnings). after() defers it
      // to post-render where it's legal. (applyWizardTransition + mark-abandoned
      // already call revalidateTag from legal action/route contexts.)
      after(() => revalidateTag(sessionTag(chatId)));
    }
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "hydrate_session_stale_check" },
      level: "warning",
      extra: { chatId },
    });
    // Fall through with the same chatId — better to return SOMETHING
    // than to throw at the page boundary.
  }

  return { chatId };
}
