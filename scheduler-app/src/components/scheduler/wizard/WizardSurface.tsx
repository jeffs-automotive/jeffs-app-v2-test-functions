"use client";

/**
 * WizardSurface — client-side step dispatcher for the new server-state-
 * driven wizard at /book-v2.
 *
 * Per chat-design.md "Architecture amendment — 2026-05-14": the page's
 * Server Component reads customer_chat_sessions via getCurrentCard and
 * passes the WizardCard down. This component switches on card.step and
 * renders the matching card.
 *
 * Phase 3 (this file's first version): wires only step='greeting'. All
 * other steps fall through to <NotYetMigrated/>, which directs the
 * customer back to the live /book route during the migration window.
 *
 * Phases 4-13 each add their step's case as the corresponding migration
 * lands. Phase 14 wires the always-visible footer (Start Over + Talk to
 * a Person) at the page level, not here.
 *
 * Error surface: card submits await the Server Action; failures log to
 * Sentry (inside the action) + console here. Toast / FormMessage / retry
 * affordances are added per-step starting in phase 4; phase 14 unifies
 * the cross-cutting error states.
 */
import * as Sentry from "@sentry/nextjs";

import { CustomerInfoEditCard } from "@/components/scheduler/heritage/CustomerInfoEditCard";
import { GreetingCard } from "@/components/scheduler/heritage/GreetingCard";
import { MultiAccountDisambiguationCard } from "@/components/scheduler/heritage/MultiAccountDisambiguationCard";
import { NewCustomerInfoCard } from "@/components/scheduler/heritage/NewCustomerInfoCard";
import { NewVehicleCard } from "@/components/scheduler/heritage/NewVehicleCard";
import { NoMatchChoosePathCard } from "@/components/scheduler/heritage/NoMatchChoosePathCard";
import { OtpInput } from "@/components/scheduler/OtpInput";
import { PartialVerificationGateCard } from "@/components/scheduler/heritage/PartialVerificationGateCard";
import { PhoneNameCard } from "@/components/scheduler/heritage/PhoneNameCard";
import { ServiceAndConcernPicker } from "@/components/scheduler/ServiceAndConcernPicker";
import { VehiclePicker } from "@/components/scheduler/VehiclePicker";
import { resendOtpV2 } from "@/lib/scheduler/wizard/actions/resend-otp";
import { submitCustomerInfoEditV2 } from "@/lib/scheduler/wizard/actions/submit-customer-info-edit";
import { submitGreetingV2 } from "@/lib/scheduler/wizard/actions/submit-greeting";
import { submitMultiAccountChoiceV2 } from "@/lib/scheduler/wizard/actions/submit-multi-account-choice";
import { submitNewCustomerInfoV2 } from "@/lib/scheduler/wizard/actions/submit-new-customer-info";
import { submitNewVehicleV2 } from "@/lib/scheduler/wizard/actions/submit-new-vehicle";
import { submitNoMatchChoiceV2 } from "@/lib/scheduler/wizard/actions/submit-no-match-choice";
import { submitOtpV2 } from "@/lib/scheduler/wizard/actions/submit-otp";
import { submitPartialVerificationChoiceV2 } from "@/lib/scheduler/wizard/actions/submit-partial-verification-choice";
import { submitPhoneNameV2 } from "@/lib/scheduler/wizard/actions/submit-phone-name";
import { submitServiceAndConcernPickerV2 } from "@/lib/scheduler/wizard/actions/submit-service-and-concern-picker";
import { submitVehiclePickV2 } from "@/lib/scheduler/wizard/actions/submit-vehicle-pick";
import type { WizardCard } from "@/lib/scheduler/wizard/card-payloads";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";

export interface WizardSurfaceProps {
  chatId: string;
  card: WizardCard;
}

