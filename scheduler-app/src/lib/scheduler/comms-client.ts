/**
 * Client wrapper for the scheduler-comms Supabase Edge Function
 * (revamp Phase 3 — confirmation/reminder senders).
 *
 * Same architecture rationale + two-layer host validation as
 * manual-review-email-client.ts: provider keys stay Supabase secrets;
 * idempotency lives in the edge fn (scheduler_reminders claim + Resend
 * Idempotency-Key); fire-and-forget from submit-summary's confirm-success
 * path (`void ... .catch`) so the customer's wizard advance never blocks
 * on a send.
 */

import { resolveServiceRoleKey } from "@/lib/supabase/resolve-keys";
import { deriveValidatedEdgeFunctionUrl } from "@/lib/scheduler/orchestrator-url";

export interface SendConfirmationResponse {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export class SchedulerCommsError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SchedulerCommsError";
  }
}

/**
 * Ask scheduler-comms to send the booking-confirmation email/SMS for a
 * session. Never throws on SEND failure (edge fn reports via its ledger +
 * error log); throws SchedulerCommsError only on config/network problems
 * so the fire-and-forget `.catch` in submit-summary can Sentry-log them.
 */
export async function sendBookingConfirmation(
  sessionId: string,
): Promise<SendConfirmationResponse> {
  const url = deriveValidatedEdgeFunctionUrl(
    "scheduler-comms",
    (message, cause) => new SchedulerCommsError(message, undefined, cause),
  );
  const secretKey = resolveServiceRoleKey();
  if (!secretKey) {
    throw new SchedulerCommsError(
      "Missing service-role bearer (SUPABASE_SECRET_KEYS / SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY).",
    );
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        apikey: secretKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ op: "send_confirmation", session_id: sessionId }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new SchedulerCommsError(
      "Network error calling scheduler-comms",
      undefined,
      e,
    );
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (e) {
    throw new SchedulerCommsError(
      `scheduler-comms returned non-JSON body (status ${res.status})`,
      res.status,
      e,
    );
  }
  return parsed as SendConfirmationResponse;
}
