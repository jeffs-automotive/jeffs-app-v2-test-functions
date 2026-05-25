/**
 * Client wrapper for the scheduler-manual-review-email Supabase Edge
 * Function.
 *
 * P1.7 post-validator fix (2026-05-25) — closes CLN-13 (the
 * "appointment_verification_mismatch email send" deferred from Phase 4).
 *
 * Why a separate edge fn instead of inlining the Resend POST in the
 * Vercel Server Action:
 *
 *   1. Resend API key stays a Supabase secret (not exposed to the
 *      Vercel bundle even as a server-only env var — defense in depth
 *      against accidental NEXT_PUBLIC_ prefixing during future edits).
 *   2. Idempotency lives in the edge fn (Resend's Idempotency-Key
 *      header keyed on the 6-char code) — Vercel retries collapse
 *      cleanly into one email.
 *   3. Mirrors the keytag system's email pattern (which is also
 *      Deno-only in `_shared/manual-review-email.ts`). Future
 *      orchestrator-driven retries (cron sweep of unresolved reviews,
 *      etc.) can call the same edge fn.
 *
 * Same two-layer host validation as booking-direct-client (P0.3):
 * derived host must end in `.supabase.co` AND must match the
 * `NEXT_PUBLIC_SUPABASE_URL` host. Defends against a typo'd
 * ORCHESTRATOR_URL sending the service-role bearer somewhere else.
 *
 * Fire-and-forget: callers in submit-summary.ts use `void` + `.catch`
 * to avoid blocking the customer's wizard advance on email send. The
 * email is back-office triage; the customer's appointment is already
 * confirmed in Tekmetric by the time this fires.
 */

import { resolveServiceRoleKey } from "@/lib/supabase/resolve-keys";

export type SchedulerManualReviewCategory =
  "appointment_verification_mismatch";

export interface SchedulerManualReviewOption {
  key: string;
  label: string;
  description: string;
  needs_tag_input?: boolean;
}

export interface SchedulerManualReviewEmailRequest {
  code: string; // "AVM-ABCDEF" — 10 chars (PFX-XXXXXX)
  category: SchedulerManualReviewCategory;
  issue_summary: string;
  options: SchedulerManualReviewOption[];
  context: {
    chat_id?: string;
    appointment_id?: number;
    customer_id?: number;
    vehicle_id?: number;
    diff?: string;
    [k: string]: unknown;
  };
}

export interface SchedulerManualReviewEmailResponse {
  ok: boolean;
  dedup?: boolean;
  latency_ms?: number;
  error?: string;
  status?: number;
  detail?: string;
}

export class ManualReviewEmailError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ManualReviewEmailError";
  }
}

const ALLOWED_EMAIL_HOST_SUFFIX = ".supabase.co";

function manualReviewEmailUrl(): string {
  const orchestratorUrl = process.env.ORCHESTRATOR_URL;
  if (!orchestratorUrl) {
    throw new ManualReviewEmailError(
      "Missing ORCHESTRATOR_URL env var — needed to derive the manual-review-email endpoint.",
    );
  }
  const derivedUrl = orchestratorUrl.replace(
    /\/[^/]+\/?$/,
    "/scheduler-manual-review-email",
  );

  // P0.3 Layer 1: hardcoded suffix gate.
  let derivedHost: string;
  try {
    derivedHost = new URL(derivedUrl).host;
  } catch (e) {
    throw new ManualReviewEmailError(
      `Invalid derived manual-review-email URL (ORCHESTRATOR_URL=${orchestratorUrl})`,
      undefined,
      e,
    );
  }
  if (!derivedHost.endsWith(ALLOWED_EMAIL_HOST_SUFFIX)) {
    throw new ManualReviewEmailError(
      `Refusing to send service-role bearer: derived host '${derivedHost}' does not end with '${ALLOWED_EMAIL_HOST_SUFFIX}'. Check ORCHESTRATOR_URL env var.`,
    );
  }

  // P0.3 Layer 2: must match the project's Supabase URL exactly.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new ManualReviewEmailError(
      "Missing NEXT_PUBLIC_SUPABASE_URL env var — required for manual-review-email host validation.",
    );
  }
  let expectedHost: string;
  try {
    expectedHost = new URL(supabaseUrl).host;
  } catch (e) {
    throw new ManualReviewEmailError(
      `Invalid NEXT_PUBLIC_SUPABASE_URL: ${supabaseUrl}`,
      undefined,
      e,
    );
  }
  if (derivedHost !== expectedHost) {
    throw new ManualReviewEmailError(
      `Refusing to send service-role bearer: derived host '${derivedHost}' does not match NEXT_PUBLIC_SUPABASE_URL host '${expectedHost}'. ORCHESTRATOR_URL and NEXT_PUBLIC_SUPABASE_URL must target the same Supabase project.`,
    );
  }

  return derivedUrl;
}

// Exported for unit testing of the URL validation logic.
export function _manualReviewEmailUrl(): string {
  return manualReviewEmailUrl();
}

/**
 * POST the manual-review payload to the edge function. Returns the
 * parsed response. Callers handle ok=false + log to Sentry; the wrapper
 * does NOT throw on email-send failure (the customer flow does not
 * depend on email success).
 *
 * Will throw `ManualReviewEmailError` on:
 *   - Missing/invalid env vars (configuration error)
 *   - Network failure
 *   - Non-JSON response from the edge fn
 *
 * Returns `{ ok: false, error }` on:
 *   - HTTP 4xx/5xx with a JSON body (edge fn's own error shape passes through)
 */
export async function sendSchedulerManualReviewEmail(
  req: SchedulerManualReviewEmailRequest,
): Promise<SchedulerManualReviewEmailResponse> {
  const url = manualReviewEmailUrl();
  const secretKey = resolveServiceRoleKey();
  if (!secretKey) {
    throw new ManualReviewEmailError(
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
      body: JSON.stringify(req),
      // 20s timeout. Resend's median latency is ~200ms; 20s gives
      // generous headroom for Vercel network blips without holding
      // the Server Action open too long (the email call is the
      // last thing fired from submit-summary's verify-mismatch path).
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new ManualReviewEmailError(
      `Network error calling scheduler-manual-review-email`,
      undefined,
      e,
    );
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (e) {
    throw new ManualReviewEmailError(
      `scheduler-manual-review-email returned non-JSON body (status ${res.status})`,
      res.status,
      e,
    );
  }

  // Edge fn always returns JSON with `ok` + optional `error` — pass
  // through verbatim. HTTP non-2xx is reflected in the body's `ok`
  // field; the response shape is identical regardless of status.
  return parsed as SchedulerManualReviewEmailResponse;
}
