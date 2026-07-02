/**
 * Service-staff email notification after a successful Tekmetric POST
 * confirmation. Phase 12 2026-05-16.
 *
 * Per Chris's 2026-05-16 spec: every chat-driven appointment fires an
 * email to the service-staff inbox with:
 *   - Customer name + phone + email
 *   - Vehicle (year/make/model/plate)
 *   - Date/time + Wait vs Drop off
 *   - Services + concerns (from the appointment description)
 *   - Customer notes (Phase 13 will append these to the description; for
 *     Phase 12 launch they're empty)
 *   - Vehicle notes (from new_vehicle_info if present)
 *   - Direct link to the appointment in Tekmetric:
 *     https://shop.tekmetric.com/admin/shop/7476/appointments/<id>
 *
 * Triggered fire-and-forget from `submit-summary.ts` after confirmBooking
 * succeeds. Failure to send the email does NOT block the customer's
 * confirmation experience — it's an internal-only notification; the
 * customer's booking is already live in Tekmetric.
 *
 * Reads RESEND_API_KEY + SCHEDULER_STAFF_EMAIL_TO + SCHEDULER_STAFF_EMAIL_FROM
 * from process.env. Missing env vars cause a single console.warn (not
 * thrown) so the customer flow continues unaffected.
 */
import * as Sentry from "@sentry/nextjs";
import { Resend } from "resend";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const TEKMETRIC_ADMIN_URL_BASE =
  "https://shop.tekmetric.com/admin/shop/7476/appointments/";

export interface StaffNotificationArgs {
  chatId: string;
  appointmentId: number;
  startsAtIso: string;
  /** Type slug (B4 2026-07-02: DB-driven — no longer a closed union). */
  appointmentType: string;
  /** Short display label from scheduler_appointment_types ("Wait", "Drop-off"). */
  appointmentTypeLabel: string;
  /** Title sent to Tekmetric (already includes [TM] + slot tag). */
  title: string;
  /** Description sent to Tekmetric (services + concerns). */
  description: string;
}

