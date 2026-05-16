"use server";

/**
 * Cross-cutting — Escalate (Phase 14 2026-05-16).
 *
 * Per chat-design.md §A "Escalation flow" (lines 3116-3186): trigger
 * sources include the footer "Talk to a person" button, keyword scanner
 * hits in free-text fields, OTP max attempts, summary edit limit,
 * Tekmetric write failures, and customer-notes parse-reject limit. Every
 * trigger funnels through THIS action.
 *
 * What this does:
 *   1. Snapshots the pre-escalation step so dismissEscalationV2 can
 *      restore it from the audit log later.
 *   2. Writes the row with status='escalated', escalated_at=now(),
 *      escalation_reason=<reason>, outcome='escalation' (so the transcript
 *      subject builder prepends [ESCALATED]).
 *   3. Audit-log row: event_type='escalation_triggered' with the prior
 *      step + reason stashed so dismissEscalationV2 can read it back.
 *   4. Fires the on-demand transcript dispatch — fire-and-forget so the
 *      customer's escalation card renders without waiting on Resend.
 *   5. Advances current_step to 'escalated' so getCurrentCard surfaces
 *      the EscalationCard on next render.
 *
 * Reason convention (mirrors legacy submitEscalate + chat-design.md
 * §3161):
 *   - 'manual_button_tap'           — footer button
 *   - 'keyword:<category>:<word>'   — keyword scanner
 *   - 'otp_max_attempts'            — OTP exhaustion
 *   - 'summary_edit_limit'          — summary edit cap
 *   - 'tekmetric_failure'           — write-side persistence failure
 *   - 'notes_reject_limit'          — Step 10.3 parsed-note reject 2x
 *
 * Pre-escalation step snapshot is kept in the audit-log event_detail —
 * no separate row column. dismissEscalationV2 reads the latest
 * 'escalation_triggered' row's event_detail.pre_escalation_step.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import { fireTranscriptDispatch } from "@/lib/scheduler/wizard/actions/fire-transcript-dispatch";

const submitEscalateSchema = z.object({
  chatId: z.string().min(1),
  reason: z.string().min(1).max(200).optional(),
});

export type SubmitEscalateV2Args = z.infer<typeof submitEscalateSchema>;

export async function submitEscalateV2(
  args: SubmitEscalateV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitEscalateSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId, reason = "manual_button_tap" } = parsed.data;

  try {
    const supabase = createSupabaseAdminClient();

    // Snapshot the pre-escalation step so dismissEscalationV2 can restore.
    const { data: priorRow } = await supabase
      .from("customer_chat_sessions")
      .select("current_step, status")
      .eq("id", chatId)
      .maybeSingle();
    const priorStep = (priorRow?.current_step as string | null) ?? "greeting";

    // Don't re-escalate an already-escalated session — the row reads
    // back the same state and we'd append a duplicate audit row.
    if ((priorRow?.status as string | null) === "escalated") {
      return { ok: true, next_step: "escalated" };
    }

    const result = await applyWizardTransition({
      chatId,
      updates: {
        status: "escalated",
        escalated_at: new Date().toISOString(),
        escalation_reason: reason,
        // outcome='escalation' triggers the [ESCALATED] subject prefix in
        // buildTranscriptSubject (transcript-html.ts).
        outcome: "escalation",
      },
      nextStep: "escalated",
      jeffBubble:
        "Let me get one of our advisors on this — call us at (610) 253-6565 and we'll take great care of you. 📞",
    });

    // Best-effort audit-log row carrying the pre-escalation step.
    void supabase
      .from("scheduler_audit_log")
      .insert({
        session_id: chatId,
        step: "escalated",
        event_type: "escalation_triggered",
        event_detail: {
          reason,
          pre_escalation_step: priorStep,
        },
      })
      .then(({ error }) => {
        if (error) {
          Sentry.captureMessage("submit_escalate_v2 audit insert failed", {
            level: "warning",
            extra: { chatId, error: error.message },
          });
        }
      });

    // Fire-and-forget transcript dispatch — surface the escalation to
    // service@jeffsautomotive.com within seconds. The 5-min cron
    // backstop catches failures.
    void fireTranscriptDispatch({ chatId }).catch((e) => {
      Sentry.captureException(e, {
        tags: { surface: "submit_escalate_v2_transcript_dispatch" },
        level: "warning",
        extra: { chatId },
      });
    });

    return result;
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "submit_escalate_v2" },
      level: "error",
    });
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
