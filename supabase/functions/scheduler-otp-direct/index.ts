// scheduler-otp-direct
//
// Deterministic OTP verify + resend endpoint per the chat-design.md
// "Architecture amendment — 2026-05-14" + the migration plan in
// scheduler-refactor-state.json phase_05a.
//
// Replaces the orchestrator-direct LLM path for Step 3 (OTP verify + resend).
// Sister of scheduler-step2-direct (initial OTP send + Tekmetric lookup) and
// scheduler-booking-direct (booking ladder). Phase 18 consolidates all three
// into a single scheduler-server function.
//
// Why no LLM: chat-design.md amendment locks deterministic ops to direct
// edge functions. The verify code path is pure crypto + DB; the LLM round-
// trip adds latency, cost, and a failure mode (parse errors on directive
// output) for zero benefit.
//
// Request:
//   POST / { op: 'verify' | 'resend', session_id, code? }
//
// Ops:
//
//   op='verify'
//     input:  { session_id, code }  (code = 6 digits)
//     output (200):
//       { ok: true, verified: true,
//         customer_id: number | null,                  // null when no Tekmetric match (new-client path)
//         identity_verification_level: 'full',
//         attempts_remaining: number }
//       { ok: true, verified: false,
//         error: 'invalid_code' | 'expired' | 'no_active_code' | 'too_many_attempts',
//         attempts_remaining: number }
//     output (4xx/5xx): { ok: false, error: <string> }
//
//   op='resend'
//     input:  { session_id }
//     output (200):
//       { ok: true, phone_last_four: string, ttl_seconds: number }
//       { ok: false, error: 'rate_limited' | 'send_failed' | 'no_phone_on_session' }
//
// Auth: Pattern A bearer (matches orchestrator-direct + scheduler-step2-direct).

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { ENV_NAMES } from "../_shared/tekmetric.ts";
import {
  checkSchedulerBearer,
  unauthorizedResponse,
  RESOLVED_SERVICE_ROLE_KEY,
} from "../_shared/scheduler-auth.ts";
import { verifyOtp, sendOtp } from "../_shared/tools/scheduler-otp.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SHOP_ID = parseInt(
  Deno.env.get(ENV_NAMES.TEKMETRIC_SHOP_ID) ?? "7476",
  10,
);

const sb = createClient(SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, apikey, Content-Type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ─── Input parsing ─────────────────────────────────────────────────────────

interface VerifyInput {
  op: "verify";
  session_id: string;
  code: string;
}

interface ResendInput {
  op: "resend";
  session_id: string;
}

type RequestBody = VerifyInput | ResendInput;

function parseBody(
  raw: unknown,
):
  | { ok: true; input: RequestBody }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.session_id !== "string" || !r.session_id) {
    return { ok: false, error: "session_id required" };
  }
  if (r.op === "verify") {
    if (typeof r.code !== "string" || !/^\d{6}$/.test(r.code)) {
      return { ok: false, error: "code must be a 6-digit string" };
    }
    return {
      ok: true,
      input: { op: "verify", session_id: r.session_id, code: r.code },
    };
  }
  if (r.op === "resend") {
    return { ok: true, input: { op: "resend", session_id: r.session_id } };
  }
  return { ok: false, error: "op must be 'verify' or 'resend'" };
}

// ─── Op handlers ──────────────────────────────────────────────────────────

