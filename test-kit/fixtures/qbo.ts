/**
 * QuickBooks Online (Intuit Accounting API) test fixtures — shared cookie-cutter data for the
 * recurring QBO failure modes (catalog: ../README.md). Pure TypeScript, NO test-framework
 * imports, so both Vitest and `deno test` can import it. The JE-input shape is STRUCTURAL
 * (matches qteklink-app's QboJeInput) so a contract suite can feed these straight into a real
 * `toQboJournalEntry` builder without the kit depending on any app's types.
 */

export interface JeLineInput {
  accountId: string;
  /** Direction lives in PostingType; Amount is always the POSITIVE magnitude. */
  postingType: "Debit" | "Credit";
  /** integer cents (> 0). A negative/fractional value must FAIL CLOSED in the builder. */
  amountCents: number;
  description: string;
}
export interface JeInput {
  docNumber: string;
  txnDate: string;
  privateNote: string;
  lines: JeLineInput[];
  /** present → an UPDATE (full balanced replace under the current SyncToken). */
  id?: string;
  syncToken?: string;
}

/** A balanced JE create: Σ debits === Σ credits (Dr A/R 1000 / Cr income 600 + tax 400). */
export const balancedJe: JeInput = {
  docNumber: "QTL-RO-2026-06-15",
  txnDate: "2026-06-15",
  privateNote: "QTL|7476|realm|day=2026-06-15|sales|v1",
  lines: [
    { accountId: "120", postingType: "Debit", amountCents: 100000, description: "RO 153211" },
    { accountId: "412", postingType: "Credit", amountCents: 60000, description: "Daily sales 2026-06-15" },
    { accountId: "206", postingType: "Credit", amountCents: 40000, description: "Daily sales 2026-06-15" },
  ],
};

/** A JE whose debits do NOT equal credits — must never reach the poster (the gate blocks it). */
export const unbalancedJe: JeInput = {
  ...balancedJe,
  lines: [
    { accountId: "120", postingType: "Debit", amountCents: 100000, description: "RO 153211" },
    { accountId: "412", postingType: "Credit", amountCents: 60000, description: "Daily sales" },
  ],
};

/** A line with a zero amount — the builder drops it (never an empty $0 line). */
export const zeroLineJe: JeInput = {
  ...balancedJe,
  lines: [...balancedJe.lines, { accountId: "999", postingType: "Debit", amountCents: 0, description: "comped" }],
};

/** A negative-cents line — the sign must come from PostingType, never a negative Amount → throws. */
export const negativeCentsJe: JeInput = {
  ...balancedJe,
  lines: [{ accountId: "120", postingType: "Debit", amountCents: -100000, description: "RO 153211" }],
};

/** A non-integer cents line — money is integer cents only → throws. */
export const nonIntegerCentsJe: JeInput = {
  ...balancedJe,
  lines: [{ accountId: "120", postingType: "Debit", amountCents: 100000.5, description: "RO 153211" }],
};

/** A correction UPDATE — carries the live Id + current SyncToken (full replacement). */
export const updateJe: JeInput = { ...balancedJe, id: "26058", syncToken: "4" };

/** An UPDATE missing the SyncToken — must FAIL CLOSED (never guess "0" and gamble the lock). */
export const updateJeNoSyncToken: JeInput = { ...balancedJe, id: "26058" };

// ── QBO API response/fault shapes (for client error-classification + retry contracts) ──
/** A throttle (429) — bounded retry honoring Retry-After. */
export const throttle429 = { status: 429, headers: { "retry-after": "1" }, body: { Fault: { Error: [{ code: "3001", Message: "throttled" }], type: "ServiceFault" } } };
/** A transient 5xx — bounded retry. */
export const serverError503 = { status: 503, body: "service unavailable" };
/** A validation Fault that mentions "entity" — classify as ar_entity_rejected, NOT a blind retry. */
export const entityValidationFault = { status: 400, body: { Fault: { Error: [{ code: "6190", Message: "A business validation error", Detail: "Entity is required" }], type: "ValidationFault" } } };
/** An auth/refresh failure — surfaces reconnect_required, never a silent retry loop. */
export const invalidGrant = { status: 400, body: { error: "invalid_grant" } };
