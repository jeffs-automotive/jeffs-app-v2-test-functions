/**
 * Wizard card payload types — Phase 2 of the server-state-driven refactor.
 *
 * Per chat-design.md "Architecture amendment — 2026-05-14": the page reads
 * `customer_chat_sessions.current_step` and dispatches via a discriminated
 * union to the matching card component. Each variant's `payload` shape is
 * what the card needs to render.
 *
 * IMPORTANT: the per-step payload BUILDERS live in `get-current-card.ts`.
 * This file is types-only. Adding a new step is two edits:
 *   1. Add the variant here.
 *   2. Add the case in `get-current-card.ts`.
 *
 * Zod runtime schemas for these payloads are deliberately NOT defined yet —
 * the payloads are server-built from the typed row (`database.types.ts`),
 * so runtime validation at the page boundary is redundant. The first place
 * Zod becomes useful is at Server Action input boundaries (added per step
 * in phases 3-13).
 */
import type { WizardStep } from "../session-state";

// ─── Per-step payload types ─────────────────────────────────────────────────

/** Step 1 — Greeting. Hardcoded card chrome; no row data needed. */
export interface GreetingPayload {
  // intentionally empty
}

/** Step 2 — Phone + name capture. Step-label tone varies by greeting bucket. */
export interface PhoneNamePayload {
  step_label: string;
  /** Prefill fields when resuming a session or bouncing back from a branch. */
  initial_first_name?: string;
  initial_last_name?: string;
  initial_phone_e164?: string;
}

/** Step 3 — OTP entry. */
export interface OtpPendingPayload {
  phone_last_four: string;
  ttl_seconds: number;
  attempts_remaining: number;
}

/** Step 3.5a — Partial verification gate (name match without phone match). */
export interface PartialVerificationGatePayload {
  matched_axis: "name" | "phone";
  attempted_first_name: string | null;
  attempted_phone_last_four: string | null;
  /** Only meaningful when matched_axis='phone'; null otherwise per PII rules. */
  matched_first_name: string | null;
}

/** Step 3.5b — Multi-account disambiguation. Vehicle-only per PII protection. */
export interface MultiAccountDisambiguationPayload {
  candidates: Array<{
    customer_id: number;
    recent_vehicle: string;
  }>;
  attempted_phone_last_four: string | null;
}

/** Step 3.5c — No-match choose-path (returning customer with 0 phone + 0 name). */
export interface NoMatchChoosePathPayload {
  attempted_first_name: string | null;
  attempted_phone_last_four: string | null;
}

/** Step 5 (returning) — Customer info edit. */
export interface CustomerInfoEditPayload {
  first_name: string;
  last_name: string;
  initial_phones: Array<{ phone_e164: string; is_primary: boolean }>;
  initial_emails: Array<{ email: string; is_primary: boolean }>;
  initial_address:
    | {
        address1?: string;
        address2?: string;
        city?: string;
        state?: string;
        zip?: string;
      }
    | null;
}

/** Step 5 (new-client) — New customer info form. */
export interface NewCustomerInfoPayload {
  first_name: string;
  last_name: string;
  verified_phone_e164: string;
}

/** Step 6 — Vehicle picker. */
export interface VehiclePickPayload {
  vehicles: Array<{ id: string; label: string }>;
  allow_add_new: boolean;
}

/** Step 6 sub — New vehicle drill-down / standalone form. */
export interface NewVehicleFormPayload {
  // Phase 1: no per-mode rendering differences. Reserved for phase 7.
}

/**
 * Step 7 — Service picker (2026-05-17 reshape per Chris's UX review).
 *
 * Single-section chip picker. All 10 routine services are shown to the
 * customer with their starting price + (optional) waived-fee note. The
 * testing_services catalog is NO LONGER surfaced on this card — picking
 * a diagnostic test is the diagnostic LLM's job, not the customer's
 * (the testing list is long and confusing to a non-mechanic).
 *
 * For chips with requires_explanation=TRUE (brake_inspection,
 * check_battery, warning_lights, check_suspension, check_ac) the picker
 * UI is identical; the diagnostic flow kicks in on submit via the
 * concern_explanation queue.
 *
 * Submit emits `{ picks: string[] }`. The submit-service-and-concern-
 * picker action splits the picks:
 *   - routine non-explanation → row.selected_simple_services[]
 *   - routine with requires_explanation → row.explanation_required_items[]
 *     (the queue the wizard walks via Step 7.2 concern_explanation)
 */
