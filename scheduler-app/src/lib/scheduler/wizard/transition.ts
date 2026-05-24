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
import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { WizardStep } from "../session-state";
import type { WizardTransitionResult } from "./transition-types";

/**
 * Paths to revalidate after a wizard transition. Bug fix 2026-05-16:
 * previously only '/book-v2' was revalidated, but after the Phase 15
 * cutover the wizard ships on '/', '/book', AND '/book-v2' (redirect).
 * Cross-tab navigation + BFCache restore could land on a route whose
 * RSC cache wasn't invalidated.
 *
 * WizardSurface's router.refresh() papers over this for the active tab,
 * but a SECOND tab opened against / or /book would render stale RSC
 * bytes until that tab's next navigation. Revalidating all three paths
 * keeps every tab consistent.
 */
const WIZARD_REVALIDATE_PATHS = ["/", "/book", "/book-v2"] as const;

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

  // All three writes committed atomically. Revalidate every wizard surface.
  for (const path of WIZARD_REVALIDATE_PATHS) {
    revalidatePath(path);
  }

  return { ok: true, next_step: args.nextStep };
}
