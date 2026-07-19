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
import type { CardCopy } from "../card-text";

// ─── Per-step payload types ─────────────────────────────────────────────────

/** Step 1 — Greeting. Card copy is editable via /schedulerconfig (card-text). */
export interface GreetingPayload {
  /** Editable "main copy" (eyebrow/title/description/prose/footnote), resolved
   *  server-side from scheduler_card_text (defaults ← DB override). Raw
   *  templates; the card substitutes {{merge_field}} tokens via `interpolate`. */
  copy: CardCopy<"greeting">;
}

/** Step 2 — Phone + name capture. Step-label tone varies by greeting bucket. */
export interface PhoneNamePayload {
  step_label: string;
  /** Prefill fields when resuming a session or bouncing back from a branch. */
  initial_first_name?: string;
  initial_last_name?: string;
  initial_phone_e164?: string;
  /** Editable card copy (card-text-editor). */
  copy: CardCopy<"phone_name">;
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
  /** Editable card copy (card-text-editor). */
  copy: CardCopy<"partial_verification_gate">;
}

/** Step 3.5b — Multi-account disambiguation. Vehicle-only per PII protection. */
export interface MultiAccountDisambiguationPayload {
  candidates: Array<{
    customer_id: number;
    recent_vehicle: string;
  }>;
  attempted_phone_last_four: string | null;
  /** Editable card copy (card-text-editor). */
  copy: CardCopy<"multi_account_disambiguation">;
}

/** Step 3.5c — No-match choose-path (returning customer with 0 phone + 0 name). */
export interface NoMatchChoosePathPayload {
  attempted_first_name: string | null;
  attempted_phone_last_four: string | null;
  /** Editable card copy (card-text-editor). */
  copy: CardCopy<"no_match_choose_path">;
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
  /** Editable card copy (card-text-editor). */
  copy: CardCopy<"customer_info_edit">;
}

/** Step 5 (new-client) — New customer info form. */
export interface NewCustomerInfoPayload {
  first_name: string;
  last_name: string;
  verified_phone_e164: string;
  /** Editable card copy (card-text-editor). */
  copy: CardCopy<"new_customer_info">;
}

/** Step 6 — Vehicle picker. */
export interface VehiclePickPayload {
  vehicles: Array<{ id: string; label: string }>;
  allow_add_new: boolean;
}

/** Step 6 sub — New vehicle drill-down / standalone form. */
export interface NewVehicleFormPayload {
  // Phase 1: no per-mode rendering differences. Reserved for phase 7.
  /** Editable card copy (card-text-editor). */
  copy: CardCopy<"new_vehicle_form">;
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
  /** Summary edit hub (2026-07-04): service_keys to pre-select when the
   *  picker is opened to edit services from the hub (`edit_return_step` is
   *  set). Empty on the normal forward flow. The picker seeds its selected
   *  set from these so the customer's prior picks aren't lost. */
  initial_selected?: string[];
}

/** Step 7.2 — Per-concern explanation card. */
export interface ConcernExplanationPayload {
  service_key: string;
  display_name: string;
  lead_in_bubble: string;
  /** Editable card copy (card-text-editor). */
  copy: CardCopy<"concern_explanation">;
}

/** Step 7.3 — Diagnostic specialist runs in the background. */
export interface DiagnosticLoadingPayload {
  // intentionally empty — pure loading state
  /** Editable card copy (card-text-editor). */
  copy: CardCopy<"diagnostic_loading">;
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
  /** Editable card copy (card-text-editor). */
  copy: CardCopy<"clarification_question">;
}

/**
 * Step 7.4b — Concern clarify chip card (act-or-ask AO4, 2026-07-03).
 *
 * Shown when a concern's Stage-1 diagnostic returned 2-3 ranked candidate
 * categories. The customer taps the closest fit (or "None of these"). The
 * shape mirrors the HEAD entry of the persisted
 * `concern_clarify_candidates` JSONB array (get-current-card reads the head
 * defensively — same queue-head idiom as clarification_question).
 *
 * `candidates` are ALREADY RANKED best-first by run-diagnostics; the card
 * renders them in array order and never re-sorts. A `null`
 * `starting_price_cents` (advisor-handoff `other_subcategory` candidate)
 * renders the "We'll take a look" pill instead of a price.
 */
export interface ConcernClarifyPayload {
  concern_text: string;
  /** The picker-chip display name for the source concern (nullable when
   *  the chip label wasn't resolvable — the card doesn't render it). */
  service_display_name: string | null;
  candidates: Array<{
    key: string;
    kind: "testing_service" | "other_subcategory";
    display_name: string;
    starting_price_cents: number | null;
    description: string | null;
  }>;
  /** Editable card copy (card-text-editor). */
  copy: CardCopy<"concern_clarify">;
}

/**
 * Step 7.4c — Concern triage chip card (feature concern-triage, 2026-07-19).
 *
 * Shown when a concern's Stage-1 diagnostic returned ZERO candidates for a
 * triage-eligible reason (`too_vague` / `no_catalog_fit`) on its first pass.
 * Instead of dead-ending to an advisor, the customer picks the closest broad
 * category ("What kind of trouble is it?") and a CONSTRAINED re-diagnosis
 * runs. The shape mirrors the HEAD entry of the persisted
 * `concern_triage_state` JSONB array (get-current-card reads the head
 * defensively — same queue-head idiom as concern_clarify).
 *
 * `chips` are ALREADY SORTED by the caller (seed `sort` column snapshot on the
 * triage entry); the card renders them in array order and never re-sorts. The
 * fixed "Something else / not sure" escape is an in-card affordance (chip_key
 * TRIAGE_ESCAPE_CHIP_KEY), NOT a `chips` element — it always routes to the
 * advisor.
 *
 * `concern_id` (INV-13 stable identity) + `concern_index` (display order) are
 * carried so the submit action targets the exact queue entry (INV-14/INV-15)
 * and WizardSurface can key the card on the concern.
 */
