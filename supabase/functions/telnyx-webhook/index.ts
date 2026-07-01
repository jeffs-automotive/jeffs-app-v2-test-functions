// telnyx-webhook — durable intake for ALL Telnyx webhook events.
//
// v1 (docs/scheduler/telnyx-webhook-plan-2026-07-01.md): capture + alert only.
//   - TODAY this URL sits in the 10DLC CAMPAIGN webhook slot → Telnyx sends
//     provisioning/status events here (campaign approval, number assignment,
//     campaign suspension). NOT customer traffic.
//   - REVAMP PHASE 2 points the MESSAGING PROFILE webhook at the same URL →
//     inbound messages (customer replies, STOP/HELP) + delivery receipts land
//     here too. The consent-ledger/DLR consumer is deliberately NOT built yet
//     (needs the sms_consents schema); every event is durably stored so nothing
//     is lost in the meantime.
//
// Contract (qteklink-webhook template): store, THEN 200. A duplicate/replay
// (unique 23505 on data.id) is a 200, NOT a failure. 5xx ONLY when we genuinely
// can't store, so Telnyx retries (3 attempts + failover; ~2 s response budget —
// this handler does one INSERT).
//
// Auth, layered:
//   1. `?token=` URL secret vs TELNYX_WEBHOOK_TOKEN — the hard gate, constant-
//      time compare. Fail-closed: unset secret → 500; mismatch → 401.
//   2. Ed25519 signature verify-if-present: Telnyx signs
//      `{telnyx-timestamp}|{raw_body}` (headers telnyx-signature-ed25519 /
//      telnyx-timestamp; account public key from Mission Control → Keys &
//      Credentials). When TELNYX_PUBLIC_KEY is set AND both headers are
//      present, a FAILED verify → 401 (active forgery signal — not stored).
//      Absent headers → accepted on the token gate alone, stored with
//      signature_verified=false (10DLC provisioning deliveries are not
//      documented as guaranteed-signed). Phase 2 flips message.* to
//      require-signed before real SMS traffic.
//
// payload carries phone-number PII → it lands ONLY in the service_role-only
// telnyx_webhook_events table; logs carry ids/types only, and Sentry events are
// scrubbed by withSentryScope's beforeSend.
//
// References: supabase/functions/qteklink-webhook/index.ts (pattern template),
//   migration 20260701232000_telnyx_webhook_events.sql,
//   developers.telnyx.com/docs/messaging/messages/receiving-webhooks,
//   .claude/rules/observability.md.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { withSentryScope, Sentry } from "../_shared/sentry-edge.ts";
import { bearersEqual } from "../_shared/scheduler-auth.ts";
import { resolveSecretKey } from "../_shared/resolve-secret-key.ts";

