/**
 * SALE JournalEntry builder (C5) — PURE TypeScript (no React/Supabase), so it's
 * directly unit-testable (the Fat-DAL business-logic layer; the DAL
 * `src/lib/dal/sale-je.ts` fetches the RO snapshot + mappings and calls this).
 *
 * Builds ONE per-RO SALE JE draft from the RO's posting snapshot — `ro_posted`
 * (paid) OR `ro_sent_to_ar` (on A/R); both finalize the sale (plan §4/§5/§6):
 *   Dr Accounts Receivable [235] = totalSales (net), NO EntityRef (bulk A/R — §13;
 *     `arEntityless` flags it so the daily poster's ar_entity_rejected guard can detect
 *     a future QBO tightening rather than silently drop it).
 *   Cr each income account = GROSS − allocated discount:
 *     - Labor  → the labor income account (laborSales is authoritative).
 *     - Parts  → split by partType.code (PART/TIRE/BATTERY → distinct accounts),
 *                each category's gross = its share of partsSales (largest-remainder
 *                so the category lines sum EXACTLY to partsSales).
 *     - Fees   → by normalized name (RO fees[] + AUTHORIZED job fees[]).
 *     - Sublet → the sublet income account (subletSales).
 *   Cr tax: split the authoritative `taxes` lump → min(tire_qty×$1, taxes) → PTAL
 *     [252]; remainder → Sales Tax Payable [250].
 *
 * Discounts (plan §6): allocate the `discountTotal` lump LABOR → PARTS → SUBLET →
 * FEES, capped at each bucket's gross. Pass-through fees (mapping flag) are EXCLUDED
 * from the fee bucket. Within the parts bucket the discount lands on the present
 * category's account directly (one type) or pro-rata across categories (multiple);
 * same for the fee bucket. Income posts NET; the per-account allocation is returned
 * for persistence. No discount account/line (Chris).
 *
 * Filtering: only `authorized === true` jobs count — `jobs[]` carries declined
 * estimate lines that would massively overcount (research-findings §4.3). Verified
 * against 8 real ROs: Σ(authorized parts retail×qty) ties partsSales; Σ(authorized
 * labor rate×hours) ties laborSales; Σ(RO + authorized job fees) ties feeTotal.
 *
 * Unmapped sources are NOT guessed — they're returned in `unmapped` for the C7
 * resolution queue. Zero-amount lines are omitted (a fully-comped $0 RO yields no
 * lines). Money is integer cents throughout.
 */

export interface SnapshotPart {
  retail?: number | null;
  quantity?: number | null;
  partType?: { code?: string | null } | null;
}
export interface SnapshotLabor {
  rate?: number | null;
  hours?: number | null;
}
export interface SnapshotFeeLine {
  name?: string | null;
  total?: number | null;
}
export interface SnapshotJob {
  authorized?: boolean | null;
  parts?: SnapshotPart[] | null;
  labor?: SnapshotLabor[] | null;
  fees?: SnapshotFeeLine[] | null;
}
export interface RoSaleSnapshot {
  repairOrderNumber: string;
  repairOrderId: number;
  postedDate: string; // UTC ISO
  partsSales: number;
  laborSales: number;
  subletSales: number;
  feeTotal: number;
  discountTotal: number;
  taxes: number;
  totalSales: number;
  jobs?: SnapshotJob[] | null;
  fees?: SnapshotFeeLine[] | null; // RO-level fees
}

/** A resolved fee mapping: which account, and whether it's a pass-through fee
 *  (excluded from the discount waterfall). */
export interface FeeMapping {
  accountId: string;
  passThrough: boolean;
}
/** Accounts resolved from qteklink_mappings for this shop+realm. A null/absent
 *  entry means "no active mapping" → the source is reported in `unmapped`. */
export interface ResolvedMappings {
  laborAccountId: string | null;
  /** partType.code (PART/TIRE/BATTERY/…) → income account id. */
  partCategoryAccountIds: Record<string, string>;
  /** normalized fee name → {accountId, passThrough}. */
  feeAccountsByName: Record<string, FeeMapping>;
  subletAccountId: string | null;
  arAccountId: string | null;
  salesTaxAccountId: string | null;
  tireFeeAccountId: string | null;
}

