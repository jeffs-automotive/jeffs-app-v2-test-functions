/**
 * wrapQtekAction — Sentry-instrumented Server Action wrapper for qteklink-app.
 *
 * Mirrors admin-app's wrapAdminAction but tags for the QTekLink surface:
 *   - surface=qteklink-app             (set globally in sentry.server.config.ts)
 *   - qteklink_action=<name>
 *   - actor_email=<email>              (when supplied by the action)
 *   - actor_object_id=<entra oid>      (stable Entra identity — our allowlist key)
 *   - qbo_realm_id=<realmId>           (when the action targets a QBO connection)
 *
 * Per .claude/rules/observability.md rule 1 — every Server Action MUST be
 * wrapped in Sentry.withServerActionInstrumentation. recordResponse: false
 * because QBO / Tekmetric payloads carry customer + financial PII; let the
 * project's beforeSend scrubber handle errors, don't recordResponse them.
 *
 * Per Next.js 15 Server Action security warning: every action must call
 * requireQtekUser() FIRST before doing anything. wrapQtekAction does NOT
 * call requireQtekUser for you — that's the action's responsibility. This
 * wrapper is purely observability.
 */
import * as Sentry from "@sentry/nextjs";

export interface QtekActionTags {
  actorEmail?: string;
  actorObjectId?: string;
  realmId?: string;
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
export function wrapQtekAction<TArgs extends readonly unknown[], TResult>(
  actionName: string,
  inner: (...args: TArgs) => Promise<TResult>,
  staticTags?: QtekActionTags,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    return await Sentry.withServerActionInstrumentation(
      actionName,
      { recordResponse: false },
      async () => {
        Sentry.setTag("qteklink_action", actionName);
        if (staticTags?.actorEmail) {
          Sentry.setTag("actor_email", staticTags.actorEmail);
        }
        if (staticTags?.actorObjectId) {
          Sentry.setTag("actor_object_id", staticTags.actorObjectId);
        }
        if (staticTags?.realmId) {
          Sentry.setTag("qbo_realm_id", staticTags.realmId);
        }
        return await inner(...args);
      },
    );
  };
}