export interface ServiceConcernPickerPayload {
  routine_services: Array<{
    service_key: string;
    display_name: string;
    /** Integer cents. NULL means no price shown on the chip. 0 renders as "Free". */
    starting_price_cents: number | null;
    /** Short customer-facing caveat shown under the price (e.g. brake
     *  inspection's "Fee waived if a repair…"). NULL means no note. */
    price_waived_note: string | null;
    /** Customer-facing 1-2 sentence description, shown under the title
     *  on the picker tile. NULL means no description rendered. Added
     *  2026-05-19 with the rectangular one-per-line tile layout. */
    description: string | null;
  }>;
}

/** Step 7.2 — Per-concern explanation card. */
export interface ConcernExplanationPayload {
  service_key: string;
  display_name: string;
  lead_in_bubble: string;
}

/** Step 7.3 — Diagnostic specialist runs in the background. */
export interface DiagnosticLoadingPayload {
  // intentionally empty — pure loading state
}

/** Step 7.4 — One clarification question. */
export interface ClarificationQuestionPayload {
  question_id: number;
  question_text: string;
  options: Array<{ label: string; value: string }>;
  service_key: string | null;
  category: string | null;
  /** TRUE → the card lets the customer toggle multiple chips on/off then
   *  taps Continue. FALSE → single-tap-to-submit. Sourced from
   *  `concern_questions.multi_select`. Added 2026-05-18 with the CAT-2
   *  catalog rebuild. */
  multi_select: boolean;
}

/** Step 7.5 — Testing service approval. */
export interface TestingServiceApprovalPayload {
  services: Array<{
    service_key: string;
    display_name: string;
    starting_price_cents: number;
    notes: string | null;
  }>;
  category: string | null;
}

/** Step 7.6 — Second routine pass. */
export interface SecondRoutinePassPayload {
  common_services: Array<{ service_key: string; display_name: string }>;
  already_picked: string[];
}

/** Step 8 — Appointment type picker. */
export interface AppointmentTypePayload {
  options: Array<{
    type: "waiter" | "dropoff";
    available: boolean;
    unavailable_reason: string | null;
    earliest_hint: string | null;
  }>;
}

/** Step 9.1 — Date picker. */
export interface DatePickPayload {
  available_dates: string[];
  type: "waiter" | "dropoff";
  initial_focus_date: string | null;
  range_end: string | null;
}

/** Step 9.2 — Waiter time picker. */
export interface WaiterTimePickPayload {
  date: string;
  available_times: Array<"08:00" | "09:00">;
}

/** Step 10.1 — Summary card. */
export interface SummaryPayload {
  hold_id: string | null;
  hold_expires_at: string | null;
  starts_at: string;
  customer: string;
  vehicle: string;
  type: "waiter" | "dropoff";
  services: Array<{
    display_name: string;
    kind: "routine" | "concern" | "testing";
    starting_price_cents?: number;
    notes?: string;
  }>;
  reminders: string[];
  /** TRUE when `starts_at` falls on today in the shop's local timezone.
   *  Drives copy swaps on the SummaryCard label + the final
   *  confirmation bubble — "drop off before 10 AM" becomes "drop off
   *  as soon as you can today" since the "by 10 AM" guidance may
   *  already be past or close to past. Added 2026-05-18. */
  is_same_day?: boolean;
}

