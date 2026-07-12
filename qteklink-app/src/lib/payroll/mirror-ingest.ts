/**
 * Tekmetric RO-mirror ingest (payroll) — the in-app port of
 * `scheduler-app/scripts/tekmetric/sync-ros.mjs` (the SOURCE OF TRUTH for semantics; the
 * script stays for backfills). Pages `/repair-orders` via the qteklink Tekmetric client
 * (OAuth via Vault — NOT the tekmetric-api-testing edge fn) and upserts into the
 * `tekmetric_ros*` mirror tables — one column per field.
 *
 * Ported semantics (locked, from the script):
 *   - `tekmetric_ros.raw` stores the untouched payload (nothing is ever lost).
 *   - Every object is key-diffed against the per-level whitelists below; unknown keys →
 *     `record_tekmetric_ingest_alert()` RPC, so a new Tekmetric field becomes a column
 *     instead of silently vanishing.
 *   - Rows that fail to insert (type surprises) are alerted as `insert_error`; the run continues.
 *   - Upsert order: parents (tekmetric_ros) BEFORE children; children are delete-then-insert
 *     per RO (Tekmetric can remove line items — PK upsert alone would strand deleted rows;
 *     job/sublet grandchildren go via FK CASCADE).
 *   - Incremental watermark: DERIVED from the mirror itself — max(created_date) +
 *     max(updated_date) of `tekmetric_ros` (shop-scoped here), newest minus a 24h lookback →
 *     since-date. Same storage as the script (no separate watermark table).
 *
 * Modes:
 *   - `{ mode: 'incremental' }` — the nightly path: two passes (created-since + updated-since,
 *     because `updatedDate` stays null until an RO changes).
 *   - `{ mode: 'range', postedDateStart, postedDateEnd, updatedDateStart? }` — the per-run
 *     "Refresh Tekmetric data" action (posted-date window only) and, with `updatedDateStart`,
 *     the round-7 #42 dry-run (posted window PLUS an updated-since pass — catches
 *     completed-but-unposted ROs the #39 hours basis buckets). Reads NO watermark and stores
 *     none. Tekmetric API contract (tested 2026-07-11): page size hard-capped at 100, NO
 *     batch-by-ids param, and UNKNOWN params are SILENTLY IGNORED (returning the full
 *     dataset) — only postedDateStart/postedDateEnd/updatedDateStart/start may be passed.
 *     CAVEAT (derived watermark): rows it upserts can carry created/updated dates newer than
 *     the incremental frontier, which raises the DERIVED max — the nightly's 24h lookback is
 *     the mitigation; a stored per-mode watermark is the fix if this ever bites.
 *
 * The mirror tables are deliberately direct-service-role-writable (documented departure from
 * the RPC-write-only qteklink convention — they mirror an external system verbatim).
 * Multi-tenant: every query/row is shop-scoped by the caller-supplied shopId.
 */
import * as Sentry from "@sentry/nextjs";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pageRepairOrders, type TekmetricRoPage } from "@/lib/tekmetric/client";
import { isIsoDate } from "@/lib/format";

/** Raw Tekmetric payload object. Values stay `unknown` ON PURPOSE: the mirror copies fields
 *  verbatim and lets the DB column types be the contract — a type surprise becomes an
 *  `insert_error` alert (the script's locked behavior), never a silent TS coercion. */
type RawObj = Record<string, unknown>;

// ─── per-level known-key whitelists (verbatim from sync-ros.mjs — the 2,500-RO census) ──────

