// log-edge-error.ts — Supabase Edge Function helper that writes a
// structured row to scheduler_error_log.
//
// Sibling of scheduler-app/src/lib/scheduler/wizard/log-error.ts (the
// Vercel-side helper). Same semantics, same shape, same table. See the
// Vercel version for the rationale.
//
// Usage inside a Deno edge function:
//
//   } catch (e) {
//     await logEdgeError(sb, {
//       session_id: input.session_id,
//       origin_id: 'scheduler-step2-direct',
//       surface: 'scheduler-step2-direct/sendOtp',
//       error_code: `otp_${otp.error}`,
//       message: otp.detail ?? null,
//       context: { phone_last_four: phone.slice(-4) },
//     });
//   }
//
// Best-effort: failures to write the row are logged to console.warn and
// the original error path proceeds.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { Sentry } from "./sentry-edge.ts";

export type LogEdgeErrorLevel = "fatal" | "error" | "warning" | "info";

export interface LogEdgeErrorArgs {
  session_id?: string | null;
  surface: string;
  origin_id?: string | null;
  level?: LogEdgeErrorLevel;
  error_code?: string | null;
  message?: string | null;
  context?: Record<string, unknown> | null;
  stack?: string | null;
}

const MAX_MESSAGE_LEN = 2000;
const MAX_STACK_LEN = 4000;

export async function logEdgeError(
  sb: SupabaseClient,
  args: LogEdgeErrorArgs,
): Promise<void> {
  let stepAtError: string | null = null;
  if (args.session_id) {
    try {
      const { data: row } = await sb
        .from("customer_chat_sessions")
        .select("current_step")
        .eq("id", args.session_id)
        .maybeSingle();
      stepAtError = (row?.current_step as string | null) ?? null;
    } catch {
      // Ignore — log without step.
    }
  }

  const message = args.message?.slice(0, MAX_MESSAGE_LEN) ?? null;
  const stack = args.stack?.slice(0, MAX_STACK_LEN) ?? null;

  try {
    await sb.from("scheduler_error_log").insert({
      session_id: args.session_id ?? null,
      origin: "edge-fn",
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

  // OBS-4 (2026-05-19): also push to Sentry if initialized. Belt-and-suspenders
  // with the scheduler_error_log row insert above — Sentry surfaces the event
  // for live triage + alerting; the row preserves it for SQL-queryable
  // historical analysis. Either path failing doesn't break the other.
  // No-op when EDGE_FN_SENTRY_DSN secret is unset.
  try {
    Sentry.captureMessage(args.message ?? args.error_code ?? args.surface, {
      level: (args.level ?? "error") as "fatal" | "error" | "warning" | "info",
      tags: {
        origin: "edge-fn",
        origin_id: args.origin_id ?? args.surface,
        surface: args.surface,
        error_code: args.error_code ?? "unknown",
      },
      extra: {
        session_id: args.session_id ?? null,
        step_at_error: stepAtError,
        context: args.context ?? null,
        stack,
      },
    });
  } catch {
    // Sentry capture failures are silent — the scheduler_error_log row above
    // is the primary persistence.
  }
}
