/**
 * Payroll derivation layer — Tekmetric RO mirror → payroll inputs (contract:
 * docs/qteklink/payroll-contract.md §derive.ts; formulas + decisions:
 * docs/qteklink/payroll-workbook-extraction-2026-07-10.md).
 *
 * Structure: THIN FETCHERS (service-role admin client, batched + paged reads of the
 * tekmetric_ros* mirror) feeding PURE AGGREGATORS (rows in, totals out) so every
 * rollup is unit-testable without a DB (`__tests__/derive.aggregators.test.ts`).
 *
 * INVARIANT #1 — THE AUTHORIZED FILTER (extraction doc #20, verified 772/772 on
 * June 2026): every rollup filters jobs to `authorized IS TRUE`; labor lines, parts,
 * and job fees pass through their PARENT JOB's flag. Declined (`false`) AND
 * undetermined (`null`) jobs are BOTH excluded — only `authorized === true` counts.
 * The filter is applied twice, deliberately:
 *   1. In the mirror queries (`.eq("authorized", true)`) — the SQL layer.
 *   2. Inside every pure aggregator — defense in depth: an unfiltered row set still
 *      aggregates correctly, and the unit tests assert it.
 * (`selected` is the WRONG flag — 535/772. Stakes: June 2026 declined jobs carry
 * 1,269.6 labor hours vs 1,176.7 authorized — unfiltered billed hours would be >2×.)
 *
 * Money: integer cents throughout (BIGINT cents in the mirror). Hours: 2dp.
 * Every derived result carries provenance { roCount, dateRange, asOf }.
 *
 * BUCKETING BASES (round-7 decision #39): HOURS derivations (per-tech billed hours,
 * the foreman's shop total, and the prior-year shop-hour goal) bucket ROs by their
 * COMPLETED date (shop-local) — including completed-but-not-yet-posted ROs — because
 * that reproduces the Tekmetric report Marie reconciles against and credits work when
 * performed. MONEY derivations (sales, fees, parts, GP inputs, spiffs) stay on the
 * POSTED date (the accounting side, backtested penny-exact). Both are TIMESTAMPTZ
 * converted via toShopLocalDate.
 *
 * MULTI-TENANT: every RO query is scoped by shop_id; child tables (jobs, labor,
 * parts) are scoped through their shop-filtered parent RO ids.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getShopSettings } from "@/lib/dal/settings";
import { toShopLocalDate } from "@/lib/sales/sale-builder";
import { isIsoDate } from "@/lib/format";

// ── Row types (local by design — the shared payroll types module is owned by the
//    calc agent; the wire step reconciles. Shapes mirror 20260703010000_tekmetric_ro_mirror.sql.) ──

export interface MirrorRoRow {
  id: number;
  service_writer_id: number | null;
  total_sales_cents: number | null;
  taxes_cents: number | null;
  fee_total_cents: number | null;
  posted_date: string | null;
  /** TIMESTAMPTZ — the #39 hours-bucketing basis (null until Tekmetric marks the RO complete). */
  completed_date: string | null;
  synced_at: string | null;
}

export interface MirrorJobRow {
  id: number;
  ro_id: number;
  authorized: boolean | null;
  job_category_name: string | null;
}

export interface MirrorLaborRow {
  id: number;
  job_id: number;
  technician_id: number | null;
  hours: number | null;
}

export interface MirrorPartRow {
  id: number;
  job_id: number;
  cost_cents: number | null;
  quantity: number | null;
}

/** RO-level sublet (decision #37 — the join hop between ROs and sublet items;
 *  no authorized flag plays a role in the pinned parts-cost formula). */
export interface MirrorSubletRow {
  id: number;
  ro_id: number;
}

export interface MirrorSubletItemRow {
  id: number;
  sublet_id: number;
  cost_cents: number | null;
}

/** Spiff category config (settings `payroll.spiff_categories` — extra keys like
 *  `first_seen`/`is_new` are carried by settings, not needed here). */
