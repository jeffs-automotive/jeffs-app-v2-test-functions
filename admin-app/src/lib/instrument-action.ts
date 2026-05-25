/**
 * wrapAdminAction — Sentry-instrumented Server Action wrapper for admin-app.
 *
 * Mirrors scheduler-app's wrapAction (src/lib/scheduler/wizard/instrument-action.ts)
 * but tags differently:
 *   - surface=admin-app (already set globally in sentry.server.config.ts)
 *   - admin_action=<name>
 *   - actor_email=<email>             (when supplied by the action)
 *   - orchestrator_tool=<name>        (when the action wraps an orchestrator call)
 *
 * Per .claude/rules/observability.md rule 1 — every Server Action MUST be
 * wrapped in Sentry.withServerActionInstrumentation. recordResponse: false
 * because orchestrator returns can include customer names / vehicle data
 * (PII-adjacent — let the project's beforeSend scrubber handle errors,
 * don't recordResponse them).
 *
 * Per Next.js 15 Server Action security warning: every action must call
 * requireAdmin() FIRST before doing anything. wrapAdminAction does NOT
 * call requireAdmin for you — that's the action's responsibility. The
 * wrapper is purely observability.
 */
import * as Sentry from "@sentry/nextjs";

export interface AdminActionTags {
  actorEmail?: string;
  orchestratorTool?: string;
}

/**
 * Variadic so it works with BOTH:
 *   - simple actions: `(args) => Promise<result>`
 *   - useActionState actions: `(prevState, formData) => Promise<newState>`
 *
 * The `inner` function's parameter list is preserved exactly. staticTags
 * are applied once at wrap time; actions can also call Sentry.setTag /
 * setUser inside their bodies for per-call dynamic context.
 */
export function wrapAdminAction<TArgs extends readonly unknown[], TResult>(
  actionName: string,
  inner: (...args: TArgs) => Promise<TResult>,
  staticTags?: AdminActionTags,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    return await Sentry.withServerActionInstrumentation(
      actionName,
      { recordResponse: false },
      async () => {
        Sentry.setTag("admin_action", actionName);
        if (staticTags?.actorEmail) {
          Sentry.setTag("actor_email", staticTags.actorEmail);
        }
        if (staticTags?.orchestratorTool) {
          Sentry.setTag("orchestrator_tool", staticTags.orchestratorTool);
        }
        return await inner(...args);
      },
    );
  };
}
