/**
 * Vendor-doc read (back-office module, 2026-07-17) — read-only QBO lookups the office
 * manager drives from the "Add" modal: type an invoice number, we fetch the matching
 * vendor document to auto-fill vendor / date / amount / RO#.
 *
 * "Bills AND expenses" (Chris): the same invoice number may have been entered as a QBO
 * `Bill` (A-P) OR a `Purchase` (expense / check / credit-card). We query BOTH by DocNumber
 * and return every candidate — DocNumber is NOT unique (across vendors, across time, and
 * across the two entity types), so the caller may get 0, 1, or many and disambiguates by
 * vendor + date + amount.
 *
 * RO# (Chris): lives on a "customer line" — the CustomerRef on an expense line (fallback:
 * the line Description). We surface a best-guess + all candidates; the Add modal shows the
 * fetched values for the office manager to CONFIRM/EDIT, so an imperfect guess is safe.
 * (The exact customer-line field is being confirmed against a real Jeff's bill — see the plan.)
 *
 * Fat-DAL: the mappers are pure + unit-tested; the fetch fns are thin QboClient wrappers.
 * QBO errors throw QboClientError (the action wraps them via qboFailure). Money is cents.
 */
import { QboClient } from "@/lib/qbo/client";
import { QboClientError } from "@/lib/qbo/errors";
import { resolveRealmForShop } from "@/lib/dal/realm";
import {
  billQueryResponseSchema,
  purchaseQueryResponseSchema,
  attachableQueryResponseSchema,
  type QboBill,
  type QboPurchase,
  type QboLine,
} from "@/lib/qbo/entities";

export type VendorDocType = "Bill" | "Purchase";

export interface VendorDocCandidate {
  qboTxnType: VendorDocType;
  qboTxnId: string;
  vendorName: string | null;
  billNo: string | null; // the DocNumber the office manager typed
  billDate: string | null; // TxnDate, YYYY-MM-DD
  totalCents: number | null;
  roNumber: string | null; // best-guess RO# from the customer line
  roCandidates: string[]; // every customer-line value we saw (for the UI to disambiguate)
}

export interface VendorDocAttachment {
  qboAttachableId: string;
  fileName: string | null;
  tempDownloadUri: string | null;
}

// Tekmetric RO numbers are ~6-digit integers (e.g. 154157). Prefer a candidate matching that.
const RO_NUMBER_RE = /\b(\d{4,7})\b/;

/** Dollars → integer cents, guarding against float drift + non-finite input. */
export function dollarsToCents(amt: number | null | undefined): number | null {
  if (amt === null || amt === undefined || !Number.isFinite(amt)) return null;
  return Math.round(amt * 100);
}

/** Collect the RO# candidates from a doc's lines: CustomerRef.name first, then any
 *  RO-looking token in the line Description. De-duplicated, order-preserving. */
export function extractRoCandidates(lines: QboLine[] | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    const v = (raw ?? "").trim();
    if (v.length > 0 && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  };
  for (const line of lines ?? []) {
    const detail = line.AccountBasedExpenseLineDetail ?? line.ItemBasedExpenseLineDetail;
    push(detail?.CustomerRef?.name);
  }
  // Fallback: an RO-looking token in a description (only if a customer line didn't yield one).
  if (out.length === 0) {
    for (const line of lines ?? []) {
      const m = (line.Description ?? "").match(RO_NUMBER_RE);
      if (m) push(m[1]);
    }
  }
  return out;
}

/** Pick the best RO# guess: the first candidate that looks like an RO number, else the
 *  first candidate raw (a customer name the OM can correct). */
export function pickRoNumber(candidates: string[]): string | null {
  for (const c of candidates) {
    const m = c.match(RO_NUMBER_RE);
    if (m?.[1]) return m[1];
  }
  return candidates[0] ?? null;
}