export interface ConcernTriagePayload {
  /** INV-13 stable identity of the concern being triaged — passed verbatim to
   *  submit-concern-triage so the tap targets the right queue head (INV-14). */
  concern_id: string;
  /** Display order / queue position of the concern. The card keys on this. */
  concern_index: number;
  /** The customer's own typed concern text, echoed back verbatim (may be ""). */
  concern_text: string;
  /** The broad-category chips, ALREADY SORTED (rendered snapshot from the
   *  triage entry). `chip_key` is echoed back on tap; `display_label` is the
   *  customer-voice label. Empty ([]) renders the escape-only card. */
  chips: Array<{ chip_key: string; display_label: string }>;
  /** Editable card copy (card-text-editor). */
  copy: CardCopy<"concern_triage">;
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
  /** Editable card copy (card-text-editor). */
  copy: CardCopy<"testing_service_approval">;
}

/** Step 7.6 — Second routine pass. */
export interface SecondRoutinePassPayload {
  common_services: Array<{ service_key: string; display_name: string }>;
  already_picked: string[];
  /** Editable card copy (card-text-editor). */
  copy: CardCopy<"second_routine_pass">;
}

/** Step 8 — Appointment type picker. */
export interface AppointmentTypePayload {
  options: Array<{
    /** Type slug from scheduler_appointment_types (B3 2026-07-02: DB-driven —
     *  no longer a closed "waiter"|"dropoff" union). */
    type: string;
    /** Card copy, from the type row (replaces the component's TYPE_META). */
    title: string;
    description: string;
    emoji: string;
    available: boolean;
    unavailable_reason: string | null;
    earliest_hint: string | null;
  }>;
  /** Editable card chrome copy (card-text-editor) — eyebrow/title/footnote
   *  only. Per-option copy lives on scheduler_appointment_types. */
  copy: CardCopy<"appointment_type">;
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
  /** Editable card copy (card-text-editor). */
  copy: CardCopy<"summary">;
}

/**
 * Step 10.2 — Summary edit hub (2026-07-04).
 *
 * The "Edit something" landing reached from the SummaryCard. Renders a
 * per-section overview (contact / vehicle / services / appointment time),
 * each with an Edit button, plus a primary "Looks good — back to summary".
 * Section summaries are derived from the same row columns as the summary
 * card via build-summary-data's `buildSummaryEditHubData`, so the hub shows
 * exactly what the customer confirmed.
 */
export interface SummaryEditHubPayload {
  contact: {
    name: string;
    /** Last 4 of the session phone. Optional — omitted when unknown. */
    phone_last_four?: string;
    /** Primary email for the description, when present. */
    email?: string;
  };
  /** "2022 Toyota Camry" style label, or null when no vehicle resolved. */
  vehicle_label: string | null;
  services: {
    /** Routine service display names. */
    routine: string[];
    /** Free-text / requires-explanation concerns with a one-line recap. */
    concerns: Array<{ display_name: string; one_liner: string }>;
    /** Approved testing services with their starting price. */
    testing: Array<{ display_name: string; starting_price_cents: number }>;
  };
  appointment: {
    type: "waiter" | "dropoff";
    /** YYYY-MM-DD, or "" when not yet picked. */
    date: string;
    /** HH:MM (waiter) or "" (dropoff / not-yet-picked). */
    time: string;
  };
  /** TRUE when the session still holds a live (unreleased) slot. Editing
   *  the appointment time releases it; the hub surfaces this so the card
   *  can warn before the customer re-picks. */
  hold_active: boolean;
  /** Editable card copy (card-text-editor). */
  copy: CardCopy<"summary_edit_hub">;
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
  /** Editable card copy (card-text-editor). */
  copy: CardCopy<"customer_notes">;
}

/** Step 10.4 — Customer question capture. */
export interface CustomerQuestionPayload {
  // intentionally empty
  /** Editable card copy (card-text-editor). */
  copy: CardCopy<"customer_question">;
}

/** Step 10.5 — Completed terminal state. */
export interface CompletedPayload {
  first_name: string | null;
  appointment_label: string | null;
  allow_schedule_another: boolean;
  /** Active confirmation/reminder-text consent for the session's phone at
   *  render time (revamp Phase 2). Drives the CompletedCard's truthful
   *  what-happens-next line; false when unknown/lookup-failed. */
  sms_consent: boolean;
  /** Editable card copy (card-text-editor). */
  copy: CardCopy<"completed">;
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
  | { step: "concern_clarify"; payload: ConcernClarifyPayload }
  | { step: "concern_triage"; payload: ConcernTriagePayload }
  | { step: "testing_service_approval"; payload: TestingServiceApprovalPayload }
  | { step: "second_routine_pass"; payload: SecondRoutinePassPayload }
  | { step: "appointment_type"; payload: AppointmentTypePayload }
  | { step: "date_pick"; payload: DatePickPayload }
  | { step: "waiter_time_pick"; payload: WaiterTimePickPayload }
  | { step: "summary"; payload: SummaryPayload }
  | { step: "summary_edit_hub"; payload: SummaryEditHubPayload }
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
