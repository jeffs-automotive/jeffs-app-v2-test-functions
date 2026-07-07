// tekmetric-ro-backfill.mjs — authoritative ro_posted backfill from the Tekmetric
// REST API (the keytag webhook firehose missed ~25% of RO posts). Fetches every RO
// POSTED in a window (paginated /repair-orders), and (with --insert) writes each as
// a ro_posted event into qteklink_events in the SAME shape the live qteklink-webhook
// would — so the C5 SALE builder reads them transparently. The API is the source of
// truth, so its received_at = now() makes it win the builder's latest-per-RO pick.
//
// Run:  cd qteklink-app && node --env-file=.env.local scripts/tekmetric-ro-backfill.mjs [from] [to] [--insert] [--only-missing]
//   DRY by default (fetch + summarize, no writes). --insert performs the backfill.
//   --only-missing narrows to currently-posted ROs with NO captured posting webhook
//   (ro_posted / ro_sent_to_ar) in qteklink_events — the precise single-gap affordance
//   (without it, ROs captured as ro_sent_to_ar get redundant ro_posted rows: the dedup
//   hash is kind|source_id|event_time_raw, so a different kind never dedupes).
import { createClient } from "@supabase/supabase-js";

const SHOP_ID = 7476;
const REALM = "9341455608740708";
const TEK_BASE = "https://shop.tekmetric.com/api/v1";
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const DO_INSERT = process.argv.includes("--insert");
const ONLY_MISSING = process.argv.includes("--only-missing");
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

/** RO ids that already have a captured posting event (ro_posted / ro_sent_to_ar). */
async function capturedRoIds(roIds) {
  const captured = new Set();
  for (let i = 0; i < roIds.length; i += 200) {
    const { data, error } = await sb
      .from("qteklink_events")
      .select("tekmetric_ro_id")
      .eq("shop_id", SHOP_ID)
      .eq("realm_id", REALM)
      .in("event_kind", ["ro_posted", "ro_sent_to_ar"])
      .in("tekmetric_ro_id", roIds.slice(i, i + 200));
    if (error) throw new Error(`qteklink_events captured-scan failed: ${error.message}`);
    for (const r of data ?? []) captured.add(Number(r.tekmetric_ro_id));
  }
  return captured;
}

const main = async () => {
  const token = await tekToken();
  let ros = (await fetchPostedROs(token)).filter((r) => r.postedDate);
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

  if (ONLY_MISSING) {
    // Currently-posted ROs only (an unposted-now RO's sale is not recognized — nothing to backfill).
    const postedNow = ros.filter((r) => r.repairOrderStatus?.postedOrAccrecv === true);
    const captured = await capturedRoIds(postedNow.map((r) => r.id));
    ros = postedNow.filter((r) => !captured.has(r.id));
    console.log(`\n--only-missing: ${ros.length} of ${postedNow.length} currently-posted ROs have NO captured posting webhook`);
    for (const r of ros) {
      console.log(`  missing: RO ${r.repairOrderNumber} (${r.id}) $${((Number(r.totalSales) || 0) / 100).toFixed(2)} posted=${r.postedDate}`);
    }
  }

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
