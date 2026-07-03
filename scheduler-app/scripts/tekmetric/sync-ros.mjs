// Tekmetric RO mirror ingest.
//
// Pages /repair-orders (shop 7476) through the tekmetric-api-testing edge fn
// (raw_get) and upserts into the tekmetric_ro* mirror tables — one column per
// field. Plan + schema rationale: docs/tekmetric/ro-mirror-plan.md.
//
// Fallbacks (locked decision #2):
//   - tekmetric_ros.raw stores the untouched payload (nothing is ever lost).
//   - Every object is key-diffed against the per-level whitelists below;
//     unknown keys -> record_tekmetric_ingest_alert() + run-summary printout,
//     so a new Tekmetric field becomes a column instead of silently vanishing.
//   - Rows that fail to insert (type surprises) are alerted as insert_error
//     and listed in the summary; the run continues.
//
// Usage (from scheduler-app/):
//   node scripts/tekmetric/sync-ros.mjs --backfill [--start-page N] [--end-page N]
//   node scripts/tekmetric/sync-ros.mjs --since 2026-07-01
//   node scripts/tekmetric/sync-ros.mjs               # incremental (watermark)
//
// Env: reads scheduler-app/.env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..', '..');

// ─── env ─────────────────────────────────────────────────────────────────────

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    // Vercel "sensitive" vars pull as empty strings — never let '' shadow a real value.
    if (val.length > 0 && (process.env[key] === undefined || process.env[key] === '')) {
      process.env[key] = val;
    }
  }
}
loadEnvFile(path.join(APP_ROOT, '.env.local'));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SECRET_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY (scheduler-app/.env.local)');
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } });
const EDGE_FN = `${SUPABASE_URL}/functions/v1/tekmetric-api-testing`;
const SHOP_ID = 7476;
const PAGE_SIZE = 100;

// ─── per-level known-key whitelists (from the 2,500-RO census) ───────────────

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
};

// ─── unknown-field alarm ─────────────────────────────────────────────────────

const alerts = new Map(); // "level|k1,k2" -> { level, keys, ro_id, sample, occurrences }

function checkKeys(level, obj, roId) {
  if (obj === null || obj === undefined) return;
  const unknown = Object.keys(obj).filter((k) => !KNOWN[level].has(k)).sort();
  if (unknown.length === 0) return;
  const mapKey = `${level}|${unknown.join(',')}`;
  const existing = alerts.get(mapKey);
  if (existing) { existing.occurrences += 1; return; }
  const sample = {};
  for (const k of unknown) sample[k] = obj[k];
  alerts.set(mapKey, { level, keys: unknown, ro_id: roId, sample, occurrences: 1 });
}

function recordInsertError(table, roIds, error) {
  const mapKey = `insert_error|${table}`;
  const existing = alerts.get(mapKey);
  if (existing) { existing.occurrences += 1; return; }
  alerts.set(mapKey, {
    level: 'insert_error',
    keys: [table],
    ro_id: roIds[0] ?? null,
    sample: { error: String(error?.message ?? error).slice(0, 500), ro_ids: roIds.slice(0, 20) },
    occurrences: 1,
  });
}

async function flushAlerts() {
  for (const a of alerts.values()) {
    const { error } = await supabase.rpc('record_tekmetric_ingest_alert', {
      p_level: a.level,
      p_unknown_keys: a.keys,
      p_ro_id: a.ro_id,
      p_sample: a.sample,
    });
    if (error) console.error(`  ! failed to persist alert ${a.level}|${a.keys}: ${error.message}`);
  }
}

// ─── field mappers (one column per JSON field) ───────────────────────────────

const ts = (v) => (v === null || v === undefined ? null : v);