export interface SpiffCategoryConfig {
  name: string;
  counted: boolean;
  /** Spiffs per counted job (e.g. FLUID FLUSH 2 → 2). */
  multiplier: number;
}

export interface DeriveProvenance {
  roCount: number;
  /** Shop-local calendar dates, INCLUSIVE. */
  dateRange: { start: string; end: string };
  /** Mirror freshness: max `synced_at` across the ROs (query time when no rows). */
  asOf: string;
}

export interface Derived<T> {
  value: T;
  provenance: DeriveProvenance;
}

export interface DeriveOpts {
  /** IANA timezone for posted-date bucketing; defaults to the shop's configured tz. */
  tz?: string;
}

// ── Small pure helpers ────────────────────────────────────────────────────────

/** Round half away from zero to an integer (cents). */
export function roundCents(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

function round2(x: number): number {
  return roundCents(x * 100) / 100;
}

/** "YYYY-MM" → inclusive first/last shop-local dates of that month. Throws on bad input. */
export function monthDateRange(month: string): { start: string; end: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error(`payroll derive: month must be "YYYY-MM", got "${month}"`);
  }
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/** "YYYY-MM" → the SAME month one year earlier (round-3 decisions #22/#23). */
export function priorYearMonth(month: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error(`payroll derive: month must be "YYYY-MM", got "${month}"`);
  }
  return `${String(Number(month.slice(0, 4)) - 1).padStart(4, "0")}${month.slice(4)}`;
}

function provenanceFor(ros: MirrorRoRow[], start: string, end: string): DeriveProvenance {
  let asOf: string | null = null;
  for (const r of ros) {
    if (r.synced_at != null && (asOf === null || r.synced_at > asOf)) asOf = r.synced_at;
  }
  return { roCount: ros.length, dateRange: { start, end }, asOf: asOf ?? new Date().toISOString() };
}

// ── PURE aggregators (rows in, totals out) ────────────────────────────────────

/** INVARIANT #1 gate: the set of job ids with `authorized === true` (false AND null excluded). */
export function authorizedJobIds(jobs: MirrorJobRow[]): Set<number> {
  const ids = new Set<number>();
  for (const j of jobs) if (j.authorized === true) ids.add(j.id);
  return ids;
}

/**
 * Billed hours per technician: Σ labor-line `hours` attributed by labor-line
 * `technician_id`, lines counted ONLY when their parent job is authorized
 * (decision #7 + INVARIANT #1). Lines with a null technician_id are unattributable
 * per-tech and excluded here (they still count in {@link aggregateShopBilledHours}).
 * Hours rounded to 2dp per technician.
 */
export function aggregateBilledHoursByTechnician(
  jobs: MirrorJobRow[],
  laborLines: MirrorLaborRow[],
): Map<number, number> {
  const authorized = authorizedJobIds(jobs);
  const byTech = new Map<number, number>();
  for (const line of laborLines) {
    if (!authorized.has(line.job_id)) continue; // aggregator-side INVARIANT #1
    if (line.technician_id == null || line.hours == null) continue;
    byTech.set(line.technician_id, (byTech.get(line.technician_id) ?? 0) + line.hours);
  }
  for (const [tech, hours] of byTech) byTech.set(tech, round2(hours));
  return byTech;
}

/**
 * Total shop billed hours (foreman bonus input, decision #4): Σ labor-line hours on
 * authorized jobs — INCLUDING lines with no technician attribution (it's a shop total).
 */
export function aggregateShopBilledHours(jobs: MirrorJobRow[], laborLines: MirrorLaborRow[]): number {
  const authorized = authorizedJobIds(jobs);
  let total = 0;
  for (const line of laborLines) {
    if (!authorized.has(line.job_id)) continue; // aggregator-side INVARIANT #1
    if (line.hours == null) continue;
    total += line.hours;
  }
  return round2(total);
}

export interface SalesCandidates {
  /** Candidate A: Σ ro.total_sales_cents as-is. */
  totalSalesCents: number;
  /** Candidate B: Σ (ro.total_sales_cents − ro.taxes_cents) — "pre-tax" if candidate A
   *  turns out to include tax. The BACKTEST decides which matches the workbook. */
  totalSalesMinusTaxesCents: number;
}

