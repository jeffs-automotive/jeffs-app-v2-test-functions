// Types for the scheduler wizard state machine.
//
// Per chat-design.md 2026-05-13: the wizard has 10 locked steps + sub-flows.
// The XState machine here mirrors customer_chat_sessions.current_step values
// 1-to-1 — see migration 20260513000000 column-level comment for the full
// enum value space.
//
// The machine is the CLIENT-SIDE companion to the server's source-of-truth
// session row. Both must agree on `current_step`; the orchestrator drives
// transitions via directives, and the local machine reflects the latest
// directive in its state. On resume, the machine HYDRATES from the session
// row's current_step.

// ─── Wizard step enum (matches customer_chat_sessions.current_step) ─────────

export const WIZARD_STEPS = [
  // Step 1
  "greeting",
  // Step 2
  "phone_name",
  // Step 3
  "otp_pending",
  // Step 4 (verification reconciliation sub-steps)
  "partial_verification_gate",
  "multi_account_disambiguation",
  "no_match_choose_path",
  // Step 5
  "customer_info_edit",
  "new_customer_info",
  // Step 6
  "vehicle_pick",
  "new_vehicle_form",
  // Step 7
  "service_concern_picker",
  "concern_explanation",
  "diagnostic_loading",
  "clarification_question",
  "testing_service_approval",
  "second_routine_pass",
  // Step 8
  "appointment_type",
  // Step 9
  "date_pick",
  "waiter_time_pick",
  // Step 10
  "summary",
  "customer_notes",
  "customer_question",
  // Terminal states
  "completed",
  "escalated",
  "abandoned",
] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

export type IdentityVerificationLevel = "full" | "partial" | "none";

// ─── Wizard context ─────────────────────────────────────────────────────────

export interface WizardContext {
  /** UUID of the customer_chat_sessions row driving this wizard. */
  sessionId: string;

  /** Which channel started this session — drives OTP requirement etc. */
  channel: "web" | "sms";

  /** Step 1 — opening question bucket. */
  isReturningCustomer: boolean | null;

  /** Step 2 — what the customer typed (NOT yet verified). */
  enteredFirstName: string | null;
  enteredLastName: string | null;
  enteredPhoneE164: string | null;

  /** Step 3 — OTP. */
  otpSentAt: string | null;
  otpAttempts: number;
  otpVerified: boolean;

  /** Step 4-5 — verified identity (server-set). */
  identityVerificationLevel: IdentityVerificationLevel | null;
  verifiedCustomerId: number | null;
  verifiedFirstName: string | null;
  verifiedLastName: string | null;

  /** Step 6 — vehicle. */
  selectedVehicleId: number | null;
  /** When customer is adding a new vehicle, the in-flight form data. */
  newVehicleDraft: {
    year?: number;
    make?: string;
    model?: string;
    licensePlate?: string;
    notes?: string;
  } | null;

  /** Step 7 — services + concerns. */
  selectedSimpleServices: string[];
  /** Per-concern explanation items (matches customer_chat_sessions column shape). */
  explanationRequiredItems: Array<{
    serviceKey: string;
    explanationText: string;
    category?: string;
    clarifications?: Record<string, string | "skipped">;
    recommendations?: string[];
  }>;
  /** Step 7.4 — pending clarification questions queued for this turn. */
  pendingClarificationQuestions: Array<{
    id: number;
    questionText: string;
    options: Array<{ label: string; value: string }>;
    serviceKey: string;
  }>;
  /** Step 7.5 — testing services recommended (aggregated across concerns). */
  recommendedTestingServices: Array<{
    serviceKey: string;
    displayName: string;
    startingPriceCents: number;
    notes: string | null;
  }>;
  approvedTestingServices: string[];
  declinedTestingServices: string[];
  /** Step 7.6 — additional routine round. */
  additionalRoutineServicesRound2: string[];

  /** Step 8 — appointment type. */
  appointmentType: "waiter" | "dropoff" | null;

  /** Step 9 — date + time. */
  appointmentDate: string | null;     // YYYY-MM-DD
  appointmentTime: string | null;     // HH:MM (waiter only; dropoff hardcoded)

  /** Hold (10-min TTL). */
  holdToken: string | null;
  holdExpiresAt: string | null;

  /** Step 10 — confirmation + post-confirm captures. */
  appointmentConfirmedAt: string | null;
  appointmentId: number | null;
  customerNotesText: string | null;
  customerNotesApproved: boolean | null;
  customerNotesEditAttempts: number;
  customerQuestion: string | null;
  customerQuestionForwarded: boolean;

