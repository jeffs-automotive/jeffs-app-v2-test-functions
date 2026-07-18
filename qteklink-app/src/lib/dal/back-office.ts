/**
 * Back-office DAL (Phase 1) — the office-manager side of the cross-app module. Fat-DAL:
 * pure TS, unit-testable; all reads/writes go through the service-role admin client + the
 * SECURITY DEFINER RPCs. MULTI-TENANT: shopId is server-derived (requireQtekUser().shopId),
 * never from the client. No silent failures: every DB error throws.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { resolveSupabaseUrl, resolveServiceRoleKey } from "@/lib/supabase/resolve-keys";
import * as Sentry from "@sentry/nextjs";

export type IssueKind = "invoice_issue" | "open_ro" | "reopened_ro" | "misc";
export type IssueStatus = "open" | "sent_to_sa" | "awaiting_verify" | "verified";
export type NotifyEvent = "detected" | "ro_closed" | "sent_to_sa" | "resent_to_sa" | "sa_submitted" | "verified";

export interface BackOfficeIssue {
  id: string;
  kind: IssueKind;
  status: IssueStatus;
  source: string;
  title: string | null;
  roNumber: string | null;
  tekmetricRoId: number | null;
  vendorName: string | null;
  billNo: string | null;
  billDate: string | null;
  totalCents: number | null;
  qboTxnType: string | null;
  qboTxnId: string | null;
  boNotes: string | null;
  saNotes: string | null;
  context: Record<string, unknown>;
  createdBy: string | null;
  sentToSaAt: string | null;
  saSubmittedAt: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  lastActivityAt: string;
  createdAt: string;
}

export interface BackOfficeSettings {
  saEmails: string[];
  officeEmails: string[];
  accountingEmails: string[];
  reopenedEmails: string[];
  digestEmails: string[];
  fallbackAdminEmail: string;
  staleHours: number;
}

export const DEFAULT_BACK_OFFICE_SETTINGS: BackOfficeSettings = {
  saEmails: [],
  officeEmails: [],
  accountingEmails: [],
  reopenedEmails: [],
  digestEmails: [],
  fallbackAdminEmail: "",
  staleHours: 48,
};

const ISSUE_COLUMNS =
  "id, kind, status, source, title, ro_number, tekmetric_ro_id, vendor_name, bill_no, bill_date, total_cents, qbo_txn_type, qbo_txn_id, bo_notes, sa_notes, context, created_by, sent_to_sa_at, sa_submitted_at, verified_at, verified_by, last_activity_at, created_at";

interface IssueDbRow {
  id: string;
  kind: string;
  status: string;
  source: string;
  title: string | null;
  ro_number: string | null;
  tekmetric_ro_id: number | string | null;
  vendor_name: string | null;
  bill_no: string | null;
  bill_date: string | null;
  total_cents: number | string | null;
  qbo_txn_type: string | null;
  qbo_txn_id: string | null;
  bo_notes: string | null;
  sa_notes: string | null;
  context: Record<string, unknown> | null;
  created_by: string | null;
  sent_to_sa_at: string | null;
  sa_submitted_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  last_activity_at: string;
  created_at: string;
}

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapIssue(r: IssueDbRow): BackOfficeIssue {
  return {
    id: r.id,
    kind: r.kind as IssueKind,
    status: r.status as IssueStatus,
    source: r.source,
    title: r.title,
    roNumber: r.ro_number,
    tekmetricRoId: num(r.tekmetric_ro_id),
    vendorName: r.vendor_name,
    billNo: r.bill_no,
    billDate: r.bill_date,
    totalCents: num(r.total_cents),
    qboTxnType: r.qbo_txn_type,
    qboTxnId: r.qbo_txn_id,
    boNotes: r.bo_notes,
    saNotes: r.sa_notes,
    context: r.context ?? {},
    createdBy: r.created_by,
    sentToSaAt: r.sent_to_sa_at,
    saSubmittedAt: r.sa_submitted_at,
    verifiedAt: r.verified_at,
    verifiedBy: r.verified_by,
    lastActivityAt: r.last_activity_at,
    createdAt: r.created_at,
  };
}

/** Active (non-verified) issues of one kind for a shop, newest first. */
export async function listActiveIssues(shopId: number, kind: IssueKind): Promise<BackOfficeIssue[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("back_office_issues")
    .select(ISSUE_COLUMNS)
    .eq("shop_id", shopId)
    .eq("kind", kind)
    .neq("status", "verified")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listActiveIssues failed: ${error.message}`);
  return ((data ?? []) as IssueDbRow[]).map(mapIssue);
}

/** All non-verified issues for a shop (dashboard / stale scan), newest first. */
export async function listAllActiveIssues(shopId: number): Promise<BackOfficeIssue[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("back_office_issues")
    .select(ISSUE_COLUMNS)
    .eq("shop_id", shopId)
    .neq("status", "verified")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listAllActiveIssues failed: ${error.message}`);
  return ((data ?? []) as IssueDbRow[]).map(mapIssue);
}