/**
 * Month sales, BOTH candidate definitions (contract: keep both exported; the
 * backtest picks). RO-level totals are Tekmetric's own authorized-only rollups
 * (verified 772/772, extraction doc #20) — no job-level filter applies here.
 */
export function aggregateSalesCandidates(ros: MirrorRoRow[]): SalesCandidates {
  let total = 0;
  let minusTaxes = 0;
  for (const r of ros) {
    const sales = r.total_sales_cents ?? 0;
    total += sales;
    minusTaxes += sales - (r.taxes_cents ?? 0);
  }
  return { totalSalesCents: total, totalSalesMinusTaxesCents: minusTaxes };
}

/**
 * Month fees = Σ ro.fee_total_cents (decision #14). Tekmetric's RO-level rollup
 * already ≡ Σ authorized-job fees + RO fee lines (verified 772/772) — the authorized
 * filter is embedded upstream by Tekmetric, not re-applied here.
 */
export function aggregateFeesCents(ros: MirrorRoRow[]): number {
  let total = 0;
  for (const r of ros) total += r.fee_total_cents ?? 0;
  return total;
}

/**
 * Month "subtotal" (round-5, extraction #36 — REVERSES #28): month sales display
 * AFTER FEES = Σ(total_sales − taxes − fees) over posted ROs — the original
 * backtest-pinned (#21) definition (June 2026 = $273,061.13). Used for the bonus
 * panels' month sales AND the prior-year auto sales goal (#22/#23), so the "beat
 * last year" comparison stays apples-to-apples. The fee-INCLUSIVE figure
 * (`totalSalesMinusTaxesCents`) remains the INTERNAL GP base per #38.
 * RO-level totals are Tekmetric's own authorized-only rollups (extraction #20) —
 * no job-level filter applies here.
 */
export function aggregateMonthSubtotalCents(ros: MirrorRoRow[]): number {
  return aggregateSalesCandidates(ros).totalSalesMinusTaxesCents - aggregateFeesCents(ros);
}

/**
 * Month parts cost, the PARTS-TABLE half (decision #37, pinned penny-exact vs
 * Chris's June breakdown): Σ round(cost_cents × quantity) over AUTHORIZED jobs —
 * rounded PER LINE, half away from zero; quantity null → 1. Tires and batteries
 * live in the parts table too. June 2026: $69,080.90 (the old un-weighted
 * Σ cost_cents was $18,151.54 understated — removed). The RO-level sublet half
 * is {@link aggregateSubletCostCents}; {@link monthPartsCostCents} composes both.
 */
export function aggregateAuthorizedPartsCostCents(jobs: MirrorJobRow[], parts: MirrorPartRow[]): number {
  const authorized = authorizedJobIds(jobs);
  let total = 0;
  for (const p of parts) {
    if (!authorized.has(p.job_id)) continue; // aggregator-side INVARIANT #1
    total += roundCents((p.cost_cents ?? 0) * (p.quantity ?? 1));
  }
  return total;
}

/**
 * Month parts cost, the SUBLET half (decision #37): Σ sublet-item cost_cents over
 * ROs posted in the month. Sublets are RO-LEVEL — no authorized flag applies in
 * the pinned formula (the June penny-proof summed ALL sublet items on posted ROs:
 * $290.00). Null-safe.
 */
export function aggregateSubletCostCents(items: MirrorSubletItemRow[]): number {
  let total = 0;
  for (const it of items) total += it.cost_cents ?? 0;
  return total;
}

/**
 * Spiff counts per service writer (decision #15): for each AUTHORIZED job whose
 * `job_category_name` is a COUNTED category, add that category's multiplier to the
 * RO's service writer. Names match VERBATIM (settings store observed values as-is —
 * including the live "FLUID FLUSH ADD ON " trailing space). ROs with no service
 * writer are skipped (nobody to credit).
 */