const KNOWN = {
  ro: new Set([
    'id', 'repairOrderNumber', 'shopId', 'repairOrderStatus', 'repairOrderLabel',
    'repairOrderCustomLabel', 'color', 'appointmentId', 'customerId', 'technicianId',
    'serviceWriterId', 'vehicleId', 'milesIn', 'milesOut', 'keytag', 'completedDate',
    'postedDate', 'laborSales', 'partsSales', 'subletSales', 'discountTotal', 'feeTotal',
    'taxes', 'amountPaid', 'totalSales', 'jobs', 'sublets', 'fees', 'discounts',
    'customerConcerns', 'createdDate', 'updatedDate', 'deletedDate', 'estimateShareDate',
    'inspectionShareDate', 'invoiceShareDate', 'customerTimeOut', 'estimateUrl',
    'inspectionUrl', 'invoiceUrl', 'leadSource',
  ]),
  status: new Set(['id', 'code', 'name', 'postedOrAccrecv']),
  label: new Set(['id', 'code', 'name', 'status']),
  customLabel: new Set(['name']),
  job: new Set([
    'id', 'repairOrderId', 'vehicleId', 'customerId', 'name', 'authorized',
    'authorizedDate', 'selected', 'technicianId', 'note', 'cannedJobId',
    'jobCategoryName', 'partsTotal', 'laborTotal', 'discountTotal', 'feeTotal',
    'subtotal', 'archived', 'createdDate', 'completedDate', 'updatedDate', 'labor',
    'parts', 'fees', 'discounts', 'laborHours', 'loggedHours', 'sort',
  ]),
  labor: new Set(['id', 'name', 'rate', 'hours', 'complete', 'technicianId']),
  part: new Set([
    'id', 'quantity', 'brand', 'name', 'partNumber', 'description', 'cost', 'retail',
    'model', 'width', 'ratio', 'diameter', 'constructionType', 'loadIndex', 'loadRange',
    'speedRating', 'mileageWarranty', 'runFlat', 'sideWallStyle', 'temperature',
    'tireCategory', 'tireType', 'traction', 'treadwear', 'partType', 'partStatus',
    'dotNumbers',
  ]),
  partType: new Set(['id', 'code', 'name']),
  partStatus: new Set(['id', 'code', 'name']),
  fee: new Set(['id', 'name', 'total']),
  discount: new Set(['id', 'name', 'total']),
  concern: new Set(['id', 'concern', 'techComment']),
  sublet: new Set([
    'id', 'name', 'vendor', 'authorized', 'authorizedDate', 'selected', 'note', 'items',
    'price', 'cost', 'repairOrderId', 'sort', 'feeable', 'taxSublet', 'accountsPayable',
  ]),
  subletItem: new Set(['id', 'name', 'cost', 'price', 'complete']),
  vendor: new Set(['id', 'name', 'nickname', 'website', 'phone']),
  accountsPayable: new Set(['id', 'amount', 'amountPaid', 'paymentDetails', 'paymentType']),
} satisfies Record<string, Set<string>>;

export type KnownLevel = keyof typeof KNOWN;

// ─── unknown-field / insert-error alert collector (per-run — no module-level state) ─────────

export interface IngestAlert {
  level: string;
  keys: string[];
  ro_id: number | null;
  sample: Record<string, unknown>;
  occurrences: number;
}

export interface AlertCollector {
  /** Key-diff `obj` against the `level` whitelist; unknown keys → one deduped alert. */
  checkKeys(level: KnownLevel, obj: unknown, roId: number | null): void;
  /** Record a failed chunk insert (type surprise) — deduped per table. */
  recordInsertError(table: string, roIds: number[], error: unknown): void;
  list(): IngestAlert[];
}

export function createAlertCollector(): AlertCollector {
  const alerts = new Map<string, IngestAlert>(); // "level|k1,k2" → alert

  return {
    checkKeys(level, obj, roId) {
      if (obj === null || obj === undefined || typeof obj !== "object") return;
      const unknown = Object.keys(obj).filter((k) => !KNOWN[level].has(k)).sort();
      if (unknown.length === 0) return;
      const mapKey = `${level}|${unknown.join(",")}`;
      const existing = alerts.get(mapKey);
      if (existing) { existing.occurrences += 1; return; }
      const sample: Record<string, unknown> = {};
      for (const k of unknown) sample[k] = (obj as RawObj)[k];
      alerts.set(mapKey, { level, keys: unknown, ro_id: roId, sample, occurrences: 1 });
    },
    recordInsertError(table, roIds, error) {
      const mapKey = `insert_error|${table}`;
      const existing = alerts.get(mapKey);
      if (existing) { existing.occurrences += 1; return; }
      alerts.set(mapKey, {
        level: "insert_error",
        keys: [table],
        ro_id: roIds[0] ?? null,
        sample: {
          error: String((error as { message?: unknown } | null)?.message ?? error).slice(0, 500),
          ro_ids: roIds.slice(0, 20),
        },
        occurrences: 1,
      });
    },
    list: () => [...alerts.values()],
  };
}

// ─── field mappers (one column per JSON field — pure, exported for tests) ───────────────────