export interface DashboardCounts {
  openCount: number;
  closedThisMonth: number;
  staleCount: number;
}

export async function getDashboardCounts(shopId: number, monthStart: string, staleHours: number): Promise<DashboardCounts> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("back_office_dashboard_counts", {
    p_shop_id: shopId,
    p_month_start: monthStart,
    p_stale_hours: staleHours,
  });
  if (error) throw new Error(`getDashboardCounts failed: ${error.message}`);
  const c = (data ?? {}) as { open_count?: number; closed_this_month?: number; stale_count?: number };
  return {
    openCount: c.open_count ?? 0,
    closedThisMonth: c.closed_this_month ?? 0,
    staleCount: c.stale_count ?? 0,
  };
}

export interface CreateIssueInput {
  realmId?: string | null;
  title?: string | null;
  roNumber?: string | null;
  tekmetricRoId?: number | null;
  vendorName?: string | null;
  billNo?: string | null;
  billDate?: string | null;
  totalCents?: number | null;
  qboTxnType?: string | null;
  qboTxnId?: string | null;
  boNotes?: string | null;
  context?: Record<string, unknown>;
}

/** Build the create_issue jsonb payload (numbers/dates as JSON values, never "" — the RPC casts). */
function toPayload(input: CreateIssueInput): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (input.realmId) p.realm_id = input.realmId;
  if (input.title) p.title = input.title;
  if (input.roNumber) p.ro_number = input.roNumber;
  if (typeof input.tekmetricRoId === "number") p.tekmetric_ro_id = input.tekmetricRoId;
  if (input.vendorName) p.vendor_name = input.vendorName;
  if (input.billNo) p.bill_no = input.billNo;
  if (input.billDate) p.bill_date = input.billDate;
  if (typeof input.totalCents === "number") p.total_cents = input.totalCents;
  if (input.qboTxnType) p.qbo_txn_type = input.qboTxnType;
  if (input.qboTxnId) p.qbo_txn_id = input.qboTxnId;
  if (input.boNotes) p.bo_notes = input.boNotes;
  if (input.context) p.context = input.context;
  return p;
}

export async function createIssue(
  shopId: number,
  kind: IssueKind,
  source: "manual" | "qbo_fetch",
  input: CreateIssueInput,
  actor: string,
): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("back_office_create_issue", {
    p_shop_id: shopId,
    p_kind: kind,
    p_source: source,
    p_payload: toPayload(input),
    p_actor: actor,
    p_actor_app: "qteklink",
  });
  if (error) throw new Error(`createIssue failed: ${error.message}`);
  return data as string;
}

/** Returns the alert event to fire ('sent_to_sa' | 'resent_to_sa'), or null on a no-op. */
export async function sendToSa(shopId: number, issueId: string, actor: string, note: string | null): Promise<"sent_to_sa" | "resent_to_sa" | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("back_office_send_to_sa", {
    p_shop_id: shopId,
    p_issue_id: issueId,
    p_actor: actor,
    p_note: note,
  });
  if (error) throw new Error(`sendToSa failed: ${error.message}`);
  return data === "sent_to_sa" || data === "resent_to_sa" ? data : null;
}

// A RO is "closed" once its newest sale-scan event is a posting (posted / sent-to-A-R);
// an unpost (or no event) leaves it open. Mirrors the ro-watch cron's isPosting logic.
const RO_POSTING_KINDS = ["ro_posted", "ro_sent_to_ar"];
const RO_SCAN_KINDS = ["ro_posted", "ro_sent_to_ar", "ro_unposted"];
// Guards the RO# before it goes into a PostgREST .or() filter (no comma/paren/dot → no
// filter injection). Tekmetric RO numbers are digits; alnum+dash is a safe superset.
const SAFE_RO_NUMBER = /^[A-Za-z0-9-]{1,32}$/;

