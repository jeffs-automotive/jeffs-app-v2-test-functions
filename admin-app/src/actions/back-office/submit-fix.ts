"use server";

/**
 * submitFixAction — the service advisor submits their fix (sent_to_sa → awaiting_verify),
 * which pings the office manager to verify. Visible to any admin-app user (no role gate —
 * Chris's Phase-1 decision). requireAdmin() runs OUTSIDE the try so its redirect
 * propagates; the DB work is wrapped so a failure surfaces (never a silent swallow).
 */
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import { submitFix, notifyBackOffice, getAdminShopId } from "@/lib/back-office";

export type SubmitFixState =
  | { ok: true; timestamp: number }
  | { ok: false; message: string; timestamp: number }
  | null;

const SubmitFixSchema = z.object({
  issue_id: z.string().uuid("Missing or invalid issue id."),
  sa_note: z.string().trim().min(1, "Add a note describing what you fixed.").max(4000, "That note is too long."),
});

async function submitFixImpl(_prev: SubmitFixState, formData: FormData): Promise<SubmitFixState> {
  const { email } = await requireAdmin();
  try {
    const parsed = SubmitFixSchema.safeParse({
      issue_id: String(formData.get("issue_id") ?? ""),
      sa_note: String(formData.get("sa_note") ?? ""),
    });
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input.", timestamp: Date.now() };
    }
    const { issue_id: issueId, sa_note: note } = parsed.data;

    const shopId = getAdminShopId();
    const done = await submitFix(shopId, issueId, email, note);
    if (!done) return { ok: false, message: "That issue can't be submitted right now (it may have changed).", timestamp: Date.now() };

    await notifyBackOffice(shopId, issueId, "sa_submitted");
    return { ok: true, timestamp: Date.now() };
  } catch (e) {
    Sentry.captureException(e);
    return { ok: false, message: "Something went wrong. Please try again.", timestamp: Date.now() };
  }
}

export const submitFixAction = wrapAdminAction("backOfficeSubmitFix", submitFixImpl);
