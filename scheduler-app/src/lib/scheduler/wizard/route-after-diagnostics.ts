/**
 * routeAfterDiagnostics — shared routing helper (2026-05-17).
 *
 * Used by run-diagnostics (after the per-concern LLM pass) and by
 * submit-clarification-answer (after the question queue drains). Both
 * end-of-pipeline points need the same routing rule:
 *
 *   pending non-empty            → clarification_question (ask remaining)
 *   pending empty + recs present → testing_service_approval (recommend services)
 *   pending empty + no recs      → second_routine_pass (forward-to-advisor bubble)
 *
 * The "forward-to-advisor" path fires when every concern matched a
 * 'other'-subcategory OR couldn't be categorized by the diagnostic LLM.
 *
 * Lives in its own module (not run-diagnostics.ts) because that file is
 * "use server"-flagged and Next.js only allows async-function exports
 * from action modules. This is a synchronous pure function.
 */

export interface RouteAfterDiagnosticsArgs {
  pending_count: number;
  recommendation_count: number;
}

export interface RouteAfterDiagnosticsResult {
  nextStep:
    | "clarification_question"
    | "testing_service_approval"
    | "second_routine_pass";
  jeffBubble: string | undefined;
}

export function routeAfterDiagnostics(
  args: RouteAfterDiagnosticsArgs,
): RouteAfterDiagnosticsResult {
  if (args.pending_count > 0) {
    return {
      nextStep: "clarification_question",
      jeffBubble:
        "Got it — a few quick questions to make sure we test the right things. 🔎",
    };
  }
  if (args.recommendation_count > 0) {
    return {
      nextStep: "testing_service_approval",
      jeffBubble:
        "Thanks — based on what you told me, here's what I'd recommend our techs look at.",
    };
  }
  return {
    nextStep: "second_routine_pass",
    jeffBubble:
      "Thanks for the detail — I'll pass this over to our service advisors and they'll reach out if they have more questions. Let's get you on the schedule. 📅",
  };
}
