// Pure tool functions for OTP send/verify + escalation.
//
// Per appointments_design.md §4.1 + §7.2 + §10.
// Used by: _shared/scheduler-tools.ts (AI SDK tool registry).
//
// SMS provider (locked 2026-05-10): TBD pending Chris's evaluation of his
// existing VOIP company vs Telnyx. The send_otp call here STUBS the actual
// SMS-send call — the rest (code generation, hashing, attempts counter,
// rate-limit) is provider-agnostic and works now. Wiring up the real send
// is a one-line swap in `sendOtpViaSmsProvider` once the provider is locked.
//
// Storage:
//   - otp_codes table holds: phone_e164, code_hash (sha256(salt || code)),
//     salt (16 random bytes), expires_at (now + 5 min), attempts, consumed_at,
//     ip_addr.
//   - Single-use: consumed_at set on first verify pass; subsequent verifies
//     against the same code fail.
//
// Rate limits (Phase 1):
//   - Max 15 active codes per phone per hour (insert hits the 16th → reject).
//     Raised from 3 → 15 on 2026-07-17 (Chris); kept in lockstep with the
//     app-layer OTP_PHONE_MAX in scheduler-app/src/lib/security/rate-limit.ts.
//   - Max 3 wrong attempts per code → consume the code (force a resend)

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { logEdgeError } from "../log-edge-error.ts";
// Revamp Phase 2 (2026-07-02): the Telnyx transport + provider gating moved
// to the shared _shared/telnyx-client.ts so the confirmation/reminder
// senders use the SAME send path as OTP. Behavior-preserving extraction.
import { sendSms, type SmsSendResult } from "../telnyx-client.ts";

const OTP_TTL_MIN = 5;
const OTP_LENGTH = 6;
const MAX_ACTIVE_CODES_PER_HOUR = 15;
const MAX_ATTEMPTS_PER_CODE = 3;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateOtp(): string {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  // Map 4 bytes (32 bits) to a 6-digit number; leading zeros padded.
  const n =
    (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3];
  const code = (Math.abs(n) % 1_000_000).toString().padStart(OTP_LENGTH, "0");
  return code;
}

function generateSalt(): Uint8Array {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return salt;
}

async function sha256(saltBytes: Uint8Array, code: string): Promise<Uint8Array> {
  const codeBytes = new TextEncoder().encode(code);
  const combined = new Uint8Array(saltBytes.length + codeBytes.length);
  combined.set(saltBytes, 0);
  combined.set(codeBytes, saltBytes.length);
  const digest = await crypto.subtle.digest("SHA-256", combined);
  return new Uint8Array(digest);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
  return result === 0;
}

