"use server";

/**
 * submitFixAction — the service advisor submits their fix (sent_to_sa → awaiting_verify),
 * which pings the office manager to verify. Visible to any admin-app user (no role gate —
 * Chris's Phase-1 decision). requireAdmin() runs OUTSIDE the try so its redirect
 * propagates; the DB work is wrapped so a failure surfaces (never a silent swallow).
 */
import * as Sentry from "@sentry/nextjs";
import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import { submitFix, notifyBackOffice, getAdminShopId } from "@/lib/back-office";

export type SubmitFixState =
  | { ok: true; timestamp: number }
  | { ok: false; message: string; timestamp: number }
  | null;

async function submitFixImpl(_prev: SubmitFixState, formData: FormData): Promise<SubmitFixState> {
  const { email } = await requireAdmin();
  try {
    const issueId = String(formData.get("issue_id") ?? "").trim();
    const note = String(formData.get("sa_note") ?? "").trim();
    if (!issueId) return { ok: false, message: "Missing issue id.", timestamp: Date.now() };
    if (!note) return { ok: false, message: "Add a note describing what you fixed.", timestamp: Date.now() };
    if (note.length > 4000) return { ok: false, message: "That note is too long.", timestamp: Date.now() };

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