export function mapBillToCandidate(bill: QboBill): VendorDocCandidate {
  const roCandidates = extractRoCandidates(bill.Line);
  return {
    qboTxnType: "Bill",
    qboTxnId: bill.Id,
    vendorName: bill.VendorRef?.name?.trim() || null,
    billNo: bill.DocNumber?.trim() || null,
    billDate: bill.TxnDate?.trim() || null,
    totalCents: dollarsToCents(bill.TotalAmt),
    roNumber: pickRoNumber(roCandidates),
    roCandidates,
  };
}

export function mapPurchaseToCandidate(purchase: QboPurchase): VendorDocCandidate {
  const roCandidates = extractRoCandidates(purchase.Line);
  return {
    qboTxnType: "Purchase",
    qboTxnId: purchase.Id,
    // A Purchase's payee (vendor) is EntityRef; VendorRef doesn't exist on Purchase.
    vendorName: purchase.EntityRef?.name?.trim() || null,
    billNo: purchase.DocNumber?.trim() || null,
    billDate: purchase.TxnDate?.trim() || null,
    totalCents: dollarsToCents(purchase.TotalAmt),
    roNumber: pickRoNumber(roCandidates),
    roCandidates,
  };
}

// Invoice/expense numbers are alphanumeric with dashes/slashes/dots/spaces (e.g.
// "112-0217505-9695443", "6IV941884"). Reject anything else so we never interpolate an
// injection into the QBL string, and defensively escape the two QBL string metachars.
const DOC_NUMBER_RE = /^[A-Za-z0-9\-_/.\s]{1,64}$/;

export function assertQueryableDocNumber(docNumber: string): string {
  const trimmed = (docNumber ?? "").trim();
  if (!DOC_NUMBER_RE.test(trimmed)) {
    throw new QboClientError("That doesn't look like a valid invoice number.", { kind: "validation" });
  }
  return trimmed.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Fetch every QBO Bill AND Purchase whose DocNumber matches the typed invoice number.
 * Returns 0, 1, or many candidates. Throws QboClientError on a QBO/connection error.
 */
export async function fetchVendorDocByNumber(
  shopId: number,
  docNumber: string,
): Promise<VendorDocCandidate[]> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) {
    throw new QboClientError("QuickBooks is not connected for this shop.", { kind: "reconnect_required" });
  }
  const safe = assertQueryableDocNumber(docNumber);
  const client = new QboClient({ realmId });

  const [billRaw, purchaseRaw] = await Promise.all([
    client.query(`SELECT * FROM Bill WHERE DocNumber = '${safe}'`),
    client.query(`SELECT * FROM Purchase WHERE DocNumber = '${safe}'`),
  ]);

  const bills = billQueryResponseSchema.parse(billRaw).QueryResponse?.Bill ?? [];
  const purchases = purchaseQueryResponseSchema.parse(purchaseRaw).QueryResponse?.Purchase ?? [];

  return [...bills.map(mapBillToCandidate), ...purchases.map(mapPurchaseToCandidate)];
}

/**
 * Fetch the documents attached to a Bill/Purchase in QBO (the scanned parts invoice).
 * Attachments are not tier-gated. The TempDownloadUri is short-lived, so callers re-fetch
 * on demand rather than persisting the URL. Throws QboClientError on a QBO error.
 * NOTE: querying Attachable by AttachableRef is being confirmed against Jeff's realm (plan).
 */
export async function fetchVendorDocAttachments(
  shopId: number,
  qboTxnType: VendorDocType,
  qboTxnId: string,
): Promise<VendorDocAttachment[]> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) {
    throw new QboClientError("QuickBooks is not connected for this shop.", { kind: "reconnect_required" });
  }
  const safeId = assertQueryableDocNumber(qboTxnId);
  const client = new QboClient({ realmId });
  const raw = await client.query(
    `SELECT * FROM Attachable WHERE AttachableRef.EntityRef.Type = '${qboTxnType}' AND AttachableRef.EntityRef.value = '${safeId}'`,
  );
  const rows = attachableQueryResponseSchema.parse(raw).QueryResponse?.Attachable ?? [];
  return rows.map((a) => ({
    qboAttachableId: a.Id,
    fileName: a.FileName?.trim() || null,
    tempDownloadUri: a.TempDownloadUri?.trim() || null,
  }));
}