function hexToBytes(hex: string): Uint8Array {
  // Postgres BYTEA returns "\x..." encoding via supabase-js; strip the prefix.
  const stripped = hex.startsWith("\\x") ? hex.slice(2) : hex;
  const out = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(b: Uint8Array): string {
  return (
    "\\x" +
    Array.from(b)
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}

// ─── Telnyx SMS send — SHARED transport (revamp Phase 2) ─────────────────────
//
// The Telnyx POST + provider gating (SMS_PROVIDER telnyx|stub|disabled +
// auto-detect) now live in _shared/telnyx-client.ts, shared with the
// confirmation/reminder senders. Only the OTP message text stays here.

type SendOtpResult = SmsSendResult;

function buildOtpMessageText(code: string): string {
  // Keep under 160 chars to stay one SMS segment (cheaper + delivers faster).
  // NOTE (corrected 2026-07-02, REVAMP-PLAN §4b): being "transactional" does
  // NOT blanket-exempt OTP from STOP semantics — a prior STOP is honored at
  // the carrier/account level regardless of message type. "Reply STOP" is
  // omitted here purely for single-segment length; STOP/HELP handling lives
  // in the telnyx-webhook consumer + the campaign auto-responder.
  return `Jeff's Automotive: Your verification code is ${code}. Expires in 5 minutes. Don't share this code.`;
}

/** Dispatch the OTP through the shared provider-gated transport. */
async function sendOtpViaSmsProvider(
  phoneE164: string,
  code: string,
): Promise<SendOtpResult> {
  return sendSms(phoneE164, buildOtpMessageText(code), "otp");
}

// ─── Tool functions ──────────────────────────────────────────────────────────

/**
 * Generate a 6-digit OTP, hash it, store in otp_codes, and send via SMS.
 *
 * Rate-limit: counts non-consumed otp_codes for this phone created in the
 * last hour; if ≥ MAX_ACTIVE_CODES_PER_HOUR, returns
 * { ok: false, error: 'rate_limited' } without inserting OR sending.
 *
 * Test-OTP bypass (2026-05-13): when phone_e164 matches the env-gated
 * SCHEDULER_TEST_PHONE_E164 value, the function:
 *   - SKIPS the Telnyx SMS send
 *   - Inserts the otp_codes row with hash(SCHEDULER_TEST_OTP_CODE)
 *   - Returns ok:true normally
 * This lets Playwright + manual end-to-end testing drive the wizard
 * without needing a real phone to receive SMS. The verifyOtp path is
 * unchanged — the test phone uses the same Hash + verify pipeline; only
 * the SMS transport is bypassed.
 *
 * Security: gated by exact phone-string match on a Supabase Edge Function
 * env var (SCHEDULER_TEST_PHONE_E164). Production deploys leave both
 * env vars unset → bypass code path is dead. The bypass code itself
 * (SCHEDULER_TEST_OTP_CODE) is a 6-digit string; if production accidentally
 * sets the test phone but not the code, sendOtp falls back to normal
 * generation (no static-code leak).
 */
const TEST_PHONE_E164 = Deno.env.get("SCHEDULER_TEST_PHONE_E164") ?? "";
const TEST_OTP_CODE = Deno.env.get("SCHEDULER_TEST_OTP_CODE") ?? "";
const TEST_BYPASS_ENABLED =
  TEST_PHONE_E164.length > 0 &&
  /^\+1\d{10}$/.test(TEST_PHONE_E164) &&
  /^\d{6}$/.test(TEST_OTP_CODE);

export async function sendOtp(
  sb: SupabaseClient,
  shopId: number,
  args: { phone_e164: string; ip_addr?: string },
): Promise<
  | { ok: true; ttl_seconds: number; phone_last_four: string }
  | { ok: false; error: "rate_limited" | "send_failed"; detail?: string }
> {
  // Rate-limit guard: count UNCONSUMED + STILL-VALID codes in the last
  // hour for this phone. Expired codes (expires_at <= now) are NOT
  // usable so they shouldn't count against the bucket — including them
  // would lock out customers who legitimately hit a few wrong-code
  // attempts whose codes then expired without being consumed. Bug
  // audit 2026-05-16: rate-limit fired after 3 failed-and-expired codes
  // even though no successful verification had happened.
  const nowIso = new Date().toISOString();
  const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
  const { data: recent } = await sb
    .from("otp_codes")
    .select("id")
    .eq("shop_id", shopId)
    .eq("phone_e164", args.phone_e164)
    .is("consumed_at", null)
    .gte("created_at", oneHourAgo)
    .gt("expires_at", nowIso);
  if ((recent?.length ?? 0) >= MAX_ACTIVE_CODES_PER_HOUR) {
    return { ok: false, error: "rate_limited" };
  }

  // Test bypass: when env-gated test phone is used, use the static test
  // code AND skip the SMS send. Otherwise generate randomly + send Telnyx.
  const isTestPhone =
    TEST_BYPASS_ENABLED && args.phone_e164 === TEST_PHONE_E164;
  const code = isTestPhone ? TEST_OTP_CODE : generateOtp();
  const salt = generateSalt();
  const codeHash = await sha256(salt, code);

  const { data: insertedRow, error } = await sb
    .from("otp_codes")
    .insert({
      shop_id: shopId,
      phone_e164: args.phone_e164,
      code_hash: bytesToHex(codeHash),
      salt: bytesToHex(salt),
      expires_at: new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString(),
      ip_addr: args.ip_addr ?? null,
    })
    .select("id")
    .single();
  if (error || !insertedRow) {
    return {
      ok: false,
      error: "send_failed",
      detail: `otp_codes insert: ${error?.message ?? "unknown"}`,
    };
  }

  // Test-phone bypass: skip the Telnyx send. The otp_codes row is already
  // inserted with hash(TEST_OTP_CODE), so verifyOtp(TEST_OTP_CODE) will
  // succeed normally. Log the bypass so it shows up in audit retrospectives.
  if (isTestPhone) {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "send_otp_test_bypass",
        phone_last_four: args.phone_e164.slice(-4),
        otp_codes_row_id: insertedRow.id,
      }),
    );
    return {
      ok: true,
      ttl_seconds: OTP_TTL_MIN * 60,
      phone_last_four: args.phone_e164.slice(-4),
    };
  }

  const sendResult = await sendOtpViaSmsProvider(args.phone_e164, code);
  if (!sendResult.ok) {
    // Per audit I-4 (2026-05-13): differentiate provider failure types.
    // - 'auth' / 'config' / 'network' / 'provider_error' / 'rate_limit' are
    //   transient OR our-side problems. Consume the row so a retry generates
    //   a fresh code (matches prior behavior). Customer hourly quota is NOT
    //   penalized — this is a system issue, not customer behavior.
    // - 'invalid_number' is a customer-side issue (bad phone) AND letting it
    //   loop without consuming would allow infinite retries burning Telnyx
    //   budget. Keep the row + log; downstream rate limit kicks in after
    //   MAX_ACTIVE_CODES_PER_HOUR=15 attempts.
    const isCustomerSideFailure = sendResult.error_code === "invalid_number";
    if (!isCustomerSideFailure) {
      await sb
        .from("otp_codes")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", insertedRow.id as string);
    }
    console.error(
      JSON.stringify({
        level: "error",
        msg: "send_otp_provider_failed",
        provider_error_code: sendResult.error_code,
        detail: sendResult.detail,
        to_last_four: args.phone_e164.slice(-4),
        consumed: !isCustomerSideFailure,
      }),
    );
    return {
      ok: false,
      error: "send_failed",
      detail: sendResult.detail,
    };
  }

  return {
    ok: true,
    ttl_seconds: OTP_TTL_MIN * 60,
    phone_last_four: args.phone_e164.slice(-4),
  };
}

