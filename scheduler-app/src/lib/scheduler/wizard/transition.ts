/**
 * applyWizardTransition — the canonical "advance a wizard step" helper.
 *
 * Per chat-design.md "Architecture amendment — 2026-05-14", every Server
 * Action in the new wizard does these three things atomically:
 *
 *   1. Write the customer_chat_sessions row (column updates + new
 *      current_step + bump last_active_at)
 *   2. Optionally append a user-voice + Jeff-voice chat bubble (rendered on
 *      next page render via customer_chat_messages replay)
 *   3. Revalidate the wizard page so Next.js re-runs the Server Component
 *      and getCurrentCard picks up the new step
 *
 * 2026-05-24 — Plan 04 Phase 1A (closes I-COR-1):
 *   Steps 1 + 2 are now executed in a SINGLE Postgres transaction via the
 *   `apply_wizard_transition` RPC. PostgREST wraps the function call in a
 *   transaction; either all three writes commit or all three roll back.
 *
 *   The old flow used 3 sequential supabase-js calls (UPDATE +
 *   appendBubble(user) + appendBubble(assistant)) — non-atomic. A
 *   bubble-insert failure would leave the row advanced but the transcript
 *   missing a bubble, producing the "row says we're past greeting but
 *   transcript has no greeting bubble" failure mode.
 *
 *   The RPC also server-canonicalizes `last_active_at` via
 *   `pg_catalog.now()` — transition.ts no longer stamps it client-side.
 *   This removes a low-grade clock-drift risk on serverless instances
 *   whose system clocks have drifted from Postgres.
 *
 *   See migration 20260524220000_rpc_apply_wizard_transition.sql header
 *   for the full design rationale (including why the plan's WHERE
 *   status='active' guard was dropped to avoid breaking the 2026-05-23
 *   date-picker rescue path).
 *
 * Centralizing in this helper means every wizard step's Server Action
 * follows the same lifecycle — no per-step drift, no forgetting to call
 * revalidatePath, no inconsistent last_active_at bumps.
 */
import { revalidatePath, revalidateTag } from "next/cache";
import * as Sentry from "@sentry/nextjs";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sessionTag } from "@/lib/scheduler/cache";
import type { WizardStep } from "../session-state";
import type { WizardTransitionResult } from "./transition-types";

/**
 * Plan 04 Phase 5B (closes I-OTH-3 — partial):
 *
 * The pre-Phase-5B code fired `revalidatePath` on 3 routes ("/",
 * "/book", "/book-v2") after every wizard step. That invalidated
 * the server-rendered HTML for every concurrent session on those
 * routes — advancing session A forced sessions B-J to re-render
 * on their next interaction, even though their state hadn't changed.
 *
 * Phase 5B replaces the 3-path loop with:
 *   - revalidateTag(sessionTag(chatId)) — per-session granular
 *     invalidation. Only the advancing session's cached
 *     customer_chat_sessions row (read via getCachedSessionRow in
 *     hydrate-session.ts + get-current-card.ts) is invalidated.
 *   - revalidatePath("/", "page") — single-path fallback. Down from
 *     3 paths to 1 (the canonical customer surface). Catches any
 *     future RSC reader that lands WITHOUT being tag-instrumented.
 *     Defense in depth per PLAN-04 §Phase 5 mitigation: "Keep
 *     revalidatePath as a fallback (single-path, not 'layout' scope)."
 *
 * CLN-15 (NEW deferred item) tracks the eventual drop of the
 * revalidatePath fallback once all RSC readers are confirmed
 * tag-instrumented + a verification agent independently signs off.
 */

export interface ApplyWizardTransitionArgs {
  chatId: string;
  /** Column updates to merge onto customer_chat_sessions (excluding current_step + last_active_at). */
  updates?: Record<string, unknown>;
  /** New value for current_step. */
  nextStep: WizardStep;
  /** Optional Jeff-voice bubble to append (role='assistant'). */
  jeffBubble?: string;
  /** Optional sentinel-shaped user bubble to record the customer's submit (role='user'). */
  userBubble?: string;
}

export async function applyWizardTransition(
  args: ApplyWizardTransitionArgs,
): Promise<WizardTransitionResult> {
  const supabase = createSupabaseAdminClient();

  // Build the partial-update payload the RPC will COALESCE-merge onto the
  // existing row. Order matters:
  //
  //   1. status='active' default — the 2026-05-23 date-picker bug fix:
  //      rescues sessions that a racing mark-abandoned already flipped to
  //      'timed_out'. Goes FIRST so caller's args.updates.status can
  //      override (e.g., escalation/ended paths).
  //   2. ...args.updates — caller's explicit column changes. Spread AFTER
  //      so any overlap with status wins for the caller.
  //   3. current_step — always set to nextStep. Goes LAST so a caller
  //      can't accidentally clobber it via args.updates.current_step.
  //
  // last_active_at is NOT included — the RPC sets it server-side via
  // pg_catalog.now() to remove client/server clock-drift risk. If a
  // caller passes last_active_at in updates, we strip it before the RPC
  // call (defensive; the RPC also ignores any last_active_at key).
  const { last_active_at: _stripped, ...callerUpdates } = (args.updates ??
    {}) as Record<string, unknown>;
  void _stripped; // intentionally discarded — RPC owns this column

  const payload: Record<string, unknown> = {
    status: "active",
    ...callerUpdates,
    current_step: args.nextStep,
  };

  const { error } = await supabase.rpc("apply_wizard_transition", {
    p_chat_id: args.chatId,
    p_payload: payload,
    p_user_bubble_text: args.userBubble ?? null,
    p_assistant_bubble_text: args.jeffBubble ?? null,
  });

  if (error) {
    // P0002 is the RPC's stable "session row not found" SQLSTATE. This is
    // an expected race-loss path (the customer's tab died, mark-abandoned
    // hard-deleted the row, etc.) — surface a stable typed error so
    // callers can branch on it. Don't alert Sentry; this is operational
    // noise that creates alert fatigue.
    if (error.code === "P0002") {
      return { ok: false, error: "session_not_found_or_inactive" };
    }

    Sentry.captureException(error, {
      tags: {
        surface: "apply_wizard_transition_rpc",
        next_step: args.nextStep,
      },
      level: "error",
    });
    return { ok: false, error: error.message };
  }

  // All three writes committed atomically. Invalidate this session's
  // cached RSC reads (per-session granular) + a single-path fallback
  // for any uninstrumented reader (defense in depth). See header
  // comment for the Phase 5B rationale + the CLN-15 follow-up.
  revalidateTag(sessionTag(args.chatId));
  revalidatePath("/", "page");

  return { ok: true, next_step: args.nextStep };
}
