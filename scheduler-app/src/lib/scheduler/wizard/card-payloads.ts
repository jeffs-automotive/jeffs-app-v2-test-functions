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
 * Step 7.1 — Service + concern picker (Phase 9c rebuild 2026-05-15).
 *
 * The card has TWO chip sections per chat-design.md "Architecture
 * amendment — 2026-05-14" + services-categories.md:
 *
 *   - `common_services` — routine chips that don't trigger a description
 *     (oil_change, tire_rotation, state_inspection, etc.).
 *   - `diagnostic_services` — routine-with-requires_explanation (e.g.
 *     check_battery, brake_inspection) UNION testing_services (battery_test,
 *     oil_leak_testing, etc.). Each carries a starting_price_cents so the
 *     customer sees the cost up front. The five "diagnostic-routine" chips
 *     (Brake Inspection, Check Battery, Warning Lights, Check Suspension,
 *     Check A/C) appear here without a price (their routine cousins don't
 *     charge a starting fee — the testing equivalents do).
 *
 * The customer picks any subset across BOTH sections. Submit emits
 * `{ picks: string[] }` (a flat list of every selected service_key). The
 * submit-service-and-concern-picker action splits the picks:
 *
 *   - routine non-explanation → row.selected_simple_services[]
 *   - testing services        → row.approved_testing_services[]
 *   - anything needing a description → row.explanation_required_items[]
 *     (the queue the wizard walks via Step 7.2 concern_explanation)
 */
export interface ServiceConcernPickerPayload {
  common_services: Array<{
    service_key: string;
    display_name: string;
  }>;
  diagnostic_services: Array<{
    service_key: string;
    display_name: string;
    /** Integer cents; null for the routine-with-requires_explanation chips that
     *  don't carry their own starting fee. The customer sees "Free" or "$XX.XX"
     *  per the value. */
    starting_price_cents: number | null;
    /** Tagged so the submit action knows which table the pick came from
     *  (different DB targets + different concern-category resolution path). */
    source: "testing" | "routine";
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
}

/** Step 10.3 — Customer notes capture. */
export interface CustomerNotesPayload {
  initial_text: string | null;
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
