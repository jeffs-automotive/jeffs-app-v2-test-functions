/**
 * logError — Vercel-side helper that writes a structured row to
 * scheduler_error_log in addition to Sentry.captureException.
 *
 * Per Chris's request 2026-05-16: "We should also set up our own error
 * log in supabase so you don't have to dig around so much." This is the
 * complement to Sentry — Sentry is the alerting/breadcrumb surface,
 * scheduler_error_log is the SQL-queryable triage table.
 *
 * Usage in a V2 Server Action:
 *
 *   } catch (e) {
 *     await logError({
 *       chatId,
 *       surface: "submit_otp_v2",
 *       error_code: "otp_direct_unknown",
 *       message: e instanceof Error ? e.message : String(e),
 *       stack: e instanceof Error ? e.stack : null,
 *       context: { phone_last_four, attempts_remaining },
 *     });
 *     // Also keep the Sentry capture for live alerting:
 *     Sentry.captureException(e, { ... });
 *   }
 *
 * The write is best-effort: if the table doesn't exist yet (migration
 * not applied) OR the insert fails, we log a console.warn and move on.
 * The action's own error path runs regardless.
 *
 * Why we capture step_at_error here: triage queries shouldn't need to
 * JOIN against customer_chat_sessions (which may have advanced past the
 * failure step by the time the row is queried). The helper does a quick
 * lookup so the column is populated at write time.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type LogErrorLevel = "fatal" | "error" | "warning" | "info";

export interface LogErrorArgs {
  /** Optional — null for events outside a session context (cron etc.). */
  chatId?: string | null;
  /** Where the error came from. Vercel actions use the action name. */
  surface: string;
  /** Optional finer-grained tag (e.g. 'submit_otp_v2'). Defaults to surface. */
  origin_id?: string | null;
  /** Defaults to 'error'. */
  level?: LogErrorLevel;
  /** Short structured code (e.g. 'otp_rate_limited'). */
  error_code?: string | null;
  /** Free-text error message. */
  message?: string | null;
  /** Arbitrary metadata (will be JSONB-encoded). */
  context?: Record<string, unknown> | null;
  /** Truncated stack trace if known. */
  stack?: string | null;
}

const MAX_MESSAGE_LEN = 2000;
const MAX_STACK_LEN = 4000;

export async function logError(args: LogErrorArgs): Promise<void> {
  const supabase = createSupabaseAdminClient();

  // Look up step_at_error if we have a chatId — helps triage by linking
  // the error to the wizard step the customer was on. Best-effort.
  let stepAtError: string | null = null;
  if (args.chatId) {
    try {
      const { data: row } = await supabase
        .from("customer_chat_sessions")
        .select("current_step")
        .eq("id", args.chatId)
        .maybeSingle();
      stepAtError = (row?.current_step as string | null) ?? null;
    } catch {
      // Ignore — the error log entry is still useful without step.
    }
  }

  const message = args.message?.slice(0, MAX_MESSAGE_LEN) ?? null;
  const stack = args.stack?.slice(0, MAX_STACK_LEN) ?? null;

  try {
    await supabase.from("scheduler_error_log").insert({
      session_id: args.chatId ?? null,
      origin: "vercel-action",
      origin_id: args.origin_id ?? args.surface,
      surface: args.surface,
      level: args.level ?? "error",
      error_code: args.error_code ?? null,
      message,
      context: args.context ?? null,
      stack,
      step_at_error: stepAtError,
    });
  } catch (e) {
    // Best-effort. Surface to console so a dev running locally sees the
    // failure to write the log row (which is itself a useful signal).
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        level: "warning",
        msg: "scheduler_error_log_insert_failed",
        detail: e instanceof Error ? e.message : String(e),
        original_surface: args.surface,
        original_message: message,
      }),
    );
  }
}