export function aggregateSpiffCountsByServiceWriter(
  ros: Pick<MirrorRoRow, "id" | "service_writer_id">[],
  jobs: MirrorJobRow[],
  categories: SpiffCategoryConfig[],
): Map<number, number> {
  const multiplierByName = new Map<string, number>();
  for (const c of categories) if (c.counted === true) multiplierByName.set(c.name, c.multiplier);
  const swByRo = new Map<number, number | null>();
  for (const r of ros) swByRo.set(r.id, r.service_writer_id);

  const counts = new Map<number, number>();
  for (const j of jobs) {
    if (j.authorized !== true) continue; // aggregator-side INVARIANT #1
    if (j.job_category_name == null) continue;
    const multiplier = multiplierByName.get(j.job_category_name);
    if (multiplier === undefined) continue;
    const sw = swByRo.get(j.ro_id);
    if (sw == null) continue;
    counts.set(sw, (counts.get(sw) ?? 0) + multiplier);
  }
  return counts;
}

/** Observed category names not yet in the known set — verbatim compare, deduped, sorted. */
export function newCategoryNames(observed: (string | null)[], knownNames: string[]): string[] {
  const known = new Set(knownNames);
  const fresh = new Set<string>();
  for (const name of observed) {
    if (name == null) continue;
    if (!known.has(name)) fresh.add(name);
  }
  return [...fresh].sort();
}

// ── Thin fetchers (admin client; batched .in() chunks + .range() paging) ───────

const PAGE = 1000;
const ID_CHUNK = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

const RO_COLS =
  "id, service_writer_id, total_sales_cents, taxes_cents, fee_total_cents, posted_date, completed_date, synced_at";

async function resolveTz(shopId: number, tz: string | undefined): Promise<string> {
  if (tz) return tz;
  const { settings } = await getShopSettings(shopId);
  return settings.shopTimezone;
}

/** The two RO date columns derivations bucket on (round-7 decision #39). */
export type RoDateBasis = "posted_date" | "completed_date";

/**
 * PURE exact-bucketing half of the fetchers (exported for the boundary unit tests):
 * keep only ROs whose `basis` timestamp falls on a shop-LOCAL calendar date within
 * [start, end] inclusive. The evening boundary is the whole point — e.g. completed
 * 2026-07-04T23:30 ET arrives as 2026-07-05T03:30:00Z and MUST bucket to 7/4.
 */
export function rosInLocalRange(
  ros: MirrorRoRow[],
  basis: RoDateBasis,
  start: string,
  end: string,
  tz: string,
): MirrorRoRow[] {
  return ros.filter((r) => {
    const iso = r[basis];
    if (iso == null) return false;
    const local = toShopLocalDate(iso, tz);
    return local >= start && local <= end;
  });
}

/**
 * ROs whose `basis` date (shop-local) falls within [start, end] inclusive. Queries a
 * generous ±1-day UTC window, then filters exactly by the shop-local date via
 * {@link rosInLocalRange} (the safety-net idiom).
 */
async function fetchRosByLocalDate(
  shopId: number,
  basis: RoDateBasis,
  start: string,
  end: string,
  tz: string,
): Promise<MirrorRoRow[]> {
  const startIso = new Date(Date.parse(`${start}T00:00:00Z`) - DAY_MS).toISOString();
  const endIso = new Date(Date.parse(`${end}T00:00:00Z`) + 2 * DAY_MS).toISOString();
  const admin = createSupabaseAdminClient();
  const out: MirrorRoRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("tekmetric_ros")
      .select(RO_COLS)
      .eq("shop_id", shopId)
      .not(basis, "is", null)
      .gte(basis, startIso)
      .lt(basis, endIso)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`payroll derive: tekmetric_ros fetch failed: ${error.message}`);
    const rows = (data ?? []) as MirrorRoRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return rosInLocalRange(out, basis, start, end, tz);
}

