"use server";

/**
 * fetchAttachmentsAction — service advisors view the same parts-invoice image the office
 * manager sees. admin-app has no QBO client, so this calls qteklink-app's internal
 * /api/back-office/attachment endpoint (which reuses the shared QBO token lifecycle) with
 * the service key. shop_id is resolved server-side. Read-only; degrades to a message on error.
 */
import * as Sentry from "@sentry/nextjs";
import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import { resolveServiceRoleKey } from "@/lib/supabase/resolve-keys";
import { getAdminShopId } from "@/lib/back-office";

export interface Attachment {
  qboAttachableId: string;
  fileName: string | null;
  tempDownloadUri: string | null;
}

export type FetchAttachmentsState =
  | { ok: true; attachments: Attachment[]; timestamp: number }
  | { ok: false; message: string; timestamp: number }
  | null;

async function fetchAttachmentsImpl(_prev: FetchAttachmentsState, formData: FormData): Promise<FetchAttachmentsState> {
  await requireAdmin();
  try {
    const txnType = String(formData.get("qbo_txn_type") ?? "");
    const txnId = String(formData.get("qbo_txn_id") ?? "").trim();
    if ((txnType !== "Bill" && txnType !== "Purchase") || !txnId) {
      return { ok: false, message: "This issue has no linked QuickBooks document.", timestamp: Date.now() };
    }
    const base = (process.env.QTEKLINK_INTERNAL_URL ?? "").replace(/\/$/, "");
    const key = resolveServiceRoleKey();
    if (!base || !key) {
      return { ok: false, message: "Image lookup isn't configured. Ask an admin to set QTEKLINK_INTERNAL_URL.", timestamp: Date.now() };
    }
    const res = await fetch(`${base}/api/back-office/attachment`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: getAdminShopId(), qbo_txn_type: txnType, qbo_txn_id: txnId }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; attachments?: Attachment[]; error?: string };
    if (!res.ok || json.ok === false) {
      return { ok: false, message: json.error ?? "Couldn't load the image.", timestamp: Date.now() };
    }
    return { ok: true, attachments: json.attachments ?? [], timestamp: Date.now() };
  } catch (e) {
    Sentry.captureException(e, { tags: { surface: "back-office-fetch-attachments" } });
    return { ok: false, message: "Couldn't load the image. Please try again.", timestamp: Date.now() };
  }
}

export const fetchAttachmentsAction = wrapAdminAction("backOfficeFetchAttachments", fetchAttachmentsImpl);
