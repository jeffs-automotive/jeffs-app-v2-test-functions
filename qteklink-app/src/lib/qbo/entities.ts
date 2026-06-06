/**
 * Minimal Zod schemas for the QBO entities the v1 client touches (Customer,
 * Invoice) + the Fault envelope. Intentionally narrow — QBO entities are large;
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
  FullyQualifiedName: z.string().optional(),
  AccountType: z.string().optional(),
  AccountSubType: z.string().optional(),
  Classification: z.string().optional(),
  // QTekLink REQUIRES Active (fail-closed: safeParse DROPS a malformed account
  // missing it, rather than defaulting it active). NOTE: QBO models Active as
  // nullable, so this is an app-side tightening — Account responses do return it.
  Active: z.boolean(),
});

export type QboRef = z.infer<typeof qboRefSchema>;
export type QboCustomer = z.infer<typeof customerSchema>;
export type QboInvoice = z.infer<typeof invoiceSchema>;
export type QboAccount = z.infer<typeof accountSchema>;
export type QboFaultEnvelope = z.infer<typeof faultEnvelopeSchema>;
