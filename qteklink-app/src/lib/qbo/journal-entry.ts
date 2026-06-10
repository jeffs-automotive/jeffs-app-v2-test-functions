/**
 * QBO JournalEntry payload builder (C8c) — the cents→dollars boundary. Converts a
 * stored QTekLink JE (integer cents, the C5/C6 builder shape) into the QBO Accounting
 * API JournalEntry body the poster sends. Pure + deterministic (no I/O).
 *
 *   - Each line → a DetailType:'JournalEntryLineDetail' with PostingType (Debit/Credit)
 *     + AccountRef.value = the snapshotted QBO account id. Amount is DOLLARS (cents/100).
 *   - NO EntityRef on the A/R line — QTekLink posts bulk A/R against an Other-Current-
 *     Asset account (plan §13, verified at minorversion 75; guarded by ar_entity_rejected).
 *   - An UPDATE (correction) is a FULL balanced re-send under the current SyncToken
 *     (QBO replaces ALL lines — sparse=false; §13), so the caller passes id + syncToken.
 *   - Zero-amount lines are dropped; a non-integer / negative cents amount FAILS CLOSED
 *     (throws) rather than post corrupt money.
 */
export interface QboJeLineInput {
  accountId: string;
  postingType: "Debit" | "Credit";
  /** integer cents, > 0 (the builder emits positive amounts; direction is PostingType). */
  amountCents: number;
  description: string;
}

export interface QboJeInput {
  docNumber: string;
  txnDate: string; // YYYY-MM-DD
  /** the deterministic idempotency/crash-detection marker (→ PrivateNote). */
  privateNote: string;
  lines: QboJeLineInput[];
  /** present for an UPDATE (full-replacement correction); absent for a create. */
  id?: string;
  syncToken?: string;
}

/** cents → a 2-decimal dollar number; throws on a non-integer / negative cents value. */
function centsToDollars(amountCents: number, accountId: string): number {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new Error(`toQboJournalEntry: line for account ${accountId} has invalid cents (${String(amountCents)})`);
  }
  // amountCents is an integer; /100 then round to 2dp guards any float drift.
  return Math.round(amountCents) / 100;
}

export function toQboJournalEntry(input: QboJeInput): Record<string, unknown> {
  const lines = input.lines
    .filter((l) => l.amountCents !== 0)
    .map((l) => ({
      DetailType: "JournalEntryLineDetail",
      Amount: centsToDollars(l.amountCents, l.accountId),
      Description: l.description,
      JournalEntryLineDetail: {
        PostingType: l.postingType,
        AccountRef: { value: l.accountId },
      },
    }));

  if (lines.length === 0) {
    throw new Error("toQboJournalEntry: refusing to build a JournalEntry with no lines");
  }

  const body: Record<string, unknown> = {
    DocNumber: input.docNumber,
    TxnDate: input.txnDate,
    PrivateNote: input.privateNote,
    Line: lines,
  };
  if (input.id) {
    // Full-replacement update under SyncToken (NOT a sparse patch — §13). A missing
    // token FAILS CLOSED: guessing one gambles the optimistic lock (the caller must
    // read the current SyncToken from the ledger or QBO first).
    if (!input.syncToken) {
      throw new Error(`toQboJournalEntry: update of JE ${input.id} requires the current SyncToken`);
    }
    body.Id = input.id;
    body.SyncToken = input.syncToken;
    body.sparse = false;
  }
  return body;
}
