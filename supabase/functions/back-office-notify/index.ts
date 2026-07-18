// back-office-notify — sends the back-office module's per-transition alert emails.
//
// Called service-to-service by BOTH apps' server actions (after a transition RPC
// succeeds) and by the back-office-ro-watch cron (after detect / close). Reads the issue
// row + the recipient lists from qteklink_settings.back_office, renders the HTML via
// _shared/back-office-email.ts, sends via Resend, and stamps the audit row's email result
// through back_office_stamp_email. A send failure is surfaced (Sentry + stamped), never
// silently swallowed — but it returns 200 so a bounced email never rolls back the caller's
// action.
//
// AUTH: Authorization: Bearer <SUPABASE service key> (constant-time compare), same as
// qteklink-email. Body: { shop_id, issue_id, event }.
//
// Env: RESEND_API_KEY (required); BACK_OFFICE_FROM_EMAIL; BACK_OFFICE_QTEKLINK_URL;
//      BACK_OFFICE_ADMIN_URL.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { withSentryScope, Sentry } from "../_shared/sentry-edge.ts";
import { bearersEqual, RESOLVED_SERVICE_ROLE_KEY } from "../_shared/scheduler-auth.ts";
import { resolveSecretKeyCandidates } from "../_shared/resolve-secret-key.ts";
import { sendResendEmail } from "../_shared/resend-client.ts";
import {
  buildNotifyEmail,
  type BackOfficeEvent,
  type BackOfficeIssueSummary,
  type BackOfficeLinks,
} from "../_shared/back-office-email.ts";
import { recipientsFor } from "../_shared/back-office-recipients.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const FROM_EMAIL =
  Deno.env.get("BACK_OFFICE_FROM_EMAIL") ??
  "Jeff's Automotive Back Office <alerts@jeffsautomotive.com>";
const QTEKLINK_URL = (Deno.env.get("BACK_OFFICE_QTEKLINK_URL") ?? "").replace(/\/$/, "");
const ADMIN_URL = (Deno.env.get("BACK_OFFICE_ADMIN_URL") ?? "").replace(/\/$/, "");

const sb = createClient(SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const EVENTS: readonly BackOfficeEvent[] = [
  "detected",
  "ro_closed",
  "sent_to_sa",
  "resent_to_sa",
  "sa_submitted",
  "verified",
];

const KIND_TAB: Record<BackOfficeIssueSummary["kind"], string> = {
  invoice_issue: "invoice-issues",
  open_ro: "open-ros",
  reopened_ro: "reopened-ros",
  misc: "misc",
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function linksFor(issue: BackOfficeIssueSummary): BackOfficeLinks {
  return {
    office: QTEKLINK_URL ? `${QTEKLINK_URL}/back-office/${KIND_TAB[issue.kind]}` : null,
    advisor: ADMIN_URL ? `${ADMIN_URL}/back-office` : null,
  };
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "Use POST" });

  const keyCandidates = resolveSecretKeyCandidates();
  if (keyCandidates.length === 0) {
    console.error("back-office-notify: Supabase secret key not set");
    return json(500, { error: "Misconfigured" });
  }
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!keyCandidates.some((k) => bearersEqual(bearer, k))) {
    Sentry.captureMessage("back-office-notify: unauthorized call rejected", "warning");
    return json(401, { error: "Unauthorized" });
  }

  let body: { shop_id?: unknown; issue_id?: unknown; event?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }
  const shopId = typeof body.shop_id === "number" ? body.shop_id : Number(body.shop_id);
  const issueId = typeof body.issue_id === "string" ? body.issue_id : "";
  const event = body.event as BackOfficeEvent;
  if (!Number.isInteger(shopId) || shopId <= 0 || !issueId || !EVENTS.includes(event)) {
    return json(400, { error: "shop_id (int), issue_id (uuid) and a valid event are required" });
  }

  // Load the issue (shop-scoped).
  const { data: issueRow, error: issueErr } = await sb
    .from("back_office_issues")
    .select("id, kind, status, title, ro_number, vendor_name, bill_no, bill_date, total_cents, qbo_txn_type, bo_notes, sa_notes, context")
    .eq("id", issueId)
    .eq("shop_id", shopId)
    .limit(1)
    .maybeSingle();
  if (issueErr) {
    Sentry.captureException(issueErr, { tags: { surface: "back-office-notify" } });
    return json(500, { ok: false, error: "issue_read_failed" });
  }
  if (!issueRow) return json(404, { ok: false, error: "issue_not_found" });
  const issue = issueRow as unknown as BackOfficeIssueSummary;

  const stampError = async (msg: string | null) => {
    const { error } = await sb.rpc("back_office_stamp_email", {
      p_issue_id: issueId,
      p_action: event,
      p_error: msg,
    });
    if (error) Sentry.captureException(error, { tags: { surface: "back-office-notify", step: "stamp" } });
  };

  // Recipients from the settings blob. A DB read error is NOT "no recipients" — surface it
  // (observability rule 9) so a settings-read failure doesn't silently suppress the alert.
  const { data: settingsRow, error: settingsErr } = await sb
    .from("qteklink_settings")
    .select("back_office")
    .eq("shop_id", shopId)
    .not("back_office", "is", null)
    .limit(1)
    .maybeSingle();
  if (settingsErr) {
    Sentry.captureException(settingsErr, { tags: { surface: "back-office-notify", step: "settings" } });
    await stampError("settings read failed");
    return json(500, { ok: false, error: "settings_read_failed" });
  }
  const blob = (settingsRow?.back_office ?? {}) as Record<string, unknown>;
  const recipients = recipientsFor(event, blob);

  if (recipients.length === 0) {
    console.log(JSON.stringify({ level: "warning", surface: "back-office-notify", msg: "no recipients configured", event, issue_id: issueId }));
    Sentry.captureMessage("back-office-notify: no recipients configured for event (set them on the Settings tab)", "warning");
    await stampError("no recipients configured");
    return json(200, { ok: true, skipped: "no_recipients" });
  }

  const { subject, html } = buildNotifyEmail(event, issue, linksFor(issue));
  const send = await sendResendEmail({ from: FROM_EMAIL, to: recipients, subject, html });

  if (!send.ok) {
    console.error(JSON.stringify({ level: "error", surface: "back-office-notify", event, status: send.status, error: send.error }));
    Sentry.captureMessage(`back-office-notify: Resend send failed (${send.status})`, "error");
    await stampError(send.error ?? `status ${send.status}`);
    // 200 so the caller's action is not rolled back by a bounced email.
    return json(200, { ok: false, error: "send_failed", status: send.status });
  }

  await stampError(null);
  console.log(JSON.stringify({ level: "info", surface: "back-office-notify", msg: "sent", event, to_count: recipients.length, resend_id: send.id ?? null }));
  return json(200, { ok: true, event, to_count: recipients.length, resend_id: send.id ?? null });
}

Deno.serve((req) => withSentryScope(req, "back-office-notify", () => handler(req)));