/** Date passthrough (null-normalized) — kept as in the script for fidelity. */
const ts = (v: unknown) => (v === null || v === undefined ? null : v);

/** Child-array accessor: non-arrays (absent/null/garbage) → []. */
const arr = (v: unknown): RawObj[] => (Array.isArray(v) ? (v as RawObj[]) : []);

export function mapRo(ro: RawObj, shopId: number, alerts: AlertCollector): RawObj {
  const roId = ro.id as number;
  const status = ro.repairOrderStatus as RawObj | null | undefined;
  const label = ro.repairOrderLabel as RawObj | null | undefined;
  const labelStatus = label?.status as RawObj | null | undefined;
  const customLabel = ro.repairOrderCustomLabel as RawObj | null | undefined;
  alerts.checkKeys("ro", ro, roId);
  alerts.checkKeys("status", status, roId);
  alerts.checkKeys("label", label, roId);
  if (labelStatus) alerts.checkKeys("status", labelStatus, roId);
  alerts.checkKeys("customLabel", customLabel, roId);
  return {
    id: roId,
    shop_id: ro.shopId ?? shopId,
    repair_order_number: ro.repairOrderNumber ?? null,
    appointment_id: ro.appointmentId ?? null,
    customer_id: ro.customerId ?? null,
    vehicle_id: ro.vehicleId ?? null,
    technician_id: ro.technicianId ?? null,
    service_writer_id: ro.serviceWriterId ?? null,
    keytag: ro.keytag ?? null,
    color: ro.color ?? null,
    miles_in: ro.milesIn ?? null,
    miles_out: ro.milesOut ?? null,
    lead_source: ro.leadSource ?? null,
    status_id: status?.id ?? null,
    status_code: status?.code ?? null,
    status_name: status?.name ?? null,
    status_posted_or_accrecv: status?.postedOrAccrecv ?? null,
    label_id: label?.id ?? null,
    label_code: label?.code ?? null,
    label_name: label?.name ?? null,
    label_status_id: labelStatus?.id ?? null,
    label_status_code: labelStatus?.code ?? null,
    label_status_name: labelStatus?.name ?? null,
    label_status_posted_or_accrecv: labelStatus?.postedOrAccrecv ?? null,
    custom_label_name: customLabel?.name ?? null,
    labor_sales_cents: ro.laborSales ?? null,
    parts_sales_cents: ro.partsSales ?? null,
    sublet_sales_cents: ro.subletSales ?? null,
    discount_total_cents: ro.discountTotal ?? null,
    fee_total_cents: ro.feeTotal ?? null,
    taxes_cents: ro.taxes ?? null,
    amount_paid_cents: ro.amountPaid ?? null,
    total_sales_cents: ro.totalSales ?? null,
    created_date: ts(ro.createdDate),
    updated_date: ts(ro.updatedDate),
    completed_date: ts(ro.completedDate),
    posted_date: ts(ro.postedDate),
    deleted_date: ts(ro.deletedDate),
    customer_time_out: ts(ro.customerTimeOut),
    estimate_share_date: ts(ro.estimateShareDate),
    inspection_share_date: ts(ro.inspectionShareDate),
    invoice_share_date: ts(ro.invoiceShareDate),
    estimate_url: ro.estimateUrl ?? null,
    inspection_url: ro.inspectionUrl ?? null,
    invoice_url: ro.invoiceUrl ?? null,
    raw: ro,
    synced_at: new Date().toISOString(),
  };
}

export function mapJob(job: RawObj, roId: number, shopId: number, alerts: AlertCollector): RawObj {
  alerts.checkKeys("job", job, roId);
  return {
    id: job.id,
    ro_id: roId,
    shop_id: shopId,
    customer_id: job.customerId ?? null,
    vehicle_id: job.vehicleId ?? null,
    name: job.name ?? null,
    note: job.note ?? null,
    canned_job_id: job.cannedJobId ?? null,
    job_category_name: job.jobCategoryName ?? null,
    technician_id: job.technicianId ?? null,
    authorized: job.authorized ?? null,
    authorized_date: ts(job.authorizedDate),
    selected: job.selected ?? null,
    archived: job.archived ?? null,
    sort: job.sort ?? null,
    labor_hours: job.laborHours ?? null,
    logged_hours: job.loggedHours ?? null,
    parts_total_cents: job.partsTotal ?? null,
    labor_total_cents: job.laborTotal ?? null,
    discount_total_cents: job.discountTotal ?? null,
    fee_total_cents: job.feeTotal ?? null,
    subtotal_cents: job.subtotal ?? null,
    created_date: ts(job.createdDate),
    updated_date: ts(job.updatedDate),
    completed_date: ts(job.completedDate),
  };
}

