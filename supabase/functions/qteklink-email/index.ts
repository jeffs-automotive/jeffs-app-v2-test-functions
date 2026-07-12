// qteklink-email — QTekLink's notification sender (service-to-service only).
//
// The qteklink-app (Vercel) has no Resend credential; this tiny function holds the
// project's RESEND_API_KEY and sends plain-text notification emails (day-changed
// alerts, date-move alerts) on the app's behalf.
//
// AUTH: the caller must present `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`
// (constant-time compare). That key never leaves the server side of either system.
//
// Body: { to: string[], subject: string, text: string, html?: string }
//   → 200 {ok:true, id} on send; 4xx on bad input/auth; 502 when Resend rejects
//     (the caller logs + Sentry-captures — a notification failure must be visible,
//     never silently swallowed).
//   `html` is ADDITIVE-only (payroll pay-summary emails, plan 2026-07-12 §5.7):
//   optional pre-rendered HTML passed through to Resend alongside `text`; `text`
//   stays required exactly as before — the four live alert paths send
//   {to, subject, text} and that contract must keep returning 200 unchanged.
//
// From address: QTEKLINK_FROM_EMAIL secret, defaulting to the project's alerts sender.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSentryScope, Sentry } from "../_shared/sentry-edge.ts";
import { bearersEqual } from "../_shared/scheduler-auth.ts";
import { resolveSecretKeyCandidates } from "../_shared/resolve-secret-key.ts";

const FROM_EMAIL =
  Deno.env.get("QTEKLINK_FROM_EMAIL") ?? "QTekLink <alerts@jeffsautomotive.com>";

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "Use POST" });

  // Accept ANY currently-valid secret key (new-format dict/single first, the
  // legacy-named injected var last): the Vercel caller and this function may
  // resolve different forms of the same credential surface, and a key rotation
  // must not break the handshake (audit 2026-06-12).
  const keyCandidates = resolveSecretKeyCandidates();
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (keyCandidates.length === 0 || !resendKey) {
    console.error("qteklink-email: Supabase secret key / RESEND_API_KEY not set");
    return json(500, { error: "Misconfigured" });
  }

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!keyCandidates.some((k) => bearersEqual(bearer, k))) {
    Sentry.captureMessage("qteklink-email: unauthorized call rejected", "warning");
    return json(401, { error: "Unauthorized" });
  }

  let body: { to?: unknown; subject?: unknown; text?: unknown; html?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const to = Array.isArray(body.to) ? body.to.filter((t): t is string => typeof t === "string" && EMAIL_RX.test(t.trim())).map((t) => t.trim()) : [];
  const subject = typeof body.subject === "string" ? body.subject.trim().slice(0, 300) : "";
  const text = typeof body.text === "string" ? body.text.slice(0, 20_000) : "";
  if (to.length === 0 || !subject || !text) {
    return json(400, { error: "to[] (valid emails), subject and text are required" });
  }

  // Optional html (additive — absent/null means plain-text send, exactly as today).
  // When PRESENT it is validated loudly: a caller that meant to send HTML must not
  // silently fall back to text-only, and an oversized body is rejected, not truncated.
  let html: string | null = null;
  if (body.html !== undefined && body.html !== null) {
    if (typeof body.html !== "string" || body.html.length === 0) {
      return json(400, { error: "html, when provided, must be a non-empty string" });
    }
    if (body.html.length > 100_000) {
      return json(400, { error: "html must be at most 100000 characters" });
    }
    html = body.html;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, text, ...(html === null ? {} : { html }) }),
  });
  const resBody = await res.text();
  if (!res.ok) {
    Sentry.captureMessage(`qteklink-email: Resend rejected the send (${res.status})`, "error");
    console.error(JSON.stringify({ level: "error", surface: "qteklink-email", status: res.status, body: resBody.slice(0, 500) }));
    return json(502, { ok: false, error: "send_failed" });
  }
  let id: string | null = null;
  try {
    id = (JSON.parse(resBody) as { id?: string }).id ?? null;
  } catch {
    // non-JSON success body — fine, the 2xx is the contract.
  }
  console.log(JSON.stringify({ level: "info", surface: "qteklink-email", msg: "sent", to_count: to.length, subject, has_html: html !== null }));
  return json(200, { ok: true, id });
}

Deno.serve((req) => withSentryScope(req, "qteklink-email", () => handler(req)));
