/**
 * wrapAction — centralizes Sentry.withServerActionInstrumentation for V2
 * Server Actions per .claude/rules/observability.md rule 1:
 *
 *   "Every Server Action is wrapped in Sentry.withServerActionInstrumentation"
 *
 * Usage:
 *
 *   async function submitGreetingV2Impl(args): Promise<WizardTransitionResult> {
 *     // ... existing body ...
 *   }
 *   export const submitGreetingV2 = wrapAction(
 *     "submitGreetingV2",
 *     submitGreetingV2Impl,
 *   );
 *
 * Why a wrapper (not inline withServerActionInstrumentation):
 *
 *   1. One line per action — minimal edit surface across 25 V2 actions.
 *   2. Centralizes the recordResponse: false flag (PII-bearing returns
 *      shouldn't be sent to Sentry — see sentry.server.config.ts:55-73
 *      beforeSend scrubbing).
 *   3. Tags the event with wizard_action = name so triage queries can
 *      group by V2 action without parsing every span name.
 *
 * Why this matters: @sentry/nextjs v10 has auto-instrumentation for
 * Server Actions in some configurations, but rule 1 of observability.md
 * mandates the explicit wrap. The explicit wrap also survives any future
 * opt-out or config change.
 *
 * Created 2026-05-16 per R6 Stream A BLOCKER-A-1.
 */
import * as Sentry from "@sentry/nextjs";

export function wrapAction<Args, Result>(
  actionName: string,
  inner: (args: Args) => Promise<Result>,
): (args: Args) => Promise<Result> {
  // Sentry.withServerActionInstrumentation returns Promise<ReturnType<callback>>
  // — since our callback itself returns a Promise (it awaits the inner action),
  // the Sentry call effectively returns Promise<Promise<Result>>. The outer
  // await flattens this back to Promise<Result> for the caller.
  return async (args) => {
    return await Sentry.withServerActionInstrumentation(
      actionName,
      { recordResponse: false },
      async () => {
        Sentry.setTag("wizard_action", actionName);
        // Auto-tag chat_id at the wrapper so every inner
        // Sentry.captureException within the action inherits it. Every V2
        // action takes args with a `chatId: string` field. Pattern-
        // extension fix 2026-05-16: prior R4 wiring added chat_id only to
        // the TOP-LEVEL catches, leaving inner captureException sites
        // (parse failures, edge fn op-error branches, etc.) without the
        // session-correlation tag. This hoists it to the wrapper so all
        // sub-spans get it for free.
        if (
          args !== null &&
          typeof args === "object" &&
          "chatId" in args &&
          typeof (args as { chatId: unknown }).chatId === "string" &&
          (args as { chatId: string }).chatId.length > 0
        ) {
          Sentry.setTag("chat_id", (args as { chatId: string }).chatId);
        }
        return await inner(args);
      },
    );
  };
}
