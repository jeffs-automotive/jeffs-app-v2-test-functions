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
  const nowIso = new Date().toISOString();

  // 2026-05-23 BUG FIX (date-picker stuck-on-first-click): write
  // status='active' by default. A wizard transition IS an active
  // interaction; setting status='active' alongside the new step ensures
  // that any racing mark-abandoned which already flipped status to
  // 'timed_out' gets corrected here. Without this, hydrateSession on the
  // next page render would observe status='timed_out' and wipe the row
  // in place — stranding the customer at the greeting card right after
  // they'd successfully picked a date.
  //
  // Callers that intentionally want a non-active status (escalation,
  // ended, etc.) pass it via `updates.status`; the spread below preserves
  // their override because they come AFTER the default.
  const payload: Record<string, unknown> = {
    status: "active",
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

  for (const path of WIZARD_REVALIDATE_PATHS) {
    revalidatePath(path);
  }

  return { ok: true, next_step: args.nextStep };
}