// test seam — lazily-initialized service-role client (see index.test.ts).
let sb: SupabaseClient | null = null;
function getSb(): SupabaseClient {
  if (sb === null) {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SECRET_KEY = resolveSecretKey();
    if (!SECRET_KEY) throw new Error("telnyx-webhook: no Supabase secret key configured");
    sb = createClient(SUPABASE_URL, SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return sb;
}
export function _setSupabaseClientForTesting(client: unknown): void {
  sb = client as SupabaseClient;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Ed25519 signature verification ─────────────────────────────────────────
// Telnyx signs base64(ed25519_sign(`${telnyx-timestamp}|${raw_body}`)) with the
// account keypair; the portal exposes the base64 raw 32-byte public key.
// Replay of a validly-signed delivery is handled by the data.id dedup, so no
// timestamp-freshness window is enforced here (the store is idempotent).
function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function verifyTelnyxSignature(
  publicKeyB64: string,
  signatureB64: string,
  timestamp: string,
  rawBody: string,
): Promise<boolean> {
  try {
    const publicKey = b64ToBytes(publicKeyB64);
    const signature = b64ToBytes(signatureB64);
    const key = await crypto.subtle.importKey("raw", publicKey, { name: "Ed25519" }, false, [
      "verify",
    ]);
    const message = new TextEncoder().encode(`${timestamp}|${rawBody}`);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, signature, message);
  } catch {
    // Malformed key/signature/base64 → treat as verification failure.
    return false;
  }
}

// ─── Extraction ──────────────────────────────────────────────────────────────
// Telnyx envelope: { data: { id, event_type, occurred_at, payload, record_type },
// meta: { attempt, delivered_to } }. Unknown shapes still get stored (nulls).
export interface ExtractedTelnyxEvent {
  telnyxEventId: string | null;
  eventType: string;
  occurredAt: string | null; // ISO or null
}

export function extractTelnyxEvent(body: Record<string, unknown>): ExtractedTelnyxEvent {
  const data = (body?.data ?? null) as Record<string, unknown> | null;
  const id = data && (typeof data.id === "string" || typeof data.id === "number")
    ? String(data.id)
    : null;
  const eventType = data && typeof data.event_type === "string" && data.event_type.length
    ? data.event_type
    : "unknown";
  let occurredAt: string | null = null;
  if (data && typeof data.occurred_at === "string") {
    const t = Date.parse(data.occurred_at);
    occurredAt = Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return { telnyxEventId: id, eventType, occurredAt };
}

// Event types that must never pass silently — a suspended/deactivated campaign
// means carrier delivery is dying while the app looks healthy.
const ALERT_EVENT_RE = /suspend|deactivat/i;
export function isAlertEvent(eventType: string): boolean {
  return ALERT_EVENT_RE.test(eventType);
}

// ─── Redaction (qteklink-webhook conventions) ────────────────────────────────
// The telnyx-signature-ed25519/telnyx-timestamp headers are deliberately KEPT —
// they are public-key-verifiable material, useful for re-verification.
const HEADER_DENYLIST = new Set([
  "authorization", "cookie", "set-cookie", "x-api-key", "apikey",
  "proxy-authorization", "forwarded", "referer",
  "x-real-ip", "x-forwarded-for", "x-original-forwarded-for", "cf-connecting-ip",
  "true-client-ip", "x-client-ip", "x-cluster-client-ip", "fastly-client-ip",
]);
function safeHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of req.headers.entries()) {
    if (HEADER_DENYLIST.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}
function safeQueryString(url: URL): string | null {
  const params = new URLSearchParams(url.search);
  for (const key of [...params.keys()]) {
    if (key.toLowerCase() === "token") params.delete(key);
  }
  const s = params.toString();
  return s.length ? s : null;
}

// ─── Entrypoint (exported test seam) ─────────────────────────────────────────
export async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "Use POST" });

  // Gate 1 — URL token (Telnyx sends no custom headers; the URL is the surface).
  const WEBHOOK_TOKEN = Deno.env.get("TELNYX_WEBHOOK_TOKEN");
  if (!WEBHOOK_TOKEN) {
    console.error("telnyx-webhook: TELNYX_WEBHOOK_TOKEN is not set");
    return json(500, { error: "Misconfigured" });
  }
  const url = new URL(req.url);
  if (!bearersEqual(url.searchParams.get("token") ?? "", WEBHOOK_TOKEN)) {
    Sentry.withScope((scope) => {
      scope.setLevel("warning");
      scope.setTag("event", "signature_fail");
      scope.setFingerprint(["webhook-sig-fail", "telnyx", "/functions/v1/telnyx-webhook"]);
      scope.setContext("request", {
        ip: req.headers.get("x-real-ip") ?? req.headers.get("cf-connecting-ip") ?? "unknown",
        user_agent: req.headers.get("user-agent") ?? "unknown",
        url: req.url,
        method: req.method,
      });
      Sentry.captureMessage("Telnyx webhook token check failed", "warning");
    });
    return json(401, { error: "Unauthorized" });
  }

  // Read text first so a parse failure can still be recorded.
  const rawText = await req.text();

  // Gate 2 — Ed25519 verify-if-present (see header comment for the policy).
  const publicKeyB64 = Deno.env.get("TELNYX_PUBLIC_KEY");
  const sigHeader = req.headers.get("telnyx-signature-ed25519");
  const tsHeader = req.headers.get("telnyx-timestamp");
  let signatureVerified = false;
  if (publicKeyB64 && sigHeader && tsHeader) {
    signatureVerified = await verifyTelnyxSignature(publicKeyB64, sigHeader, tsHeader, rawText);
    if (!signatureVerified) {
      // A PRESENT-but-invalid signature is an active forgery signal — reject,
      // don't store (unlike absent headers, which pass on the token gate).
      Sentry.withScope((scope) => {
        scope.setLevel("warning");
        scope.setTag("event", "signature_fail");
        scope.setFingerprint(["webhook-ed25519-fail", "telnyx", "/functions/v1/telnyx-webhook"]);
        Sentry.captureMessage("Telnyx webhook Ed25519 verification failed", "warning");
      });
      return json(401, { error: "Invalid signature" });
    }
  }

  let body: Record<string, unknown> = {};
  let parseError: string | null = null;
  try {
    body = rawText.length ? JSON.parse(rawText) : {};
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }

  const ev = extractTelnyxEvent(body);

  const insertRow = {
    telnyx_event_id: ev.telnyxEventId,
    event_type: parseError ? "unparseable" : ev.eventType,
    occurred_at: ev.occurredAt,
    signature_verified: signatureVerified,
    // shop_id stays NULL in v1 — Telnyx events are account-scoped (no shop
    // claim in the payload); a number→shop map resolves this when a second
    // shop onboards. Never hardcoded (shop-agnostic.md).
    shop_id: null,
    // PII lives only here (service_role-only table). On a parse failure keep a
    // bounded raw snippet so we can diagnose without trusting the JSON shape.
    payload: parseError ? { _parse_error: parseError, _raw_text: rawText.slice(0, 8192) } : body,
    raw_headers: safeHeaders(req),
    raw_query_string: safeQueryString(url),
  };

  // DURABLE-then-200: insert FIRST, catch the dedup. NEVER .upsert({onConflict})
  // — PostgREST can't infer the PARTIAL unique index's predicate (42P10).
  const { data: inserted, error: insertErr } = await getSb()
    .from("telnyx_webhook_events")
    .insert(insertRow)
    .select("id")
    .maybeSingle();

  if (insertErr) {
    if (insertErr.code === "23505") {
      // Redelivery of an already-stored event — 200 so Telnyx stops retrying.
      console.log(JSON.stringify({
        level: "info", surface: "telnyx-webhook", msg: "duplicate event ignored",
        telnyx_event_id: ev.telnyxEventId, event_type: ev.eventType,
      }));
      return json(200, { ok: true, stored: false, duplicate: true, event_type: ev.eventType });
    }
    // Genuine store failure — NOT persisted. Capture + 5xx so Telnyx retries
    // (the durable-before-200 contract; no silent drop).
    Sentry.captureException(
      new Error(`telnyx-webhook: insert failed (${insertErr.code}): ${insertErr.message}`),
    );
    return json(503, { ok: false, stored: false, error: "store_failed" });
  }

  // Post-store alerting: campaign suspension/deactivation must never be silent
  // — carrier delivery dies while the app looks healthy. (After the durable
  // store so an alerting hiccup can never cost us the event.)
  if (isAlertEvent(ev.eventType)) {
    Sentry.withScope((scope) => {
      scope.setLevel("warning");
      scope.setTag("event", "telnyx_campaign_alert");
      scope.setTag("telnyx_event_type", ev.eventType);
      Sentry.captureMessage(`Telnyx alert event received: ${ev.eventType}`, "warning");
    });
  }

  console.log(JSON.stringify({
    level: "info", surface: "telnyx-webhook", msg: "event stored",
    telnyx_event_id: ev.telnyxEventId, event_type: insertRow.event_type,
    signature_verified: signatureVerified,
  }));
  return json(200, { ok: true, stored: true, id: inserted?.id ?? null, event_type: insertRow.event_type });
}

// Production: per-request Sentry isolation scope + PII scrub + flush.
Deno.serve((req) => withSentryScope(req, "telnyx-webhook", () => handler(req)));
