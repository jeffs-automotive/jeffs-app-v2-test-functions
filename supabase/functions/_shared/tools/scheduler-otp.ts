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
//   - Max 3 active codes per phone per hour (insert hits the 4th → reject)
//   - Max 3 wrong attempts per code → consume the code (force a resend)

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const OTP_TTL_MIN = 5;
const OTP_LENGTH = 6;
const MAX_ACTIVE_CODES_PER_HOUR = 3;
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

// ─── Telnyx SMS send ─────────────────────────────────────────────────────────
//
// Telnyx Messaging API per https://developers.telnyx.com/api-reference/messages.
//   - POST https://api.telnyx.com/v2/messages
//   - Auth: Authorization: Bearer ${TELNYX_API_KEY}
//   - Body: { from, to, text, messaging_profile_id? }
//   - 200 response: { data: { id, to: [{ status }], ... } }
//   - Status "queued" = accepted into Telnyx's pipeline; delivery status
//     comes asynchronously via webhook (we'll wire that in a follow-up).
//
// Env-driven provider selection (lock 2026-05-13):
//   - SMS_PROVIDER='telnyx' (or unset; Telnyx is the default when API key
//     is present) → real send via Telnyx
//   - SMS_PROVIDER='stub' → no-op log only (dev path; read otp_codes row
//     to read the code)
//   - SMS_PROVIDER='disabled' → reject sends explicitly

interface SendOtpResult {
  ok: boolean;
  provider_message_id?: string;
  /** Provider-side status (e.g. "queued"). Set on success. */
  provider_status?: string;
  /** Error code for our internal taxonomy. Set on failure. */
  error_code?: "auth" | "invalid_number" | "rate_limit" | "provider_error" | "network" | "config";
  /** Free-form detail safe to log (no secrets). */
  detail?: string;
}

function buildOtpMessageText(code: string): string {
  // Keep under 160 chars to stay one SMS segment (cheaper + delivers faster).
  // 10DLC OTP/transactional messages are exempt from STOP-handling reminders
  // per Telnyx's compliance docs, so we skip "Reply STOP" to keep length short.
  return `Jeff's Automotive: Your verification code is ${code}. Expires in 5 minutes. Don't share this code.`;
}

async function sendViaTelnyx(
  phoneE164: string,
  code: string,
): Promise<SendOtpResult> {
  const apiKey = Deno.env.get("TELNYX_API_KEY");
  const fromNumber = Deno.env.get("TELNYX_FROM_NUMBER");
  const messagingProfileId = Deno.env.get("TELNYX_MESSAGING_PROFILE_ID"); // optional

  if (!apiKey) {
    return {
      ok: false,
      error_code: "config",
      detail: "TELNYX_API_KEY missing in edge secrets",
    };
  }
  if (!fromNumber) {
    return {
      ok: false,
      error_code: "config",
      detail: "TELNYX_FROM_NUMBER missing in edge secrets",
    };
  }

  const body: Record<string, unknown> = {
    from: fromNumber,
    to: phoneE164,
    text: buildOtpMessageText(code),
  };
  if (messagingProfileId) body.messaging_profile_id = messagingProfileId;

  let res: Response;
  try {
    res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000), // hard 15s cap; Telnyx normally ~300ms
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error_code: "network", detail: msg.slice(0, 200) };
  }

  // Read once; non-200 responses include errors[] per Telnyx's standard envelope.
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    const errorCode: SendOtpResult["error_code"] =
      res.status === 401 || res.status === 403
        ? "auth"
        : res.status === 422
          ? "invalid_number"
          : res.status === 429
            ? "rate_limit"
            : "provider_error";
    return {
      ok: false,
      error_code: errorCode,
      detail: `telnyx HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`,
    };
  }

  const payload = json as {
    data?: { id?: string; to?: Array<{ status?: string }> };
  };
  const providerMessageId = payload.data?.id;
  const providerStatus = payload.data?.to?.[0]?.status ?? "queued";

  console.log(
    JSON.stringify({
      level: "info",
      msg: "send_otp_telnyx_ok",
      provider_message_id: providerMessageId,
      provider_status: providerStatus,
      to_last_four: phoneE164.slice(-4),
    }),
  );

  return {
    ok: true,
    provider_message_id: providerMessageId,
    provider_status: providerStatus,
  };
}

/**
 * Dispatch the OTP to the configured SMS provider.
 *
 * Selection: explicit `SMS_PROVIDER` env wins; otherwise we auto-detect
 * (TELNYX_API_KEY present → telnyx; else stub).
 */
async function sendOtpViaSmsProvider(
  phoneE164: string,
  code: string,
): Promise<SendOtpResult> {
  const explicit = Deno.env.get("SMS_PROVIDER")?.toLowerCase();
  const hasTelnyx = !!Deno.env.get("TELNYX_API_KEY");
  const provider = explicit ?? (hasTelnyx ? "telnyx" : "stub");

  if (provider === "stub") {
    console.log(
      JSON.stringify({
        level: "warning",
        msg: "send_otp_stub",
        note:
          "SMS_PROVIDER=stub — no real send. Read otp_codes row to retrieve code.",
        to_last_four: phoneE164.slice(-4),
      }),
    );
    return { ok: true, provider_message_id: "stub-no-send" };
  }

  if (provider === "disabled") {
    return {
      ok: false,
      error_code: "config",
      detail: "SMS_PROVIDER=disabled",
    };
  }

  if (provider === "telnyx") {
    return sendViaTelnyx(phoneE164, code);
  }

  return {
    ok: false,
    error_code: "config",
    detail: `unknown_sms_provider: ${provider}`,
  };
}

// ─── Tool functions ──────────────────────────────────────────────────────────

/**
 * Generate a 6-digit OTP, hash it, store in otp_codes, and send via SMS.
 *
 * Rate-limit: counts non-consumed otp_codes for this phone created in the
 * last hour; if ≥ MAX_ACTIVE_CODES_PER_HOUR, returns
 * { ok: false, error: 'rate_limited' } without inserting OR sending.
 */
export async function sendOtp(
  sb: SupabaseClient,
  shopId: number,
  args: { phone_e164: string; ip_addr?: string },
): Promise<
  | { ok: true; ttl_seconds: number; phone_last_four: string }
  | { ok: false; error: "rate_limited" | "send_failed"; detail?: string }
> {
  const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
  const { data: recent } = await sb
    .from("otp_codes")
    .select("id")
    .eq("shop_id", shopId)
    .eq("phone_e164", args.phone_e164)
    .is("consumed_at", null)
    .gte("created_at", oneHourAgo);
  if ((recent?.length ?? 0) >= MAX_ACTIVE_CODES_PER_HOUR) {
    return { ok: false, error: "rate_limited" };
  }

  const code = generateOtp();
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
    //   MAX_ACTIVE_CODES_PER_HOUR=3 attempts.
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
 *   - { verified: true } — single-use; row marked consumed_at.
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
  args: { phone_e164: string; code: string },
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
