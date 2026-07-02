// telnyx-webhook consumers — inbound STOP/HELP + delivery receipts
// (revamp Phase 2, 2026-07-02).
//
// Runs AFTER the durable firehose store (index.ts): a consumer failure can
// never cost us the event — it's logged via logEdgeError and the handler
// still 200s (the stored row allows reprocessing). Consumers therefore
// NEVER throw.
//
// Consent semantics (REVAMP-PLAN §4b + CTIA):
//   - STOP-family keywords revoke the active sms_consents row(s) for the
//     sender's phone. STOP acts EVEN ON UNSIGNED deliveries: a spoofed
//     STOP only stops us from texting someone — fail toward not-sending.
//   - START-family keywords re-grant ONLY when the delivery is Ed25519
//     signature_verified (a spoofed re-grant must be impossible), and only
//     when a prior revoked consent exists for the phone (START restores a
//     previous opt-in; it cannot mint consent from nothing).
//   - HELP-family keywords are logged only — the Telnyx campaign
//     auto-responder owns the HELP reply.
//
// DLR semantics: message.sent / message.finalized update the sms_messages
// row by telnyx_message_id (queued → sent → delivered|failed).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { logEdgeError } from "../_shared/log-edge-error.ts";

const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_KEYWORDS = new Set(["START", "YES", "UNSTOP"]);
const HELP_KEYWORDS = new Set(["HELP", "INFO"]);

export type InboundKeyword = "stop" | "start" | "help" | null;

/** CTIA keyword match: exact single word (case/whitespace-insensitive),
 *  tolerating trailing punctuation ("STOP." / "Stop!"). Longer sentences
 *  containing the word do NOT match (per CTIA single-keyword semantics —
 *  Telnyx's own account-level handler applies the same rule). */
export function classifyInboundKeyword(text: string | null | undefined): InboundKeyword {
  if (!text) return null;
  const normalized = text.trim().toUpperCase().replace(/[.!?,;:]+$/, "");
  if (STOP_KEYWORDS.has(normalized)) return "stop";
  if (START_KEYWORDS.has(normalized)) return "start";
  if (HELP_KEYWORDS.has(normalized)) return "help";
  return null;
}

interface TelnyxMessagePayload {
  id?: string;
  direction?: string;
  text?: string;
  from?: { phone_number?: string };
  to?: Array<{ phone_number?: string; status?: string }>;
  errors?: Array<{ code?: string; title?: string; detail?: string }>;
}

export function extractMessagePayload(body: Record<string, unknown>): TelnyxMessagePayload | null {
  const data = (body?.data ?? null) as Record<string, unknown> | null;
  const payload = (data?.payload ?? null) as TelnyxMessagePayload | null;
  return payload && typeof payload === "object" ? payload : null;
}

/**
 * Process a stored message.* event. Never throws.
 */
export async function processMessageEvent(args: {
  sb: SupabaseClient;
  eventType: string;
  body: Record<string, unknown>;
  signatureVerified: boolean;
}): Promise<void> {
  const { sb, eventType, body, signatureVerified } = args;
  try {
    const payload = extractMessagePayload(body);
    if (!payload) return;

    if (eventType === "message.received") {
      await handleInbound(sb, payload, signatureVerified);
      return;
    }
    if (eventType === "message.sent" || eventType === "message.finalized") {
      await handleDeliveryReceipt(sb, eventType, payload);
      return;
    }
  } catch (e) {
    // Consumers never throw — the event is durably stored for reprocessing.
    await logEdgeError(sb, {
      surface: "telnyx-webhook/consumer",
      origin_id: "telnyx-webhook",
      level: "error",
      error_code: "consumer_unhandled",
      message: e instanceof Error ? e.message : String(e),
      context: { event_type: eventType },
    });
  }
}

