"use client";

/**
 * WizardSurface — client-side step dispatcher for the server-state-driven
 * wizard (rendered at / and /book).
 *
 * Per chat-design.md "Architecture amendment — 2026-05-14": the page's
 * Server Component reads customer_chat_sessions via getCurrentCard and
 * passes the WizardCard down. This component switches on card.step and
 * renders the matching card. The always-visible footer (Start Over + Talk
 * to a Person) is wired at the page level (WizardCrossCutting), not here.
 *
 * Error surface: card submits await the Server Action; failures log to
 * Sentry (inside the action) + surface a SubmitFailedBanner here.
 *
 * Refresh after action (Phase 9c hotfix 2026-05-16): Server Actions
 * called outside a <form action> context — e.g. button onClick or
 * useEffect (the OtpInput auto-submit) — invalidate the server cache via
 * revalidatePath BUT do NOT auto-update the client view. Calling
 * `router.refresh()` after each action force-fetches the new RSC payload
 * so the page rerenders with the next card. Without this, the wizard
 * "doesn't advance" even though the row was correctly updated.
 */
import * as Sentry from "@sentry/nextjs";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AppointmentTypeCard } from "@/components/scheduler/heritage/AppointmentTypeCard";
import { CalendarDatePicker } from "@/components/scheduler/CalendarDatePicker";
import { ClarificationQuestionCard } from "@/components/scheduler/heritage/ClarificationQuestionCard";
import { CompletedCard } from "@/components/scheduler/heritage/CompletedCard";
import { ConcernClarifyCard } from "@/components/scheduler/heritage/ConcernClarifyCard";
import { ConcernExplanationCard } from "@/components/scheduler/heritage/ConcernExplanationCard";
import { CustomerInfoEditCard } from "@/components/scheduler/heritage/CustomerInfoEditCard";
import { CustomerNotesCard } from "@/components/scheduler/heritage/CustomerNotesCard";
import { CustomerQuestionCard } from "@/components/scheduler/heritage/CustomerQuestionCard";
import { DiagnosticLoadingCard } from "@/components/scheduler/heritage/DiagnosticLoadingCard";
import { EscalationCard } from "@/components/scheduler/EscalationCard";
import { GreetingCard } from "@/components/scheduler/heritage/GreetingCard";
import { MultiAccountDisambiguationCard } from "@/components/scheduler/heritage/MultiAccountDisambiguationCard";
import { NewCustomerInfoCard } from "@/components/scheduler/heritage/NewCustomerInfoCard";
import { NewVehicleCard } from "@/components/scheduler/heritage/NewVehicleCard";
import { NoMatchChoosePathCard } from "@/components/scheduler/heritage/NoMatchChoosePathCard";
import { OtpInput } from "@/components/scheduler/OtpInput";
import { PartialVerificationGateCard } from "@/components/scheduler/heritage/PartialVerificationGateCard";
import { PhoneNameCard } from "@/components/scheduler/heritage/PhoneNameCard";
import { SecondRoutinePassCard } from "@/components/scheduler/heritage/SecondRoutinePassCard";
import { ServiceAndConcernPicker } from "@/components/scheduler/ServiceAndConcernPicker";
import { SummaryCard } from "@/components/scheduler/heritage/SummaryCard";
import { SummaryEditHubCard } from "@/components/scheduler/heritage/SummaryEditHubCard";
import { TestingServiceApprovalCard } from "@/components/scheduler/heritage/TestingServiceApprovalCard";
import { VehiclePicker } from "@/components/scheduler/VehiclePicker";
import { WaiterTimePicker } from "@/components/scheduler/WaiterTimePicker";
import { WizardBackBar } from "./WizardBackBar";
import { WizardProgress } from "./WizardProgress";
import { resendOtpV2 } from "@/lib/scheduler/wizard/actions/resend-otp";
import { runDiagnosticsV2 } from "@/lib/scheduler/wizard/actions/run-diagnostics";
import { submitAppointmentTypeV2 } from "@/lib/scheduler/wizard/actions/submit-appointment-type";
import { submitClarificationAnswerV2 } from "@/lib/scheduler/wizard/actions/submit-clarification-answer";
import { submitCustomerInfoEditV2 } from "@/lib/scheduler/wizard/actions/submit-customer-info-edit";
import { submitConcernClarifyV2 } from "@/lib/scheduler/wizard/actions/submit-concern-clarify";
import { submitCustomerNotesV2 } from "@/lib/scheduler/wizard/actions/submit-customer-notes";
import { submitCustomerQuestionV2 } from "@/lib/scheduler/wizard/actions/submit-customer-question";
import { submitDateV2 } from "@/lib/scheduler/wizard/actions/submit-date";
import { submitEditHubV2 } from "@/lib/scheduler/wizard/actions/submit-edit-hub";
import { dismissEscalationV2 } from "@/lib/scheduler/wizard/actions/dismiss-escalation";
import { submitExplanationV2 } from "@/lib/scheduler/wizard/actions/submit-explanation";
import { submitGreetingV2 } from "@/lib/scheduler/wizard/actions/submit-greeting";
import { submitMultiAccountChoiceV2 } from "@/lib/scheduler/wizard/actions/submit-multi-account-choice";
import { submitNewCustomerInfoV2 } from "@/lib/scheduler/wizard/actions/submit-new-customer-info";
import { submitNewVehicleV2 } from "@/lib/scheduler/wizard/actions/submit-new-vehicle";
import { submitNoMatchChoiceV2 } from "@/lib/scheduler/wizard/actions/submit-no-match-choice";
import { submitOtpV2 } from "@/lib/scheduler/wizard/actions/submit-otp";
import { submitPartialVerificationChoiceV2 } from "@/lib/scheduler/wizard/actions/submit-partial-verification-choice";
import { submitPhoneNameV2 } from "@/lib/scheduler/wizard/actions/submit-phone-name";
import { submitSecondRoutinePassV2 } from "@/lib/scheduler/wizard/actions/submit-second-routine-pass";
import { submitServiceAndConcernPickerV2 } from "@/lib/scheduler/wizard/actions/submit-service-and-concern-picker";
import { submitStartOverV2 } from "@/lib/scheduler/wizard/actions/submit-start-over";
import { submitSummaryV2 } from "@/lib/scheduler/wizard/actions/submit-summary";
import { submitTestingServiceApprovalV2 } from "@/lib/scheduler/wizard/actions/submit-testing-service-approval";
import { submitVehiclePickV2 } from "@/lib/scheduler/wizard/actions/submit-vehicle-pick";
import { submitWaiterTimeV2 } from "@/lib/scheduler/wizard/actions/submit-waiter-time";
import type { WizardCard } from "@/lib/scheduler/wizard/card-payloads";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";

