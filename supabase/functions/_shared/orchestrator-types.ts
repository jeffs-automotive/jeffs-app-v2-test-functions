// Shared types for the unified orchestrator + router + specialists.
//
// Kept in its own file to avoid circular imports between
//   orchestrator.ts ↔ orchestrator-router.ts ↔ specialists/*.ts

/**
 * Who is driving this orchestrator run.
 * - 'advisor' = service-advisor session via Claude Desktop / orchestrator-mcp.
 *               Has access to keytag, scheduler (admin-tooled), and diagnostic
 *               specialists.
 * - 'customer' = customer-facing scheduler-app via orchestrator-direct.
 *                Limited to scheduler (no admin tools) + diagnostic. NEVER
 *                routed to keytag.
 */
export type CallerContext = "advisor" | "customer";

/**
 * The set of specialists the unified orchestrator can dispatch to. New
 * specialists added in future chunks should be appended here and to
 * ALLOWED_BY_CONTEXT.
 */
export type SpecialistName = "keytag" | "scheduler" | "diagnostic";

/**
 * Caller-context → allowed specialists. Enforced by the unified orchestrator
 * BEFORE dispatch. If the router returns a specialist not in this set for the
 * given caller_context, the orchestrator rejects the routing decision and
 * falls back to a safe default (customer → scheduler; advisor → keytag).
 */
export const ALLOWED_BY_CONTEXT: Record<CallerContext, SpecialistName[]> = {
  advisor: ["keytag", "scheduler", "diagnostic"],
  customer: ["scheduler", "diagnostic"],
};

/**
 * Direct intent_type → specialist mapping for the customer path. When the
 * chat agent (or scheduler-app frontend) sends a structured intent_type, the
 * unified orchestrator can skip the router LLM call and dispatch directly.
 *
 * Unknown intent_types fall through to the router OR a safe default (scheduler
 * for customer; keytag for advisor).
 */
export const INTENT_TYPE_TO_SPECIALIST: Record<string, SpecialistName> = {
  // Scheduler-specialist intents (Phase 1 wizard)
  verify_and_lookup: "scheduler",
  reconcile_identity: "scheduler",
  send_otp: "scheduler",
  verify_otp: "scheduler",
  fetch_customer_info: "scheduler",
  patch_customer: "scheduler",
  lookup_vehicles: "scheduler",
  pick_vehicle: "scheduler",
  add_vehicle: "scheduler",
  list_services: "scheduler",
  fetch_slots: "scheduler",
  earliest_available: "scheduler",
  hold_slot: "scheduler",
  confirm_appointment: "scheduler",
  cancel_appointment: "scheduler",
  reschedule_appointment: "scheduler",
  fetch_pricing: "scheduler",
  finalize_session: "scheduler",

  // Diagnostic-specialist intents (Phase 1 Step 7.4)
  diagnose_concern: "diagnostic",
  pick_clarification_questions: "diagnostic",
  classify_concern_category: "diagnostic",
};

/**
 * Default specialist when the router fails or the intent_type is unrecognized.
 * Picked by caller_context — keeps the system responsive without an LLM fallback.
 */
export const DEFAULT_SPECIALIST: Record<CallerContext, SpecialistName> = {
  advisor: "keytag",
  customer: "scheduler",
};

/**
 * Meta block attached to every OrchestratorResult — describes which specialist
 * actually ran, what model it used, and how long it took. Aggregated in the
 * unified orchestrator's run-row close.
 */
export interface OrchestratorResultMeta {
  specialist: SpecialistName | "unknown";
  model: string;
  tools_called: string[];
  total_tokens_in: number;
  total_tokens_out: number;
  latency_ms: number;
  steps: number;
  /** True iff the router LLM was actually invoked. False when intent_type
   *  short-circuited the router or when the default-specialist fallback fired. */
  router_invoked: boolean;
  router_model?: string;
  router_latency_ms?: number;
  /** The reason the router (or fallback) picked this specialist. Useful for
   *  debugging routing mistakes. */
  router_reason?: string;
}
