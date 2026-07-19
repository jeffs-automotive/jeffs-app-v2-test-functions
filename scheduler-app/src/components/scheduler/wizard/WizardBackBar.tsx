"use client";

/**
 * WizardBackBar — Back affordance rendered above the wizard card
 * (2026-05-17).
 *
 * Customers reported feeling stuck on certain cards (waiter time picker
 * with zero slots, date picker landing on a wrong month, etc.). The Back
 * button gives them an explicit way out without resorting to the
 * footer's "Start over" (which wipes everything).
 *
 * Render rule: only show the bar on steps with a defined back path. This
 * mirrors the map in submit-back.ts — keep these two in sync.
 *
 * The actual back-target logic lives server-side in submitBackV2 (it
 * reads the row to pick the right predecessor for branched flows). This
 * component is a thin trigger + visual.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui";
import { submitBackV2 } from "@/lib/scheduler/wizard/actions/submit-back";

/**
 * Steps that get a Back button. Mirror of the keys in
 * submit-back.ts → backTargetFor that return non-null targets.
 */
const STEPS_WITH_BACK = new Set<string>([
  "phone_name",
  "partial_verification_gate",
  "no_match_choose_path",
  "multi_account_disambiguation",
  "customer_info_edit",
  "new_customer_info",
  "vehicle_pick",
  "new_vehicle_form",
  "service_concern_picker",
  "concern_explanation",
  "clarification_question",
  "concern_clarify",
  "concern_triage",
  "testing_service_approval",
  "second_routine_pass",
  "appointment_type",
  "date_pick",
  "waiter_time_pick",
  "summary",
  "summary_edit_hub",
]);

export interface WizardBackBarProps {
  chatId: string;
  /** Current wizard step. Used to decide whether to render. */
  currentStep: string;
}

export function WizardBackBar({ chatId, currentStep }: WizardBackBarProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  if (!STEPS_WITH_BACK.has(currentStep)) return null;

  async function handleBack() {
    if (pending) return;
    setPending(true);
    try {
      await submitBackV2({ chatId });
      router.refresh();
      // Intentional: stay pending until unmount. The next step's render
      // unmounts this bar; a transient enabled state between the action
      // returning and the new RSC arriving would feel rough.
    } catch {
      setPending(false);
    }
  }

  return (
    <div className="mb-3 flex">
      <Button
        variant="ghost"
        size="sm"
        loading={pending}
        disabled={pending}
        onClick={handleBack}
        leadingIcon="←"
        fullWidthOnMobile={false}
        aria-label="Go back to the previous step"
      >
        Back
      </Button>
    </div>
  );
}
