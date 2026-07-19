/**
 * Wizard step state machine (Phase 1 row-as-truth refactor 2026-05-13).
 *
 * Per chat-design.md locked architecture decision #1: the
 * `customer_chat_sessions` row is the source of truth for ALL data the
 * customer enters. Each Server Action writes the matching columns and
 * advances `current_step`. The wizard (and orchestrator) read from
 * the row — they NEVER parse customer-entered data out of message text.
 *
 * The wizard step enum here mirrors the 25-state list documented in the
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
  // Act-or-ask AO4 (2026-07-03): the chip card shown when a concern's
  // Stage-1 returned 2-3 ranked candidates. Sits in the step-7 cluster
  // next to clarification_question (both are diagnostic-loop cards).
  "concern_clarify",
  // concern-triage (2026-07-19): the broad-category chip card shown when a
  // concern is too vague to classify (Stage-1 returned 0 candidates for a
  // genuine concern). One tap → constrained re-diagnosis. Sibling of
  // concern_clarify in the step-7 diagnostic-loop cluster. Feature:
  // docs/scheduler/concern-triage-and-unsure-path-plan.md.
  "concern_triage",
  "testing_service_approval",
  "second_routine_pass",
  // Step 8
  "appointment_type",
  // Step 9
  "date_pick",
  "waiter_time_pick",
  // Step 10
  "summary",
  // Summary edit hub (2026-07-04): the per-section edit landing reached
  // from the summary card's "Edit something". Renders 4 section cards
  // (contact / vehicle / services / time) + "back to summary". Sits next
  // to summary in the step-10 cluster.
  "summary_edit_hub",
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