export function WizardSurface({ chatId, card }: WizardSurfaceProps) {
  switch (card.step) {
    case "greeting":
      return (
        <GreetingCard
          onSubmit={async ({ is_returning }) => {
            const result = await submitGreetingV2({
              chatId,
              is_returning,
            });
            logIfFailed("submitGreetingV2", chatId, result);
          }}
        />
      );

    case "phone_name":
      return (
        <PhoneNameCard
          step_label={card.payload.step_label}
          initial_first_name={card.payload.initial_first_name}
          initial_last_name={card.payload.initial_last_name}
          initial_phone_e164={card.payload.initial_phone_e164}
          onSubmit={async ({ first_name, last_name, phone }) => {
            const result = await submitPhoneNameV2({
              chatId,
              first_name,
              last_name,
              phone_e164: phone,
            });
            logIfFailed("submitPhoneNameV2", chatId, result);
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
              logIfFailed("resendOtpV2", chatId, result);
              return;
            }
            if ("code" in output) {
              const result = await submitOtpV2({ chatId, code: output.code });
              logIfFailed("submitOtpV2", chatId, result);
            }
          }}
        />
      );

    case "partial_verification_gate":
      return (
        <PartialVerificationGateCard
          matched_axis={card.payload.matched_axis}
          attempted_first_name={card.payload.attempted_first_name}
          attempted_phone_last_four={card.payload.attempted_phone_last_four}
          matched_first_name={card.payload.matched_first_name}
          onSubmit={async ({ action }) => {
            const result = await submitPartialVerificationChoiceV2({
              chatId,
              action,
            });
            logIfFailed("submitPartialVerificationChoiceV2", chatId, result);
          }}
        />
      );

    case "no_match_choose_path":
      return (
        <NoMatchChoosePathCard
          attempted_first_name={card.payload.attempted_first_name}
          attempted_phone_last_four={card.payload.attempted_phone_last_four}
          onSubmit={async ({ action }) => {
            const result = await submitNoMatchChoiceV2({ chatId, action });
            logIfFailed("submitNoMatchChoiceV2", chatId, result);
          }}
        />
      );

    case "multi_account_disambiguation":
      return (
        <MultiAccountDisambiguationCard
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
            logIfFailed("submitMultiAccountChoiceV2", chatId, result);
          }}
        />
      );

    case "customer_info_edit":
      return (
        <CustomerInfoEditCard
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
            logIfFailed("submitCustomerInfoEditV2", chatId, result);
          }}
        />
      );

    case "new_customer_info":
      return (
        <NewCustomerInfoCard
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
            logIfFailed("submitNewCustomerInfoV2", chatId, result);
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
            logIfFailed("submitVehiclePickV2", chatId, result);
          }}
        />
      );

    case "new_vehicle_form":
      return (
        <NewVehicleCard
          onSubmit={async (output) => {
            const result = await submitNewVehicleV2({
              chatId,
              year: output.year,
              make: output.make,
              model: output.model,
              license_plate: output.license_plate,
              notes: output.notes,
            });
            logIfFailed("submitNewVehicleV2", chatId, result);
          }}
        />
      );

    case "service_concern_picker":
      return (
        <ServiceAndConcernPicker
          common_services={card.payload.common_services}
          onSubmit={async ({ services, concern_text }) => {
            const result = await submitServiceAndConcernPickerV2({
              chatId,
              services,
              concern_text,
            });
            logIfFailed("submitServiceAndConcernPickerV2", chatId, result);
          }}
        />
      );

    // Every other step renders the migration placeholder. Each later phase
    // adds its case BEFORE this default and removes the corresponding
    // entry from the placeholder's hint list.
    default:
      return <NotYetMigrated step={card.step} />;
  }
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
  // eslint-disable-next-line no-console
  console.error(`[wizard] ${actionName} failed:`, result.error);
}

function NotYetMigrated({ step }: { step: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-rule bg-paper-100 p-6">
      <p className="font-display text-[17px] leading-snug text-ink">
        Step <code className="rounded bg-paper-200 px-1.5 py-0.5">{step}</code>{" "}
        not yet migrated to the new wizard surface.
      </p>
      <p className="mt-3 text-[14px] leading-relaxed text-ink-secondary">
        This route (<code>/book-v2</code>) is the in-flight migration target.
        Visit{" "}
        <a
          href="/book"
          className="font-medium text-brand-burgundy-700 hover:underline"
        >
          /book
        </a>{" "}
        for the full live flow while phases 4-13 land.
      </p>
    </div>
  );
}