async function handleInbound(
  sb: SupabaseClient,
  payload: TelnyxMessagePayload,
  signatureVerified: boolean,
): Promise<void> {
  const phone = payload.from?.phone_number ?? null;
  if (!phone) return;
  const keyword = classifyInboundKeyword(payload.text);

  // Ledger the inbound message (dedup on telnyx_message_id; 23505 = replay).
  const { error: insertErr } = await sb.from("sms_messages").insert({
    shop_id: 7476, // single-tenant today; number→shop map is the multi-shop follow-up
    direction: "inbound",
    phone_e164: phone,
    kind: "inbound",
    body: (payload.text ?? "").slice(0, 1000),
    telnyx_message_id: payload.id ?? null,
    status: "received",
  });
  if (insertErr && insertErr.code !== "23505") {
    await logEdgeError(sb, {
      surface: "telnyx-webhook/inbound_ledger",
      origin_id: "telnyx-webhook",
      level: "error",
      error_code: "sms_messages_insert_failed",
      message: insertErr.message,
      context: { phone_last_four: phone.slice(-4) },
    });
  }

  if (keyword === "stop") {
    // Revoke EVERY active consent for this phone (no shop filter — STOP
    // means stop; acting on an unsigned delivery is the safe direction).
    const { data: revoked, error: revokeErr } = await sb
      .from("sms_consents")
      .update({ revoked_at: new Date().toISOString(), revoke_source: "sms_stop" })
      .eq("phone_e164", phone)
      .is("revoked_at", null)
      .select("id");
    if (revokeErr) {
      await logEdgeError(sb, {
        surface: "telnyx-webhook/stop_revoke",
        origin_id: "telnyx-webhook",
        level: "error",
        error_code: "consent_revoke_failed",
        message: revokeErr.message,
        context: { phone_last_four: phone.slice(-4) },
      });
    } else {
      console.log(JSON.stringify({
        level: "info", surface: "telnyx-webhook", msg: "stop_processed",
        revoked_count: revoked?.length ?? 0, phone_last_four: phone.slice(-4),
      }));
    }
    return;
  }

  if (keyword === "start") {
    if (!signatureVerified) {
      // A spoofed re-grant must be impossible — unsigned START is ignored
      // (logged for visibility; the customer can re-consent in the wizard).
      console.log(JSON.stringify({
        level: "warning", surface: "telnyx-webhook", msg: "start_ignored_unsigned",
        phone_last_four: phone.slice(-4),
      }));
      return;
    }
    // START restores a PRIOR opt-in: find the most recent revoked consent.
    const { data: prior, error: priorErr } = await sb
      .from("sms_consents")
      .select("shop_id")
      .eq("phone_e164", phone)
      .not("revoked_at", "is", null)
      .order("granted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (priorErr) {
      await logEdgeError(sb, {
        surface: "telnyx-webhook/start_lookup",
        origin_id: "telnyx-webhook",
        level: "error",
        error_code: "consent_lookup_failed",
        message: priorErr.message,
        context: { phone_last_four: phone.slice(-4) },
      });
      return;
    }
    if (!prior) return; // never consented before — nothing to restore
    const { error: grantErr } = await sb.from("sms_consents").insert({
      shop_id: prior.shop_id,
      phone_e164: phone,
      cta_text: "Customer texted START/UNSTOP to re-enable appointment texts (signed Telnyx inbound).",
      cta_version: "sms-start-v1",
      acquisition_medium: "sms_start",
    });
    if (grantErr && grantErr.code !== "23505") {
      await logEdgeError(sb, {
        surface: "telnyx-webhook/start_regrant",
        origin_id: "telnyx-webhook",
        level: "error",
        error_code: "consent_regrant_failed",
        message: grantErr.message,
        context: { phone_last_four: phone.slice(-4) },
      });
    }
    return;
  }

  // help / null → ledgered above; the campaign auto-responder owns replies.
}

async function handleDeliveryReceipt(
  sb: SupabaseClient,
  eventType: string,
  payload: TelnyxMessagePayload,
): Promise<void> {
  const telnyxId = payload.id;
  if (!telnyxId) return;
  const toStatus = payload.to?.[0]?.status ?? null;
  const failed = toStatus === "delivery_failed" || toStatus === "sending_failed" ||
    (payload.errors?.length ?? 0) > 0;
  const status = eventType === "message.sent"
    ? "sent"
    : failed
      ? "failed"
      : "delivered";
  const detail = failed
    ? (payload.errors?.map((e) => `${e.code ?? ""} ${e.title ?? ""}`).join("; ") ||
      toStatus || "failed")
    : toStatus;

  const { error } = await sb
    .from("sms_messages")
    .update({
      status,
      status_detail: detail,
      updated_at: new Date().toISOString(),
    })
    .eq("telnyx_message_id", telnyxId);
  if (error) {
    await logEdgeError(sb, {
      surface: "telnyx-webhook/dlr",
      origin_id: "telnyx-webhook",
      level: "error",
      error_code: "sms_messages_dlr_update_failed",
      message: error.message,
      context: { telnyx_message_id: telnyxId, event_type: eventType },
    });
  }
}