/**
 * Step 10.3 — Customer notes capture (Phase 13 2026-05-16).
 *
 * Two render modes:
 *
 *   - **Input mode** (`parsed_preview === null`): show the textarea + Skip
 *     + Send buttons. `initial_text` is the customer's prior raw note when
 *     resuming a session or null on first show.
 *
 *   - **Approval mode** (`parsed_preview !== null`): the customer's prior
 *     submit (text ≤150 chars) was LLM-parsed. The card shows the parsed
 *     preview with Save (approve) + Edit (reject) buttons. On a 2nd reject
 *     the action auto-punts to the raw-append path. `edit_attempts` is
 *     surfaced so the card can hint "Last try — next edit will send your
 *     original note as-is" on attempts=1.
 */
export interface CustomerNotesPayload {
  initial_text: string | null;
  /**
   * Phase 13: LLM-rewritten preview of the customer's ≤150-char raw note.
   * `null` in input mode (no preview yet). Non-null + non-empty puts the
   * card into approval mode.
   */
  parsed_preview: string | null;
  /**
   * Phase 13: count of prior Edit (reject) clicks on the parsed preview.
   * `0` on first preview; `1` on the alternate-wording retry. The card
   * uses this to surface a "last try" hint on attempts=1.
   */
  edit_attempts: number;
}

/** Step 10.4 — Customer question capture. */
export interface CustomerQuestionPayload {
  // intentionally empty
}

/** Step 10.5 — Completed terminal state. */
export interface CompletedPayload {
  first_name: string | null;
  appointment_label: string | null;
  allow_schedule_another: boolean;
}

/** Escalation terminal state. */
export interface EscalatedPayload {
  reason: string;
  shop_phone: string;
}

/** Abandoned terminal state (idle timeout / sendBeacon). */
export interface AbandonedPayload {
  // intentionally empty
}

// ─── Discriminated union ────────────────────────────────────────────────────

export type WizardCard =
  | { step: "greeting"; payload: GreetingPayload }
  | { step: "phone_name"; payload: PhoneNamePayload }
  | { step: "otp_pending"; payload: OtpPendingPayload }
  | { step: "partial_verification_gate"; payload: PartialVerificationGatePayload }
  | {
      step: "multi_account_disambiguation";
      payload: MultiAccountDisambiguationPayload;
    }
  | { step: "no_match_choose_path"; payload: NoMatchChoosePathPayload }
  | { step: "customer_info_edit"; payload: CustomerInfoEditPayload }
  | { step: "new_customer_info"; payload: NewCustomerInfoPayload }
  | { step: "vehicle_pick"; payload: VehiclePickPayload }
  | { step: "new_vehicle_form"; payload: NewVehicleFormPayload }
  | { step: "service_concern_picker"; payload: ServiceConcernPickerPayload }
  | { step: "concern_explanation"; payload: ConcernExplanationPayload }
  | { step: "diagnostic_loading"; payload: DiagnosticLoadingPayload }
  | { step: "clarification_question"; payload: ClarificationQuestionPayload }
  | { step: "testing_service_approval"; payload: TestingServiceApprovalPayload }
  | { step: "second_routine_pass"; payload: SecondRoutinePassPayload }
  | { step: "appointment_type"; payload: AppointmentTypePayload }
  | { step: "date_pick"; payload: DatePickPayload }
  | { step: "waiter_time_pick"; payload: WaiterTimePickPayload }
  | { step: "summary"; payload: SummaryPayload }
  | { step: "customer_notes"; payload: CustomerNotesPayload }
  | { step: "customer_question"; payload: CustomerQuestionPayload }
  | { step: "completed"; payload: CompletedPayload }
  | { step: "escalated"; payload: EscalatedPayload }
  | { step: "abandoned"; payload: AbandonedPayload };

/**
 * Type-level assertion: WizardCard.step covers every WizardStep value.
 * If this errors, the discriminated union is out of sync with WIZARD_STEPS.
 */
type _StepCoverageCheck = Exclude<WizardStep, WizardCard["step"]> extends never
  ? true
  : never;
// Reference the type so it isn't pruned as unused — this is the assertion.
export const _stepCoverageCheck: _StepCoverageCheck = true;
