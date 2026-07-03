"use server";

/**
 * Cross-cutting — Start Over (Phase 14 2026-05-16).
 *
 * Per chat-design.md §Cross-cutting page-footer affordances (lines
 * 3098-3113): the "🔄 Start over" footer button resets the customer's
 * in-flight session to a clean greeting state. The cookie-bound chatId
 * stays the same (so the page reload picks up the same row); we wipe
 * every wizard column AND the customer_chat_messages transcript so the
 * UI re-renders with the GreetingCard and no stale bubble history.
 *
 * What this does NOT do:
 *   - It does NOT clear the cookie / change the chat id. The cookie is
 *     the customer's identity within Phase 1 (no cross-device sessions);
 *     spinning up a new chatId would lose audit history. Instead we keep
 *     the id and rewrite the row.
 *   - It does NOT confirm — the footer card surfaces the 2-tap confirm
 *     in the client; by the time we get here the customer already
 *     acknowledged the reset.
 *
 * Audit log: writes `session_restarted` with the prior step + outcome so
 * the service team can see repeat-restart UX-signals in the transcript.
 *
 * Per the legacy submitStartOver pattern: silent failure of the
 * customer_chat_messages delete is OK (logged but not raised) — wiping
 * the row is the load-bearing half; if bubble cleanup fails the
 * customer's next render just has stale ghost bubbles that re-resolve
 * on the next interaction.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import { wrapAction } from "@/lib/scheduler/wizard/instrument-action";

const submitStartOverSchema = z.object({
  chatId: z.string().min(1),
});

export type SubmitStartOverV2Args = z.infer<typeof submitStartOverSchema>;

async function submitStartOverV2Impl(
  args: SubmitStartOverV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitStartOverSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId } = parsed.data;

  try {
    const supabase = createSupabaseAdminClient();

    // Snapshot pre-restart context for audit telemetry.
    const { data: priorRow } = await supabase
      .from("customer_chat_sessions")
      .select("current_step, status, started_at")
      .eq("id", chatId)
      .maybeSingle();
    const priorStep = (priorRow?.current_step as string | null) ?? null;
    const priorStatus = (priorRow?.status as string | null) ?? null;
    const startedAt =
      typeof priorRow?.started_at === "string" ? priorRow.started_at : null;
    const latencyInPriorSession =
      startedAt && Number.isFinite(Date.parse(startedAt))
        ? Math.round((Date.now() - Date.parse(startedAt)) / 1000)
        : null;

    // Wipe the transcript so the next render starts from a clean
    // GreetingCard with no ghost bubbles. Best-effort — if this fails the
    // wizard advance still succeeds.
    const { error: deleteMsgError } = await supabase
      .from("customer_chat_messages")
      .delete()
      .eq("session_id", chatId);
    if (deleteMsgError) {
      Sentry.captureMessage("submit_start_over_v2 delete messages failed", {
        level: "warning",
        extra: { chatId, error: deleteMsgError.message },
      });
    }

    // Wipe every wizard-state column on the row. Mirror of the legacy
    // submitStartOver column list; appointment_confirmed_at + the
    // customer_notes / customer_question fields wipe so a prior
    // run doesn't bleed into the new one.
    const result = await applyWizardTransition({
      chatId,
      updates: {
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
        // Summary edit hub (task EH1): clear the return-to-hub breadcrumb
        // so a fresh session never resumes mid-edit.
        edit_return_step: null,
        escalated_at: null,
        escalation_reason: null,
        ended_at: null,
        completed_at: null,
        outcome: null,
        status: "active",
      },
      nextStep: "greeting",
      jeffBubble:
        "All clear — let's start fresh. 👋 Are you a returning customer or new to Jeff's?",
    });

    // Best-effort audit write. We're not blocking on the result; if the
    // insert fails the wizard still advances.
    void supabase
      .from("scheduler_audit_log")
      .insert({
        session_id: chatId,
        step: "greeting",
        event_type: "session_restarted",
        event_detail: {
          previous_step: priorStep,
          previous_status: priorStatus,
          latency_in_old_session_sec: latencyInPriorSession,
        },
      })
      .then(({ error }) => {
        if (error) {
          Sentry.captureMessage("submit_start_over_v2 audit insert failed", {
            level: "warning",
            extra: { chatId, error: error.message },
          });
        }
      });

    return result;
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "submit_start_over_v2" },
      level: "error",
    });
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export const submitStartOverV2 = wrapAction(
  "submitStartOverV2",
  submitStartOverV2Impl,
);
