"use server";

/**
 * Cross-cutting — Dismiss escalation (Phase 14 2026-05-16).
 *
 * Per chat-design.md §A "Escalation flow" (lines 3167-3177): the
 * "Back to scheduling" button on the EscalationCard reverts the session
 * to its pre-escalation state. The audit log keeps the
 * `escalation_triggered` row + a new `escalation_dismissed` row so the
 * service team can see the customer self-corrected.
 *
 * Implementation:
 *   1. Read the latest 'escalation_triggered' audit-log row for this
 *      session — its event_detail.pre_escalation_step is the step we
 *      restore to. Ordered by occurred_at DESC so back-to-back
 *      escalation/dismiss cycles work correctly.
 *   2. Fail-safe: if no audit row exists (audit insert failed earlier,
 *      or the customer landed directly on the escalated step via a
 *      query param trick), restore to 'greeting' — a working surface is
 *      better than a stuck escalated step.
 *   3. Write the row: status='active', escalated_at=null,
 *      escalation_reason=null, outcome=null (clears the [ESCALATED]
 *      transcript subject prefix for the eventual happy-path send).
 *   4. Audit-log row: 'escalation_dismissed' with the restored step.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import type { WizardStep } from "@/lib/scheduler/session-state";

const dismissEscalationSchema = z.object({
  chatId: z.string().min(1),
});

export type DismissEscalationV2Args = z.infer<typeof dismissEscalationSchema>;

// Defensive allow-list — only restore to steps we actually render. If the
// audit-log carries a weird value the customer hits greeting instead.
const VALID_RESTORE_STEPS: ReadonlySet<WizardStep> = new Set<WizardStep>([
  "greeting",
  "phone_name",
  "otp_pending",
  "partial_verification_gate",
  "multi_account_disambiguation",
  "no_match_choose_path",
  "customer_info_edit",
  "new_customer_info",
  "vehicle_pick",
  "new_vehicle_form",
  "service_concern_picker",
  "concern_explanation",
  "diagnostic_loading",
  "clarification_question",
  "testing_service_approval",
  "second_routine_pass",
  "appointment_type",
  "date_pick",
  "waiter_time_pick",
  "summary",
  "customer_notes",
  "customer_question",
]);

export async function dismissEscalationV2(
  args: DismissEscalationV2Args,
): Promise<WizardTransitionResult> {
  const parsed = dismissEscalationSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId } = parsed.data;

  try {
    const supabase = createSupabaseAdminClient();

    // Find the most recent escalation_triggered audit row.
    const { data: auditRow } = await supabase
      .from("scheduler_audit_log")
      .select("event_detail")
      .eq("session_id", chatId)
      .eq("event_type", "escalation_triggered")
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const rawPreStep =
      (
        auditRow?.event_detail as
          | { pre_escalation_step?: string }
          | null
          | undefined
      )?.pre_escalation_step ?? "greeting";

    const restoreStep: WizardStep = VALID_RESTORE_STEPS.has(
      rawPreStep as WizardStep,
    )
      ? (rawPreStep as WizardStep)
      : "greeting";

    const result = await applyWizardTransition({
      chatId,
      updates: {
        status: "active",
        escalated_at: null,
        escalation_reason: null,
        // Clear outcome so the eventual happy-path transcript doesn't
        // carry the [ESCALATED] subject prefix from the prior trigger.
        outcome: null,
      },
      nextStep: restoreStep,
      jeffBubble:
        "All good — let's pick up where you left off. 👍",
    });

    // Best-effort audit row.
    void supabase
      .from("scheduler_audit_log")
      .insert({
        session_id: chatId,
        step: restoreStep,
        event_type: "escalation_dismissed",
        event_detail: { restored_to_step: restoreStep },
      })
      .then(({ error }) => {
        if (error) {
          Sentry.captureMessage(
            "dismiss_escalation_v2 audit insert failed",
            { level: "warning", extra: { chatId, error: error.message } },
          );
        }
      });

    return result;
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "dismiss_escalation_v2" },
      level: "error",
    });
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
