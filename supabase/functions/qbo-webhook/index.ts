// qbo-webhook — QuickBooks Online (Intuit) webhook receiver.
//
// Intuit POSTs an `eventNotifications` payload here when a subscribed entity changes
// in the connected QBO company. Each POST carries an `intuit-signature` header.
//
// Signature verification (GOLD SOURCE — Intuit Java SDK WebhooksService.verifyPayload):
//   compute HMAC-SHA256 of the RAW request body using the Webhook Verifier Token as the
//   key, STANDARD Base64-encode it, and string-compare to the `intuit-signature` header.
//
// verify_jwt is false (set in config.toml): Intuit posts an unauthenticated request; the
// signature IS the auth. This app is on-demand (no local mirror / no CDC sync), so the
// receiver verifies + logs + acks 200. It does not persist or sync — if a mirror is added
// later, extend this with a qbo_webhook_events table + a CDC follow-up call.
//
// Secret: QBO_WEBHOOK_VERIFIER_TOKEN (from the Intuit app's Webhooks config). Until it is
// set, the endpoint stays live and acks 200 (so Intuit's setup test passes) but cannot
// verify, so it does not process the payload.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Sentry, withSentryScope } from "../_shared/sentry-edge.ts";

const FUNCTION_NAME = "qbo-webhook";
const enc = new TextEncoder();

/** Standard Base64 (with padding) of bytes — matches Intuit's printBase64Binary. */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Base64(HMAC-SHA256(message, key)) — the QBO intuit-signature algorithm. */
async function hmacSha256Base64(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return bytesToBase64(new Uint8Array(sig));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve((req) =>
  withSentryScope(req, FUNCTION_NAME, async () => {
    // Liveness check for browsers / Intuit dashboard sanity hits.
    if (req.method === "GET") {
      return new Response("QuickBooks webhook endpoint. POST only.", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    if (req.method !== "POST") {
      return json({ ok: false, error: "method_not_allowed" }, 405);
    }

    // The HMAC is over the RAW body exactly as received — read it as text first.
    const rawBody = await req.text();
    const signature = req.headers.get("intuit-signature");
    const verifierToken = Deno.env.get("QBO_WEBHOOK_VERIFIER_TOKEN") ?? "";

    // Not yet configured: stay live + ack so Intuit's endpoint setup test passes, but do
    // NOT process an unverifiable payload.
    if (!verifierToken) {
      console.warn(
        JSON.stringify({
          level: "warn",
          surface: FUNCTION_NAME,
          msg: "QBO_WEBHOOK_VERIFIER_TOKEN not set — acking without verification or processing",
        }),
      );
      return json({ ok: true, verified: false, note: "verifier token not configured" }, 200);
    }

    if (!signature) {
      Sentry.captureMessage("QBO webhook missing intuit-signature header", "warning");
      return json({ ok: false, error: "missing_signature" }, 401);
    }

    const computed = await hmacSha256Base64(verifierToken, rawBody);
    if (computed.length !== signature.length || computed !== signature) {
      Sentry.captureMessage("QBO webhook signature verification failed", "warning");
      return json({ ok: false, error: "invalid_signature" }, 401);
    }

    // Verified. Parse + log a concise summary for troubleshooting (no PII — only entity
    // type/operation/id + realmId). On-demand app: nothing to sync, so we ack.
    let notifications: Array<{
      realmId?: string;
      dataChangeEvent?: { entities?: Array<{ name?: string; id?: string; operation?: string; lastUpdated?: string }> };
    }> = [];
    try {
      notifications = JSON.parse(rawBody)?.eventNotifications ?? [];
    } catch {
      console.warn(JSON.stringify({ level: "warn", surface: FUNCTION_NAME, msg: "verified but unparseable JSON body" }));
      return json({ ok: true, verified: true, received: 0 }, 200);
    }

    const summary = notifications.map((n) => ({
      realmId: n.realmId,
      changes: (n.dataChangeEvent?.entities ?? []).map((e) => `${e.name}:${e.operation}:${e.id}`),
    }));
    console.log(
      JSON.stringify({
        level: "info",
        surface: FUNCTION_NAME,
        msg: "QBO webhook received + verified",
        notification_count: notifications.length,
        notifications: summary,
      }),
    );

    return json({ ok: true, verified: true, received: notifications.length }, 200);
  })
);
