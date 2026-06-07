// tekmetric-ro-backfill.mjs — authoritative ro_posted backfill from the Tekmetric
// REST API (the keytag webhook firehose missed ~25% of RO posts). Fetches every RO
// POSTED in a window (paginated /repair-orders), and (with --insert) writes each as
// a ro_posted event into qteklink_events in the SAME shape the live qteklink-webhook
// would — so the C5 SALE builder reads them transparently. The API is the source of
// truth, so its received_at = now() makes it win the builder's latest-per-RO pick.
//
// Run:  cd qteklink-app && node --env-file=.env.local scripts/tekmetric-ro-backfill.mjs [from] [to] [--insert]
//   DRY by default (fetch + summarize, no writes). --insert performs the backfill.
import { createClient } from "@supabase/supabase-js";

const SHOP_ID = 7476;
const REALM = "9341455608740708";
const TEK_BASE = "https://shop.tekmetric.com/api/v1";
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const DO_INSERT = process.argv.includes("--insert");
const FROM = args[0] ?? "2026-05-10";
const TO = args[1] ?? "2026-06-06";
const etDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

function serviceKey() {
  const dict = process.env.SUPABASE_SECRET_KEYS;
  if (dict) {
    try {
      const p = JSON.parse(dict);
      for (const v of Array.isArray(p) ? p : Object.values(p)) { const s = typeof v === "string" ? v : v?.value; if (s) return s; }
    } catch { console.warn("SUPABASE_SECRET_KEYS not valid JSON; using SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY."); }
  }
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const sb = createClient(SUPABASE_URL, serviceKey(), { auth: { persistSession: false } });

function parseTs(raw) {
  if (!raw) return null;
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw);
  const t = Date.parse(hasZone ? raw : `${raw}Z`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

async function tekToken() {
  const { data, error } = await sb.rpc("tekmetric_get_secret", { p_name: "tekmetric_access_token" });
  if (error) throw new Error(`tekmetric_get_secret failed: ${error.message}`);
  if (!data) throw new Error("Vault has no tekmetric_access_token");
  return data;
}

async function fetchPostedROs(token) {
  const out = [];
  let page = 0;
  // Tekmetric wants a zoned timestamp. Window is ET business days (May/June = EDT, -04:00),
  // so bound at ET midnight..23:59:59 — matches the qteklink_events business-date buckets.
  const startTs = encodeURIComponent(`${FROM}T00:00:00-04:00`);
  const endTs = encodeURIComponent(`${TO}T23:59:59-04:00`);
  while (true) {
    const url = `${TEK_BASE}/repair-orders?shop=${SHOP_ID}&postedDateStart=${startTs}&postedDateEnd=${endTs}&size=100&page=${page}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
    if (!res.ok) throw new Error(`GET /repair-orders page ${page} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    out.push(...(json.content ?? []));
    if (json.last || (json.content ?? []).length < 100) break;
    page += 1;
    if (page > 50) throw new Error("pagination guard: >50 pages");
  }
  return out;
}

const main = async () => {
  const token = await tekToken();
  const ros = (await fetchPostedROs(token)).filter((r) => r.postedDate);
  const sample = ros[0] ?? {};
  const haveSales = sample.totalSales != null;
  const haveJobs = Array.isArray(sample.jobs);
  const haveFees = Array.isArray(sample.fees);

  // Per-ET-day count + total sales (to compare against AL's daily JA-RO).
  const byDay = new Map();
  let totalCents = 0;
  for (const r of ros) {
    const d = etDay.format(new Date(parseTs(r.postedDate)));
    const rec = byDay.get(d) ?? { n: 0, cents: 0 };
    rec.n += 1; rec.cents += Number(r.totalSales) || 0;
    byDay.set(d, rec);
    totalCents += Number(r.totalSales) || 0;
  }
  console.log(`Tekmetric posted ROs ${FROM}..${TO}: ${ros.length} | sample has totalSales=${haveSales} jobs=${haveJobs} fees=${haveFees}`);
  console.log(`Total sales: $${(totalCents / 100).toFixed(2)}\n\nPer ET day — ROs | sales($):`);
  for (const [d, r] of [...byDay.entries()].sort()) console.log(`${d} | ${r.n} | ${(r.cents / 100).toFixed(2)}`);

  if (!DO_INSERT) { console.log("\n(DRY RUN — pass --insert to backfill into qteklink_events)"); return; }
  if (!haveSales || !haveJobs) throw new Error("List rows lack totalSales/jobs — need per-RO detail fetch; aborting before insert.");

  let inserted = 0, dup = 0, failed = 0;
  for (const r of ros) {
    const row = {
      shop_id: SHOP_ID, realm_id: REALM, event_kind: "ro_posted",
      event_text: `(tekmetric-api backfill) Repair Order #${r.repairOrderNumber} posted`,
      source_id: String(r.id), event_time_raw: r.postedDate, tekmetric_event_at: parseTs(r.postedDate),
      payment_id: null, tekmetric_ro_id: r.id,
      raw_body: { event: `(tekmetric-api backfill) Repair Order #${r.repairOrderNumber} posted`, data: r },
      raw_headers: { _backfill: "tekmetric-api" }, raw_query_string: null,
    };
    const { error } = await sb.from("qteklink_events").insert(row);
    if (!error) inserted += 1;
    else if (error.code === "23505") dup += 1;
    else { failed += 1; if (failed <= 3) console.error(`insert RO ${r.id} failed: ${error.message}`); }
  }
  console.log(`\nInserted ${inserted} ro_posted (api); ${dup} already present; ${failed} failed.`);
};
main().catch((e) => { console.error(`FAIL: ${e.message}`); process.exit(1); });
