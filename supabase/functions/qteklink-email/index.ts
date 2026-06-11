// qteklink-email — QTekLink's notification sender (service-to-service only).
//
// The qteklink-app (Vercel) has no Resend credential; this tiny function holds the
// project's RESEND_API_KEY and sends plain-text notification emails (day-changed
// alerts, date-move alerts) on the app's behalf.
//
// AUTH: the caller must present `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`
// (constant-time compare). That key never leaves the server side of either system.
//
// Body: { to: string[], subject: string, text: string }
//   → 200 {ok:true, id} on send; 4xx on bad input/auth; 502 when Resend rejects
//     (the caller logs + Sentry-captures — a notification failure must be visible,
//     never silently swallowed).
//
// From address: QTEKLINK_FROM_EMAIL secret, defaulting to the project's alerts sender.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSentryScope, Sentry } from "../_shared/sentry-edge.ts";
import { bearersEqual } from "../_shared/scheduler-auth.ts";

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

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!serviceKey || !resendKey) {
    console.error("qteklink-email: SUPABASE_SERVICE_ROLE_KEY / RESEND_API_KEY not set");
    return json(500, { error: "Misconfigured" });
  }

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!bearersEqual(bearer, serviceKey)) {
    Sentry.captureMessage("qteklink-email: unauthorized call rejected", "warning");
    return json(401, { error: "Unauthorized" });
  }

  let body: { to?: unknown; subject?: unknown; text?: unknown };
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

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, text }),
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
  console.log(JSON.stringify({ level: "info", surface: "qteklink-email", msg: "sent", to_count: to.length, subject }));
  return json(200, { ok: true, id });
}

Deno.serve((req) => withSentryScope(req, "qteklink-email", () => handler(req)));