export interface WizardSurfaceProps {
  chatId: string;
  card: WizardCard;
}

export function WizardSurface({ chatId, card }: WizardSurfaceProps) {
  // R6-D-1 + IMPORTANT-D-1 2026-05-16: focus management + aria-live for
  // wizard step transitions. Every step advance previously dropped focus
  // to document.body (WCAG 2.4.3 Focus Order) and went unannounced to
  // screen readers (4.1.3 Status Messages). The wrapper region:
  //   - tabIndex={-1} so it can receive programmatic focus but isn't in
  //     the natural tab order (keyboard users still tab into the card's
  //     own first interactive element after).
  //   - aria-live="polite" so SR users hear the new card's labelledby on
  //     mount without interrupting current speech.
  //   - useEffect on card.step sends focus on every transition.
  // The actual switch lives in WizardCardSwitcher below so the focus
  // ref is scoped to this outer component and doesn't capture state
  // that the inner switch would otherwise be repeating.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    containerRef.current?.focus();
  }, [card.step]);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      aria-live="polite"
      className="outline-none focus:outline-none"
    >
      {/* Presentational 4-phase ribbon — reads card.step only, no state, no
          actions. Honest for every branch (no numeric "of N"). */}
      <WizardProgress step={card.step} />
      {/* key={card.step} forces remount on every step change so the bar's
          local `pending` state can't stick at true across a back navigation.
          Without the key, backing from date_pick → appointment_type (both
          in STEPS_WITH_BACK) leaves the same component instance mounted
          with `pending=true` after the await — the spinner never clears. */}
      <WizardBackBar key={card.step} chatId={chatId} currentStep={card.step} />
      <WizardCardSwitcher chatId={chatId} card={card} />
    </div>
  );
}

