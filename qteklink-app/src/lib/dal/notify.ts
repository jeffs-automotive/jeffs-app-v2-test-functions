/**
 * Notification DAL — sends QTekLink's plain-text alert emails through the
 * `qteklink-email` edge function (which holds the project's Resend credential;
 * this app authenticates to it with the service-role key, server-to-server).
 *
 * Recipients come from qteklink_settings (the /settings page), configured PER
 * NAMED EMAIL (Chris's spec): the DATE CHANGE ALERT list and the DAY CORRECTION
 * ALERT list — each a comma-separated set of addresses. When a list is empty the
 * send is SKIPPED but never silently: a structured log + a Sentry warning fire so
 * the gap is visible.
 *
 * A failed send NEVER throws into the caller's money path — corrections must not
 * roll back because an email bounced. Failures are captured to Sentry.
 */
import * as Sentry from "@sentry/nextjs";
import { resolveSupabaseUrl, resolveServiceRoleKey } from "@/lib/supabase/resolve-keys";

export interface SendEmailInput {
  to: string[];
  subject: string;
  text: string;
}

/** POST to the qteklink-email edge fn. Returns true on a 2xx. Never throws. */
export async function sendQteklinkEmail(input: SendEmailInput): Promise<boolean> {
  const to = input.to.map((t) => t.trim()).filter((t) => t.length > 0);
  if (to.length === 0) {
    console.log(JSON.stringify({ level: "warning", surface: "qteklink-notify", msg: "no recipients configured — email skipped", subject: input.subject }));
    Sentry.captureMessage("qteklink-notify: notification skipped — no recipients configured (set them on /settings)", "warning");
    return false;
  }
  try {
    const base = resolveSupabaseUrl();
    const key = resolveServiceRoleKey();
    if (!base || !key) {
      Sentry.captureMessage("qteklink-notify: Supabase URL / service key missing — email skipped", "error");
      return false;
    }
    const url = `${base.replace(/\/$/, "")}/functions/v1/qteklink-email`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to, subject: input.subject, text: input.text }),
    });
    if (!res.ok) {
      const body = await res.text();
      Sentry.captureMessage(`qteklink-notify: email send failed (${res.status})`, "error");
      console.error(JSON.stringify({ level: "error", surface: "qteklink-notify", status: res.status, body: body.slice(0, 300), subject: input.subject }));
      return false;
    }
    console.log(JSON.stringify({ level: "info", surface: "qteklink-notify", msg: "email sent", to_count: to.length, subject: input.subject }));
    return true;
  } catch (e) {
    Sentry.captureException(e, { tags: { surface: "qteklink-notify" } });
    return false;
  }
}
