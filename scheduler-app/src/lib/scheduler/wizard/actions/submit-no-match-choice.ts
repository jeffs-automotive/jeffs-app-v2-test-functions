"use server";

/**
 * Step 3.5b — No-match-choose-path submit (V2, server-state-driven).
 *
 * Per chat-design.md §3.5b lines 759-773.
 *
 * Two actions:
 *   - 'try_different_phone' → clear phone + OTP state, bounce back to Step 2
 *     (PhoneNameCard with first/last pre-filled, phone empty)
 *   - 'continue_as_new'     → flip customer_self_identified='new', advance
 *     to new_customer_info (Step 4 new-client)
 *
 * NOTE: per chat-design.md §3.5b, the "continue as new" path SKIPS OTP
 * because the customer just went through the lookup flow + the choose-path
 * screen — that's the spec's verification proxy. This is intentionally
 * different from the §3 "new + 0 match" Option B path (which DOES OTP-
 * verify) — the customer's bucket origin differs, and the spec treats them
 * differently.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import { wrapAction } from "@/lib/scheduler/wizard/instrument-action";

const submitNoMatchChoiceSchema = z.object({
  chatId: z.string().min(1),
  action: z.enum(["continue_as_new", "try_different_phone"]),
});

export type SubmitNoMatchChoiceV2Args = z.infer<
  typeof submitNoMatchChoiceSchema
>;

async function submitNoMatchChoiceV2Impl(
  args: SubmitNoMatchChoiceV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitNoMatchChoiceSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId, action } = parsed.data;

  try {
    if (action === "try_different_phone") {
      // Clear the phone + any OTP state so the customer enters fresh.
      // Keep entered_first_name + entered_last_name so PhoneNameCard's
      // prefill (Phase 4 addition) makes them not retype names.
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

    // continue_as_new: switch bucket to 'new', advance to Step 4 new-client.
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
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "submit_no_match_choice_v2", action },
      level: "error",
    });
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export const submitNoMatchChoiceV2 = wrapAction(
  "submitNoMatchChoiceV2",
  submitNoMatchChoiceV2Impl,
);
