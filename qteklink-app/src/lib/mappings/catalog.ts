/**
 * Client-safe mapping catalog — the `kind` + `posting_role` enums (mirroring the
 * DB CHECK constraints in 20260606010000) plus display labels. No server imports,
 * so BOTH the mapping actions (Zod input validation) and the UI (selects/labels)
 * can import it.
 *
 * NOTE: the DB RPC `qteklink_set_mapping` (via `qteklink_role_accepts_type`) is
 * the AUTHORITATIVE role<->account-type compatibility gate. These constants are
 * only for input validation + display; they never decide what posts.
 */
export const MAPPING_KINDS = [
  "labor",
  "part_category",
  "fee",
  "sublet",
  "tax",
  "payment_type",
  "noncash_payment_type",
  "system",
] as const;
export type MappingKind = (typeof MAPPING_KINDS)[number];

export const POSTING_ROLES = [
  "income",
  "sales_tax_payable",
  "tire_fee_payable",
  "accounts_receivable",
  "undeposited_funds",
  "cc_fee",
  "noncash_contra",
] as const;
export type PostingRole = (typeof POSTING_ROLES)[number];

export const KIND_LABELS: Record<MappingKind, string> = {
  labor: "Labor",
  part_category: "Part category",
  fee: "Fee",
  sublet: "Sublet",
  tax: "Tax",
  payment_type: "Payment type",
  noncash_payment_type: "Non-cash payment type",
  system: "System account",
};

export const ROLE_LABELS: Record<PostingRole, string> = {
  income: "Income",
  sales_tax_payable: "Sales tax payable",
  tire_fee_payable: "Tire fee payable (PTAL)",
  accounts_receivable: "Accounts receivable",
  undeposited_funds: "Undeposited funds",
  cc_fee: "Credit-card fee",
  noncash_contra: "Non-cash contra",
};