function mapRo(ro) {
  checkKeys('ro', ro, ro.id);
  checkKeys('status', ro.repairOrderStatus, ro.id);
  checkKeys('label', ro.repairOrderLabel, ro.id);
  if (ro.repairOrderLabel?.status) checkKeys('status', ro.repairOrderLabel.status, ro.id);
  checkKeys('customLabel', ro.repairOrderCustomLabel, ro.id);
  return {
    id: ro.id,
    shop_id: ro.shopId ?? SHOP_ID,
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
    status_id: ro.repairOrderStatus?.id ?? null,
    status_code: ro.repairOrderStatus?.code ?? null,
    status_name: ro.repairOrderStatus?.name ?? null,
    status_posted_or_accrecv: ro.repairOrderStatus?.postedOrAccrecv ?? null,
    label_id: ro.repairOrderLabel?.id ?? null,
    label_code: ro.repairOrderLabel?.code ?? null,
    label_name: ro.repairOrderLabel?.name ?? null,
    label_status_id: ro.repairOrderLabel?.status?.id ?? null,
    label_status_code: ro.repairOrderLabel?.status?.code ?? null,
    label_status_name: ro.repairOrderLabel?.status?.name ?? null,
    label_status_posted_or_accrecv: ro.repairOrderLabel?.status?.postedOrAccrecv ?? null,
    custom_label_name: ro.repairOrderCustomLabel?.name ?? null,
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

function mapJob(job, roId) {
  checkKeys('job', job, roId);
  return {
    id: job.id,
    ro_id: roId,
    shop_id: SHOP_ID,
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

function mapLabor(l, jobId, roId) {
  checkKeys('labor', l, roId);
  return {
    id: l.id, job_id: jobId, ro_id: roId,
    name: l.name ?? null, rate_cents: l.rate ?? null, hours: l.hours ?? null,
    complete: l.complete ?? null, technician_id: l.technicianId ?? null,
  };
}

function mapPart(p, jobId, roId) {
  checkKeys('part', p, roId);
  checkKeys('partType', p.partType, roId);
  if (p.partStatus) checkKeys('partStatus', p.partStatus, roId);
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
    part_type_id: p.partType?.id ?? null, part_type_code: p.partType?.code ?? null,
    part_type_name: p.partType?.name ?? null,
    part_status_id: p.partStatus?.id ?? null, part_status_code: p.partStatus?.code ?? null,
    part_status_name: p.partStatus?.name ?? null,
  };
}

function mapConcern(c, roId) {
  checkKeys('concern', c, roId);
  return { id: c.id, ro_id: roId, concern: c.concern ?? null, tech_comment: c.techComment ?? null };
}

function mapSublet(s, roId) {
  checkKeys('sublet', s, roId);
  if (s.vendor) checkKeys('vendor', s.vendor, roId);
  if (s.accountsPayable) checkKeys('accountsPayable', s.accountsPayable, roId);
  return {
    id: s.id, ro_id: roId,
    name: s.name ?? null, note: s.note ?? null,
    price_cents: s.price ?? null, cost_cents: s.cost ?? null,
    authorized: s.authorized ?? null, authorized_date: ts(s.authorizedDate),
    selected: s.selected ?? null, sort: s.sort ?? null,
    feeable: s.feeable ?? null, tax_sublet: s.taxSublet ?? null,
    vendor_id: s.vendor?.id ?? null, vendor_name: s.vendor?.name ?? null,
    vendor_nickname: s.vendor?.nickname ?? null, vendor_phone: s.vendor?.phone ?? null,
    vendor_website: s.vendor?.website ?? null,
    ap_id: s.accountsPayable?.id ?? null,
    ap_amount_cents: s.accountsPayable?.amount ?? null,
    ap_amount_paid_cents: s.accountsPayable?.amountPaid ?? null,
    ap_payment_type: s.accountsPayable?.paymentType ?? null,
    ap_payment_details: s.accountsPayable?.paymentDetails ?? null,
  };
}

function mapSubletItem(it, subletId, roId) {
  checkKeys('subletItem', it, roId);
  return {
    id: it.id, sublet_id: subletId, ro_id: roId,
    name: it.name ?? null, cost_cents: it.cost ?? null, price_cents: it.price ?? null,
    complete: it.complete ?? null,
  };
}

// ─── edge-fn paging ──────────────────────────────────────────────────────────

async function fetchRoPage(page, extraQuery = {}) {
  const body = {
    op: 'raw_get',
    path: '/repair-orders',
    query: { shop: SHOP_ID, size: PAGE_SIZE, page, ...extraQuery },
  };
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(EDGE_FN, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SECRET_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(`edge fn ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
      return j.body;
    } catch (e) {
      if (attempt === 4) throw e;
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
}

// ─── upsert one page of ROs ──────────────────────────────────────────────────

async function chunked(table, rows, roIds, op) {
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500);
    const { error } = await op(slice);
    if (error) {
      recordInsertError(table, roIds, error);
      console.error(`  ! ${table} insert failed (${slice.length} rows): ${error.message}`);
    }
  }
}

async function upsertPage(ros) {
  const roRows = [];
  const jobs = [], labor = [], parts = [], jobFees = [], jobDiscounts = [];
  const fees = [], discounts = [], concerns = [], sublets = [], subletItems = [];

  for (const ro of ros) {
    roRows.push(mapRo(ro));
    for (const j of ro.jobs ?? []) {
      jobs.push(mapJob(j, ro.id));
      for (const l of j.labor ?? []) labor.push(mapLabor(l, j.id, ro.id));
      for (const p of j.parts ?? []) parts.push(mapPart(p, j.id, ro.id));
      for (const f of j.fees ?? []) { checkKeys('fee', f, ro.id); jobFees.push({ id: f.id, job_id: j.id, ro_id: ro.id, name: f.name ?? null, total_cents: f.total ?? null }); }
      for (const d of j.discounts ?? []) { checkKeys('discount', d, ro.id); jobDiscounts.push({ id: d.id, job_id: j.id, ro_id: ro.id, name: d.name ?? null, total_cents: d.total ?? null }); }
    }
    for (const f of ro.fees ?? []) { checkKeys('fee', f, ro.id); fees.push({ id: f.id, ro_id: ro.id, name: f.name ?? null, total_cents: f.total ?? null }); }
    for (const d of ro.discounts ?? []) { checkKeys('discount', d, ro.id); discounts.push({ id: d.id, ro_id: ro.id, name: d.name ?? null, total_cents: d.total ?? null }); }
    for (const c of ro.customerConcerns ?? []) concerns.push(mapConcern(c, ro.id));
    for (const s of ro.sublets ?? []) {
      sublets.push(mapSublet(s, ro.id));
      for (const it of s.items ?? []) subletItems.push(mapSubletItem(it, s.id, ro.id));
    }
  }

  const roIds = roRows.map((r) => r.id);

  // parent upsert
  await chunked('tekmetric_ros', roRows, roIds, (slice) =>
    supabase.from('tekmetric_ros').upsert(slice, { onConflict: 'id' }));

  // children: delete-then-insert per RO (Tekmetric can remove line items;
  // PK upsert alone would strand deleted rows). Job children cascade.
  for (const table of ['tekmetric_ro_jobs', 'tekmetric_ro_fees', 'tekmetric_ro_discounts', 'tekmetric_ro_customer_concerns', 'tekmetric_ro_sublets']) {
    const { error } = await supabase.from(table).delete().in('ro_id', roIds);
    if (error) recordInsertError(`${table}:delete`, roIds, error);
  }

  await chunked('tekmetric_ro_jobs', jobs, roIds, (s) => supabase.from('tekmetric_ro_jobs').insert(s));
  await chunked('tekmetric_ro_job_labor', labor, roIds, (s) => supabase.from('tekmetric_ro_job_labor').insert(s));
  await chunked('tekmetric_ro_job_parts', parts, roIds, (s) => supabase.from('tekmetric_ro_job_parts').insert(s));
  await chunked('tekmetric_ro_job_fees', jobFees, roIds, (s) => supabase.from('tekmetric_ro_job_fees').insert(s));
  await chunked('tekmetric_ro_job_discounts', jobDiscounts, roIds, (s) => supabase.from('tekmetric_ro_job_discounts').insert(s));
  await chunked('tekmetric_ro_fees', fees, roIds, (s) => supabase.from('tekmetric_ro_fees').insert(s));
  await chunked('tekmetric_ro_discounts', discounts, roIds, (s) => supabase.from('tekmetric_ro_discounts').insert(s));
  await chunked('tekmetric_ro_customer_concerns', concerns, roIds, (s) => supabase.from('tekmetric_ro_customer_concerns').insert(s));
  await chunked('tekmetric_ro_sublets', sublets, roIds, (s) => supabase.from('tekmetric_ro_sublets').insert(s));
  await chunked('tekmetric_ro_sublet_items', subletItems, roIds, (s) => supabase.from('tekmetric_ro_sublet_items').insert(s));

  return { ros: roRows.length, jobs: jobs.length, concerns: concerns.length };
}

// ─── modes ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { mode: 'incremental', startPage: 0, endPage: Infinity, since: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--backfill') args.mode = 'backfill';
    else if (argv[i] === '--since') { args.mode = 'since'; args.since = argv[++i]; }
    else if (argv[i] === '--start-page') args.startPage = Number(argv[++i]);
    else if (argv[i] === '--end-page') args.endPage = Number(argv[++i]);
    else { console.error(`unknown arg ${argv[i]}`); process.exit(2); }
  }
  return args;
}

async function runPages(extraQuery, startPage, endPage, label) {
  let totals = { ros: 0, jobs: 0, concerns: 0 };
  for (let page = startPage; page <= endPage; page++) {
    const body = await fetchRoPage(page, extraQuery);
    const rows = body?.content ?? [];
    if (rows.length === 0) break;
    const t = await upsertPage(rows);
    totals.ros += t.ros; totals.jobs += t.jobs; totals.concerns += t.concerns;
    const totalPages = body?.totalPages ?? '?';
    console.log(`[${label}] page ${page}/${totalPages}: +${t.ros} ROs (${totals.ros} total, ${totals.concerns} concerns)`);
    if (body?.last === true) break;
  }
  return totals;
}

async function watermark() {
  // Consider BOTH created_date and updated_date (updatedDate is null until an RO changes).
  const w = { created: null, updated: null };
  for (const col of ['created_date', 'updated_date']) {
    const { data, error } = await supabase
      .from('tekmetric_ros').select(col).not(col, 'is', null)
      .order(col, { ascending: false }).limit(1);
    if (error) { console.error(`watermark query failed: ${error.message}`); process.exit(1); }
    if (data?.[0]) w[col === 'created_date' ? 'created' : 'updated'] = data[0][col];
  }
  return w;
}

const args = parseArgs(process.argv);
const started = Date.now();
let totals;

if (args.mode === 'backfill') {
  totals = await runPages({}, args.startPage, args.endPage, 'backfill');
} else {
  let sinceDate;
  if (args.mode === 'since') {
    sinceDate = args.since;
  } else {
    const w = await watermark();
    const newest = [w.created, w.updated].filter(Boolean).sort().pop();
    if (!newest) { console.error('empty mirror — run --backfill first'); process.exit(2); }
    sinceDate = new Date(Date.parse(newest) - 24 * 3600 * 1000).toISOString().slice(0, 10);
  }
  console.log(`incremental since ${sinceDate} (created + updated passes)`);
  const a = await runPages({ start: sinceDate }, 0, Infinity, 'created-since');
  const b = await runPages({ updatedDateStart: sinceDate }, 0, Infinity, 'updated-since');
  totals = { ros: a.ros + b.ros, jobs: a.jobs + b.jobs, concerns: a.concerns + b.concerns };
}

await flushAlerts();

console.log(`\nDONE in ${Math.round((Date.now() - started) / 1000)}s: ${totals.ros} ROs, ${totals.jobs} jobs, ${totals.concerns} concerns synced.`);
if (alerts.size > 0) {
  console.log(`\n⚠ ${alerts.size} ingest alert(s) — mirror is missing columns or rows failed (also persisted to tekmetric_ro_ingest_alerts):`);
  for (const a of alerts.values()) {
    console.log(`  [${a.level}] keys=${a.keys.join(',')} ×${a.occurrences} (first ro ${a.ro_id})`);
  }
} else {
  console.log('No unknown fields, no insert failures — every field landed in a column.');
}