/**
 * The RO's current closed/open state from the Tekmetric event ledger, for stamping an
 * open_ro issue at creation time (so an already-closed RO is immediately verifiable rather
 * than waiting for the ro-watch cron). Returns not-closed when the RO# is unknown/unsafe or
 * has no posting event. Throws on DB error.
 */
export async function getRoClosureStatus(shopId: number, roNumber: string): Promise<{ closed: boolean; closedAt: string | null }> {
  if (!SAFE_RO_NUMBER.test(roNumber)) return { closed: false, closedAt: null };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_events")
    .select("event_kind, received_at")
    .eq("shop_id", shopId)
    .or(`raw_body->data->>repairOrderNumber.eq.${roNumber},raw_body->>repairOrderNumber.eq.${roNumber}`)
    .in("event_kind", RO_SCAN_KINDS)
    .order("received_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`getRoClosureStatus failed: ${error.message}`);
  const latest = (data ?? [])[0] as { event_kind: string; received_at: string } | undefined;
  if (latest && RO_POSTING_KINDS.includes(latest.event_kind)) {
    return { closed: true, closedAt: latest.received_at };
  }
  return { closed: false, closedAt: null };
}

export async function verifyIssue(shopId: number, issueId: string, actor: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("back_office_verify", {
    p_shop_id: shopId,
    p_issue_id: issueId,
    p_actor: actor,
    p_actor_app: "qteklink",
  });
  if (error) throw new Error(`verifyIssue failed: ${error.message}`);
  return data === true;
}

// ─── Settings ────────────────────────────────────────────────────────────────

interface SettingsBlobDb {
  sa_emails?: unknown;
  office_emails?: unknown;
  accounting_emails?: unknown;
  reopened_emails?: unknown;
  digest_emails?: unknown;
  fallback_admin_email?: unknown;
  stale_hours?: unknown;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()) : [];
}

export async function getBackOfficeSettings(shopId: number): Promise<{ realmId: string | null; settings: BackOfficeSettings }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { realmId: null, settings: DEFAULT_BACK_OFFICE_SETTINGS };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_settings")
    .select("back_office")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .limit(1);
  if (error) throw new Error(`getBackOfficeSettings failed: ${error.message}`);
  const blob = ((data ?? [])[0]?.back_office ?? null) as SettingsBlobDb | null;
  if (!blob) return { realmId, settings: DEFAULT_BACK_OFFICE_SETTINGS };
  return {
    realmId,
    settings: {
      saEmails: strList(blob.sa_emails),
      officeEmails: strList(blob.office_emails),
      accountingEmails: strList(blob.accounting_emails),
      reopenedEmails: strList(blob.reopened_emails),
      digestEmails: strList(blob.digest_emails),
      fallbackAdminEmail: typeof blob.fallback_admin_email === "string" ? blob.fallback_admin_email : "",
      staleHours: typeof blob.stale_hours === "number" && Number.isFinite(blob.stale_hours) ? blob.stale_hours : 48,
    },
  };
}

export async function upsertBackOfficeSettings(shopId: number, settings: BackOfficeSettings): Promise<void> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) throw new Error("QuickBooks is not connected for this shop.");
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("back_office_upsert_settings", {
    p_shop_id: shopId,
    p_realm_id: realmId,
    p_back_office: {
      sa_emails: settings.saEmails,
      office_emails: settings.officeEmails,
      accounting_emails: settings.accountingEmails,
      reopened_emails: settings.reopenedEmails,
      digest_emails: settings.digestEmails,
      fallback_admin_email: settings.fallbackAdminEmail,
      stale_hours: settings.staleHours,
    },
  });
  if (error) throw new Error(`upsertBackOfficeSettings failed: ${error.message}`);
}

/**
 * Fire a back-office-notify alert after a transition succeeds. Never throws into the
 * caller's action path — a bounced email must not fail the office manager's click.
 */
export async function notifyBackOffice(shopId: number, issueId: string, event: NotifyEvent): Promise<void> {
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