async function handleVerify(input: VerifyInput): Promise<Response> {
  // Read phone + customer_id off the session row. Required to feed verifyOtp
  // and to surface customer_id to the Next.js submitOtpV2 (which branches
  // on customer_id==null for the Option B new-client path).
  const { data: row, error: rowErr } = await sb
    .from("customer_chat_sessions")
    .select("phone_e164, customer_id, otp_attempts")
    .eq("id", input.session_id)
    .maybeSingle();
  if (rowErr) {
    return jsonResponse(
      { ok: false, error: `session lookup failed: ${rowErr.message}` },
      500,
    );
  }
  if (!row) {
    return jsonResponse({ ok: false, error: "session_not_found" }, 404);
  }
  const phone = (row.phone_e164 as string | null) ?? "";
  if (!phone) {
    return jsonResponse(
      { ok: false, error: "no_phone_on_session" },
      400,
    );
  }

  const result = await verifyOtp(sb, SHOP_ID, {
    phone_e164: phone,
    code: input.code,
    // verifyOtp writes otp_verified_at + identity_verification_level='full'
    // to customer_chat_sessions when verified=true. Phase 1 fix; see
    // scheduler-otp.ts §verifyOtp.
    session_id: input.session_id,
  });

  // Bump session-level otp_attempts on failure (mirror of what the legacy
  // submitOtp Server Action did). On verify success, attempts_remaining
  // is full (3) — verifyOtp consumed the code so no need to bump.
  const priorAttempts = (row.otp_attempts as number | null) ?? 0;
  if (!result.verified) {
    const newAttempts = priorAttempts + 1;
    await sb
      .from("customer_chat_sessions")
      .update({
        otp_attempts: newAttempts,
        last_active_at: new Date().toISOString(),
      })
      .eq("id", input.session_id);
    return jsonResponse({
      ok: true,
      verified: false,
      error: result.error ?? "invalid_code",
      attempts_remaining: Math.max(0, 3 - newAttempts),
    });
  }

  return jsonResponse({
    ok: true,
    verified: true,
    customer_id: row.customer_id ?? null,
    identity_verification_level: "full",
    attempts_remaining: 3,
  });
}

async function handleResend(input: ResendInput): Promise<Response> {
  const { data: row, error: rowErr } = await sb
    .from("customer_chat_sessions")
    .select("phone_e164")
    .eq("id", input.session_id)
    .maybeSingle();
  if (rowErr) {
    return jsonResponse(
      { ok: false, error: `session lookup failed: ${rowErr.message}` },
      500,
    );
  }
  if (!row || !row.phone_e164) {
    return jsonResponse({ ok: false, error: "no_phone_on_session" }, 400);
  }

  const result = await sendOtp(sb, SHOP_ID, {
    phone_e164: row.phone_e164 as string,
  });

  if (!result.ok) {
    return jsonResponse({
      ok: false,
      error: result.error ?? "send_failed",
    });
  }

  // Reset session-level otp_attempts for the new code (the per-code counter
  // is enforced inside verifyOtp's otp_codes row).
  await sb
    .from("customer_chat_sessions")
    .update({
      otp_sent_at: new Date().toISOString(),
      otp_attempts: 0,
      last_active_at: new Date().toISOString(),
    })
    .eq("id", input.session_id);

  return jsonResponse({
    ok: true,
    phone_last_four: result.phone_last_four,
    ttl_seconds: result.ttl_seconds,
  });
}

// ─── HTTP handler ─────────────────────────────────────────────────────────

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "POST only" }, 405);
  }

  const authCheck = checkSchedulerBearer(req, "scheduler-otp-direct");
  if (!authCheck.ok) {
    return unauthorizedResponse(authCheck);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "invalid JSON body" }, 400);
  }
  const parse = parseBody(raw);
  if (!parse.ok) {
    return jsonResponse({ ok: false, error: parse.error }, 400);
  }
  const input = parse.input;

  try {
    if (input.op === "verify") return await handleVerify(input);
    if (input.op === "resend") return await handleResend(input);
    return jsonResponse({ ok: false, error: "unreachable" }, 500);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      JSON.stringify({
        level: "error",
        msg: "scheduler_otp_direct_unhandled",
        op: input.op,
        detail: msg,
      }),
    );
    return jsonResponse(
      { ok: false, op: input.op, error: msg },
      500,
    );
  }
}

Deno.serve(handleRequest);
