// telnyx-client — shared Telnyx SMS transport (revamp Phase 2).
//
// Extracted 2026-07-02 from _shared/tools/scheduler-otp.ts (sendViaTelnyx)
// so the confirmation/reminder senders share ONE transport with the OTP
// path. Behavior-preserving: same endpoint, auth, status mapping, 15s cap.
//
// Telnyx Messaging API per https://developers.telnyx.com/api-reference/messages
//   - POST https://api.telnyx.com/v2/messages
//   - Auth: Authorization: Bearer ${TELNYX_API_KEY}
//   - Body: { from, to, text, messaging_profile_id? }
//   - 200 response: { data: { id, to: [{ status }], ... } }
//   - Status "queued" = accepted into Telnyx's pipeline; delivery status
//     arrives asynchronously via telnyx-webhook (DLR consumer).
//
// Provider selection (lock 2026-05-13; NOTE the auto-detect default):
//   - SMS_PROVIDER='telnyx' → real send
//   - SMS_PROVIDER='stub'   → no-op log only (dev path)
//   - SMS_PROVIDER='disabled' → reject sends explicitly
//   - UNSET → auto-detect: TELNYX_API_KEY present → telnyx (LIVE), else
//     stub. The plan-era "default stub" wording is wrong once the key is
//     set — flipping the key on IS the go-live switch unless SMS_PROVIDER
//     pins otherwise.
//
// Consent: this module is transport-ONLY. Callers own the consent gate —
// confirmation/reminder senders MUST check sms_consents for an active row
// (REVAMP-PLAN §4b P0); the OTP path is exempt (the customer explicitly
// requests the code — its own consent basis). STOP-handling note: 10DLC
// STOP/HELP keywords are processed at the Telnyx account level AND in our
// telnyx-webhook consumer; transactional OTP is NOT exempt from honoring
// a prior STOP at the carrier level (an earlier comment claiming a blanket
// exemption was factually wrong — REVAMP-PLAN §4b).

export interface SmsSendResult {
  ok: boolean;
  provider_message_id?: string;
  /** Provider-side status (e.g. "queued"). Set on success. */
  provider_status?: string;
  /** Error code for our internal taxonomy. Set on failure. */
  error_code?:
    | "auth"
    | "invalid_number"
    | "rate_limit"
    | "provider_error"
    | "network"
    | "config";
  /** Free-form detail safe to log (no secrets). */
  detail?: string;
}

export type SmsProvider = "telnyx" | "stub" | "disabled";

/** Explicit SMS_PROVIDER env wins; else auto-detect by TELNYX_API_KEY. */
export function resolveSmsProvider(): SmsProvider | "unknown" {
  const explicit = Deno.env.get("SMS_PROVIDER")?.toLowerCase();
  const hasTelnyx = !!Deno.env.get("TELNYX_API_KEY");
  const provider = explicit ?? (hasTelnyx ? "telnyx" : "stub");
  if (provider === "telnyx" || provider === "stub" || provider === "disabled") {
    return provider;
  }
  return "unknown";
}

/**
 * Raw Telnyx send. No provider gating, no consent gating — see sendSms
 * for the gated entry point.
 */
export async function sendViaTelnyx(
  phoneE164: string,
  text: string,
): Promise<SmsSendResult> {
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
    text,
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

  // Read once; non-200 responses include errors[] per Telnyx's envelope.
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    const errorCode: SmsSendResult["error_code"] =
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
      msg: "sms_send_telnyx_ok",
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
 * Provider-gated send. `context` labels the stub/disabled log lines so a
 * skipped send is attributable (otp | confirmation | reminder_24h | …).
 */
export async function sendSms(
  phoneE164: string,
  text: string,
  context: string,
): Promise<SmsSendResult> {
  const provider = resolveSmsProvider();

  if (provider === "stub") {
    console.log(
      JSON.stringify({
        level: "warning",
        msg: "sms_send_stub",
        context,
        note: "SMS_PROVIDER=stub — no real send.",
        to_last_four: phoneE164.slice(-4),
      }),
    );
    return { ok: true, provider_message_id: "stub-no-send" };
  }

  if (provider === "disabled") {
    return { ok: false, error_code: "config", detail: "SMS_PROVIDER=disabled" };
  }

  if (provider === "telnyx") {
    return sendViaTelnyx(phoneE164, text);
  }

  return {
    ok: false,
    error_code: "config",
    detail: `unknown_sms_provider: ${Deno.env.get("SMS_PROVIDER")}`,
  };
}
