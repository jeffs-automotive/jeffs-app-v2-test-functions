/**
 * QBO Account schema — the COA entries QTekLink mirrors into `qbo_accounts` (C1). A narrow
 * projection of QBO's large Account entity: just the fields the mapping UI + post-time
 * validation read. `code` on faults etc. is modeled elsewhere.
 *
 * (The earlier Customer / Invoice / JournalEntry / Fault schemas here were qbo-api-client demo
 * leftovers — QTekLink posts bulk JournalEntries only and never touches the QBO Customer/Invoice
 * module [macro/micro], and the poster validates JE shape via @/lib/qbo/journal-entry — so they
 * were removed in the 2026-06-08 dead-code audit.)
 *
 * The Bill / Purchase / Attachable schemas below were ADDED 2026-07-17 for the back-office
 * module's read-only vendor-doc fetch (@/lib/qbo/vendor-docs): the office manager types an
 * invoice number and we read the matching QBO Bill (a posted vendor bill) or Purchase (an
 * expense / check / credit-card charge — "bills AND expenses") to auto-fill vendor / date /
 * amount / RO#. Narrow projections: only the fields that surface fetch results.
 */
import { z } from "zod";

export const accountSchema = z.object({
  Id: z.string().optional(),
  Name: z.string(),
  // The user-facing account NUMBER (e.g. "120" for ACCOUNTS RECEIVABLE). QBO may OMIT it
  // (many system accounts have none) or send null — .nullish() tolerates both so a null
  // AcctNum never DROPS the account (the true-mirror would otherwise soft-delete it).
  AcctNum: z.string().nullish(),
  FullyQualifiedName: z.string().optional(),
  AccountType: z.string().optional(),
  AccountSubType: z.string().optional(),
  Classification: z.string().optional(),
  // QTekLink REQUIRES Active (fail-closed: safeParse DROPS a malformed account missing it,
  // rather than defaulting it active). QBO models Active as nullable, so this is an app-side
  // tightening — Account responses do return it.
  Active: z.boolean(),
});

export type QboAccount = z.infer<typeof accountSchema>;

// ─── Vendor-doc read (back-office module) ────────────────────────────────────

/** A QBO reference — { value, name } (name is the display label; sometimes omitted). */
export const qboRefSchema = z.object({
  value: z.string().optional(),
  name: z.string().optional(),
});

// An expense line carries the customer/RO linkage. Chris: the RO# lives on a "customer
// line" — the CustomerRef on an expense line (fallback: the line Description). Both detail
// shapes (account-based + item-based) can carry a CustomerRef, so we read either.
const expenseLineDetailSchema = z.object({
  CustomerRef: qboRefSchema.nullish(),
  AccountRef: qboRefSchema.nullish(),
});

export const qboLineSchema = z.object({
  Id: z.string().optional(),
  Amount: z.number().nullish(),
  Description: z.string().nullish(),
  DetailType: z.string().optional(),
  AccountBasedExpenseLineDetail: expenseLineDetailSchema.nullish(),
  ItemBasedExpenseLineDetail: expenseLineDetailSchema.nullish(),
});
export type QboLine = z.infer<typeof qboLineSchema>;

/** QBO Bill (a posted vendor bill / A-P). Narrow projection. */
export const billSchema = z.object({
  Id: z.string(),
  DocNumber: z.string().nullish(),
  TxnDate: z.string().nullish(),
  TotalAmt: z.number().nullish(),
  VendorRef: qboRefSchema.nullish(),
  Line: z.array(qboLineSchema).nullish(),
  PrivateNote: z.string().nullish(),
});
export type QboBill = z.infer<typeof billSchema>;

/** QBO Purchase (an expense / check / credit-card charge). The payee vendor is EntityRef. */
export const purchaseSchema = z.object({
  Id: z.string(),
  DocNumber: z.string().nullish(),
  TxnDate: z.string().nullish(),
  TotalAmt: z.number().nullish(),
  PaymentType: z.string().nullish(),
  EntityRef: qboRefSchema.nullish(),
  Line: z.array(qboLineSchema).nullish(),
  PrivateNote: z.string().nullish(),
});
export type QboPurchase = z.infer<typeof purchaseSchema>;

/** QBO Attachable (an uploaded document — the scanned parts invoice). */
export const attachableSchema = z.object({
  Id: z.string(),
  FileName: z.string().nullish(),
  TempDownloadUri: z.string().nullish(),
  ContentType: z.string().nullish(),
});
export type QboAttachable = z.infer<typeof attachableSchema>;

/** `{ QueryResponse: { Bill?: [...] } }` — the entity array is omitted when there are 0 hits. */
export const billQueryResponseSchema = z.object({
  QueryResponse: z.object({ Bill: z.array(billSchema).nullish() }).nullish(),
});
export const purchaseQueryResponseSchema = z.object({
  QueryResponse: z.object({ Purchase: z.array(purchaseSchema).nullish() }).nullish(),
});
export const attachableQueryResponseSchema = z.object({
  QueryResponse: z.object({ Attachable: z.array(attachableSchema).nullish() }).nullish(),
});
