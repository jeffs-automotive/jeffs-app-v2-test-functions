"use server";

/**
 * Back-office issue actions (office-manager side, qteklink-app). Thin wrappers: validate,
 * requireQtekUser (viewer is read-only — mutations need approver/admin), delegate to the
 * DAL, fire the alert, return a typed envelope. The QBO fetch is read-only.
 */
import { z } from "zod";
import { requireQtekUser, type QtekRole } from "@/lib/auth";
import { wrapQtekAction } from "@/lib/instrument-action";
import { resolveRealmForShop } from "@/lib/dal/realm";
import {
  fetchVendorDocByNumber,
  fetchVendorDocAttachments,
  type VendorDocCandidate,
  type VendorDocAttachment,
  type VendorDocType,
} from "@/lib/qbo/vendor-docs";
import { createIssue, sendToSa, verifyIssue, notifyBackOffice, type IssueKind } from "@/lib/dal/back-office";
import { qboFailure, type QboActionResult } from "../qbo/result";

function forbidden(): { ok: false; reason: "validation"; message: string; timestamp: number } {
  return { ok: false, reason: "validation", message: "You don't have permission to do that.", timestamp: Date.now() };
}
function canManage(role: QtekRole): boolean {
  return role === "approver" || role === "admin";
}
function invalid(message: string): { ok: false; reason: "validation"; message: string; timestamp: number } {
  return { ok: false, reason: "validation", message, timestamp: Date.now() };
}
const isUuid = (s: string): boolean => z.string().uuid().safeParse(s).success;

