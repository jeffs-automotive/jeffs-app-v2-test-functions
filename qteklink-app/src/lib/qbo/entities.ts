/**
 * QBO Account schema — the COA entries QTekLink mirrors into `qbo_accounts` (C1). A narrow
 * projection of QBO's large Account entity: just the fields the mapping UI + post-time
 * validation read. `code` on faults etc. is modeled elsewhere.
 *
 * (The earlier Customer / Invoice / JournalEntry / Fault schemas here were qbo-api-client demo
 * leftovers — QTekLink posts bulk JournalEntries only and never touches the QBO Customer/Invoice
 * module [macro/micro], and the poster validates JE shape via @/lib/qbo/journal-entry — so they
 * were removed in the 2026-06-08 dead-code audit. `accountSchema` is the only live export.)
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
