"use server";

/**
 * Back-office settings action — admin-only. Edits the alert recipient lists (service
 * advisors, office, accounting, daily digest), the "send to admin" fallback address, and
 * the stale threshold. Whole-blob read-modify-write via the DAL.
 */
import { z } from "zod";
import { requireQtekUser } from "@/lib/auth";
import { wrapQtekAction } from "@/lib/instrument-action";
import { upsertBackOfficeSettings, type BackOfficeSettings } from "@/lib/dal/back-office";
import { emailRx } from "@/lib/validate";
import { qboFailure, type QboActionResult } from "../qbo/result";

const emailListField = (which: string) =>
  z
    .string()
    .trim()
    .max(2000)
    .refine(
      (v) => v.split(",").map((e) => e.trim()).filter(Boolean).every((e) => emailRx.test(e)),
      `${which} must be valid email addresses, separated by commas.`,
    );

const SettingsSchema = z.object({
  saEmails: emailListField("Service-advisor recipients"),
  officeEmails: emailListField("Office recipients"),
  accountingEmails: emailListField("Accounting recipients"),
  reopenedEmails: emailListField("Reopened-RO alert recipients"),
  digestEmails: emailListField("Daily-digest recipients"),
  fallbackAdminEmail: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || emailRx.test(v), "The admin fallback must be a valid email address."),
  staleHours: z.coerce.number().int().min(1).max(720),
});

const toList = (v: string) => v.split(",").map((e) => e.trim()).filter(Boolean);

async function updateSettingsImpl(
  _prev: QboActionResult<{ saved: true }> | null,
  formData: FormData,
): Promise<QboActionResult<{ saved: true }>> {
  try {
    const { shopId, role } = await requireQtekUser();
    if (role !== "admin") {
      return { ok: false, reason: "validation", message: "Admin role required to change settings.", timestamp: Date.now() };
    }
    const parsed = SettingsSchema.safeParse({
      saEmails: String(formData.get("sa_emails") ?? ""),
      officeEmails: String(formData.get("office_emails") ?? ""),
      accountingEmails: String(formData.get("accounting_emails") ?? ""),
      reopenedEmails: String(formData.get("reopened_emails") ?? ""),
      digestEmails: String(formData.get("digest_emails") ?? ""),
      fallbackAdminEmail: String(formData.get("fallback_admin_email") ?? ""),
      staleHours: formData.get("stale_hours") ?? 48,
    });
    if (!parsed.success) {
      return { ok: false, reason: "validation", message: parsed.error.issues[0]?.message ?? "Invalid settings.", timestamp: Date.now() };
    }
    const settings: BackOfficeSettings = {
      saEmails: toList(parsed.data.saEmails),
      officeEmails: toList(parsed.data.officeEmails),
      accountingEmails: toList(parsed.data.accountingEmails),
      reopenedEmails: toList(parsed.data.reopenedEmails),
      digestEmails: toList(parsed.data.digestEmails),
      fallbackAdminEmail: parsed.data.fallbackAdminEmail,
      staleHours: parsed.data.staleHours,
    };
    await upsertBackOfficeSettings(shopId, settings);
    return { ok: true, data: { saved: true }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const updateBackOfficeSettingsAction = wrapQtekAction("backOfficeUpdateSettings", updateSettingsImpl);