/** ROs POSTED (shop-local) within [start, end] — the MONEY basis (#39). */
async function fetchPostedRos(shopId: number, start: string, end: string, tz: string): Promise<MirrorRoRow[]> {
  return fetchRosByLocalDate(shopId, "posted_date", start, end, tz);
}

/**
 * ROs COMPLETED (shop-local) within [start, end] — the HOURS basis (round-7 #39).
 * Deliberately ignores posted_date entirely: completed-but-NOT-yet-posted ROs are
 * included (that is the point — the Tekmetric report credits work when performed).
 */
async function fetchCompletedRos(shopId: number, start: string, end: string, tz: string): Promise<MirrorRoRow[]> {
  return fetchRosByLocalDate(shopId, "completed_date", start, end, tz);
}

/** Authorized jobs for a set of RO ids — `.eq("authorized", true)` is the SQL half of INVARIANT #1. */
async function fetchAuthorizedJobs(roIds: number[]): Promise<MirrorJobRow[]> {
  if (roIds.length === 0) return [];
  const admin = createSupabaseAdminClient();
  const out: MirrorJobRow[] = [];
  for (let i = 0; i < roIds.length; i += ID_CHUNK) {
    const chunk = roIds.slice(i, i + ID_CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from("tekmetric_ro_jobs")
        .select("id, ro_id, authorized, job_category_name")
        .in("ro_id", chunk)
        .eq("authorized", true) // SQL-side INVARIANT #1
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`payroll derive: tekmetric_ro_jobs fetch failed: ${error.message}`);
      const rows = (data ?? []) as MirrorJobRow[];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

/** Chunked + paged child fetch keyed on an arbitrary FK column (job_id for labor/
 *  parts, ro_id for sublets, sublet_id for sublet items — each hop rides its
 *  mirror index). */
async function fetchChildrenByKey<T>(
  table: string,
  cols: string,
  keyCol: string,
  ids: number[],
): Promise<T[]> {
  if (ids.length === 0) return [];
  const admin = createSupabaseAdminClient();
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from(table)
        .select(cols)
        .in(keyCol, chunk)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`payroll derive: ${table} fetch failed: ${error.message}`);
      const rows = (data ?? []) as T[];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

// ── Composed derivations (contract §derive.ts) ────────────────────────────────

/**
 * Billed hours per technician_id over ROs COMPLETED within [start, end] (inclusive
 * shop-local ISO dates — a pay period is Sun..Sat ×2). Decision #7 attribution
 * (labor-line technician_id, authorized jobs) on the round-7 #39 COMPLETED-date
 * basis — completed-but-not-yet-posted ROs count; posted-but-not-in-window do not.
 *
 * ACCEPTANCE REFERENCE (#39, Chris's Tekmetric report screenshots 2026-07-11):
 * for the 6/28–7/11 run, week 2 (7/5–7/11) must reproduce EXACTLY
 *   Trilli 55.05 / Fuhrer 49.43 / Vasiliou 45.90 / Stoneback 11.87
 * under completed-date bucketing (the posted basis was under by the
 * completed-not-yet-posted work).
 */
export async function billedHoursByTechnician(
  shopId: number,
  start: string,
  end: string,
  opts: DeriveOpts = {},
): Promise<Derived<Map<number, number>>> {
  if (!isIsoDate(start) || !isIsoDate(end)) {
    throw new Error(`payroll derive: billedHoursByTechnician needs ISO dates, got "${start}".."${end}"`);
  }
  const tz = await resolveTz(shopId, opts.tz);
  const ros = await fetchCompletedRos(shopId, start, end, tz);
  const jobs = await fetchAuthorizedJobs(ros.map((r) => r.id));
  const labor = await fetchChildrenByKey<MirrorLaborRow>(
    "tekmetric_ro_job_labor",
    "id, job_id, technician_id, hours",
    "job_id",
    jobs.map((j) => j.id),
  );
  return { value: aggregateBilledHoursByTechnician(jobs, labor), provenance: provenanceFor(ros, start, end) };
}

/**
 * Month sales — BOTH candidate definitions (Σ total_sales_cents, and Σ total minus
 * taxes); the backtest decides which matches the workbook's pre-tax sales (decision #3).
 */
export async function monthSalesPreTaxCents(
  shopId: number,
  month: string,
  opts: DeriveOpts = {},
): Promise<Derived<SalesCandidates>> {
  const { start, end } = monthDateRange(month);
  const tz = await resolveTz(shopId, opts.tz);
  const ros = await fetchPostedRos(shopId, start, end, tz);
  return { value: aggregateSalesCandidates(ros), provenance: provenanceFor(ros, start, end) };
}

/**
 * SAME-month-PREVIOUS-year subtotal = Σ(total_sales − taxes − fees), AFTER FEES
 * (round-5, extraction #36 — same definition as aggregateMonthSubtotalCents so the
 * "beat last year" comparison is apples-to-apples) — the auto-derived
 * service-advisor sales goal (#22/#23). `month` is the BONUS month ("YYYY-MM"); the
 * prior-year month is derived here. A provenance roCount of 0 means "no data" —
 * callers fall back to the legacy pay_config.sales_goal_cents.
 */
export async function priorYearMonthSubtotalCents(
  shopId: number,
  month: string,
  opts: DeriveOpts = {},
): Promise<Derived<number>> {
  const target = priorYearMonth(month);
  const { start, end } = monthDateRange(target);
  const tz = await resolveTz(shopId, opts.tz);
  const ros = await fetchPostedRos(shopId, start, end, tz);
  return { value: aggregateMonthSubtotalCents(ros), provenance: provenanceFor(ros, start, end) };
}

/** Month fees = Σ ro.fee_total_cents over ROs posted in the month (decision #14). */
export async function monthFeesCents(
  shopId: number,
  month: string,
  opts: DeriveOpts = {},
): Promise<Derived<number>> {
  const { start, end } = monthDateRange(month);
  const tz = await resolveTz(shopId, opts.tz);
  const ros = await fetchPostedRos(shopId, start, end, tz);
  return { value: aggregateFeesCents(ros), provenance: provenanceFor(ros, start, end) };
}

/**
 * Month parts cost (decision #37, pinned penny-exact vs Chris's June breakdown):
 *   Σ round(part.cost_cents × quantity) over AUTHORIZED jobs (per-line rounding;
 *   tires + batteries live in the parts table)
 * + Σ sublet-item cost_cents (RO-level sublets — joined through
 *   tekmetric_ro_sublets so both hops ride the mirror's indexes; no authorized
 *   flag in the pinned formula)
 * over ROs posted in the month. June 2026: 69,080.90 + 290.00 = $69,370.90 —
 * matches parts 53,434.56 / tires 13,191.60 / batteries 2,454.74 / sublet 290.00.
 */
export async function monthPartsCostCents(
  shopId: number,
  month: string,
  opts: DeriveOpts = {},
): Promise<Derived<number>> {
  const { start, end } = monthDateRange(month);
  const tz = await resolveTz(shopId, opts.tz);
  const ros = await fetchPostedRos(shopId, start, end, tz);
  const jobs = await fetchAuthorizedJobs(ros.map((r) => r.id));
  const parts = await fetchChildrenByKey<MirrorPartRow>(
    "tekmetric_ro_job_parts",
    "id, job_id, cost_cents, quantity",
    "job_id",
    jobs.map((j) => j.id),
  );
  const sublets = await fetchChildrenByKey<MirrorSubletRow>(
    "tekmetric_ro_sublets",
    "id, ro_id",
    "ro_id",
    ros.map((r) => r.id),
  );
  const subletItems = await fetchChildrenByKey<MirrorSubletItemRow>(
    "tekmetric_ro_sublet_items",
    "id, sublet_id, cost_cents",
    "sublet_id",
    sublets.map((s) => s.id),
  );
  return {
    value: aggregateAuthorizedPartsCostCents(jobs, parts) + aggregateSubletCostCents(subletItems),
    provenance: provenanceFor(ros, start, end),
  };
}

/**
 * Total shop billed hours for the month (foreman bonus input, decision #4) — ROs
 * COMPLETED in the month (round-7 #39; the same basis as per-tech billed hours so
 * the foreman's total ties to the report Marie reconciles against).
 */
export async function shopBilledHours(
  shopId: number,
  month: string,
  opts: DeriveOpts = {},
): Promise<Derived<number>> {
  const { start, end } = monthDateRange(month);
  const tz = await resolveTz(shopId, opts.tz);
  const ros = await fetchCompletedRos(shopId, start, end, tz);
  const jobs = await fetchAuthorizedJobs(ros.map((r) => r.id));
  const labor = await fetchChildrenByKey<MirrorLaborRow>(
    "tekmetric_ro_job_labor",
    "id, job_id, technician_id, hours",
    "job_id",
    jobs.map((j) => j.id),
  );
  return { value: aggregateShopBilledHours(jobs, labor), provenance: provenanceFor(ros, start, end) };
}

/**
 * SAME-month-PREVIOUS-year total shop billed hours — the auto-derived shop-foreman
 * hour goal (round-5 decision #32, mirroring the SA sales-goal pattern #22/#23).
 * `month` is the BONUS month ("YYYY-MM"); the prior-year month is derived here.
 * Same rollup as {@link shopBilledHours} (authorized jobs, null-technician lines
 * included — it's a shop total) on the SAME round-7 #39 COMPLETED-date basis, so
 * the goal comparison stays apples-to-apples. A provenance roCount of 0 means
 * "no data" — callers fall back to the legacy pay_config.shop_hour_goal.
 */
export async function priorYearShopBilledHours(
  shopId: number,
  month: string,
  opts: DeriveOpts = {},
): Promise<Derived<number>> {
  const target = priorYearMonth(month);
  const { start, end } = monthDateRange(target);
  const tz = await resolveTz(shopId, opts.tz);
  const ros = await fetchCompletedRos(shopId, start, end, tz);
  const jobs = await fetchAuthorizedJobs(ros.map((r) => r.id));
  const labor = await fetchChildrenByKey<MirrorLaborRow>(
    "tekmetric_ro_job_labor",
    "id, job_id, technician_id, hours",
    "job_id",
    jobs.map((j) => j.id),
  );
  return { value: aggregateShopBilledHours(jobs, labor), provenance: provenanceFor(ros, start, end) };
}

/**
 * Spiff counts per service_writer_id over ROs posted in the month, per the
 * counted-category config (decision #15): Σ multiplier per counted authorized job.
 */
export async function spiffCountsByServiceWriter(
  shopId: number,
  month: string,
  categories: SpiffCategoryConfig[],
  opts: DeriveOpts = {},
): Promise<Derived<Map<number, number>>> {
  const { start, end } = monthDateRange(month);
  const tz = await resolveTz(shopId, opts.tz);
  const ros = await fetchPostedRos(shopId, start, end, tz);
  const jobs = await fetchAuthorizedJobs(ros.map((r) => r.id));
  return {
    value: aggregateSpiffCountsByServiceWriter(ros, jobs, categories),
    provenance: provenanceFor(ros, start, end),
  };
}

/**
 * New-category catcher (decision #15): distinct `job_category_name` values in the
 * mirror not yet in the known set. ALL jobs, not authorized-only — a category
 * first seen on a declined job is still an observed category to configure.
 *
 * Uses the `qteklink_payroll_distinct_job_categories` RPC (recursive index
 * skip-scan, ~2ms). The previous client-side paging over every categorized job
 * row hit the Postgres statement timeout (57014) on its first page — live
 * failure 2026-07-11, migration 20260711140000.
 */
export async function discoverNewCategories(shopId: number, knownNames: string[]): Promise<string[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_payroll_distinct_job_categories", {
    p_shop_id: shopId,
  });
  if (error) throw new Error(`payroll derive: category discovery fetch failed: ${error.message}`);
  const observed = (data ?? []) as string[];
  return newCategoryNames(observed, knownNames);
}