export function mapLabor(l: RawObj, jobId: number, roId: number, alerts: AlertCollector): RawObj {
  alerts.checkKeys("labor", l, roId);
  return {
    id: l.id, job_id: jobId, ro_id: roId,
    name: l.name ?? null, rate_cents: l.rate ?? null, hours: l.hours ?? null,
    complete: l.complete ?? null, technician_id: l.technicianId ?? null,
  };
}

export function mapPart(p: RawObj, jobId: number, roId: number, alerts: AlertCollector): RawObj {
  const partType = p.partType as RawObj | null | undefined;
  const partStatus = p.partStatus as RawObj | null | undefined;
  alerts.checkKeys("part", p, roId);
  alerts.checkKeys("partType", partType, roId);
  if (partStatus) alerts.checkKeys("partStatus", partStatus, roId);
  return {
    id: p.id, job_id: jobId, ro_id: roId,
    quantity: p.quantity ?? null, brand: p.brand ?? null, name: p.name ?? null,
    part_number: p.partNumber ?? null, description: p.description ?? null,
    cost_cents: p.cost ?? null, retail_cents: p.retail ?? null, model: p.model ?? null,
    width: p.width ?? null, ratio: p.ratio ?? null, diameter: p.diameter ?? null,
    construction_type: p.constructionType ?? null, load_index: p.loadIndex ?? null,
    load_range: p.loadRange ?? null, speed_rating: p.speedRating ?? null,
    mileage_warranty: p.mileageWarranty ?? null, run_flat: p.runFlat ?? null,
    side_wall_style: p.sideWallStyle ?? null, temperature: p.temperature ?? null,
    tire_category: p.tireCategory ?? null, tire_type: p.tireType ?? null,
    traction: p.traction ?? null, treadwear: p.treadwear ?? null,
    dot_numbers: Array.isArray(p.dotNumbers) && p.dotNumbers.length ? p.dotNumbers : null,
    part_type_id: partType?.id ?? null, part_type_code: partType?.code ?? null,
    part_type_name: partType?.name ?? null,
    part_status_id: partStatus?.id ?? null, part_status_code: partStatus?.code ?? null,
    part_status_name: partStatus?.name ?? null,
  };
}

export function mapConcern(c: RawObj, roId: number, alerts: AlertCollector): RawObj {
  alerts.checkKeys("concern", c, roId);
  return { id: c.id, ro_id: roId, concern: c.concern ?? null, tech_comment: c.techComment ?? null };
}

export function mapSublet(s: RawObj, roId: number, alerts: AlertCollector): RawObj {
  const vendor = s.vendor as RawObj | null | undefined;
  const ap = s.accountsPayable as RawObj | null | undefined;
  alerts.checkKeys("sublet", s, roId);
  if (vendor) alerts.checkKeys("vendor", vendor, roId);
  if (ap) alerts.checkKeys("accountsPayable", ap, roId);
  return {
    id: s.id, ro_id: roId,
    name: s.name ?? null, note: s.note ?? null,
    price_cents: s.price ?? null, cost_cents: s.cost ?? null,
    authorized: s.authorized ?? null, authorized_date: ts(s.authorizedDate),
    selected: s.selected ?? null, sort: s.sort ?? null,
    feeable: s.feeable ?? null, tax_sublet: s.taxSublet ?? null,
    vendor_id: vendor?.id ?? null, vendor_name: vendor?.name ?? null,
    vendor_nickname: vendor?.nickname ?? null, vendor_phone: vendor?.phone ?? null,
    vendor_website: vendor?.website ?? null,
    ap_id: ap?.id ?? null,
    ap_amount_cents: ap?.amount ?? null,
    ap_amount_paid_cents: ap?.amountPaid ?? null,
    ap_payment_type: ap?.paymentType ?? null,
    ap_payment_details: ap?.paymentDetails ?? null,
  };
}

