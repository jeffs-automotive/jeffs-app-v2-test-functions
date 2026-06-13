"use server";

/**
 * Wizard "Back" — Phase 1 back-navigation helper (2026-05-17).
 *
 * Customers regularly want to back out of a card and re-pick. The wizard
 * is a step-based state machine, so "back" needs an explicit map from
 * the current step to its predecessor step rather than a generic
 * browser-history navigation (the row's `current_step` is the source of
 * truth; the URL doesn't carry step state).
 *
 * Implementation choice — hardcoded map vs. step_history column. We
 * chose the hardcoded map for Phase 1 because:
 *   - No migration required (ship-now friendly).
 *   - The wizard has well-defined fork points; the map captures them.
 *   - For branchy steps (vehicle_pick can come from customer_info_edit
 *     OR new_customer_info), we read the row to pick the right predecessor.
 *
 * The "Back" button is NOT shown on:
 *   - greeting           — nothing to go back to
 *   - otp_pending        — back would re-trigger an SMS send; use "Try a
 *                          different number" affordance instead (which
 *                          isn't a back, it's a phone re-entry flow)
 *   - diagnostic_loading — transient state; the LLM is mid-run
 *   - customer_notes / customer_question — post-confirm; the appointment
 *                          is already booked
 *   - completed / escalated / abandoned — terminal states
 *
 * Cards that DO get a Back button are the major branch points:
 *   phone_name, partial_verification_gate, no_match_choose_path,
 *   multi_account_disambiguation, customer_info_edit, new_customer_info,
 *   vehicle_pick, new_vehicle_form, service_concern_picker,
 *   concern_explanation, clarification_question, testing_service_approval,
 *   second_routine_pass, appointment_type, date_pick, waiter_time_pick,
 *   summary (back → date_pick; the per-section "Edit" buttons on the
 *   SummaryCard remain the preferred deep-jump).
 *
 * This list mirrors STEPS_WITH_BACK in WizardBackBar.tsx and the non-null
 * keys of backTargetFor below — keep all three in sync.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import type { WizardStep } from "@/lib/scheduler/session-state";
import { wrapAction } from "@/lib/scheduler/wizard/instrument-action";

const submitBackSchema = z.object({
  chatId: z.string().min(1),
});

export type SubmitBackV2Args = z.infer<typeof submitBackSchema>;

async function submitBackV2Impl(
  args: SubmitBackV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitBackSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId } = parsed.data;

  try {
    const supabase = createSupabaseAdminClient();
    const { data: row, error: rowErr } = await supabase
      .from("customer_chat_sessions")
      .select("current_step, customer_id, hold_token")
      .eq("id", chatId)
      .maybeSingle();
    if (rowErr || !row) {
      return { ok: false, error: rowErr?.message ?? "session_not_found" };
    }
    const currentStep = row.current_step as WizardStep | null;
    if (!currentStep) {
      return { ok: false, error: "no current_step on row" };
    }

    const target = backTargetFor(currentStep, {
      isNewCustomer: row.customer_id == null,
    });
    if (!target) {
      // Step has no back path — return ok so the client doesn't surface
      // an error; the Back button simply won't be rendered on these
      // steps in the first place, but a stale click shouldn't error out.
      return { ok: true, next_step: currentStep };
    }

    // When backing out of a step that placed a hold (dropoff date_pick
    // wrote `hold_token` and may have advanced to summary), releasing
    // the hold prevents the customer from holding two slots
    // simultaneously when they pick a new date. The applyWizardTransition
    // below will overwrite hold_token=null in the row write; the
    // appointment_holds row gets released_at set so the cron reaper
    // sees it as closed.
    if (
      (currentStep === "summary" ||
        currentStep === "waiter_time_pick" ||
        currentStep === "date_pick") &&
      typeof row.hold_token === "string" &&
      row.hold_token.length > 0
    ) {
      await supabase
        .from("appointment_holds")
        .update({ released_at: new Date().toISOString() })
        .eq("id", row.hold_token)
        .is("released_at", null);
    }

    const updates: Record<string, unknown> = {};
    // Clear hold_token when leaving the hold zone so a re-entry forms a
    // fresh hold rather than re-using the released one.
    if (
      currentStep === "summary" ||
      currentStep === "waiter_time_pick" ||
      currentStep === "date_pick"
    ) {
      updates.hold_token = null;
    }

    return applyWizardTransition({
      chatId,
      updates,
      nextStep: target,
    });
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "submit_back_v2" },
      level: "error",
    });
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export const submitBackV2 = wrapAction("submitBackV2", submitBackV2Impl);

/**
 * Map a current step to its predecessor. Returns null when the step has
 * no sensible back (greeting / terminal / transient). The `row` argument
 * supplies the row-state needed to disambiguate branched predecessors
 * (e.g. vehicle_pick coming from customer_info_edit vs new_customer_info).
 */
function backTargetFor(
  current: WizardStep,
  row: { isNewCustomer: boolean },
): WizardStep | null {
  switch (current) {
    // No back from these
    case "greeting":
    case "otp_pending":
    case "diagnostic_loading":
    case "completed":
    case "escalated":
    case "abandoned":
      return null;

    case "phone_name":
      return "greeting";

    case "partial_verification_gate":
    case "no_match_choose_path":
    case "multi_account_disambiguation":
      return "phone_name";

    case "customer_info_edit":
      // Returning-customer path; the immediate predecessor in the happy
      // path is otp_pending. We can't go back to OTP (that would re-send
      // a code), so we route to phone_name and the customer can re-enter.
      return "phone_name";

    case "new_customer_info":
      // New-customer path; predecessor is no_match_choose_path or
      // partial_verification_gate. no_match is the most common entry —
      // route there. partial_verification_gate customers will lose their
      // gate context if they back-navigate; acceptable tradeoff.
      return "no_match_choose_path";

    case "vehicle_pick":
      // Customer info form was the predecessor — branched by customer
      // identity (returning vs new).
      return row.isNewCustomer ? "new_customer_info" : "customer_info_edit";

    case "new_vehicle_form":
      return "vehicle_pick";

    case "service_concern_picker":
      return "vehicle_pick";

    case "concern_explanation":
    case "clarification_question":
    case "testing_service_approval":
      return "service_concern_picker";

    case "second_routine_pass":
      // Predecessor is the diagnostic loop's terminus; concrete prior
      // card varies but service_concern_picker is the safe re-entry.
      return "service_concern_picker";

    case "appointment_type":
      return "second_routine_pass";

    case "date_pick":
      return "appointment_type";

    case "waiter_time_pick":
      return "date_pick";

    case "summary":
      // Back from summary goes to the date (the most recent decision).
      // Per-section "Edit" buttons on the SummaryCard remain the
      // preferred way to jump deeper.
      return "date_pick";

    case "customer_notes":
    case "customer_question":
      // Post-confirm: no back. The appointment is booked.
      return null;
  }
}
