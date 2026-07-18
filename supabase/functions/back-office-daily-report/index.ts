// back-office-daily-report — the back-office module's daily digest email.
//
// Open issues + a Stale (>48h) section (each with days-open), plus headline counts (open /
// closed-this-month / stale) drawn from the SAME back_office_dashboard_counts RPC the
// in-app Dashboard tab uses. Sent per shop to the digest_emails from the Settings tab, once
// a day (Resend idempotency key per shop-local date). Triggered by pg_cron
// (jobname: back-office-daily-report) via scheduler_invoke_edge_function; scheduler bearer.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { withSentryScope, Sentry } from "../_shared/sentry-edge.ts";
import {
  checkSchedulerBearer,
  unauthorizedResponse,
  RESOLVED_SERVICE_ROLE_KEY,
} from "../_shared/scheduler-auth.ts";
import { sendResendEmail } from "../_shared/resend-client.ts";
import {
  buildBackOfficeDigestData,
  monthStartYmd,
  shopLocalYmd,
  type BackOfficeDigestData,
  type BackOfficeDigestItem,
} from "../_shared/back-office-dashboard-data.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const FROM_EMAIL =
  Deno.env.get("BACK_OFFICE_FROM_EMAIL") ??
  "Jeff's Automotive Back Office <alerts@jeffsautomotive.com>";
const DEFAULT_TZ = "America/New_York";

const BRAND_ACCENT = "#D2B487";
const BG = "#1a1416";
const CARD = "#241c1f";
const TEXT = "#f2e9e4";
const MUTED = "#b8a9a2";
const RULE = "#3a2e30";
const STALE = "#e08a8a";

const sb = createClient(SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const KIND_LABEL: Record<string, string> = {
  invoice_issue: "Invoice issue",
  open_ro: "Open RO",
  reopened_ro: "Reopened RO",
  misc: "Misc",
};
const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  sent_to_sa: "With advisor",
  awaiting_verify: "Awaiting verify",
  verified: "Verified",
};
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function ref(i: BackOfficeDigestItem): string {
  if (i.ro_number) return `RO #${esc(i.ro_number)}`;
  if (i.bill_no) return `#${esc(i.bill_no)}`;
  if (i.title) return esc(i.title);
  return "—";
}

function tile(label: string, value: number, accent = false): string {
  return `<td style="padding:0 6px;width:33%;">
    <div style="background:${BG};border:1px solid ${RULE};border-radius:8px;padding:14px;text-align:center;">
      <div style="color:${accent ? STALE : BRAND_ACCENT};font-size:28px;font-weight:700;line-height:1;">${value}</div>
      <div style="color:${MUTED};font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-top:6px;">${esc(label)}</div>
    </div>
  </td>`;
}

function itemRow(i: BackOfficeDigestItem, showDaysAccent: boolean): string {
  const days = `${i.days_open}d`;
  return `<tr>
    <td style="padding:8px 10px 8px 0;color:${TEXT};font-size:13px;vertical-align:top;white-space:nowrap;">${ref(i)}</td>
    <td style="padding:8px 10px 8px 0;color:${MUTED};font-size:12px;vertical-align:top;white-space:nowrap;">${esc(KIND_LABEL[i.kind] ?? i.kind)}</td>
    <td style="padding:8px 10px 8px 0;color:${TEXT};font-size:12px;vertical-align:top;">${esc(i.vendor_name ?? i.bo_notes ?? "")}</td>
    <td style="padding:8px 10px 8px 0;color:${MUTED};font-size:12px;vertical-align:top;white-space:nowrap;">${esc(STATUS_LABEL[i.status] ?? i.status)}</td>
    <td style="padding:8px 0;color:${showDaysAccent ? STALE : MUTED};font-size:12px;font-weight:${showDaysAccent ? "700" : "400"};vertical-align:top;text-align:right;white-space:nowrap;">${days}</td>
  </tr>`;
}

function section(title: string, items: BackOfficeDigestItem[], emptyMsg: string, staleAccent: boolean): string {
  const header = `<h2 style="color:${TEXT};font-size:15px;font-weight:700;margin:24px 0 8px;">${esc(title)}</h2>`;
  if (items.length === 0) {
    return `${header}<div style="color:${MUTED};font-size:13px;font-style:italic;padding:8px 0;">${esc(emptyMsg)}</div>`;
  }
  return `${header}<table style="width:100%;border-collapse:collapse;border-top:1px solid ${RULE};">${items.map((i) => itemRow(i, staleAccent)).join("")}</table>`;
}

