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
  "store_credit",
  "fee_expense",
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
  store_credit: "Store credit (liability)",
  fee_expense: "Fee → expense (offset)",
};

/**
 * Derive the posting role from a Tekmetric item's (kind, sourceKey) — so the mapping
 * UI never asks the user to pick a role, and the action derives it SERVER-SIDE (never
 * trusts a client-supplied role). Returns null for an unknown tax/system key (→ reject).
 * Income-bearing kinds (labor/part/fee/sublet) always credit an income account; the
 * tax + system keys carry their specific liability/asset role.
 */
export function derivePostingRole(kind: string, sourceKey: string): PostingRole | null {
  switch (kind) {
    case "labor":
    case "part_category":
    case "fee":
    case "sublet":
      return "income";
    case "noncash_payment_type":
      return "noncash_contra";
    case "tax": {
      const k = sourceKey.trim().toLowerCase();
      if (k === "sales tax") return "sales_tax_payable";
      if (k === "tire tax") return "tire_fee_payable";
      return null;
    }
    case "system": {
      const k = sourceKey.trim().toLowerCase();
      if (k === "accounts_receivable") return "accounts_receivable";
      if (k === "undeposited_funds") return "undeposited_funds";
      if (k === "cc_fee") return "cc_fee";
      if (k === "store_credit") return "store_credit";
      return null;
    }
    default:
      return null;
  }
}

/**
 * A FEE's posting role follows the QBO type of the account the admin picks — a fee
 * can be booked as revenue OR as a contra-expense offset (Chris, 2026-07-01):
 *   - Income / Other Income   → `income`      (credit as revenue, the default)
 *   - Expense / Other Expense → `fee_expense` (credit to OFFSET that expense)
 *   - anything else           → null          (unmappable — the action rejects it)
 * Mirrors the DB gate `qteklink_role_accepts_type` (income vs fee_expense). Pure —
 * the account TYPE is resolved server-side from the COA (never a client value), so
 * this only maps a trusted type to the role; the DB trigger re-validates on write.
 */
export function feePostingRoleForAccountType(accountType: string | null): PostingRole | null {
  const t = (accountType ?? "").trim();
  if (t === "Income" || t === "Other Income") return "income";
  if (t === "Expense" || t === "Other Expense") return "fee_expense";
  return null;
}