export interface SaleSettings {
  /** IANA timezone, e.g. "America/New_York" — converts postedDate (UTC) to the JE TxnDate. */
  shopTimezone: string;
  /** Per-tire state fee in cents (PA = $1.00 = 100). */
  tireFeeCentsPerTire: number;
  /** Sales-tax rate in basis points (PA = 6.00% = 600). The BUILDER no longer uses it
   *  for the tax split (PTAL = min(tire_qty×$1, taxes) unconditionally — the baseline
   *  heuristic under-detected the fee); it remains here because the §8 reconcile gate
   *  shares this settings shape for its too-much-tax ceiling check. */
  salesTaxRateBps: number;
}

export type PostingType = "Debit" | "Credit";
export interface JeLine {
  accountId: string;
  postingType: PostingType;
  amountCents: number;
  description: string;
}
export interface SaleJournalEntry {
  docNumber: string; // "RO <#>"
  txnDate: string; // shop-local YYYY-MM-DD
  lines: JeLine[]; // zero-amount lines omitted
  /** The A/R debit carries no EntityRef (bulk receivable) — the ar_entity_rejected guard. */
  arEntityless: boolean;
  /** accountId → discount cents applied to it (audit-only output — the daily ledger persists lines, not the allocation). */
  discountAllocation: Record<string, number>;
  /** The authoritative `taxes` lump split into the per-tire fee (PTAL) vs sales tax
   *  (the clamp model). Always sums to ro.taxes. The §8 gate reads this rather than
   *  re-deriving the split. */
  taxSplit: { tireFeeCents: number; salesTaxCents: number };
  /** Sources with no active mapping (or a non-postable split) → C7 resolution queue. */
  unmapped: string[];
  balanced: boolean;
  totalDebitsCents: number;
  totalCreditsCents: number;
}

/** Normalize a fee name for mapping lookup: trim + lowercase (real fee names carry
 *  trailing spaces + inconsistent casing — research-findings §4.5). */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Distribute an integer `total` (cents) across buckets in proportion to `weights`,
 * using the largest-remainder (Hamilton) method so the parts sum EXACTLY to `total`.
 * Weights may be fractional (e.g. retail×qty). total===0 or all-zero weights → zeros.
 * Assumes total >= 0 (callers guard the discount/gross to be non-negative).
 */
export function allocateByShare(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  // Sum only the POSITIVE weight mass (the numerator uses Math.max(w,0) too) — else a
  // negative weight shrinks sumW and the positive buckets over-allocate beyond `total`.
  const sumW = weights.reduce((a, b) => a + Math.max(b, 0), 0);
  if (total === 0 || sumW <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * Math.max(w, 0)) / sumW);
  const out = exact.map((x) => Math.floor(x));
  const remainder = total - out.reduce((a, b) => a + b, 0);
  // Hand the leftover cents to the largest fractional parts (ties → lower index).
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < remainder && k < n; k++) {
    const slot = order[k];
    if (slot) out[slot.i] = (out[slot.i] ?? 0) + 1;
  }
  return out;
}

/** postedDate (UTC ISO) → the shop's local calendar date "YYYY-MM-DD" (QBO TxnDate). */
export function toShopLocalDate(utcIso: string, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(utcIso));
}

