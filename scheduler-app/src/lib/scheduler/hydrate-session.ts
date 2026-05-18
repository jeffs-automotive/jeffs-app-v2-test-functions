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

export const COOKIE_NAME = "sched-chat-id";

/** Active-session threshold per the 2026-05-16 spec. */
const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Wizard-state columns wiped during a stale-row reset. Mirror of
 * submitStartOverV2's column list so the manual "Start Over" path and
 * the automatic "session timed out" path produce the same fresh state.
 *
 * Keys NOT in this list (preserved on reset):
 *   - id, shop_id, channel, started_at — identity / immutable per session
 *   - last_active_at, current_step, status — reset explicitly below
 */
const RESET_COLUMNS = {
  is_returning_customer: null,
  greeting_answered_at: null,
  entered_first_name: null,
  entered_last_name: null,
  phone_e164: null,
  otp_sent_at: null,
  otp_attempts: 0,
  otp_verified_at: null,
  identity_verification_level: null,
  verified_first_name: null,
  verified_last_name: null,
  edited_phones: null,
  edited_emails: null,
  edited_address: null,
  primary_email_for_description: null,
  new_vehicle_info: null,
  customer_id: null,
  vehicle_id: null,
  appointment_id: null,
  pending_candidates: null,
  customer_self_identified: null,
  selected_simple_services: null,
  explanation_required_items: null,
  diagnostic_processing_complete: false,
  clarification_questions_pending: null,
  clarification_questions_answered: null,
  recommended_testing_services: null,
  approved_testing_services: null,
  declined_testing_services: null,
  additional_routine_services_round2: null,
  appointment_type: null,
  appointment_date: null,
  appointment_time: null,
  hold_token: null,
  appointment_confirmed_at: null,
  customer_notes_text: null,
  customer_notes_approved: null,
  customer_notes_edit_attempts: 0,
  customer_question: null,
  customer_question_forwarded: false,
  summary_edit_attempts: 0,
  escalated_at: null,
  escalation_reason: null,
  ended_at: null,
  completed_at: null,
  outcome: null,
} as const;

export interface HydratedSession {
  /** UUID from the HttpOnly cookie. Always set — middleware guarantees it. */
  chatId: string;
}

/**
 * Read the cookie + check freshness. Stale rows are wiped in place.
 * Returns the chatId the page should hydrate against.
 *
 * Safe to call from any Server Component. Performs at most 3 DB
 * operations:
 *   - 1 read (the row freshness check)
 *   - 1 write to release the prior hold (only if a hold existed)
 *   - 1 write to reset the wizard columns (only if stale)
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

    // Stale. Release any active hold, then wipe wizard columns in place.
    // Both writes are best-effort — failure shouldn't block the page
    // render. The customer will see the greeting card either way (the
    // wipe is what produces the greeting; if the wipe fails, the page
    // will still render whatever step is set).
    const nowIso = new Date().toISOString();
    if (row.hold_token) {
      await supabase
        .from("appointment_holds")
        .update({ released_at: nowIso })
        .eq("id", row.hold_token as string)
        .is("released_at", null);
    }
    // Also release any holds keyed by session_id (defense — the
    // hold_token column above is the per-row pointer, but
    // appointment_holds may have additional rows for this session).
    await supabase
      .from("appointment_holds")
      .update({ released_at: nowIso })
      .eq("session_id", chatId)
      .is("released_at", null);

    await supabase
      .from("customer_chat_sessions")
      .update({
        ...RESET_COLUMNS,
        current_step: null, // getCurrentCard falls back to 'greeting'
        status: "active",
        last_active_at: nowIso,
      })
      .eq("id", chatId);

    // Also wipe the chat-bubble transcript so the rendered conversation
    // starts clean. Mirror of submitStartOverV2.
    await supabase
      .from("customer_chat_messages")
      .delete()
      .eq("session_id", chatId);
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
