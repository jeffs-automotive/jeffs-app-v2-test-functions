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

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { ENV_NAMES } from "../_shared/tekmetric.ts";
import {
  checkSchedulerBearer,
  unauthorizedResponse,
  RESOLVED_SERVICE_ROLE_KEY,
} from "../_shared/scheduler-auth.ts";
import { verifyOtp, sendOtp } from "../_shared/tools/scheduler-otp.ts";
import { getCustomerById } from "../_shared/tools/scheduler-customer.ts";
import { logEdgeError } from "../_shared/log-edge-error.ts";
import { withSentryScope } from "../_shared/sentry-edge.ts";

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

/**
 * Convert a Tekmetric-stored phone number to E.164 (+1XXXXXXXXXX). Returns
 * null when the digit count is unrecognized (defensive — should rarely fire
 * because Tekmetric phones for US shops are 10-digit).
 */
function tekmetricPhoneToE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

async function handleVerify(input: VerifyInput): Promise<Response> {
  // Read phone + customer_id + cached edits off the session row. customer_id
  // surfaces to submitOtpV2 (which branches on customer_id==null for the
  // Option B new-client path). edited_phones is checked below to skip the
  // Tekmetric profile fetch when the customer is re-entering Step 5 from
  // Edit-from-Summary (Phase 12) — preserves their prior edits.
  const { data: row, error: rowErr } = await sb
    .from("customer_chat_sessions")
    .select("phone_e164, customer_id, otp_attempts, edited_phones")
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

  // Verified=true. For returning customers (customer_id set), fetch the
  // current Tekmetric profile + stash phones/emails/address on the row's
  // edited_* columns so Step 5 CustomerInfoEditCard pre-fills with current
  // values. Skip when edited_phones is already populated (Phase 12 Edit-
  // from-Summary re-entry — customer's prior edits take precedence).
  //
  // Fail-soft: a fetch failure shouldn't block the verify response. The
  // card will render with empty values and the customer can type from
  // scratch. Logged for observability.
  if (row.customer_id && !row.edited_phones) {
    try {
      const customer = await getCustomerById(sb, SHOP_ID, row.customer_id);
      if (customer) {
        const editedPhones = (customer.phone ?? [])
          .slice(0, 2)
          .map((p) => ({
            phone_e164: tekmetricPhoneToE164(p.number),
            is_primary: p.primary === true,
          }))
          .filter((p): p is { phone_e164: string; is_primary: boolean } =>
            p.phone_e164 !== null
          );
        const editedEmails = customer.email
          ? [{ email: customer.email, is_primary: true }]
          : [];
        const editedAddress = customer.address
          ? {
              address1: customer.address.streetAddress ?? undefined,
              city: customer.address.city ?? undefined,
              state: customer.address.state ?? undefined,
              zip: customer.address.zip ?? undefined,
            }
          : null;

        const { error: stashErr } = await sb
          .from("customer_chat_sessions")
          .update({
            edited_phones: editedPhones,
            edited_emails: editedEmails,
            edited_address: editedAddress,
            primary_email_for_description: customer.email ?? null,
            verified_first_name: customer.firstName ?? undefined,
            verified_last_name: customer.lastName ?? undefined,
            last_active_at: new Date().toISOString(),
          })
          .eq("id", input.session_id);
        if (stashErr) {
          console.error(
            JSON.stringify({
              level: "warn",
              msg: "verify_otp_profile_stash_failed",
              session_id: input.session_id,
              detail: stashErr.message,
            }),
          );
        }
      }
    } catch (e) {
      console.error(
        JSON.stringify({
          level: "warn",
          msg: "verify_otp_profile_fetch_failed",
          session_id: input.session_id,
          customer_id: row.customer_id,
          detail: e instanceof Error ? e.message : String(e),
        }),
      );
    }
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
    // R6 NICE 2026-05-16: surface bearer rejections to scheduler_error_log
    // for queryable triage. The existing console.warn in scheduler-auth.ts
    // reaches Sentry via Log Drain, but the structured row gives ops a
    // single place to query auth failures across all direct fns.
    await logEdgeError(sb, {
      surface: "scheduler-otp-direct/auth",
      origin_id: "scheduler-otp-direct",
      level: "warning",
      error_code: `auth_${authCheck.reason ?? "unknown"}`,
      message: authCheck.reason ?? null,
      context: authCheck.diagnostic
        ? { diagnostic: authCheck.diagnostic }
        : null,
    });
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
    const stack = e instanceof Error ? (e.stack ?? null) : null;
    console.error(
      JSON.stringify({
        level: "error",
        msg: "scheduler_otp_direct_unhandled",
        op: input.op,
        detail: msg,
      }),
    );
    await logEdgeError(sb, {
      session_id: input.session_id,
      surface: `scheduler-otp-direct/${input.op}`,
      origin_id: "scheduler-otp-direct",
      level: "error",
      error_code: `${input.op}_unhandled`,
      message: msg,
      stack,
    });
    return jsonResponse(
      { ok: false, op: input.op, error: msg },
      500,
    );
  }
}

// PLAN-02 Phase 1 — per-request Sentry isolation scope + flush before response.
Deno.serve((req) => withSentryScope(req, "scheduler-otp-direct", () => handleRequest(req)));
