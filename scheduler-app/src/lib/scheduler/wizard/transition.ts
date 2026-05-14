/**
 * applyWizardTransition — the canonical "advance a wizard step" helper.
 *
 * Per chat-design.md "Architecture amendment — 2026-05-14", every Server
 * Action in the new wizard does these three things atomically:
 *
 *   1. Write the customer_chat_sessions row (column updates + new
 *      current_step + bump last_active_at)
 *   2. Optionally append a Jeff-voice chat-bubble (rendered on next page
 *      render via customer_chat_messages replay)
 *   3. Revalidate the wizard page so Next.js re-runs the Server Component
 *      and getCurrentCard picks up the new step
 *
 * Centralizing in this helper means every wizard step's Server Action
 * follows the same lifecycle — no per-step drift, no forgetting to call
 * revalidatePath, no inconsistent last_active_at bumps.
 *
 * Why no transaction wrapper around row write + bubble append? Bubble
 * persistence is a transcript concern; if it fails, the wizard advance
 * still succeeds (caught by Sentry; user keeps moving). A two-table
 * transaction would require an RPC; not worth it for Phase 1.
 */
import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { WizardStep } from "../session-state";
import { appendBubble, type BubbleRole } from "./append-bubble";
import type { WizardTransitionResult } from "./transition-types";

/**
 * Path to revalidate after a wizard transition. /book-v2 is the parallel
 * route phases 3-14 build the new surface in. Phase 15 swaps this to
 * '/book' as part of the cutover; phase 16 (delete dead code) removes the
 * /book-v2 route entirely.
 */
const WIZARD_REVALIDATE_PATH = "/book-v2";

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
  const nowIso = new Date().toISOString();

  const payload: Record<string, unknown> = {
    ...(args.updates ?? {}),
    current_step: args.nextStep,
    last_active_at: nowIso,
  };

  const { error: updateErr } = await supabase
    .from("customer_chat_sessions")
    .update(payload)
    .eq("id", args.chatId);

  if (updateErr) {
    Sentry.captureException(updateErr, {
      tags: {
        surface: "apply_wizard_transition_row_write",
        next_step: args.nextStep,
      },
      level: "error",
    });
    return { ok: false, error: updateErr.message };
  }

  // Bubble appends run sequentially so the user-bubble appears before the
  // jeff-bubble in transcript order. Failures don't abort the transition.
  if (args.userBubble) {
    await appendBubble({
      chatId: args.chatId,
      role: "user" satisfies BubbleRole,
      text: args.userBubble,
    });
  }
  if (args.jeffBubble) {
    await appendBubble({
      chatId: args.chatId,
      role: "assistant" satisfies BubbleRole,
      text: args.jeffBubble,
    });
  }

  revalidatePath(WIZARD_REVALIDATE_PATH);

  return { ok: true, next_step: args.nextStep };
}
