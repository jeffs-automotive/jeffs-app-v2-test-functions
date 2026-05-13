/**
 * Types + helpers for Server Actions in session-actions.ts.
 *
 * MUST live in a separate file from the Server Actions themselves.
 * Next.js 15 forbids non-async-function exports from a "use server" file
 * — exporting a type/interface OR a plain const from `session-actions.ts`
 * would cause the file's exports to resolve as `undefined`/broken proxies
 * at runtime, and `await submitPhoneName(...)` would silently fail. This
 * file has no "use server" directive so plain type + const exports are
 * fine.
 */

import type { WizardStep } from "@/lib/scheduler/session-state";

export interface SessionActionResult {
  ok: boolean;
  /** Tool NAME to render next (e.g. "show_otp_input"), NOT a semantic
   *  orchestrator directive (e.g. "send_otp_first"). The chat agent's
   *  tool catalog is keyed on tool names, so the Server Action does the
   *  semantic→tool translation before returning. */
  directive?: string;
  /** Payload for the tool. */
  data?: Record<string, unknown>;
  /** Optional flags the client/agent branches on. */
  flags?: Record<string, unknown>;
  /** Templated Jeff-voice chat bubble to render between cards. */
  bubble_copy?: string;
  /** Server-rendered current_step AFTER this action. */
  current_step?: WizardStep;
  /** Human-readable error when ok=false. */
  error?: string;
}

/**
 * Map the orchestrator's SEMANTIC directive (what should happen next)
 * to the chat agent's TOOL NAME (which renderer to invoke).
 *
 * The orchestrator speaks in business intent ("send_otp_first",
 * "identity_match_required", "render_confirmation_card"). The chat
 * agent's tool catalog is keyed on the rendering tool names
 * ("show_otp_input", "show_escalation_card", "show_summary_card").
 *
 * Server Actions call this BEFORE returning so the directive field of
 * SessionActionResult is always a tool name the agent can route on.
 */
const DIRECTIVE_TO_TOOL_NAME: Record<string, string> = {
  // greeting → step 2
  show_phone_entry: "show_phone_name_card",
  show_phone_name_card: "show_phone_name_card",

  // phone_name → step 3 / step 4
  send_otp_first: "show_otp_input",
  show_otp_input: "show_otp_input",
  identity_match_required: "show_escalation_card",
  show_new_customer_form: "show_new_customer_form",
  partial_verification_gate: "show_escalation_card",

  // otp → step 5 / step 7
  show_vehicle_picker: "show_vehicle_picker",
  show_service_and_concern_picker: "show_service_and_concern_picker",

  // service + concern → step 8 / step 9
  clarify_concern_question: "show_clarification_question",
  propose_testing_services: "show_testing_service_approval",

  // appointment flow
  show_appointment_type: "show_appointment_type",
  offer_earliest_available: "show_appointment_type",
  show_calendar_date_picker: "show_calendar_date_picker",
  show_waiter_time_picker: "show_waiter_time_picker",

  // confirmation
  render_confirmation_card: "show_summary_card",
  show_summary_card: "show_summary_card",
  appointment_booked: "show_customer_notes_card",
  hold_expired: "show_calendar_date_picker",
  slot_just_taken: "show_calendar_date_picker",

  // post-confirmation
  show_customer_notes_card: "show_customer_notes_card",
  show_customer_question_card: "show_customer_question_card",
  show_completed_card: "show_completed_card",
  session_complete: "show_completed_card",

  // terminal / error
  escalate: "show_escalation_card",
  show_escalation_card: "show_escalation_card",
  tool_error: "show_escalation_card",

  // pass-through
  continue: "continue",
};

/**
 * Translate a semantic directive to a tool name. If the directive is
 * already a tool name (or unknown), pass through unchanged — the chat
 * agent will fall back to "continue" behavior for unknown directives.
 */
export function mapDirectiveToToolName(directive: string | undefined): string | undefined {
  if (!directive) return directive;
  return DIRECTIVE_TO_TOOL_NAME[directive] ?? directive;
}
