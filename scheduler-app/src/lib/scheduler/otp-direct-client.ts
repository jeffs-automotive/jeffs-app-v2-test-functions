/**
 * Client wrapper for the scheduler-otp-direct Supabase Edge Function.
 *
 * Per chat-design.md "Architecture amendment — 2026-05-14" + the migration
 * plan (phase_05a): replaces the orchestrator-direct LLM path for OTP
 * verify + resend. Sibling of step2-direct-client.ts and the existing
 * booking-direct-client.ts.
 *
 * Same auth pattern (Pattern A bearer + apikey) + same env-var resolution
 * via ORCHESTRATOR_URL → swap the trailing path segment.
 */
import { resolveServiceRoleKey } from "@/lib/supabase/resolve-keys";

// ─── Op shapes ──────────────────────────────────────────────────────────────

export type OtpVerifyRequest = {
  op: "verify";
  session_id: string;
  code: string;
};

export type OtpResendRequest = {
  op: "resend";
  session_id: string;
};

export type OtpDirectRequest = OtpVerifyRequest | OtpResendRequest;

export interface OtpVerifySuccessResponse {
  ok: true;
  verified: true;
  customer_id: number | null;
  identity_verification_level: "full";
  attempts_remaining: number;
}

export interface OtpVerifyFailureResponse {
  ok: true;
  verified: false;
  error: "invalid_code" | "expired" | "no_active_code" | "too_many_attempts";
  attempts_remaining: number;
}

export interface OtpResendSuccessResponse {
  ok: true;
  phone_last_four: string;
  ttl_seconds: number;
}

export interface OtpDirectErrorResponse {
  ok: false;
  error: string;
}

export type OtpVerifyResponse =
  | OtpVerifySuccessResponse
  | OtpVerifyFailureResponse
  | OtpDirectErrorResponse;

export type OtpResendResponse =
  | OtpResendSuccessResponse
  | OtpDirectErrorResponse;

// ─── Errors ─────────────────────────────────────────────────────────────────

export class OtpDirectError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "OtpDirectError";
  }
}

// ─── URL resolution ─────────────────────────────────────────────────────────

function otpDirectUrl(): string {
  const orchestratorUrl = process.env.ORCHESTRATOR_URL;
  if (!orchestratorUrl) {
    throw new OtpDirectError(
      "Missing ORCHESTRATOR_URL env var — needed to derive the scheduler-otp-direct endpoint.",
    );
  }
  return orchestratorUrl.replace(/\/[^/]+\/?$/, "/scheduler-otp-direct");
}

// ─── Core fetch helper ──────────────────────────────────────────────────────

async function callOtpDirect<T>(req: OtpDirectRequest): Promise<T> {
  const url = otpDirectUrl();
  const secretKey = resolveServiceRoleKey();
  if (!secretKey) {
    throw new OtpDirectError(
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
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new OtpDirectError(
      "Network error calling scheduler-otp-direct",
      undefined,
      e,
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "<unreadable body>");
    throw new OtpDirectError(
      `scheduler-otp-direct returned ${res.status}: ${text}`,
      res.status,
    );
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (e) {
    throw new OtpDirectError(
      "scheduler-otp-direct returned non-JSON body",
      res.status,
      e,
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new OtpDirectError(
      "scheduler-otp-direct response not an object",
      res.status,
    );
  }

  return parsed as T;
}

// ─── Public ops ─────────────────────────────────────────────────────────────

export function callOtpVerify(
  args: Omit<OtpVerifyRequest, "op">,
): Promise<OtpVerifyResponse> {
  return callOtpDirect<OtpVerifyResponse>({ op: "verify", ...args });
}

export function callOtpResend(
  args: Omit<OtpResendRequest, "op">,
): Promise<OtpResendResponse> {
  return callOtpDirect<OtpResendResponse>({ op: "resend", ...args });
}
