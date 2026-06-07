/**
 * SALE JE DAL (C5) — fetch an RO's latest posting (`ro_posted` / `ro_sent_to_ar`)
 * snapshot from the append-only `qteklink_events` ledger, resolve the shop's active
 * `qteklink_mappings`, and run the pure builder (`@/lib/sales/sale-builder`).
 *
 * Fat-DAL: the business logic is the PURE builder (unit-tested without mocks);
 * this module is the thin DB seam. C8's posting pipeline calls it.
 *
 * MULTI-TENANT: `shopId` is server-derived; `realmId` from the bound connection
 * (`resolveRealmForShop`). `qteklink_events` / `qteklink_mappings` are
 * service_role-only and service_role bypasses RLS → every query scopes shop_id +
 * realm_id. No silent failures: every DB error throws.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { RO_POSTING_EVENT_KINDS } from "@/lib/events/kinds";
import {
  buildSaleJournalEntry,
  normalizeName,
  type ResolvedMappings,
  type RoSaleSnapshot,
  type SaleJournalEntry,
  type SaleSettings,
} from "@/lib/sales/sale-builder";

const DEFAULT_TIRE_FEE_CENTS = 100; // PA per-tire state fee = $1.00 (qteklink_settings → C8)
const DEFAULT_SHOP_TZ = "America/New_York";

interface MappingRow {
  kind: string;
  source_key: string;
  qbo_account_id: string;
  posting_role: string;
  pass_through: boolean;
}

export interface BuildSaleResult {
  realmId: string | null;
  /** null when the shop has no connection OR the RO has no posting snapshot yet. */
  je: SaleJournalEntry | null;
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
function parseSnapshot(data: unknown): RoSaleSnapshot | null {
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
function resolveMappings(rows: MappingRow[]): ResolvedMappings {
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

/**
 * Build the SALE JE draft for one RO. Returns {realmId:null, je:null} when the
 * shop has no connection, and {realmId, je:null} when the RO has no posting
 * snapshot yet. Throws (FAIL CLOSED) on any DB error or an unusable snapshot.
 */
export async function buildShopRoSaleJe(
  shopId: number,
  repairOrderId: number,
  opts: { shopTimezone?: string; tireFeeCentsPerTire?: number } = {},
): Promise<BuildSaleResult> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { realmId: null, je: null };

  const admin = createSupabaseAdminClient();

  // Latest POSTING snapshot for this RO (append-only ledger → newest received).
  // ro_posted (paid) OR ro_sent_to_ar (on A/R) BOTH finalize the sale; an A/R RO
  // arrives ONLY as ro_sent_to_ar (@/lib/events/kinds), so filtering ro_posted
  // alone would silently drop every A/R sale. Latest-of-either wins via the order.
  const { data: evRows, error: evErr } = await admin
    .from("qteklink_events")
    .select("raw_body, received_at")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("tekmetric_ro_id", repairOrderId)
    .in("event_kind", [...RO_POSTING_EVENT_KINDS])
    // Latest by business posted-time, tie-break received_at — an out-of-order re-delivery
    // of an OLDER repost must not supersede the newest posted state.
    .order("tekmetric_event_at", { ascending: false, nullsFirst: false })
    .order("received_at", { ascending: false })
    .limit(1);
  if (evErr) throw new Error(`buildShopRoSaleJe (events) failed: ${evErr.message}`);

  const latest = (evRows ?? [])[0] as { raw_body: { data?: unknown } | null } | undefined;
  if (!latest) return { realmId, je: null }; // not posted yet

  const snapshot = parseSnapshot(latest.raw_body?.data);
  if (!snapshot) {
    throw new Error(`buildShopRoSaleJe: posting event for RO ${repairOrderId} has no usable snapshot`);
  }

  const { data: mapRows, error: mapErr } = await admin
    .from("qteklink_mappings")
    .select("kind, source_key, qbo_account_id, posting_role, pass_through")
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("active", true)
    // Deterministic order: if two active rows collapse to the same normalized key
    // (e.g. cased fee-name variants), the latest effective_from wins the overwrite.
    .order("effective_from", { ascending: true });
  if (mapErr) throw new Error(`buildShopRoSaleJe (mappings) failed: ${mapErr.message}`);

  const mappings = resolveMappings((mapRows ?? []) as MappingRow[]);
  const settings: SaleSettings = {
    shopTimezone: opts.shopTimezone ?? DEFAULT_SHOP_TZ,
    tireFeeCentsPerTire: opts.tireFeeCentsPerTire ?? DEFAULT_TIRE_FEE_CENTS,
  };

  return { realmId, je: buildSaleJournalEntry(snapshot, mappings, settings) };
}
