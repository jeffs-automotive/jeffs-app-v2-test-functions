/**
 * SALE snapshot parsing + mapping resolution (C5) — the PURE seam between the raw
 * `qteklink_events` posting payloads / `qteklink_mappings` rows and the pure sale
 * builder (`@/lib/sales/sale-builder`): `parseSnapshot` (fail-closed payload → typed
 * snapshot) + `resolveMappings` (rows → the builder's account lookups). Consumed by
 * the shared day-draft builder (`day-drafts.ts`). (The per-RO `buildShopRoSaleJe`
 * DAL that lived here was retired with the per-RO posting path — the daily pipeline
 * builds whole days.)
 */
import { normalizeName, type ResolvedMappings, type RoSaleSnapshot } from "@/lib/sales/sale-builder";

export interface MappingRow {
  kind: string;
  source_key: string;
  qbo_account_id: string;
  posting_role: string;
  pass_through: boolean;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** A money value MUST be an integer count of cents (Tekmetric sends integer cents,
 *  verified). Reject a decimal-dollar / fractional / oversized value rather than let
 *  it corrupt the JE (100x or fractional-cent). Returns null on rejection. */
function cents(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

/** Map the raw posting (`ro_posted` / `ro_sent_to_ar`) body.data into the typed snapshot the builder reads.
 *  Returns null (→ caller treats as "no usable snapshot") when required fields are
 *  missing/invalid — fail closed, never build a JE from corrupt data. */
export function parseSnapshot(data: unknown): RoSaleSnapshot | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  // A posted RO must carry a parseable postedDate (the JE TxnDate source).
  if (typeof d.postedDate !== "string" || d.postedDate.length === 0 || Number.isNaN(Date.parse(d.postedDate))) {
    return null;
  }
  const repairOrderNumber = String(d.repairOrderNumber ?? d.id ?? "").trim();
  if (repairOrderNumber.length === 0) return null; // need an RO number for DocNumber

  // Every money total must be integer cents — fail closed if any isn't.
  const partsSales = cents(d.partsSales);
  const laborSales = cents(d.laborSales);
  const subletSales = cents(d.subletSales);
  const feeTotal = cents(d.feeTotal);
  const discountTotal = cents(d.discountTotal);
  const taxes = cents(d.taxes);
  const totalSales = cents(d.totalSales);
  if (
    partsSales === null || laborSales === null || subletSales === null ||
    feeTotal === null || discountTotal === null || taxes === null || totalSales === null
  ) {
    return null;
  }

  return {
    repairOrderNumber,
    repairOrderId: num(d.id),
    postedDate: d.postedDate,
    partsSales, laborSales, subletSales, feeTotal, discountTotal, taxes, totalSales,
    jobs: Array.isArray(d.jobs) ? (d.jobs as RoSaleSnapshot["jobs"]) : [],
    fees: Array.isArray(d.fees) ? (d.fees as RoSaleSnapshot["fees"]) : [],
  };
}

/** Build ResolvedMappings from the shop's active qteklink_mappings rows. */
export function resolveMappings(rows: MappingRow[]): ResolvedMappings {
  const r: ResolvedMappings = {
    laborAccountId: null,
    partCategoryAccountIds: {},
    feeAccountsByName: {},
    subletAccountId: null,
    arAccountId: null,
    salesTaxAccountId: null,
    tireFeeAccountId: null,
  };
  for (const m of rows) {
    switch (m.kind) {
      case "labor":
        r.laborAccountId = m.qbo_account_id;
        break;
      case "part_category":
        // source_key is the partType.code (PART/TIRE/BATTERY); normalize to match the
        // builder's normalized code (trim + upper).
        r.partCategoryAccountIds[m.source_key.trim().toUpperCase()] = m.qbo_account_id;
        break;
      case "fee":
        r.feeAccountsByName[normalizeName(m.source_key)] = {
          accountId: m.qbo_account_id,
          passThrough: m.pass_through === true,
        };
        break;
      case "sublet":
        r.subletAccountId = m.qbo_account_id;
        break;
      case "system":
        if (m.source_key === "accounts_receivable") r.arAccountId = m.qbo_account_id;
        break;
      case "tax":
        if (m.posting_role === "sales_tax_payable") r.salesTaxAccountId = m.qbo_account_id;
        else if (m.posting_role === "tire_fee_payable") r.tireFeeAccountId = m.qbo_account_id;
        break;
    }
  }
  return r;
}

