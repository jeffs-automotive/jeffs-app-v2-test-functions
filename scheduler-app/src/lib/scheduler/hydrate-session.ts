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
import * as Sentry from "@sentry/nextjs";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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
 *   - 1 read (the row freshness check)
 *   - 1 RPC call to hydrate_session_reset (only if stale) — atomically
 *     releases the prior hold(s), wipes wizard columns, and clears the
 *     bubble transcript (Plan 04 Phase 1B — closes I-COR-2)
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
    const supabase = createSupabaseAdminClient();
    const { data: row } = await supabase
      .from("customer_chat_sessions")
      .select("id, status, last_active_at, hold_token")
      .eq("id", chatId)
      .maybeSingle();

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
    const isTerminalState =
      row.status === "ended" || row.status === "escalated";

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