/**
 * Verify a customer-entered OTP code against the most-recent active row for
 * the phone. Constant-time compare via XOR.
 *
 * Outcomes:
 *   - { verified: true } — single-use; row marked consumed_at. When session_id
 *     is supplied, ALSO writes otp_verified_at=now() and
 *     identity_verification_level='full' to the matching
 *     customer_chat_sessions row. This is the chat-design.md §3 identity-gate
 *     persistence (OTP-success path always lands at 'full' verification per
 *     §4.3 reconciliation matrix: phone hits >= 1 → full; the no-phone-match
 *     'partial' path never sends OTP in the first place).
 *   - { verified: false, error: 'no_active_code' } — none in window
 *   - { verified: false, error: 'invalid_code' } — hash mismatch (attempt
 *     counter incremented; on 3rd wrong attempt, code is consumed to force
 *     a resend)
 *   - { verified: false, error: 'too_many_attempts' } — already at cap
 *   - { verified: false, error: 'expired' } — past expires_at
 */
export async function verifyOtp(
  sb: SupabaseClient,
  shopId: number,
  args: { phone_e164: string; code: string; session_id?: string },
): Promise<{
  verified: boolean;
  error?: "no_active_code" | "invalid_code" | "too_many_attempts" | "expired";
}> {
  const { data: row, error: selectErr } = await sb
    .from("otp_codes")
    .select("id, code_hash, salt, expires_at, attempts, consumed_at")
    .eq("shop_id", shopId)
    .eq("phone_e164", args.phone_e164)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (selectErr) {
    throw new Error(`otp_codes select failed: ${selectErr.message}`);
  }
  if (!row) {
    return { verified: false, error: "no_active_code" };
  }
  if (new Date(row.expires_at as string) <= new Date()) {
    // Mark expired row as consumed so subsequent calls don't keep matching it
    await sb
      .from("otp_codes")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", row.id as string);
    return { verified: false, error: "expired" };
  }
  if ((row.attempts as number) >= MAX_ATTEMPTS_PER_CODE) {
    await sb
      .from("otp_codes")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", row.id as string);
    return { verified: false, error: "too_many_attempts" };
  }

  const submittedHash = await sha256(
    hexToBytes(row.salt as string),
    args.code,
  );
  const storedHash = hexToBytes(row.code_hash as string);

  if (!bytesEqual(submittedHash, storedHash)) {
    const newAttempts = (row.attempts as number) + 1;
    if (newAttempts >= MAX_ATTEMPTS_PER_CODE) {
      await sb
        .from("otp_codes")
        .update({
          attempts: newAttempts,
          consumed_at: new Date().toISOString(),
        })
        .eq("id", row.id as string);
    } else {
      await sb
        .from("otp_codes")
        .update({ attempts: newAttempts })
        .eq("id", row.id as string);
    }
    return { verified: false, error: "invalid_code" };
  }

  // Consume the code — single-use semantics
  await sb
    .from("otp_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id as string);

  // Persist identity-gate state to the chat session row when caller threaded
  // through session_id. Per chat-design.md §3 (lines 685-705) OTP success
  // ALWAYS means 'full' verification — the partial-verify branch (name match
  // without phone match) never sends an OTP. Best-effort: a row-write failure
  // shouldn't fail the verify itself (the otp_codes row is already consumed
  // and the customer should see the success path). Surfaced via console
  // error for observability.
  if (args.session_id) {
    const verifiedAt = new Date().toISOString();
    const { error: sessionUpdateErr } = await sb
      .from("customer_chat_sessions")
      .update({
        otp_verified_at: verifiedAt,
        identity_verification_level: "full",
        last_active_at: verifiedAt,
      })
      .eq("id", args.session_id);
    if (sessionUpdateErr) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "verify_otp_session_write_failed",
          session_id: args.session_id,
          detail: sessionUpdateErr.message,
        }),
      );
      // R4-IMPORTANT-A-5 2026-05-16: surface to scheduler_error_log so
      // ops can detect the half-verified state (otp_codes consumed but
      // identity_verification_level still 'partial'). Without this the
      // downstream "PII gate" mis-routing was invisible to triage.
      await logEdgeError(sb, {
        session_id: args.session_id,
        surface: "scheduler-otp/verifyOtp",
        origin_id: "scheduler-otp",
        level: "error",
        error_code: "session_write_failed_after_verify",
        message: sessionUpdateErr.message,
      });
    }
  }

  return { verified: true };
}

/**
 * Escalate to human — returns the shop phone + a stock message. Caller
 * (chat agent) renders show_escalation_card on web or plain text on SMS,
 * then sets customer_chat_sessions.status = 'escalated'.
 */
export function escalateToHuman(args: { reason: string }): {
  shop_phone: string;
  message: string;
  reason: string;
} {
  return {
    shop_phone: "6102536565",
    message:
      "I'm sorry — I'm not able to handle that here. Please call us at 6102536565 and we'll take care of you right away.",
    reason: args.reason,
  };
}