// ─── Fetch a vendor doc from QuickBooks (read-only) ──────────────────────────
async function fetchVendorDocImpl(
  _prev: QboActionResult<VendorDocCandidate[]> | null,
  formData: FormData,
): Promise<QboActionResult<VendorDocCandidate[]>> {
  try {
    const { shopId, role } = await requireQtekUser();
    if (!canManage(role)) return forbidden();
    const invoiceNo = String(formData.get("invoice_number") ?? "").trim();
    if (!invoiceNo) return invalid("Enter an invoice number.");
    const candidates = await fetchVendorDocByNumber(shopId, invoiceNo);
    return { ok: true, data: candidates, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const fetchVendorDocAction = wrapQtekAction("backOfficeFetchVendorDoc", fetchVendorDocImpl);

// ─── Fetch the parts-invoice image(s) attached to a QBO Bill/Purchase (read-only) ──
async function fetchAttachmentsImpl(
  _prev: QboActionResult<VendorDocAttachment[]> | null,
  formData: FormData,
): Promise<QboActionResult<VendorDocAttachment[]>> {
  try {
    const { shopId, role } = await requireQtekUser();
    if (!canManage(role)) return forbidden();
    const txnType = String(formData.get("qbo_txn_type") ?? "") as VendorDocType;
    const txnId = String(formData.get("qbo_txn_id") ?? "").trim();
    if (!txnId || (txnType !== "Bill" && txnType !== "Purchase")) {
      return invalid("This issue has no linked QuickBooks document.");
    }
    const attachments = await fetchVendorDocAttachments(shopId, txnType, txnId);
    return { ok: true, data: attachments, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const fetchAttachmentsAction = wrapQtekAction("backOfficeFetchAttachments", fetchAttachmentsImpl);

// ─── Create an invoice_issue / open_ro ───────────────────────────────────────
const InvoiceIssueSchema = z.object({
  kind: z.enum(["invoice_issue", "open_ro"]),
  vendorName: z.string().trim().max(200).optional(),
  billNo: z.string().trim().max(64).optional(),
  billDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Bill date must be YYYY-MM-DD.").optional(),
  totalCents: z.coerce.number().int().optional(),
  roNumber: z.string().trim().max(64).optional(),
  qboTxnType: z.enum(["Bill", "Purchase"]).optional(),
  qboTxnId: z.string().trim().max(64).optional(),
  boNotes: z.string().trim().max(4000).optional(),
});

async function createInvoiceIssueImpl(
  _prev: QboActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<QboActionResult<{ id: string }>> {
  try {
    const { shopId, role, email } = await requireQtekUser();
    if (!canManage(role)) return forbidden();
    const opt = (k: string) => {
      const v = formData.get(k);
      return v == null || String(v).trim() === "" ? undefined : String(v);
    };
    const parsed = InvoiceIssueSchema.safeParse({
      kind: opt("kind"),
      vendorName: opt("vendor_name"),
      billNo: opt("bill_no"),
      billDate: opt("bill_date"),
      totalCents: opt("total_cents"),
      roNumber: opt("ro_number"),
      qboTxnType: opt("qbo_txn_type"),
      qboTxnId: opt("qbo_txn_id"),
      boNotes: opt("bo_notes"),
    });
    if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Invalid input.");

    const realmId = await resolveRealmForShop(shopId);
    const id = await createIssue(shopId, parsed.data.kind as IssueKind, parsed.data.qboTxnId ? "qbo_fetch" : "manual", {
      realmId,
      vendorName: parsed.data.vendorName ?? null,
      billNo: parsed.data.billNo ?? null,
      billDate: parsed.data.billDate ?? null,
      totalCents: parsed.data.totalCents ?? null,
      roNumber: parsed.data.roNumber ?? null,
      qboTxnType: parsed.data.qboTxnType ?? null,
      qboTxnId: parsed.data.qboTxnId ?? null,
      boNotes: parsed.data.boNotes ?? null,
      context: parsed.data.kind === "open_ro" ? { ro_status: "ro_open" } : {},
    }, email);
    return { ok: true, data: { id }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const createInvoiceIssueAction = wrapQtekAction("backOfficeCreateInvoiceIssue", createInvoiceIssueImpl);

// ─── Create a misc issue ─────────────────────────────────────────────────────
const MiscSchema = z.object({
  title: z.string().trim().min(1, "A title is required.").max(200),
  roNumber: z.string().trim().max(64).optional(),
  boNotes: z.string().trim().max(4000).optional(),
});

async function createMiscImpl(
  _prev: QboActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<QboActionResult<{ id: string }>> {
  try {
    const { shopId, role, email } = await requireQtekUser();
    if (!canManage(role)) return forbidden();
    const opt = (k: string) => {
      const v = formData.get(k);
      return v == null || String(v).trim() === "" ? undefined : String(v);
    };
    const parsed = MiscSchema.safeParse({ title: opt("title"), roNumber: opt("ro_number"), boNotes: opt("bo_notes") });
    if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Invalid input.");
    const id = await createIssue(shopId, "misc", "manual", {
      title: parsed.data.title,
      roNumber: parsed.data.roNumber ?? null,
      boNotes: parsed.data.boNotes ?? null,
    }, email);
    return { ok: true, data: { id }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const createMiscAction = wrapQtekAction("backOfficeCreateMisc", createMiscImpl);

// ─── Send to service advisor (also the "add note & re-send" loop) ────────────
async function sendToSaImpl(
  _prev: QboActionResult<{ done: true }> | null,
  formData: FormData,
): Promise<QboActionResult<{ done: true }>> {
  try {
    const { shopId, role, email } = await requireQtekUser();
    if (!canManage(role)) return forbidden();
    const issueId = String(formData.get("issue_id") ?? "").trim();
    const note = String(formData.get("note") ?? "").trim() || null;
    if (!isUuid(issueId)) return invalid("Missing or invalid issue id.");
    const event = await sendToSa(shopId, issueId, email, note);
    if (!event) return invalid("That issue can't be sent right now (it may have changed).");
    await notifyBackOffice(shopId, issueId, event);
    return { ok: true, data: { done: true }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const sendToSaAction = wrapQtekAction("backOfficeSendToSa", sendToSaImpl);

// ─── Verify = close ──────────────────────────────────────────────────────────
async function verifyIssueImpl(
  _prev: QboActionResult<{ done: true }> | null,
  formData: FormData,
): Promise<QboActionResult<{ done: true }>> {
  try {
    const { shopId, role, email } = await requireQtekUser();
    if (!canManage(role)) return forbidden();
    const issueId = String(formData.get("issue_id") ?? "").trim();
    if (!isUuid(issueId)) return invalid("Missing or invalid issue id.");
    const done = await verifyIssue(shopId, issueId, email);
    if (!done) return invalid("That issue is already verified.");
    await notifyBackOffice(shopId, issueId, "verified");
    return { ok: true, data: { done: true }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const verifyIssueAction = wrapQtekAction("backOfficeVerify", verifyIssueImpl);
