"use server";

/**
 * Step 3.5a — Partial-verification gate submit (V2, server-state-driven).
 *
 * Per chat-design.md §3.5 lines 712-757 + the spec's "constraints when
 * verification_level='partial'" block lines 750-758.
 *
 * Four actions:
 *   - 'use_different_phone'  → clear phone + OTP state, bounce back to
 *                              Step 2 with name pre-filled
 *   - 'proceed_as_partial'   → set identity_verification_level='partial',
 *                              SKIP customer_info_edit, advance to
 *                              vehicle_pick. Downstream sensitive-action
 *                              gates (Tekmetric PATCH on customer, vehicle
 *                              add, notes → customer.notes) read this
 *                              level and refuse the operation.
 *   - 'continue_as_new'      → flip bucket to 'new', advance to
 *                              new_customer_info (Step 4 new-client). Per
 *                              the same "continue as new from a 3.5
 *                              branch" pattern as §3.5b — no fresh OTP
 *                              because the customer just authenticated
 *                              their phone via OTP to land here.
 *   - 'escalate'             → status='escalated', set escalation_reason,
 *                              advance to 'escalated' terminal state.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";

const submitPartialVerificationChoiceSchema = z.object({
  chatId: z.string().min(1),
  action: z.enum([
    "use_different_phone",
    "proceed_as_partial",
    "continue_as_new",
    "escalate",
  ]),
});

export type SubmitPartialVerificationChoiceV2Args = z.infer<
  typeof submitPartialVerificationChoiceSchema
>;

export async function submitPartialVerificationChoiceV2(
  args: SubmitPartialVerificationChoiceV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitPartialVerificationChoiceSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId, action } = parsed.data;

  try {
    if (action === "escalate") {
      return applyWizardTransition({
        chatId,
        updates: {
          status: "escalated",
          escalated_at: new Date().toISOString(),
          escalation_reason: "partial_verification:customer_chose_escalate",
        },
        nextStep: "escalated",
        jeffBubble:
          "No problem — give us a ring at (610) 253-6565 and we'll sort it. 📞",
      });
    }

    if (action === "use_different_phone") {
      return applyWizardTransition({
        chatId,
        updates: {
          phone_e164: null,
          otp_sent_at: null,
          otp_verified_at: null,
          otp_attempts: 0,
          customer_id: null,
          identity_verification_level: null,
        },
        nextStep: "phone_name",
        jeffBubble:
          "No problem — pop in a different number and I'll try again. 📱",
      });
    }

    if (action === "continue_as_new") {
      return applyWizardTransition({
        chatId,
        updates: {
          customer_self_identified: "new",
          is_returning_customer: false,
        },
        nextStep: "new_customer_info",
        jeffBubble:
          "Welcome aboard! 👋 Let's get your account set up — just a few quick details.",
      });
    }

    // proceed_as_partial — set the partial level and skip directly to
    // vehicle_pick (Step 5 customer_info_edit is BLOCKED for partial
    // verification per spec lines 751-758).
    return applyWizardTransition({
      chatId,
      updates: {
        identity_verification_level: "partial",
      },
      nextStep: "vehicle_pick",
      jeffBubble:
        "Got it — let's pick your vehicle. (Note: account edits will need a phone call to (610) 253-6565.)",
    });
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "submit_partial_verification_choice_v2", action },
      level: "error",
    });
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