export function buildSaleJournalEntry(
  ro: RoSaleSnapshot,
  mappings: ResolvedMappings,
  settings: SaleSettings,
): SaleJournalEntry {
  const unmapped: string[] = [];
  const discountAllocation: Record<string, number> = {};
  const docNumber = `RO ${ro.repairOrderNumber}`;
  const authJobs = (ro.jobs ?? []).filter((j) => j.authorized === true);

  // A posted SALE RO is non-negative (a fully-comped RO is $0; refunds flow through the
  // payment side, not a negative sale). A negative total would post a negative A/R debit
  // → queue it (balanced=false), never post.
  if (ro.totalSales < 0) unmapped.push(`negative_total:${ro.totalSales}`);

  // ── 1. Gross income by source (authorized only) ─────────────────────────────
  // Parts: weight each category by Σ(retail×qty), then allocate partsSales by those
  // weights so category grosses tie EXACTLY to partsSales. tire_qty for the tax split.
  const catWeights = new Map<string, number>();
  let tireQty = 0;
  for (const j of authJobs) {
    for (const p of j.parts ?? []) {
      // Normalize the category code (trim + upper) so casing/whitespace variants match
      // the part_category mappings + the TIRE tire-fee check.
      const code = (p.partType?.code ?? "PART").trim().toUpperCase();
      catWeights.set(code, (catWeights.get(code) ?? 0) + (p.retail ?? 0) * (p.quantity ?? 0));
      if (code === "TIRE") tireQty += p.quantity ?? 0;
    }
  }
  const cats = [...catWeights.keys()];
  const partsGrossByCat = new Map<string, number>();
  if (ro.partsSales > 0) {
    const catWeightSum = cats.reduce((a, c) => a + Math.max(catWeights.get(c) ?? 0, 0), 0);
    if (cats.length === 0) {
      // partsSales > 0 but no parseable part lines → can't categorize; queue it.
      unmapped.push("part_category:unknown");
    } else if (catWeightSum <= 0) {
      // part lines exist but carry no positive weight (zero/negative retail×qty) → can't
      // split partsSales across categories; queue rather than silently drop partsSales.
      unmapped.push("part_category:unweighted");
    } else {
      const alloc = allocateByShare(ro.partsSales, cats.map((c) => catWeights.get(c) ?? 0));
      cats.forEach((c, i) => partsGrossByCat.set(c, alloc[i] ?? 0));
    }
  }

  // Fees by normalized name (RO-level + authorized job-level).
  const feeGrossByName = new Map<string, number>();
  const feeDisplay = new Map<string, string>();
  for (const f of [...(ro.fees ?? []), ...authJobs.flatMap((j) => j.fees ?? [])]) {
    if (!f.name) continue;
    const key = normalizeName(f.name);
    feeGrossByName.set(key, (feeGrossByName.get(key) ?? 0) + (f.total ?? 0));
    if (!feeDisplay.has(key)) feeDisplay.set(key, f.name.trim());
  }

  // ── 2. Discount waterfall: labor → parts → sublet → fees(non-pass-through) ───
  let rem = Math.max(ro.discountTotal, 0);
  const take = (cap: number): number => {
    const t = Math.min(rem, Math.max(cap, 0));
    rem -= t;
    return t;
  };
  const laborDisc = take(ro.laborSales);
  const partsDisc = take(ro.partsSales);
  const subletDisc = take(ro.subletSales);
  // Only NON-pass-through fees are discountable. (An unmapped fee is reported below;
  // it's treated as non-pass-through here, but it won't produce a postable line.)
  const feeKeys = [...feeGrossByName.keys()];
  // Only MAPPED, non-pass-through fees are discountable — an UNMAPPED fee produces no
  // credit line, so allocating discount to it would "lose" that discount (it's queued).
  const discountableFeeKeys = feeKeys.filter(
    (k) => mappings.feeAccountsByName[k] !== undefined && !mappings.feeAccountsByName[k].passThrough,
  );
  const discountableFeeGross = discountableFeeKeys.reduce((a, k) => a + (feeGrossByName.get(k) ?? 0), 0);
  const feesDisc = take(discountableFeeGross);
  if (rem > 0) {
    // Discount exceeded all discountable gross — should never happen; never auto-bucket.
    unmapped.push(`discount_residual:${rem}`);
  }

  // Sub-allocate the parts-bucket discount across the present categories (pro-rata;
  // a single category gets all of it) and the fee-bucket discount across fee accounts.
  const partsDiscByCat = new Map<string, number>();
  {
    const alloc = allocateByShare(partsDisc, cats.map((c) => partsGrossByCat.get(c) ?? 0));
    cats.forEach((c, i) => partsDiscByCat.set(c, alloc[i] ?? 0));
  }
  const feeDiscByName = new Map<string, number>();
  {
    const alloc = allocateByShare(
      feesDisc,
      discountableFeeKeys.map((k) => feeGrossByName.get(k) ?? 0),
    );
    discountableFeeKeys.forEach((k, i) => feeDiscByName.set(k, alloc[i] ?? 0));
  }

  // ── 3. Build the credit (income) lines = gross − allocated discount ──────────
  const credits: JeLine[] = [];
  const addCredit = (accountId: string, amountCents: number, description: string, discCents: number) => {
    if (discCents > 0) discountAllocation[accountId] = (discountAllocation[accountId] ?? 0) + discCents;
    if (amountCents !== 0) credits.push({ accountId, postingType: "Credit", amountCents, description });
  };

  // Labor.
  if (ro.laborSales > 0) {
    if (mappings.laborAccountId) {
      addCredit(mappings.laborAccountId, ro.laborSales - laborDisc, `${docNumber} — Labor`, laborDisc);
    } else {
      unmapped.push("labor");
    }
  }
  // Parts by category.
  for (const c of cats) {
    const gross = partsGrossByCat.get(c) ?? 0;
    if (gross === 0) continue;
    const acct = mappings.partCategoryAccountIds[c];
    if (acct) {
      addCredit(acct, gross - (partsDiscByCat.get(c) ?? 0), `${docNumber} — Parts (${c})`, partsDiscByCat.get(c) ?? 0);
    } else {
      unmapped.push(`part_category:${c}`);
    }
  }
  // Sublet.
  if (ro.subletSales > 0) {
    if (mappings.subletAccountId) {
      addCredit(mappings.subletAccountId, ro.subletSales - subletDisc, `${docNumber} — Sublet`, subletDisc);
    } else {
      unmapped.push("sublet");
    }
  }
  // Fees by name.
  for (const k of feeKeys) {
    const gross = feeGrossByName.get(k) ?? 0;
    if (gross === 0) continue;
    const m = mappings.feeAccountsByName[k];
    if (m) {
      addCredit(m.accountId, gross - (feeDiscByName.get(k) ?? 0), `${docNumber} — Fee: ${feeDisplay.get(k)}`, feeDiscByName.get(k) ?? 0);
    } else {
      unmapped.push(`fee:${feeDisplay.get(k)}`);
    }
  }
  // ── Tax split: separate the authoritative `taxes` lump → tire fee (PTAL) + sales tax.
  // The payload has NO per-line taxable flags and NO itemized PTA fee line — the PA
  // $1/tire fee is bundled INTO `taxes`. Rule:
  //   PTAL = min(tire_qty × $1, max(taxes, 0));  Sales Tax = taxes − PTAL.
  // The earlier baseline-excess heuristic (PTAL = clamp(taxes − round(rate×base), 0, cap))
  // systematically UNDER-detected the fee and mis-filed it as Sales Tax: the all-taxable
  // `base` includes NON-taxable fees (hazmat, tire disposal), inflating the baseline by
  // more than the fee on most tire-ROs, and a tax-exempt customer (A/R fleet) puts
  // `taxes` far below the baseline, flooring PTAL to 0 entirely. Re-validated against
  // Tekmetric's own day report 2026-06-11: 4 tire-ROs / 5 tires → $5.00 PTAL, including
  // a tax-exempt fleet RO (153065) the old rule scored $0. (The May "27/85 tire-ROs
  // charged it" finding was that heuristic measuring its own blind spot — Tekmetric
  // charges the fee per tire whenever the shop's fee is configured, which it is.)
  const tireFee = Math.min(tireQty * settings.tireFeeCentsPerTire, Math.max(ro.taxes, 0));
  const salesTax = ro.taxes - tireFee;
  if (salesTax < 0) {
    // Only reachable when taxes is NEGATIVE (corrupt) — PTAL is capped at max(taxes, 0)
    // for non-negative taxes. Queue, never post a negative tax line.
    unmapped.push(`tax_split:negative_sales_tax_${salesTax}_taxes_${ro.taxes}`);
  } else {
    if (tireFee > 0) {
      if (mappings.tireFeeAccountId) credits.push({ accountId: mappings.tireFeeAccountId, postingType: "Credit", amountCents: tireFee, description: `${docNumber} — Tire fee (PTAL)` });
      else unmapped.push("tire_fee_payable");
    }
    if (salesTax > 0) {
      if (mappings.salesTaxAccountId) credits.push({ accountId: mappings.salesTaxAccountId, postingType: "Credit", amountCents: salesTax, description: `${docNumber} — Sales tax` });
      else unmapped.push("sales_tax_payable");
    }
  }

  // ── 4. Debit A/R = net total (bulk, no EntityRef) ───────────────────────────
  const debits: JeLine[] = [];
  if (ro.totalSales !== 0) {
    if (mappings.arAccountId) {
      debits.push({ accountId: mappings.arAccountId, postingType: "Debit", amountCents: ro.totalSales, description: docNumber });
    } else {
      unmapped.push("accounts_receivable");
    }
  }

  const lines = [...debits, ...credits];
  const totalDebitsCents = debits.reduce((a, l) => a + l.amountCents, 0);
  const totalCreditsCents = credits.reduce((a, l) => a + l.amountCents, 0);

  return {
    docNumber,
    txnDate: toShopLocalDate(ro.postedDate, settings.shopTimezone),
    lines,
    arEntityless: true,
    discountAllocation,
    taxSplit: { tireFeeCents: tireFee, salesTaxCents: salesTax },
    unmapped,
    // Balanced only when fully mapped (no missing lines) AND debits === credits.
    balanced: unmapped.length === 0 && totalDebitsCents === totalCreditsCents,
    totalDebitsCents,
    totalCreditsCents,
  };
}