function WizardCardSwitcher({ chatId, card }: WizardSurfaceProps) {
  const router = useRouter();

  // Approved functional addition 2026-06-11 (decision log #2): a failed
  // Server Action used to surface NOTHING to the customer (the spinner just
  // stopped; logIfFailed → Sentry only). This is an ADDITIVE READ of the
  // already-returned `result.ok === false` outcome into local client state.
  // It does NOT modify any action body, the switch, router.refresh()
  // semantics, or the result union — it only renders the existing failure.
  const [submitFailed, setSubmitFailed] = useState(false);

  // Clear the banner when a step transition lands (card.step changes after a
  // successful action's router.refresh(), OR after a WizardBackBar back-nav
  // that bypasses handleResult) — a fresh card means the prior failure is
  // resolved. Done with the React "reset state when a prop changes during
  // render" idiom (no effect) per react.dev — avoids a cascading-render
  // setState-in-effect.
  const [seenStep, setSeenStep] = useState(card.step);
  if (seenStep !== card.step) {
    setSeenStep(card.step);
    setSubmitFailed(false);
  }

  // Helper: log + refresh. Called after every Server Action so the page
  // re-fetches its RSC payload and advances to the next card. Server Actions
  // called from useEffect / onClick (not from <form action>) need this
  // explicit refresh — `revalidatePath` alone invalidates the server cache
  // but doesn't poke the client view.
  const handleResult = (
    actionName: string,
    _chatId: string,
    result: WizardTransitionResult,
  ): void => {
    logIfFailed(actionName, chatId, result);
    // Additive: surface a failed outcome to the customer. On success the
    // banner is cleared by the card.step effect above once the step advances;
    // we also clear here so an in-place success (no step change) clears it.
    setSubmitFailed(result.ok === false);
    router.refresh();
  };

  return (
    <>
      {/* Suppress the top banner on diagnostic_loading — DiagnosticLoadingCard
          renders its own role="alert" on a diagnostics failure, so the banner
          would be a second, duplicate error surface (2026-06-13 audit). */}
      {submitFailed && card.step !== "diagnostic_loading" ? (
        <SubmitFailedBanner onRetry={() => setSubmitFailed(false)} />
      ) : null}
      {renderCard()}
    </>
  );

  function renderCard() {
    switch (card.step) {
    case "greeting":
      return (
        <GreetingCard
          copy={card.payload.copy}
          onSubmit={async ({ is_returning }) => {
            const result = await submitGreetingV2({
              chatId,
              is_returning,
            });
            handleResult("submitGreetingV2", chatId, result);
          }}
        />
      );

    case "phone_name":
      return (
        <PhoneNameCard
          copy={card.payload.copy}
          step_label={card.payload.step_label}
          initial_first_name={card.payload.initial_first_name}
          initial_last_name={card.payload.initial_last_name}
          initial_phone_e164={card.payload.initial_phone_e164}
          onSubmit={async ({ first_name, last_name, phone, sms_opt_out }) => {
            const result = await submitPhoneNameV2({
              chatId,
              first_name,
              last_name,
              phone_e164: phone,
              sms_opt_out,
            });
            handleResult("submitPhoneNameV2", chatId, result);
          }}
        />
      );

    case "otp_pending":
      return (
        <OtpInput
          phone_last_four={card.payload.phone_last_four}
          ttl_seconds={card.payload.ttl_seconds}
          attempts_remaining={card.payload.attempts_remaining}
          onSubmit={async (output) => {
            if ("action" in output && output.action === "resend") {
              const result = await resendOtpV2({ chatId });
              handleResult("resendOtpV2", chatId, result);
              return;
            }
            if ("code" in output) {
              const result = await submitOtpV2({ chatId, code: output.code });
              handleResult("submitOtpV2", chatId, result);
            }
          }}
        />
      );

    case "partial_verification_gate":
      return (
        <PartialVerificationGateCard
          copy={card.payload.copy}
          matched_axis={card.payload.matched_axis}
          attempted_first_name={card.payload.attempted_first_name}
          attempted_phone_last_four={card.payload.attempted_phone_last_four}
          onSubmit={async ({ action }) => {
            const result = await submitPartialVerificationChoiceV2({
              chatId,
              action,
            });
            handleResult("submitPartialVerificationChoiceV2", chatId, result);
          }}
        />
      );

    case "no_match_choose_path":
      return (
        <NoMatchChoosePathCard
          copy={card.payload.copy}
          attempted_first_name={card.payload.attempted_first_name}
          attempted_phone_last_four={card.payload.attempted_phone_last_four}
          onSubmit={async ({ action }) => {
            const result = await submitNoMatchChoiceV2({ chatId, action });
            handleResult("submitNoMatchChoiceV2", chatId, result);
          }}
        />
      );

    case "multi_account_disambiguation":
      return (
        <MultiAccountDisambiguationCard
          copy={card.payload.copy}
          candidates={card.payload.candidates}
          attempted_phone_last_four={card.payload.attempted_phone_last_four}
          onSubmit={async (output) => {
            const result = await submitMultiAccountChoiceV2(
              output.action === "select"
                ? {
                    action: "select",
                    chatId,
                    selected_customer_id: output.selected_customer_id,
                  }
                : { action: "none_of_these", chatId },
            );
            handleResult("submitMultiAccountChoiceV2", chatId, result);
          }}
        />
      );

    case "customer_info_edit":
      return (
        <CustomerInfoEditCard
          copy={card.payload.copy}
          first_name={card.payload.first_name}
          last_name={card.payload.last_name}
          initial_phones={card.payload.initial_phones}
          initial_emails={card.payload.initial_emails}
          initial_address={card.payload.initial_address ?? undefined}
          onSubmit={async (output) => {
            const result = await submitCustomerInfoEditV2({
              chatId,
              edited_phones: output.edited_phones,
              edited_emails: output.edited_emails,
              edited_address: output.edited_address,
              primary_email_for_description:
                output.primary_email_for_description,
            });
            handleResult("submitCustomerInfoEditV2", chatId, result);
          }}
        />
      );

    case "new_customer_info":
      return (
        <NewCustomerInfoCard
          copy={card.payload.copy}
          first_name={card.payload.first_name}
          last_name={card.payload.last_name}
          verified_phone_e164={card.payload.verified_phone_e164}
          onSubmit={async (output) => {
            const result = await submitNewCustomerInfoV2({
              chatId,
              edited_phones: output.edited_phones,
              edited_emails: output.edited_emails,
              edited_address: output.edited_address,
              primary_email_for_description:
                output.primary_email_for_description,
            });
            handleResult("submitNewCustomerInfoV2", chatId, result);
          }}
        />
      );

    case "vehicle_pick":
      return (
        <VehiclePicker
          vehicles={card.payload.vehicles}
          allow_add_new={card.payload.allow_add_new}
          onSubmit={async ({ vehicle_id }) => {
            const result = await submitVehiclePickV2({
              chatId,
              vehicle_id,
            });
            handleResult("submitVehiclePickV2", chatId, result);
          }}
        />
      );

    case "new_vehicle_form":
      return (
        <NewVehicleCard
          copy={card.payload.copy}
          onSubmit={async (output) => {
            const result = await submitNewVehicleV2({
              chatId,
              year: output.year,
              make: output.make,
              model: output.model,
              license_plate: output.license_plate,
              notes: output.notes,
            });
            handleResult("submitNewVehicleV2", chatId, result);
          }}
        />
      );

    case "service_concern_picker":
      return (
        <ServiceAndConcernPicker
          routine_services={card.payload.routine_services}
          initialSelected={card.payload.initial_selected}
          onSubmit={async ({ picks }) => {
            const result = await submitServiceAndConcernPickerV2({
              chatId,
              picks,
            });
            handleResult("submitServiceAndConcernPickerV2", chatId, result);
          }}
        />
      );

    case "concern_explanation":
      return (
        // Bug fix 2026-05-16: key={service_key} forces React to unmount
        // + remount the card between queue items. Without it, the
        // textarea's local useState retains the prior service's
        // explanation text — user reported "typed 'brakes are grinding'
        // for brake inspection, advanced to suspension check, and the
        // text was still in the textarea." Same pattern flagged for
        // ClarificationQuestionCard below.
        <ConcernExplanationCard
          key={card.payload.service_key}
          copy={card.payload.copy}
          service_key={card.payload.service_key}
          display_name={card.payload.display_name}
          lead_in_bubble={card.payload.lead_in_bubble}
          onSubmit={async ({ service_key, explanation_text }) => {
            const result = await submitExplanationV2({
              chatId,
              service_key,
              explanation_text,
            });
            handleResult("submitExplanationV2", chatId, result);
          }}
        />
      );

    case "diagnostic_loading":
      return (
        <DiagnosticLoadingCard
          copy={card.payload.copy}
          onMount={async () => {
            const result = await runDiagnosticsV2({ chatId });
            handleResult("runDiagnosticsV2", chatId, result);
            return result.ok
              ? { ok: true }
              : { ok: false, error: result.error };
          }}
        />
      );

    case "clarification_question":
      return (
        // Bug fix 2026-05-16: key={question_id} forces React to
        // unmount + remount per queue item. Same rationale as
        // ConcernExplanationCard above — the chip 'selected' state
        // could persist across queue items without this.
        <ClarificationQuestionCard
          key={card.payload.question_id}
          copy={card.payload.copy}
          question_id={card.payload.question_id}
          question_text={card.payload.question_text}
          options={card.payload.options}
          multi_select={card.payload.multi_select}
          service_key={card.payload.service_key ?? undefined}
          category={card.payload.category ?? undefined}
          onSubmit={async ({ question_id, answer }) => {
            const result = await submitClarificationAnswerV2({
              chatId,
              question_id,
              action:
                answer === "skipped"
                  ? { kind: "skip" }
                  : { kind: "answer", value: answer },
            });
            handleResult("submitClarificationAnswerV2", chatId, result);
          }}
        />
      );

    case "concern_clarify":
      return (
        // key on the concern text forces React to unmount + remount the card
        // between queued concerns (each clarify entry is a distinct concern).
        // Same rationale as clarification_question's key={question_id} above:
        // the local `pending` state must not persist across queue items.
        <ConcernClarifyCard
          key={card.payload.concern_text}
          copy={card.payload.copy}
          concern_text={card.payload.concern_text}
          candidates={card.payload.candidates.map((c) => ({
            candidate_key: c.key,
            display_name: c.display_name,
            starting_price_cents: c.starting_price_cents,
            description: c.description,
          }))}
          onSubmit={async (output) => {
            const result = await submitConcernClarifyV2({
              chatId,
              chosen_key:
                output.action === "select" ? output.candidate_key : null,
            });
            handleResult("submitConcernClarifyV2", chatId, result);
          }}
        />
      );

    case "testing_service_approval":
      return (
        <TestingServiceApprovalCard
          copy={card.payload.copy}
          services={card.payload.services}
          category={card.payload.category ?? undefined}
          onSubmit={async ({ approved, declined }) => {
            const result = await submitTestingServiceApprovalV2({
              chatId,
              approved,
              declined,
            });
            handleResult("submitTestingServiceApprovalV2", chatId, result);
          }}
        />
      );

    case "second_routine_pass":
      return (
        <SecondRoutinePassCard
          copy={card.payload.copy}
          common_services={card.payload.common_services}
          already_picked={card.payload.already_picked}
          onSubmit={async (output) => {
            const result = await submitSecondRoutinePassV2(
              output.describe_issue
                ? { chatId, added: output.added, describe_issue: true }
                : { chatId, added: output.added },
            );
            handleResult("submitSecondRoutinePassV2", chatId, result);
          }}
        />
      );

    case "appointment_type":
      return (
        <AppointmentTypeCard
          copy={card.payload.copy}
          options={card.payload.options.map((o) => ({
            type: o.type,
            title: o.title,
            description: o.description,
            emoji: o.emoji,
            available: o.available,
            unavailable_reason: o.unavailable_reason ?? undefined,
            earliest_hint: o.earliest_hint ?? undefined,
          }))}
          onSubmit={async ({ appointment_type }) => {
            const result = await submitAppointmentTypeV2({
              chatId,
              appointment_type,
            });
            handleResult("submitAppointmentTypeV2", chatId, result);
          }}
        />
      );

    case "date_pick":
      return (
        <CalendarDatePicker
          available_dates={card.payload.available_dates}
          type={card.payload.type}
          initial_focus_date={card.payload.initial_focus_date ?? undefined}
          range_end={card.payload.range_end ?? undefined}
          onSubmit={async ({ selected_date }) => {
            const result = await submitDateV2({ chatId, selected_date });
            handleResult("submitDateV2", chatId, result);
          }}
        />
      );

    case "waiter_time_pick":
      return (
        <WaiterTimePicker
          date={card.payload.date}
          available_times={card.payload.available_times}
          onSubmit={async ({ selected_time }) => {
            if (selected_time !== "08:00" && selected_time !== "09:00") {
              // Defensive: the picker only renders 08:00 / 09:00 buttons,
              // but the action's Zod schema is strict — narrow here to
              // satisfy the type.
              return;
            }
            const result = await submitWaiterTimeV2({
              chatId,
              selected_time,
            });
            handleResult("submitWaiterTimeV2", chatId, result);
          }}
        />
      );

    case "summary":
      return (
        <SummaryCard
          copy={card.payload.copy}
          hold_id={card.payload.hold_id ?? undefined}
          hold_expires_at={card.payload.hold_expires_at ?? undefined}
          starts_at={card.payload.starts_at}
          customer={card.payload.customer}
          vehicle={card.payload.vehicle}
          type={card.payload.type}
          services={card.payload.services}
          reminders={card.payload.reminders}
          is_same_day={card.payload.is_same_day}
          onSubmit={async ({ confirmed, edit_target }) => {
            const result = await submitSummaryV2({
              chatId,
              confirmed,
              edit_target,
            });
            handleResult("submitSummaryV2", chatId, result);
          }}
        />
      );

    case "summary_edit_hub":
      return (
        <SummaryEditHubCard
          payload={card.payload}
          copy={card.payload.copy}
          onSelect={async (section) => {
            const result = await submitEditHubV2({ chatId, section });
            handleResult("submitEditHubV2", chatId, result);
          }}
        />
      );

    case "customer_notes":
      return (
        <CustomerNotesCard
          copy={card.payload.copy}
          initial_text={card.payload.initial_text}
          parsed_preview={card.payload.parsed_preview}
          edit_attempts={card.payload.edit_attempts}
          onSubmit={async ({ text, approved }) => {
            // Input mode — Skip (text=null) or Send (text=typed).
            void approved; // approved=true on Send; we infer the kind from text instead.
            const result =
              text === null || text.trim().length === 0
                ? await submitCustomerNotesV2({ chatId, kind: "skip" })
                : await submitCustomerNotesV2({
                    chatId,
                    kind: "submit_raw",
                    text,
                  });
            handleResult("submitCustomerNotesV2", chatId, result);
          }}
          onApprove={async ({ parsed_text }) => {
            const result = await submitCustomerNotesV2({
              chatId,
              kind: "approve_parsed",
              parsed_text,
            });
            handleResult("submitCustomerNotesV2(approve)", chatId, result);
          }}
          onReject={async () => {
            const result = await submitCustomerNotesV2({
              chatId,
              kind: "reject_parsed",
            });
            handleResult("submitCustomerNotesV2(reject)", chatId, result);
          }}
        />
      );

    case "customer_question":
      return (
        <CustomerQuestionCard
          copy={card.payload.copy}
          onSubmit={async ({ question }) => {
            const result = await submitCustomerQuestionV2({
              chatId,
              question,
            });
            handleResult("submitCustomerQuestionV2", chatId, result);
          }}
        />
      );

    case "escalated":
      return (
        <EscalationCard
          reason={card.payload.reason}
          shop_phone={card.payload.shop_phone}
          allow_back_to_scheduling={true}
          onSubmit={async (output) => {
            if ("action" in output && output.action === "back_to_scheduling") {
              const result = await dismissEscalationV2({ chatId });
              handleResult("dismissEscalationV2", chatId, result);
              return;
            }
            // 'I'll call — close this chat' acknowledges the escalation;
            // the customer's path forward is the phone CTA in the card
            // itself. We don't transition state — the row stays
            // status='escalated' until the customer either calls (no
            // row write) or the service team manually resolves.
          }}
        />
      );

    case "completed":
      return (
        <CompletedCard
          copy={card.payload.copy}
          first_name={card.payload.first_name}
          appointment_label={card.payload.appointment_label}
          allow_schedule_another={card.payload.allow_schedule_another}
          sms_consent={card.payload.sms_consent}
          onScheduleAnother={async () => {
            // 2026-05-17 fix: call submitStartOverV2 directly so the row
            // is wiped (status='ended' otherwise sticks per the terminal-
            // state rule in hydrate-session) + revalidate. Replaces the
            // earlier ?reset=1 query-string approach which had no
            // server-side handler.
            const result = await submitStartOverV2({ chatId });
            handleResult("submitStartOverV2 (schedule_another)", chatId, result);
          }}
          onClose={async () => {
            // No-op — the CompletedCard handles its own ghost state.
          }}
        />
      );

      // Defensive fallback: every real WizardStep has an explicit case
      // above. A step with no case (shouldn't happen) renders a neutral,
      // customer-safe recovery surface rather than crashing.
      default:
        return <UnhandledStepFallback />;
    }
  }
}