export function mapSubletItem(it: RawObj, subletId: number, roId: number, alerts: AlertCollector): RawObj {
  alerts.checkKeys("subletItem", it, roId);
  return {
    id: it.id, sublet_id: subletId, ro_id: roId,
    name: it.name ?? null, cost_cents: it.cost ?? null, price_cents: it.price ?? null,
    complete: it.complete ?? null,
  };
}

// ─── DB surface (structural — the admin client satisfies it; tests inject a mock) ───────────

type DbResult = { error: { message: string } | null };
type DbRowsResult = DbResult & { data: Record<string, unknown>[] | null };

export interface MirrorDb {
  from(table: string): {
    upsert(rows: RawObj[], opts: { onConflict: string }): PromiseLike<DbResult>;
    insert(rows: RawObj[]): PromiseLike<DbResult>;
    delete(): { in(column: string, values: number[]): PromiseLike<DbResult> };
    select(columns: string): {
      eq(column: string, value: number): {
        not(column: string, op: "is", value: null): {
          order(column: string, opts: { ascending: boolean }): {
            limit(n: number): PromiseLike<DbRowsResult>;
          };
        };
      };
    };
  };
  rpc(fn: "record_tekmetric_ingest_alert", args: Record<string, unknown>): PromiseLike<DbResult>;
}

// ─── upsert one page of ROs (parents before children; children delete-then-insert) ──────────

async function chunkedWrite(
  table: string,
  rows: RawObj[],
  roIds: number[],
  alerts: AlertCollector,
  op: (slice: RawObj[]) => PromiseLike<DbResult>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500);
    const { error } = await op(slice);
    if (error) alerts.recordInsertError(table, roIds, error); // alerted + persisted; the run continues
  }
}

/** Exported for the round-7 #40 webhook mirror-apply path (payroll-live.ts), which
 *  applies webhook RO payloads through THESE SAME mappers — single-sourced, never
 *  duplicated in Deno/SQL. */
export async function upsertPage(
  db: MirrorDb,
  shopId: number,
  ros: RawObj[],
  alerts: AlertCollector,
): Promise<{ ros: number; jobs: number; concerns: number }> {
  const roRows: RawObj[] = [];
  const jobs: RawObj[] = [], labor: RawObj[] = [], parts: RawObj[] = [], jobFees: RawObj[] = [], jobDiscounts: RawObj[] = [];
  const fees: RawObj[] = [], discounts: RawObj[] = [], concerns: RawObj[] = [], sublets: RawObj[] = [], subletItems: RawObj[] = [];

  for (const ro of ros) {
    const roId = ro.id as number;
    roRows.push(mapRo(ro, shopId, alerts));
    for (const j of arr(ro.jobs)) {
      const jobId = j.id as number;
      jobs.push(mapJob(j, roId, shopId, alerts));
      for (const l of arr(j.labor)) labor.push(mapLabor(l, jobId, roId, alerts));
      for (const p of arr(j.parts)) parts.push(mapPart(p, jobId, roId, alerts));
      for (const f of arr(j.fees)) { alerts.checkKeys("fee", f, roId); jobFees.push({ id: f.id, job_id: jobId, ro_id: roId, name: f.name ?? null, total_cents: f.total ?? null }); }
      for (const d of arr(j.discounts)) { alerts.checkKeys("discount", d, roId); jobDiscounts.push({ id: d.id, job_id: jobId, ro_id: roId, name: d.name ?? null, total_cents: d.total ?? null }); }
    }
    for (const f of arr(ro.fees)) { alerts.checkKeys("fee", f, roId); fees.push({ id: f.id, ro_id: roId, name: f.name ?? null, total_cents: f.total ?? null }); }
    for (const d of arr(ro.discounts)) { alerts.checkKeys("discount", d, roId); discounts.push({ id: d.id, ro_id: roId, name: d.name ?? null, total_cents: d.total ?? null }); }
    for (const c of arr(ro.customerConcerns)) concerns.push(mapConcern(c, roId, alerts));
    for (const s of arr(ro.sublets)) {
      sublets.push(mapSublet(s, roId, alerts));
      for (const it of arr(s.items)) subletItems.push(mapSubletItem(it, s.id as number, roId, alerts));
    }
  }

  const roIds = roRows.map((r) => r.id as number);

  // parent upsert FIRST (children FK-reference it)
  await chunkedWrite("tekmetric_ros", roRows, roIds, alerts, (slice) =>
    db.from("tekmetric_ros").upsert(slice, { onConflict: "id" }));

  // children: delete-then-insert per RO (Tekmetric can remove line items; PK upsert alone
  // would strand deleted rows). Job/sublet grandchildren go via FK CASCADE.
  for (const table of ["tekmetric_ro_jobs", "tekmetric_ro_fees", "tekmetric_ro_discounts", "tekmetric_ro_customer_concerns", "tekmetric_ro_sublets"]) {
    const { error } = await db.from(table).delete().in("ro_id", roIds);
    if (error) alerts.recordInsertError(`${table}:delete`, roIds, error);
  }

  await chunkedWrite("tekmetric_ro_jobs", jobs, roIds, alerts, (s) => db.from("tekmetric_ro_jobs").insert(s));
  await chunkedWrite("tekmetric_ro_job_labor", labor, roIds, alerts, (s) => db.from("tekmetric_ro_job_labor").insert(s));
  await chunkedWrite("tekmetric_ro_job_parts", parts, roIds, alerts, (s) => db.from("tekmetric_ro_job_parts").insert(s));
  await chunkedWrite("tekmetric_ro_job_fees", jobFees, roIds, alerts, (s) => db.from("tekmetric_ro_job_fees").insert(s));
  await chunkedWrite("tekmetric_ro_job_discounts", jobDiscounts, roIds, alerts, (s) => db.from("tekmetric_ro_job_discounts").insert(s));
  await chunkedWrite("tekmetric_ro_fees", fees, roIds, alerts, (s) => db.from("tekmetric_ro_fees").insert(s));
  await chunkedWrite("tekmetric_ro_discounts", discounts, roIds, alerts, (s) => db.from("tekmetric_ro_discounts").insert(s));
  await chunkedWrite("tekmetric_ro_customer_concerns", concerns, roIds, alerts, (s) => db.from("tekmetric_ro_customer_concerns").insert(s));
  await chunkedWrite("tekmetric_ro_sublets", sublets, roIds, alerts, (s) => db.from("tekmetric_ro_sublets").insert(s));
  await chunkedWrite("tekmetric_ro_sublet_items", subletItems, roIds, alerts, (s) => db.from("tekmetric_ro_sublet_items").insert(s));

  return { ros: roRows.length, jobs: jobs.length, concerns: concerns.length };
}

