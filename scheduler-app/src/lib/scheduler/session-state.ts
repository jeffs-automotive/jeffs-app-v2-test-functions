/**
 * Wizard step state machine (Phase 1 row-as-truth refactor 2026-05-13).
 *
 * Per chat-design.md locked architecture decision #1: the
 * `customer_chat_sessions` row is the source of truth for ALL data the
 * customer enters. Each Server Action writes the matching columns and
 * advances `current_step`. The chat agent (and orchestrator) read from
 * the row — they NEVER parse customer-entered data out of message text.
 *
 * The wizard step enum here mirrors the 23-state list documented in the
 * customer_chat_sessions.current_step column comment (Chunk 1 migration
 * 20260513000000_scheduler_phase1_wizard_columns.sql).
 */

export const WIZARD_STEPS = [
  // Step 1
  "greeting",
  // Step 2
  "phone_name",
  // Step 3
  "otp_pending",
  // Step 4 (reconciliation sub-steps)
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

/**
 * Bucket the customer picked at Step 1. Maps to the `is_returning_customer`
 * column as: 'returning' → true, 'new' → false, 'unsure' → null.
 * The string form is retained in `event_detail` audit columns for
 * diagnostic purposes; the column drives the orchestrator reconciliation
 * matrix.
 */
export type GreetingBucket = "returning" | "new" | "unsure";

export function greetingBucketToBoolean(b: GreetingBucket): boolean | null {
  if (b === "returning") return true;
  if (b === "new") return false;
  return null; // unsure → null (orchestrator treats identically to returning per design)
}