/**
 * SubmitFailedBanner — presentational inline error surface for a failed
 * step submit (approved functional read 2026-06-11). role="alert" so screen
 * readers announce it on appearance. status-error palette (9.28:1). The
 * customer's card is already re-enabled (the card's own `pending` cleared in
 * its finally block when the action returned), so "try again" is just
 * re-tapping the card's CTA; the retry link dismisses this banner.
 */
function SubmitFailedBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className={
        "mb-4 rounded-[var(--radius-input)] border " +
        "border-status-error-fg bg-status-error-bg px-4 py-3 " +
        "text-[14px] leading-snug text-status-error-fg"
      }
    >
      <p>
        Something didn&apos;t go through —{" "}
        <button
          type="button"
          onClick={onRetry}
          className="font-medium text-brand-burgundy-700 underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-burgundy-500"
        >
          tap to try again
        </button>
        , or call{" "}
        <a
          href="tel:6102536565"
          className="font-medium text-brand-burgundy-700 underline underline-offset-2 hover:no-underline"
        >
          (610) 253-6565
        </a>
        .
      </p>
    </div>
  );
}

/**
 * Centralized failure surface for Phase 3-13. Phase 14 replaces this with
 * an inline toast/FormMessage + retry affordance per chat-design.md §D
 * "Error states" (toast not used; FormMessage / inline error banner).
 */
function logIfFailed(
  actionName: string,
  chatId: string,
  result: WizardTransitionResult,
): void {
  if (result.ok) return;
  Sentry.captureMessage(`${actionName} returned !ok`, {
    level: "warning",
    extra: { chatId, error: result.error },
  });
   
  console.error(`[wizard] ${actionName} failed:`, result.error);
}

function UnhandledStepFallback() {
  return (
    <div className="rounded-[var(--radius-card)] border border-rule bg-paper-100 p-6">
      <p className="font-display text-[17px] leading-snug text-ink">
        Something went off-track.
      </p>
      <p className="mt-3 text-[14px] leading-relaxed text-ink-secondary">
        Sorry about that — please refresh to pick up where you left off, or
        call{" "}
        <a
          href="tel:6102536565"
          className="font-medium text-brand-burgundy-700 hover:underline"
        >
          (610) 253-6565
        </a>{" "}
        and we&apos;ll get you booked.
      </p>
    </div>
  );
}
