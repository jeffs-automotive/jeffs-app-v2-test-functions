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
 * Month "subtotal" (round-3 #22, Chris: "sales − tax" ≡ the backtest-pinned
 * Σ(total_sales − taxes − FEES) — Tekmetric's subtotal excludes fee lines). RO-level
 * totals are Tekmetric's own authorized-only rollups (extraction #20) — no job-level
 * filter applies here.
 */
export function aggregateMonthSubtotalCents(ros: MirrorRoRow[]): number {
  return aggregateSalesCandidates(ros).totalSalesMinusTaxesCents - aggregateFeesCents(ros);
}

/** Month parts cost (contract definition): Σ part.cost_cents over AUTHORIZED jobs only. */
export function aggregateAuthorizedPartsCostCents(jobs: MirrorJobRow[], parts: MirrorPartRow[]): number {
  const authorized = authorizedJobIds(jobs);
  let total = 0;
  for (const p of parts) {
    if (!authorized.has(p.job_id)) continue; // aggregator-side INVARIANT #1
    total += p.cost_cents ?? 0;
  }
  return total;
}

/**
 * Quantity-weighted parts-cost candidate: Σ round(cost_cents × quantity) over
 * authorized jobs (quantity null → 1). NOT the contract definition — exported so the
 * backtest can report whether the mirror's `cost_cents` is per-unit or extended.
 */
export function aggregateAuthorizedPartsCostQtyWeightedCents(
  jobs: MirrorJobRow[],
  parts: MirrorPartRow[],
): number {
  const authorized = authorizedJobIds(jobs);
  let total = 0;
  for (const p of parts) {
    if (!authorized.has(p.job_id)) continue; // aggregator-side INVARIANT #1
    total += roundCents((p.cost_cents ?? 0) * (p.quantity ?? 1));
  }
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

const RO_COLS = "id, service_writer_id, total_sales_cents, taxes_cents, fee_total_cents, posted_date, synced_at";

async function resolveTz(shopId: number, tz: string | undefined): Promise<string> {
  if (tz) return tz;
  const { settings } = await getShopSettings(shopId);
  return settings.shopTimezone;
}

/**
 * ROs POSTED (shop-local) within [start, end] inclusive. Queries a generous ±1-day
 * UTC window, then filters exactly by shop-local posted date (the safety-net idiom).
 */
async function fetchPostedRos(shopId: number, start: string, end: string, tz: string): Promise<MirrorRoRow[]> {
  const startIso = new Date(Date.parse(`${start}T00:00:00Z`) - DAY_MS).toISOString();
  const endIso = new Date(Date.parse(`${end}T00:00:00Z`) + 2 * DAY_MS).toISOString();
  const admin = createSupabaseAdminClient();
  const out: MirrorRoRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("tekmetric_ros")
      .select(RO_COLS)
      .eq("shop_id", shopId)
      .not("posted_date", "is", null)
      .gte("posted_date", startIso)
      .lt("posted_date", endIso)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`payroll derive: tekmetric_ros fetch failed: ${error.message}`);
    const rows = (data ?? []) as MirrorRoRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out.filter((r) => {
    const local = toShopLocalDate(r.posted_date as string, tz);
    return local >= start && local <= end;
  });
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

async function fetchChildrenForJobs<T>(table: string, cols: string, jobIds: number[]): Promise<T[]> {
  if (jobIds.length === 0) return [];
  const admin = createSupabaseAdminClient();
  const out: T[] = [];
  for (let i = 0; i < jobIds.length; i += ID_CHUNK) {
    const chunk = jobIds.slice(i, i + ID_CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from(table)
        .select(cols)
        .in("job_id", chunk)
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
 * Billed hours per technician_id over ROs posted within [start, end] (inclusive
 * shop-local ISO dates — a pay period is Sun..Sat ×2). Decision #7.
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
  const ros = await fetchPostedRos(shopId, start, end, tz);
  const jobs = await fetchAuthorizedJobs(ros.map((r) => r.id));
  const labor = await fetchChildrenForJobs<MirrorLaborRow>(
    "tekmetric_ro_job_labor",
    "id, job_id, technician_id, hours",
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
 * SAME-month-PREVIOUS-year subtotal = Σ(total_sales − taxes − fees) over ROs posted
 * in that prior-year month (round-3 #22/#23) — the auto-derived service-advisor
 * sales goal ("beat last year"). `month` is the BONUS month ("YYYY-MM"); the
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

/** Month parts cost = Σ authorized-job part cost_cents over ROs posted in the month. */
export async function monthPartsCostCents(
  shopId: number,
  month: string,
  opts: DeriveOpts = {},
): Promise<Derived<number>> {
  const { start, end } = monthDateRange(month);
  const tz = await resolveTz(shopId, opts.tz);
  const ros = await fetchPostedRos(shopId, start, end, tz);
  const jobs = await fetchAuthorizedJobs(ros.map((r) => r.id));
  const parts = await fetchChildrenForJobs<MirrorPartRow>(
    "tekmetric_ro_job_parts",
    "id, job_id, cost_cents, quantity",
    jobs.map((j) => j.id),
  );
  return { value: aggregateAuthorizedPartsCostCents(jobs, parts), provenance: provenanceFor(ros, start, end) };
}

/** Total shop billed hours for the month (foreman bonus input, decision #4). */
export async function shopBilledHours(
  shopId: number,
  month: string,
  opts: DeriveOpts = {},
): Promise<Derived<number>> {
  const { start, end } = monthDateRange(month);
  const tz = await resolveTz(shopId, opts.tz);
  const ros = await fetchPostedRos(shopId, start, end, tz);
  const jobs = await fetchAuthorizedJobs(ros.map((r) => r.id));
  const labor = await fetchChildrenForJobs<MirrorLaborRow>(
    "tekmetric_ro_job_labor",
    "id, job_id, technician_id, hours",
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
 * mirror not yet in the known set. Scans ALL jobs (not authorized-only — a category
 * first seen on a declined job is still an observed category to configure).
 */
export async function discoverNewCategories(shopId: number, knownNames: string[]): Promise<string[]> {
  const admin = createSupabaseAdminClient();
  const observed = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("tekmetric_ro_jobs")
      .select("job_category_name")
      .eq("shop_id", shopId)
      .not("job_category_name", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`payroll derive: category discovery fetch failed: ${error.message}`);
    const rows = (data ?? []) as { job_category_name: string | null }[];
    for (const r of rows) if (r.job_category_name != null) observed.add(r.job_category_name);
    if (rows.length < PAGE) break;
  }
  return newCategoryNames([...observed], knownNames);
}
