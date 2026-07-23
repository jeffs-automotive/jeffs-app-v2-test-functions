// _shared/tekbridge/alert.ts
//
// Operator alerting for the tekbridge bot session. When the session breaks (the
// refresh chain fails / the bot has no usable token), email the operator so they
// can log the bot back in. De-duped to at most once per ALERT_DEDUP_HOURS via
// tekbridge_session_state.last_alert_at so a persistently-broken session doesn't
// send a fresh email every cron run. Reuses the shared Resend transport
// (from stays alerts@jeffsautomotive.com — see resend-deliverability notes).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendResendEmail } from "../resend-client.ts";

const ALERT_FROM = "alerts@jeffsautomotive.com";
const DEFAULT_RECIPIENT = "chris@jeffsautomotive.com";
const ALERT_DEDUP_HOURS = 12;

export interface BotAlert {
  /** Short human-readable cause (e.g. "The refresh chain broke"). */
  reason: string;
  /** Technical detail (error message) for troubleshooting. */
  detail: string;
}

function alertHtml(reason: string, detail: string): string {
  const recipientAction =
    "Log the <strong>tekbridge</strong> bot into Tekmetric (shop.tekmetric.com), open any repair order " +
    "so the session becomes shop-scoped, then resubmit its token to tekbridge. Once a fresh token is in " +
    "place, the 6-hourly refresh will keep it alive on its own again.";
  return `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px">
      <h2 style="color:#96003C;margin:0 0 8px">⚠️ Tekbridge bot session needs attention</h2>
      <p style="margin:0 0 12px;color:#333">${reason}</p>
      <p style="margin:0 0 12px;color:#333"><strong>What to do:</strong> ${recipientAction}</p>
      <p style="margin:16px 0 4px;color:#666;font-size:13px"><strong>Details for troubleshooting:</strong></p>
      <pre style="background:#f6f6f6;border:1px solid #e2e2e2;border-radius:6px;padding:10px;font-size:12px;white-space:pre-wrap;color:#444">${
        escapeHtml(detail)
      }</pre>
      <p style="margin:16px 0 0;color:#999;font-size:12px">This alert is de-duped to at most once every ${ALERT_DEDUP_HOURS} hours.</p>
    </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Email the operator about a broken bot session, de-duped via last_alert_at.
 * Never throws — a failed alert must not mask the underlying error; it's logged
 * and reported via the caller's Sentry scope. Returns whether an email was sent.
 */
export async function sendBotSessionAlert(
  sb: SupabaseClient,
  shopId: number,
  alert: BotAlert,
): Promise<{ emailed: boolean; reason?: string }> {
  const recipient = Deno.env.get("TEKBRIDGE_ALERT_EMAIL") ?? DEFAULT_RECIPIENT;

  // De-dup: skip if we already alerted within the window.
  const { data, error } = await sb
    .from("tekbridge_session_state")
    .select("last_alert_at")
    .eq("shop_id", shopId)
    .maybeSingle();
  if (error) {
    console.error(`tekbridge alert: dedup read failed (proceeding): ${error.message}`);
  }
  const lastAlertMs = data?.last_alert_at ? new Date(data.last_alert_at as string).getTime() : 0;
  if (lastAlertMs && Date.now() - lastAlertMs < ALERT_DEDUP_HOURS * 3_600_000) {
    return { emailed: false, reason: "deduped" };
  }

  const res = await sendResendEmail({
    from: ALERT_FROM,
    to: recipient,
    subject: "⚠️ Tekbridge bot session needs attention",
    html: alertHtml(alert.reason, alert.detail),
  });
  if (!res.ok) {
    console.error(`tekbridge alert: email send failed: ${res.error}`);
    return { emailed: false, reason: res.error };
  }

  const { error: stampErr } = await sb
    .from("tekbridge_session_state")
    .upsert(
      { shop_id: shopId, last_alert_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "shop_id" },
    );
  if (stampErr) {
    console.error(`tekbridge alert: last_alert_at stamp failed: ${stampErr.message}`);
  }
  return { emailed: true };
}

/**
 * Clear the alert de-dup stamp after a successful refresh, so the NEXT failure
 * alerts immediately (rather than being suppressed by a stale window).
 */
export async function clearBotAlert(sb: SupabaseClient, shopId: number): Promise<void> {
  const { error } = await sb
    .from("tekbridge_session_state")
    .update({ last_alert_at: null })
    .eq("shop_id", shopId);
  if (error) {
    console.error(`tekbridge alert: clear stamp failed: ${error.message}`);
  }
}
