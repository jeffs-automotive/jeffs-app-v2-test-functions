/**
 * Minimal Zod schemas for the QBO entities the v1 client touches (Customer,
 * Invoice, Account, JournalEntry) + the Fault envelope. Intentionally narrow — QBO entities are large;
 * we model the fields v1 reads/writes and refine per-action later. `code` is a
 * STRING (e.g. "003001"). See docs/qbo/qbo-api-client-plan.md.
 */
import { z } from "zod";

export const qboRefSchema = z.object({
  value: z.string(),
  name: z.string().optional(),
});

export const faultErrorSchema = z.object({
  Message: z.string().optional(),
  Detail: z.string().optional(),
  code: z.string(),
  element: z.string().optional(),
});

export const faultEnvelopeSchema = z.object({
  Fault: z.object({
    Error: z.array(faultErrorSchema),
    type: z.string().optional(),
  }),
  time: z.string().optional(),
});

export const customerSchema = z.object({
  Id: z.string().optional(),
  SyncToken: z.string().optional(),
  DisplayName: z.string().optional(),
  GivenName: z.string().optional(),
  FamilyName: z.string().optional(),
  CompanyName: z.string().optional(),
  PrimaryEmailAddr: z.object({ Address: z.string() }).optional(),
  PrimaryPhone: z.object({ FreeFormNumber: z.string() }).optional(),
  Active: z.boolean().optional(),
});

export const invoiceSchema = z.object({
  Id: z.string().optional(),
  SyncToken: z.string().optional(),
  CustomerRef: qboRefSchema,
  Line: z.array(z.unknown()),
  TxnDate: z.string().optional(),
  DueDate: z.string().optional(),
  DocNumber: z.string().optional(),
  TotalAmt: z.number().optional(),
});

/**
 * QBO Account — the COA entries QTekLink mirrors into `qbo_accounts` (C1).
 * Narrow projection of QBO's large Account entity: just the fields the mapping
 * UI + post-time validation read.
 */
export const accountSchema = z.object({
  Id: z.string().optional(),
  Name: z.string(),
  // The user-facing account NUMBER (e.g. "120" for ACCOUNTS RECEIVABLE). QBO may
  // OMIT it (many system accounts have none) or send null — .nullish() tolerates
  // both so a null AcctNum never DROPS the account (true-mirror would soft-delete it).
  AcctNum: z.string().nullish(),
  FullyQualifiedName: z.string().optional(),
  AccountType: z.string().optional(),
  AccountSubType: z.string().optional(),
  Classification: z.string().optional(),
  // QTekLink REQUIRES Active (fail-closed: safeParse DROPS a malformed account
  // missing it, rather than defaulting it active). NOTE: QBO models Active as
  // nullable, so this is an app-side tightening — Account responses do return it.
  Active: z.boolean(),
});

/**
 * QBO JournalEntry — the posting mechanism for QTekLink (C5 SALE builder + C8
 * poster). Narrow projection: the fields we build/read. Each line is a debit OR a
 * credit (JournalEntryLineDetail.PostingType) to an AccountRef; an A/R line may
 * carry an Entity, but QTekLink posts bulk A/R WITHOUT one (plan §13 — verified at
 * minorversion 75 + guarded by ar_entity_rejected). `.passthrough()` keeps QBO's
 * other fields on read without modeling them.
 */
export const journalEntryLineSchema = z
  .object({
    Id: z.string().optional(),
    Amount: z.number(),
    Description: z.string().optional(),
    DetailType: z.string().optional(),
    JournalEntryLineDetail: z
      .object({
        PostingType: z.enum(["Debit", "Credit"]),
        AccountRef: qboRefSchema,
        Entity: z.unknown().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const journalEntrySchema = z
  .object({
    Id: z.string().optional(),
    SyncToken: z.string().optional(),
    DocNumber: z.string().optional(),
    TxnDate: z.string().optional(),
    TotalAmt: z.number().optional(),
    Line: z.array(journalEntryLineSchema),
  })
  .passthrough();

export type QboRef = z.infer<typeof qboRefSchema>;
export type QboCustomer = z.infer<typeof customerSchema>;
export type QboInvoice = z.infer<typeof invoiceSchema>;
export type QboAccount = z.infer<typeof accountSchema>;
export type QboJournalEntryLine = z.infer<typeof journalEntryLineSchema>;
export type QboJournalEntry = z.infer<typeof journalEntrySchema>;
export type QboFaultEnvelope = z.infer<typeof faultEnvelopeSchema>;