function buildDigestHtml(data: BackOfficeDigestData): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:${BG};">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="border-top:3px solid ${BRAND_ACCENT};background:${CARD};border-radius:0 0 8px 8px;padding:24px;">
      <div style="color:${BRAND_ACCENT};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:14px;">Jeff's Automotive — Back Office digest</div>
      <table style="width:100%;border-collapse:separate;border-spacing:0;"><tr>
        ${tile("Open", data.openCount)}
        ${tile("Closed this month", data.closedThisMonth)}
        ${tile("Stale", data.staleCount, true)}
      </tr></table>
      ${section(`Stale — over 48 hours (${data.staleItems.length})`, data.staleItems, "Nothing stale. Nice.", true)}
      ${section(`All open issues (${data.openItems.length})`, data.openItems, "No open issues.", false)}
    </div>
    <div style="color:${MUTED};font-size:11px;text-align:center;margin-top:16px;">
      Automated daily digest from the Back Office module.
    </div>
  </div>
</body></html>`;
}

function digestRecipients(blob: Record<string, unknown>): string[] {
  const v = blob["digest_emails"];
  const list = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && EMAIL_RX.test(x.trim())).map((x) => x.trim()) : [];
  return [...new Set(list)];
}

Deno.serve((req) =>
  withSentryScope(req, "back-office-daily-report", async () => {
    if (req.method !== "GET" && req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });
    const auth = checkSchedulerBearer(req, "back-office-daily-report");
    if (!auth.ok) return unauthorizedResponse(auth);

    const force = new URL(req.url).searchParams.get("force") === "true";
    const nowMs = Date.now();

    const { data: conns, error: connErr } = await sb.from("qbo_connections").select("shop_id, realm_id");
    if (connErr) {
      Sentry.captureException(connErr, { tags: { surface: "back-office-daily-report" } });
      return json(500, { ok: false, error: "connections_read_failed" });
    }

    const results: Array<Record<string, unknown>> = [];
    for (const c of conns ?? []) {
      const shopId = Number((c as { shop_id: unknown }).shop_id);
      const realmId = String((c as { realm_id: unknown }).realm_id ?? "");
      if (!Number.isInteger(shopId) || shopId <= 0 || !realmId) continue;

      const { data: setRow, error: setErr } = await sb
        .from("qteklink_settings")
        .select("shop_timezone, back_office")
        .eq("shop_id", shopId)
        .eq("realm_id", realmId)
        .limit(1)
        .maybeSingle();
      if (setErr) {
        // A settings-read failure is an error, NOT "no recipients" (observability rule 9).
        Sentry.captureException(setErr, { tags: { surface: "back-office-daily-report", shop_id: String(shopId) } });
        results.push({ shop_id: shopId, error: `settings_read_failed: ${setErr.message}` });
        continue;
      }
      const tz = (setRow?.shop_timezone as string) || DEFAULT_TZ;
      const blob = (setRow?.back_office ?? {}) as Record<string, unknown>;
      const recipients = digestRecipients(blob);
      const staleHours = typeof blob["stale_hours"] === "number" ? (blob["stale_hours"] as number) : 48;

      if (recipients.length === 0) {
        results.push({ shop_id: shopId, skipped: "no_digest_recipients" });
        continue;
      }

      let data: BackOfficeDigestData;
      try {
        data = await buildBackOfficeDigestData(sb, shopId, staleHours, monthStartYmd(tz, nowMs), nowMs);
      } catch (e) {
        Sentry.captureException(e, { tags: { surface: "back-office-daily-report", shop_id: String(shopId) } });
        results.push({ shop_id: shopId, error: e instanceof Error ? e.message : String(e) });
        continue;
      }

      const html = buildDigestHtml(data);
      const subject = `Back Office: ${data.openCount} open, ${data.staleCount} stale`;
      const send = await sendResendEmail({
        from: FROM_EMAIL,
        to: recipients,
        subject,
        html,
        idempotencyKey: force ? undefined : `back-office-daily-report:${shopLocalYmd(tz, nowMs)}:${shopId}`,
      });
      if (!send.ok) {
        Sentry.captureMessage(`back-office-daily-report: send failed (${send.status})`, "error");
      }
      results.push({ shop_id: shopId, ok: send.ok, open: data.openCount, stale: data.staleCount, deduped: send.deduped ?? false });
    }

    return json(200, { ok: true, results });
  }),
);