export async function notifyStaffOfNewAppointment(
  args: StaffNotificationArgs,
): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const toEnv = process.env.SCHEDULER_STAFF_EMAIL_TO;
  const fromEnv =
    process.env.SCHEDULER_STAFF_EMAIL_FROM ??
    "scheduler@jeffsautomotive.com";

  if (!apiKey) {
    console.warn(
      JSON.stringify({
        level: "warning",
        msg: "staff_notification_no_resend_api_key",
        appointment_id: args.appointmentId,
      }),
    );
    return { sent: false, reason: "no_resend_api_key" };
  }
  if (!toEnv) {
    console.warn(
      JSON.stringify({
        level: "warning",
        msg: "staff_notification_no_to_address",
        appointment_id: args.appointmentId,
      }),
    );
    return { sent: false, reason: "no_to_address" };
  }

  try {
    // Pull the customer/vehicle row context for the email body.
    const supabase = createSupabaseAdminClient();
    const { data: rowRaw } = await supabase
      .from("customer_chat_sessions")
      .select("*")
      .eq("id", args.chatId)
      .maybeSingle();
    const row = (rowRaw ?? {}) as Record<string, unknown>;

    const first =
      (row.verified_first_name as string | null) ??
      (row.entered_first_name as string | null) ??
      "(unknown)";
    const last =
      (row.verified_last_name as string | null) ??
      (row.entered_last_name as string | null) ??
      "";
    const customerName = [first, last].filter(Boolean).join(" ").trim();

    const phone = (row.phone_e164 as string | null) ?? "(no phone on file)";
    const primaryEmail =
      (row.primary_email_for_description as string | null) ??
      extractPrimaryEmail(row.edited_emails) ??
      "(no email on file)";

    const nvi = (row.new_vehicle_info ?? {}) as Record<string, unknown>;
    const vehicleParts = [
      nvi.year ? String(nvi.year) : "",
      nvi.make ? String(nvi.make).trim() : "",
      nvi.model ? String(nvi.model).trim() : "",
    ].filter(Boolean);
    const vehicleStr = vehicleParts.join(" ") || "(vehicle TBD)";
    const plate =
      typeof nvi.license_plate === "string" && nvi.license_plate.length > 0
        ? String(nvi.license_plate).trim()
        : "";
    const vehicleNotes =
      typeof nvi.notes === "string" && nvi.notes.length > 0
        ? String(nvi.notes)
        : "";

    const customerNotesText = (row.customer_notes_text as string | null) ?? "";

    const appointmentLink = `${TEKMETRIC_ADMIN_URL_BASE}${args.appointmentId}`;
    const typeDisplay = args.appointmentTypeLabel;

    const subjectPrefix = args.appointmentTypeLabel;
    const subject = `New chat appointment — ${customerName} · ${formatFriendlyDate(args.startsAtIso)} · ${subjectPrefix}`;

    const lines: string[] = [
      `A new appointment was just booked through the online scheduler.`,
      ``,
      `📅 ${formatFriendlyDate(args.startsAtIso)} · ${typeDisplay}`,
      ``,
      `👤 ${customerName}`,
      `📞 ${phone}`,
      `📧 ${primaryEmail}`,
      ``,
      `🚙 ${vehicleStr}${plate ? ` · plate ${plate}` : ""}`,
    ];
    if (vehicleNotes) {
      lines.push(`   Vehicle notes: ${vehicleNotes}`);
    }
    lines.push(``);
    lines.push(`🔧 Services & description:`);
    lines.push(args.description);
    if (customerNotesText) {
      lines.push(``);
      lines.push(`💬 Customer note:`);
      lines.push(customerNotesText);
    }
    lines.push(``);
    lines.push(`Open in Tekmetric: ${appointmentLink}`);
    lines.push(``);
    lines.push(`— scheduler (${args.title})`);

    const text = lines.join("\n");

    // Plain-text email keeps the implementation simple + matches the
    // service-staff workflow (they open Tekmetric directly via the link).
    const resend = new Resend(apiKey);
    const recipients = toEnv.split(",").map((s) => s.trim()).filter(Boolean);
    const result = (await resend.emails.send({
      from: fromEnv,
      to: recipients,
      subject,
      text,
    })) as { error?: unknown };

    if (result.error) {
      const errMsg =
        typeof result.error === "object" && result.error
          ? JSON.stringify(result.error).slice(0, 500)
          : String(result.error);
      console.warn(
        JSON.stringify({
          level: "warning",
          msg: "staff_notification_resend_error",
          appointment_id: args.appointmentId,
          detail: errMsg,
        }),
      );
      Sentry.captureMessage("staff_notification_resend_error", {
        level: "warning",
        extra: { appointment_id: args.appointmentId, detail: errMsg },
      });
      return { sent: false, reason: "resend_error" };
    }

    return { sent: true };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.warn(
      JSON.stringify({
        level: "warning",
        msg: "staff_notification_threw",
        appointment_id: args.appointmentId,
        detail,
      }),
    );
    Sentry.captureException(e, {
      tags: { surface: "staff_notification" },
      level: "warning",
      extra: { appointment_id: args.appointmentId },
    });
    return { sent: false, reason: "exception" };
  }
}

function extractPrimaryEmail(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  for (const entry of raw) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).email === "string"
    ) {
      const e = entry as Record<string, unknown>;
      if (e.is_primary === true) return e.email as string;
    }
  }
  // No primary flag found — return first email if any
  for (const entry of raw) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).email === "string"
    ) {
      return (entry as Record<string, unknown>).email as string;
    }
  }
  return null;
}

function formatFriendlyDate(iso: string): string {
  if (!iso) return "(date TBD)";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });
  } catch {
    return iso;
  }
}