// ─── watermark (derived from the mirror — the script's storage, shop-scoped) ────────────────

async function readWatermark(db: MirrorDb, shopId: number): Promise<{ created: string | null; updated: string | null }> {
  // Consider BOTH created_date and updated_date (updatedDate is null until an RO changes).
  const w: { created: string | null; updated: string | null } = { created: null, updated: null };
  for (const col of ["created_date", "updated_date"] as const) {
    const { data, error } = await db
      .from("tekmetric_ros").select(col).eq("shop_id", shopId).not(col, "is", null)
      .order(col, { ascending: false }).limit(1);
    if (error) throw new Error(`mirror-ingest watermark query (${col}) failed: ${error.message}`);
    const v = data?.[0]?.[col];
    if (typeof v === "string") w[col === "created_date" ? "created" : "updated"] = v;
  }
  return w;
}

// ─── the run ─────────────────────────────────────────────────────────────────────────────────

export type MirrorIngestOpts =
  | { mode: "incremental" }
  | {
      mode: "range";
      postedDateStart: string;
      postedDateEnd: string;
      /** Round-7 #42 (dry-run): add a second pass fetching ROs UPDATED since this
       *  date — the posted window alone misses completed-but-unposted ROs, which the
       *  #39 hours basis buckets. ONLY a Tekmetric-supported param may go here
       *  (unknown params are silently ignored → the full 148k dataset). */
      updatedDateStart?: string;
    };

export interface MirrorIngestDeps {
  shopId: number;
  /** Inject the DB (tests); defaults to the service-role admin client. */
  db?: MirrorDb;
  /** Inject the Tekmetric RO pager (tests); defaults to the client's pageRepairOrders. */
  pageRos?: (shopId: number, query: Record<string, string | number>) => AsyncIterable<TekmetricRoPage>;
}

export interface MirrorIngestResult {
  rosUpserted: number;
  pagesFetched: number;
  /** Also persisted via record_tekmetric_ingest_alert — returned for the caller's summary. */
  alerts: IngestAlert[];
  /** The incremental since-date used (newest mirror date − 24h); null in range mode. */
  watermark: string | null;
}