  /** Edit-from-summary rate limiter (2-edit cap → escalation). */
  summaryEditAttempts: number;

  /** Escalation. */
  escalatedAt: string | null;
  escalationReason: string | null;

  /** Most recent directive received from the orchestrator (drives card render). */
  lastDirective: {
    directive: string;
    data?: Record<string, unknown>;
    flags?: Record<string, unknown>;
  } | null;

  /** Optional error surface (a tool failed, a network call dropped, etc.). */
  errorMessage: string | null;
}

export const initialWizardContext: WizardContext = {
  sessionId: "",
  channel: "web",
  isReturningCustomer: null,
  enteredFirstName: null,
  enteredLastName: null,
  enteredPhoneE164: null,
  otpSentAt: null,
  otpAttempts: 0,
  otpVerified: false,
  identityVerificationLevel: null,
  verifiedCustomerId: null,
  verifiedFirstName: null,
  verifiedLastName: null,
  selectedVehicleId: null,
  newVehicleDraft: null,
  selectedSimpleServices: [],
  explanationRequiredItems: [],
  pendingClarificationQuestions: [],
  recommendedTestingServices: [],
  approvedTestingServices: [],
  declinedTestingServices: [],
  additionalRoutineServicesRound2: [],
  appointmentType: null,
  appointmentDate: null,
  appointmentTime: null,
  holdToken: null,
  holdExpiresAt: null,
  appointmentConfirmedAt: null,
  appointmentId: null,
  customerNotesText: null,
  customerNotesApproved: null,
  customerNotesEditAttempts: 0,
  customerQuestion: null,
  customerQuestionForwarded: false,
  summaryEditAttempts: 0,
  escalatedAt: null,
  escalationReason: null,
  lastDirective: null,
  errorMessage: null,
};

// ─── Events the machine listens for ──────────────────────────────────────────

export type WizardEvent =
  | { type: "HYDRATE"; context: Partial<WizardContext> }
  | { type: "ADVANCE"; step: WizardStep }
  | {
      type: "DIRECTIVE";
      directive: string;
      data?: Record<string, unknown>;
      flags?: Record<string, unknown>;
    }
  | { type: "SET_GREETING"; isReturning: boolean }
  | { type: "SUBMIT_PHONE_NAME"; firstName: string; lastName: string; phoneE164: string }
  | { type: "OTP_SENT" }
  | { type: "OTP_VERIFY"; attempts: number; verified: boolean }
  | { type: "SET_IDENTITY"; level: IdentityVerificationLevel; customerId: number | null; firstName: string | null; lastName: string | null }
  | { type: "SELECT_VEHICLE"; vehicleId: number }
  | { type: "ADD_VEHICLE"; draft: WizardContext["newVehicleDraft"] }
  | { type: "SUBMIT_SIMPLE_SERVICES"; services: string[] }
  | { type: "SUBMIT_EXPLANATION"; serviceKey: string; explanationText: string }
  | { type: "QUEUE_CLARIFICATIONS"; questions: WizardContext["pendingClarificationQuestions"] }
  | { type: "ANSWER_CLARIFICATION"; questionId: number; answer: string | "skipped" }
  | { type: "SET_TESTING_RECOMMENDATIONS"; services: WizardContext["recommendedTestingServices"] }
  | { type: "APPROVE_TESTING"; serviceKeys: string[]; declinedKeys: string[] }
  | { type: "SUBMIT_ROUTINE_ROUND2"; services: string[] }
  | { type: "SELECT_APPOINTMENT_TYPE"; appointmentType: "waiter" | "dropoff" }
  | { type: "SELECT_DATE"; date: string }
  | { type: "SELECT_TIME"; time: string }
  | { type: "HOLD_PLACED"; holdToken: string; expiresAt: string }
  | { type: "HOLD_EXPIRED" }
  | { type: "CONFIRM_APPOINTMENT"; appointmentId: number; confirmedAt: string }
  | { type: "SUBMIT_CUSTOMER_NOTES"; text: string; approved: boolean }
  | { type: "EDIT_NOTES" }
  | { type: "SUBMIT_CUSTOMER_QUESTION"; text: string | null }
  | { type: "ESCALATE"; reason: string }
  | { type: "RESTART" }
  | { type: "ABANDON" }
  | { type: "RESUME_FROM_ABANDONED" }
  | { type: "SET_ERROR"; message: string | null };
