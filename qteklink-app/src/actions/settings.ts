"use server";

/**
 * Shop-settings action (C8c) — admin-only. Edit the auto_post gate + the settle window
 * + tz/tax/tire config. Thin (the QTekLink pattern). `auto_post` is a SENSITIVE gate —
 * it bypasses the human approval queue, so it's admin-only (enforced here).
 */
import { z } from "zod";
import { requireQtekUser } from "@/lib/auth";
import { wrapQtekAction } from "@/lib/instrument-action";
import { upsertShopSettings } from "@/lib/dal/settings";
import { qboFailure, type QboActionResult } from "./qbo/result";

const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SettingsSchema = z.object({
  autoPost: z.boolean().optional(),
  settleWindowMinutes: z.coerce.number().int().nonnegative().max(1440).optional(),
  shopTimezone: z.string().trim().min(1).max(64).optional(),
  salesTaxRateBps: z.coerce.number().int().nonnegative().max(10000).optional(), // ≤ 100%
  tireFeeCents: z.coerce.number().int().nonnegative().max(100000).optional(),
  // "" clears the recipient; a non-empty value must be a real email address.
  officeManagerEmail: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || emailRx.test(v), "Enter a valid email address for the office manager.")
    .optional(),
  // comma-separated; every non-blank entry must be a real email address.
  advisorEmails: z
    .string()
    .trim()
    .max(1000)
    .refine(
      (v) => v.split(",").map((e) => e.trim()).filter(Boolean).every((e) => emailRx.test(e)),
      "Service advisor emails must be valid addresses, separated by commas.",
    )
    .optional(),
});

function adminRequired(): { ok: false; reason: "validation"; message: string; timestamp: number } {
  return { ok: false, reason: "validation", message: "Admin role required to change settings.", timestamp: Date.now() };
}

async function updateSettingsImpl(
  _prev: QboActionResult<{ saved: true }> | null,
  formData: FormData,
): Promise<QboActionResult<{ saved: true }>> {
  try {
    const { shopId, role } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const autoPostRaw = formData.get("auto_post");
    const parsed = SettingsSchema.safeParse({
      // the settings form ALWAYS carries the checkbox → absent means unchecked = false
      // (a definite boolean, so unchecking actually turns auto-post off).
      autoPost: autoPostRaw === "on" || autoPostRaw === "true",
      settleWindowMinutes: formData.get("settle_window_minutes") || undefined,
      shopTimezone: formData.get("shop_timezone") || undefined,
      salesTaxRateBps: formData.get("sales_tax_rate_bps") || undefined,
      tireFeeCents: formData.get("tire_fee_cents") || undefined,
      // the form always carries these fields → "" means "clear the recipient".
      officeManagerEmail: formData.get("office_manager_email") == null ? undefined : String(formData.get("office_manager_email")),
      advisorEmails: formData.get("advisor_emails") == null ? undefined : String(formData.get("advisor_emails")),
    });
    if (!parsed.success) {
      return { ok: false, reason: "validation", message: parsed.error.issues[0]?.message ?? "Invalid settings.", timestamp: Date.now() };
    }
    await upsertShopSettings(shopId, {
      ...parsed.data,
      officeManagerEmail: parsed.data.officeManagerEmail === undefined ? undefined : parsed.data.officeManagerEmail || null,
      advisorEmails: parsed.data.advisorEmails === undefined
        ? undefined
        : parsed.data.advisorEmails.split(",").map((e) => e.trim()).filter(Boolean),
    });
    return { ok: true, data: { saved: true }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const updateSettingsAction = wrapQtekAction("qboUpdateSettings", updateSettingsImpl);