/** Persist the run's alerts via the SECURITY DEFINER RPC. A flush failure must not discard
 *  the ingest result (the alerts are still returned to the caller) — capture + continue.
 *  Exported for the #40 webhook mirror-apply path (payroll-live.ts). */
export async function flushAlerts(db: MirrorDb, shopId: number, alerts: AlertCollector): Promise<void> {
  for (const a of alerts.list()) {
    try {
      const { error } = await db.rpc("record_tekmetric_ingest_alert", {
        p_level: a.level,
        p_unknown_keys: a.keys,
        p_ro_id: a.ro_id,
        p_sample: a.sample,
      });
      if (error) throw new Error(`record_tekmetric_ingest_alert(${a.level}|${a.keys.join(",")}) failed: ${error.message}`);
    } catch (e) {
      Sentry.captureException(e, { tags: { qteklink_cron: "mirror-ingest-alert-flush", shop_id: String(shopId) } });
    }
  }
}

/**
 * Run the RO-mirror ingest for one shop. Incremental = the nightly path (throws on an empty
 * mirror — a backfill must seed it first). Range = the per-run refresh action (posted-date
 * window; never touches the incremental watermark). Insert errors and unknown Tekmetric keys
 * are ALERTED (RPC + returned), not thrown; watermark/paging failures THROW — the caller
 * (runNightlySync) isolates them.
 */
export async function runMirrorIngest(deps: MirrorIngestDeps, opts: MirrorIngestOpts): Promise<MirrorIngestResult> {
  const db = deps.db ?? (createSupabaseAdminClient() as unknown as MirrorDb);
  const pageRos = deps.pageRos ?? ((shopId, query) => pageRepairOrders(shopId, query));
  const alerts = createAlertCollector();
  const result: MirrorIngestResult = { rosUpserted: 0, pagesFetched: 0, alerts: [], watermark: null };

  const runPasses = async (queries: Record<string, string | number>[]): Promise<void> => {
    for (const query of queries) {
      for await (const page of pageRos(deps.shopId, query)) {
        const t = await upsertPage(db, deps.shopId, page.content, alerts);
        result.rosUpserted += t.ros;
        result.pagesFetched += 1;
      }
    }
  };

  if (opts.mode === "incremental") {
    const w = await readWatermark(db, deps.shopId);
    const newest = [w.created, w.updated].filter((v): v is string => v != null).sort().pop();
    if (!newest) {
      throw new Error(
        `mirror-ingest: empty tekmetric_ros mirror for shop ${deps.shopId} — seed it with ` +
          "scheduler-app/scripts/tekmetric/sync-ros.mjs --backfill first",
      );
    }
    // 24h lookback below the newest mirror date, exactly like the script.
    const sinceDate = new Date(Date.parse(newest) - 24 * 3600 * 1000).toISOString().slice(0, 10);
    result.watermark = sinceDate;
    // Tekmetric requires ZonedDateTime for date filters (bare YYYY-MM-DD rejected since ~2026-07-10).
    const sinceZdt = `${sinceDate}T00:00:00Z`;
    // Two passes, same as the script: ROs CREATED since + ROs UPDATED since.
    await runPasses([{ start: sinceZdt }, { updatedDateStart: sinceZdt }]);
  } else {
    if (!isIsoDate(opts.postedDateStart) || !isIsoDate(opts.postedDateEnd)) {
      throw new Error("mirror-ingest: range mode requires ISO YYYY-MM-DD postedDateStart/postedDateEnd");
    }
    if (opts.updatedDateStart !== undefined && !isIsoDate(opts.updatedDateStart)) {
      throw new Error("mirror-ingest: range mode updatedDateStart must be ISO YYYY-MM-DD");
    }
    await runPasses([
      { postedDateStart: `${opts.postedDateStart}T00:00:00Z`, postedDateEnd: `${opts.postedDateEnd}T23:59:59Z` },
      // Round-7 #42: the updated-since pass (dry-run) — completed-but-unposted ROs.
      ...(opts.updatedDateStart !== undefined
        ? [{ updatedDateStart: `${opts.updatedDateStart}T00:00:00Z` }]
        : []),
    ]);
  }

  await flushAlerts(db, deps.shopId, alerts);
  result.alerts = alerts.list();
  return result;
}
