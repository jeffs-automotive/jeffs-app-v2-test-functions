/**
 * Back-office DAL (admin-app / service-advisor side). The other half of the cross-app
 * module — the same shared back_office_issues table + RPCs the office manager writes in
 * qteklink-app. Service advisors see the queue and submit fixes here. shop_id is resolved
 * server-side (resolveAdminShopId), never from the client. No silent failures.
 */
import * as Sentry from "@sentry/nextjs";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveAdminShopId } from "@/lib/scheduler/shop-id";
import { resolveSupabaseUrl, resolveServiceRoleKey } from "@/lib/supabase/resolve-keys";

export type IssueKind = "invoice_issue" | "open_ro" | "reopened_ro" | "misc";
export type IssueStatus = "open" | "sent_to_sa" | "awaiting_verify" | "verified";

export interface SaQueueIssue {
  id: string;
  kind: IssueKind;
  status: IssueStatus;
  roNumber: string | null;
  billNo: string | null;
  vendorName: string | null;
  billDate: string | null;
  totalCents: number | null;
  qboTxnType: string | null;
  qboTxnId: string | null;
  title: string | null;
  boNotes: string | null;
  saNotes: string | null;
  context: Record<string, unknown>;
  createdAt: string;
  sentToSaAt: string | null;
}

export function getAdminShopId(): number {
  return resolveAdminShopId();
}

interface QueueDbRow {
  id: string;
  kind: string;
  status: string;
  ro_number: string | null;
  bill_no: string | null;
  vendor_name: string | null;
  bill_date: string | null;
  total_cents: number | string | null;
  qbo_txn_type: string | null;
  qbo_txn_id: string | null;
  title: string | null;
  bo_notes: string | null;
  sa_notes: string | null;
  context: Record<string, unknown> | null;
  created_at: string;
  sent_to_sa_at: string | null;
}

function mapRow(r: QueueDbRow): SaQueueIssue {
  const total = r.total_cents === null ? null : Number(r.total_cents);
  return {
    id: r.id,
    kind: r.kind as IssueKind,
    status: r.status as IssueStatus,
    roNumber: r.ro_number,
    billNo: r.bill_no,
    vendorName: r.vendor_name,
    billDate: r.bill_date,
    totalCents: total !== null && Number.isFinite(total) ? total : null,
    qboTxnType: r.qbo_txn_type,
    qboTxnId: r.qbo_txn_id,
    title: r.title,
    boNotes: r.bo_notes,
    saNotes: r.sa_notes,
    context: r.context ?? {},
    createdAt: r.created_at,
    sentToSaAt: r.sent_to_sa_at,
  };
}

/** The fix-it queue: issues with an advisor (needs a fix) or awaiting the office's verify. */
export async function listSaQueue(shopId: number): Promise<SaQueueIssue[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("back_office_issues")
    .select("id, kind, status, ro_number, bill_no, vendor_name, bill_date, total_cents, qbo_txn_type, qbo_txn_id, title, bo_notes, sa_notes, context, created_at, sent_to_sa_at")
    .eq("shop_id", shopId)
    .in("status", ["sent_to_sa", "awaiting_verify"])
    .order("sent_to_sa_at", { ascending: true });
  if (error) throw new Error(`listSaQueue failed: ${error.message}`);
  return ((data ?? []) as QueueDbRow[]).map(mapRow);
}

/** The service advisor submits their fix (sent_to_sa → awaiting_verify). Returns false on a no-op. */
export async function submitFix(shopId: number, issueId: string, actor: string, saNote: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("back_office_submit_fix", {
    p_shop_id: shopId,
    p_issue_id: issueId,
    p_actor: actor,
    p_sa_note: saNote,
  });
  if (error) throw new Error(`submitFix failed: ${error.message}`);
  return data === true;
}

/** Fire a back-office-notify alert after submit. Never throws into the caller's action. */
export async function notifyBackOffice(shopId: number, issueId: string, event: "sa_submitted"): Promise<void> {
  try {
    const base = resolveSupabaseUrl();
    const key = resolveServiceRoleKey();
    if (!base || !key) {
      Sentry.captureMessage("notifyBackOffice: Supabase URL / service key missing — alert skipped", { level: "error", tags: { surface: "back-office-notify" } });
      return;
    }
    const res = await fetch(`${base.replace(/\/$/, "")}/functions/v1/back-office-notify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: shopId, issue_id: issueId, event }),
    });
    if (!res.ok) {
      Sentry.captureMessage(`notifyBackOffice: edge fn returned ${res.status}`, { level: "error", tags: { surface: "back-office-notify" }, extra: { event } });
    }
  } catch (e) {
    Sentry.captureException(e, { tags: { surface: "back-office-notify" } });
  }
}
