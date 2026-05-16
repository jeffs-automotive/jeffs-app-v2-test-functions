"use server";

/**
 * Step 10.4 submit — Customer question (Phase 13 2026-05-16).
 *
 * Per chat-design.md §Step 10.4 (lines 2716-2748): the customer can leave
 * an optional question for the service team OR skip. Either way, the
 * action:
 *
 *   1. Writes the row:
 *        - customer_question         = text or null
 *        - customer_question_forwarded = !!text
 *        - completed_at              = now()
 *        - status                    = 'ended'
 *        - outcome                   = 'scheduled'
 *      and advances current_step → 'completed'
 *   2. Fires the on-demand transcript dispatch (fire-and-forget — failure
 *      is caught by the 5-min cron backstop). This is the V2 replacement
 *      for the legacy `consultOrchestrator(finalize_session)` call, which
 *      had no actual tool implementation behind it.
 *   3. Returns a WizardTransitionResult so WizardSurface re-renders into
 *      the completed card.
 *
 * Phase 1 policy (chat-design.md §10.4): the chat does NOT attempt to
 * answer questions in-chat. Every question is forwarded via the
 * transcript email (rendered alongside the customer note + appointment
 * details). Phase 2+ may add Q&A.
 *
 * Outcome / status convention follows legacy session-actions.ts (line
 * 2685-2690): we set status='ended' + outcome='scheduled' here so the
 * row matches what the transcript dispatcher + audit tooling expect.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import { fireTranscriptDispatch } from "@/lib/scheduler/wizard/actions/fire-transcript-dispatch";

const MAX_QUESTION_LENGTH = 280; // matches CustomerQuestionCard's textarea cap

const submitCustomerQuestionSchema = z.object({
  chatId: z.string().min(1),
  question: z.string().max(MAX_QUESTION_LENGTH).nullable(),
});

export type SubmitCustomerQuestionV2Args = z.infer<
  typeof submitCustomerQuestionSchema
>;

export async function submitCustomerQuestionV2(
  args: SubmitCustomerQuestionV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitCustomerQuestionSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId, question } = parsed.data;

  const trimmed = question?.trim() ?? null;
  const finalQuestion = trimmed && trimmed.length > 0 ? trimmed : null;

  try {
    const result = await applyWizardTransition({
      chatId,
      updates: {
        customer_question: finalQuestion,
        customer_question_forwarded: !!finalQuestion,
        completed_at: new Date().toISOString(),
        status: "ended",
        outcome: "scheduled",
      },
      nextStep: "completed",
      jeffBubble: finalQuestion
        ? "Got it — passing your question to the team. Have a great day! 👋"
        : "All set then. Have a great day, and we'll see you soon! 👋",
    });

    // Fire-and-forget transcript dispatch. Failure does NOT block the
    // advance; the 5-min cron backstop picks up any unsent rows.
    void fireTranscriptDispatch({ chatId }).catch((e) => {
      Sentry.captureException(e, {
        tags: { surface: "submit_customer_question_v2_transcript_dispatch" },
        level: "warning",
        extra: { chatId },
      });
    });

    return result;
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "submit_customer_question_v2" },
      level: "error",
    });
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
