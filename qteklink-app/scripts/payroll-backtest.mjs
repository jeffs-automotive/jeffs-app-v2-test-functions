// payroll-backtest.mjs — the phase-3 ACCURACY GATE (plan: docs/qteklink/qteklink-payroll-plan.md):
// diffs the tekmetric_ros* mirror-derived payroll inputs against a REAL filled workbook
// fixture (test-kit/fixtures/payroll/workbook-*.json) so Chris can sign off before UI work.
//
//   1. Per-technician billed hours for the fixture's pay period (labor-line hours on ROs
//      POSTED in the period, parent job `authorized IS TRUE` — INVARIANT #1, extraction
//      doc #20) vs each tech sheet's billed_w1 + billed_w2 (weeks = Sun–Sat period split).
//      Tech names → tekmetric ids come from --map; the script ALWAYS prints the mirror's
//      top technician_id hour totals so the operator can build that map.
//   2. With --month: mirror month sales (BOTH candidates: Σ total_sales_cents, and Σ total
//      minus taxes — the backtest exists to pick one), fees (Σ fee_total_cents), parts cost
//      (contract Σ cost_cents + a qty-weighted candidate) vs the fixture SA sheets'
//      month_sales / gp_with_fees / gp_without_fees.
//
// READ-ONLY against the DB (selects only). Mirrors src/lib/payroll/derive.ts query + filter
// logic (scripts are standalone .mjs — keep the two in sync if the rules change).
//
// Run (from qteklink-app/):
//   node --env-file=.env.local scripts/payroll-backtest.mjs ../test-kit/fixtures/payroll/workbook-6-14-26-6-27-26.json \
//     [--map "Cantrell, Jeff=501,Clark, Matt=502"] [--month 2026-06] [--shop 7476] [--tz America/New_York]
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const VALUE_FLAGS = new Set(["--map", "--month", "--shop", "--tz"]);
function flagValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (VALUE_FLAGS.has(argv[i])) { i++; continue; } // skip the flag AND its value
  if (argv[i].startsWith("--")) continue; // unknown flag — ignore
  positional.push(argv[i]);
}
const FIXTURE_PATH = positional[0];
const MAP_ARG = flagValue("--map");
const MONTH = flagValue("--month");
const SHOP_ID = Number(flagValue("--shop") ?? 7476);
const TZ = flagValue("--tz") ?? "America/New_York";
if (!FIXTURE_PATH) {
  console.error("usage: node --env-file=.env.local scripts/payroll-backtest.mjs <fixture.json> [--map \"Name=techId,...\"] [--month YYYY-MM] [--shop 7476] [--tz America/New_York]");
  process.exit(1);
}
if (MONTH && !/^\d{4}-(0[1-9]|1[0-2])$/.test(MONTH)) { console.error(`--month must be YYYY-MM, got ${MONTH}`); process.exit(1); }

// ── env/client idiom (matches scripts/tekmetric-ro-backfill.mjs) ──────────────
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
if (!SUPABASE_URL || !serviceKey()) { console.error("Missing SUPABASE_URL / SUPABASE_SECRET_KEY env (run with --env-file=.env.local)."); process.exit(1); }
const sb = createClient(SUPABASE_URL, serviceKey(), { auth: { persistSession: false } });

// ── date helpers ──────────────────────────────────────────────────────────────
const DAY_MS = 24 * 60 * 60 * 1000;
const localDayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const localDay = (utcIso) => localDayFmt.format(new Date(utcIso));
const addDaysIso = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** "6-14-26" → "2026-06-14" */
function usShortToIso(s) {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`can't parse fixture date "${s}" (expected M-D-YY)`);
  return `20${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function monthRange(month) {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, "0")}` };
}

// ── formatting helpers ────────────────────────────────────────────────────────
const usd = (cents) => (cents == null ? "n/a" : `$${(cents / 100).toFixed(2)}`);
const hrs = (h) => (h == null ? "n/a" : h.toFixed(2));
const pad = (s, w) => String(s).padEnd(w);
const rpad = (s, w) => String(s).padStart(w);
const dollarsToCents = (d) => (d == null ? null : Math.round(d * 100));

// ── mirror reads (READ-ONLY; logic mirrors src/lib/payroll/derive.ts) ─────────
const PAGE = 1000;
const ID_CHUNK = 100;

async function fetchPostedRos(start, end) {
  // Generous UTC window ±1 day, then exact shop-local posted-date filter.
  const startIso = new Date(Date.parse(`${start}T00:00:00Z`) - DAY_MS).toISOString();
  const endIso = new Date(Date.parse(`${end}T00:00:00Z`) + 2 * DAY_MS).toISOString();
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("tekmetric_ros")
      .select("id, service_writer_id, total_sales_cents, taxes_cents, fee_total_cents, posted_date, synced_at")
      .eq("shop_id", SHOP_ID)
      .not("posted_date", "is", null)
      .gte("posted_date", startIso)
      .lt("posted_date", endIso)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`tekmetric_ros fetch failed: ${error.message}`);
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return out.filter((r) => { const d = localDay(r.posted_date); return d >= start && d <= end; });
}

async function fetchAuthorizedJobs(roIds) {
  const out = [];
  for (let i = 0; i < roIds.length; i += ID_CHUNK) {
    const chunk = roIds.slice(i, i + ID_CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb
        .from("tekmetric_ro_jobs")
        .select("id, ro_id, authorized, job_category_name")
        .in("ro_id", chunk)
        .eq("authorized", true) // INVARIANT #1 (extraction doc #20)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`tekmetric_ro_jobs fetch failed: ${error.message}`);
      out.push(...(data ?? []));
      if ((data ?? []).length < PAGE) break;
    }
  }
  return out;
}

async function fetchJobChildren(table, cols, jobIds) {
  const out = [];
  for (let i = 0; i < jobIds.length; i += ID_CHUNK) {
    const chunk = jobIds.slice(i, i + ID_CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb
        .from(table)
        .select(cols)
        .in("job_id", chunk)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`${table} fetch failed: ${error.message}`);
      out.push(...(data ?? []));
      if ((data ?? []).length < PAGE) break;
    }
  }
  return out;
}

// ── part 1: per-technician billed hours for the fixture's period ─────────────
async function billedHoursForPeriod(start, end) {
  const w1End = addDaysIso(start, 6); // Sun–Sat week 1; week 2 = the rest
  const ros = await fetchPostedRos(start, end);
  const jobs = await fetchAuthorizedJobs(ros.map((r) => r.id));
  const labor = await fetchJobChildren("tekmetric_ro_job_labor", "id, job_id, technician_id, hours", jobs.map((j) => j.id));

  const roWeek = new Map(ros.map((r) => [r.id, localDay(r.posted_date) <= w1End ? "w1" : "w2"]));
  const jobRo = new Map(jobs.map((j) => [j.id, j.ro_id]));
  const byTech = new Map(); // techId → { w1, w2 }
  let unattributedHours = 0;
  for (const line of labor) {
    if (line.hours == null) continue;
    if (line.technician_id == null) { unattributedHours += line.hours; continue; }
    const week = roWeek.get(jobRo.get(line.job_id));
    if (!week) continue; // orphaned line (job outside the fetched RO set) — impossible by construction, skip defensively
    const rec = byTech.get(line.technician_id) ?? { w1: 0, w2: 0 };
    rec[week] += line.hours;
    byTech.set(line.technician_id, rec);
  }
  let asOf = null;
  for (const r of ros) if (r.synced_at && (!asOf || r.synced_at > asOf)) asOf = r.synced_at;
  return { byTech, unattributedHours, roCount: ros.length, asOf };
}

// ── part 2: month sales / fees / parts / GP inputs ────────────────────────────
async function monthAggregates(month) {
  const { start, end } = monthRange(month);
  const ros = await fetchPostedRos(start, end);
  const jobs = await fetchAuthorizedJobs(ros.map((r) => r.id));
  const parts = await fetchJobChildren("tekmetric_ro_job_parts", "id, job_id, cost_cents, quantity", jobs.map((j) => j.id));

  let salesTotal = 0, salesMinusTaxes = 0, fees = 0;
  for (const r of ros) {
    const t = r.total_sales_cents ?? 0;
    salesTotal += t;
    salesMinusTaxes += t - (r.taxes_cents ?? 0);
    fees += r.fee_total_cents ?? 0;
  }
  let partsCost = 0, partsCostQty = 0;
  for (const p of parts) {
    partsCost += p.cost_cents ?? 0;
    const q = p.quantity ?? 1;
    partsCostQty += Math.sign((p.cost_cents ?? 0) * q) * Math.round(Math.abs((p.cost_cents ?? 0) * q));
  }
  return { start, end, roCount: ros.length, salesTotal, salesMinusTaxes, fees, partsCost, partsCostQty };
}

// ── main ──────────────────────────────────────────────────────────────────────
const main = async () => {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  const label = fixture.period_label ?? fixture.source_workbook?.replace(/\.xlsx$/i, "");
  if (!label) throw new Error("fixture has no period_label / source_workbook to derive the period from");
  const [rawStart, rawEnd] = label.split(" - ").map((s) => s.trim());
  const periodStart = fixture.period_start ?? usShortToIso(rawStart);
  const periodEnd = fixture.period_end ?? usShortToIso(rawEnd);
  const sheets = fixture.sheets ?? [];
  if (new Date(`${periodStart}T00:00:00Z`).getUTCDay() !== 0) {
    console.warn(`WARN: period start ${periodStart} is not a Sunday — week split may not match the workbook.`);
  }

  console.log(`Backtest: ${fixture.source_workbook ?? label}  |  period ${periodStart}..${periodEnd}  |  shop ${SHOP_ID}  |  tz ${TZ}`);

  // ── Billed hours ────────────────────────────────────────────────────────────
  const { byTech, unattributedHours, roCount, asOf } = await billedHoursForPeriod(periodStart, periodEnd);
  console.log(`\nMirror: ${roCount} ROs posted in period  |  data as of ${asOf ?? "(no rows)"}`);
  if (roCount === 0) console.warn("WARN: 0 mirror ROs — is the mirror fresh for this window? (extraction doc: fresh only to 2026-07-02 as of writing)");

  console.log("\n── Mirror technician_id billed-hour totals (build your --map from these) ──");
  console.log(`${pad("technician_id", 15)}${rpad("w1", 10)}${rpad("w2", 10)}${rpad("total", 10)}`);
  const techTotals = [...byTech.entries()].sort((a, b) => (b[1].w1 + b[1].w2) - (a[1].w1 + a[1].w2));
  for (const [tech, { w1, w2 }] of techTotals) {
    console.log(`${pad(tech, 15)}${rpad(hrs(w1), 10)}${rpad(hrs(w2), 10)}${rpad(hrs(w1 + w2), 10)}`);
  }
  if (unattributedHours > 0) console.log(`(+ ${hrs(unattributedHours)} h on labor lines with NO technician_id — in shop totals, not per-tech)`);

  const techSheets = sheets.filter((s) => (s.family === "technician" || s.family === "shop_foreman") && s.inputs);
  const map = new Map(); // fixture sheet name → tekmetric technician_id
  if (MAP_ARG) {
    for (const pair of MAP_ARG.split(",")) {
      const eq = pair.lastIndexOf("=");
      if (eq < 1) { console.error(`bad --map entry "${pair}" (want Name=techId)`); process.exit(1); }
      map.set(pair.slice(0, eq).trim(), Number(pair.slice(eq + 1).trim()));
    }
  }

  if (map.size > 0) {
    console.log("\n── Billed hours: workbook vs mirror (fixture billed_w1+billed_w2 per tech sheet) ──");
    const header = `${pad("sheet", 22)}${rpad("tech_id", 9)}${rpad("wb w1", 9)}${rpad("mir w1", 9)}${rpad("wb w2", 9)}${rpad("mir w2", 9)}${rpad("wb tot", 9)}${rpad("mir tot", 9)}${rpad("Δ tot", 9)}`;
    console.log(header);
    let worst = 0;
    for (const s of techSheets) {
      const techId = map.get(s.sheet);
      if (techId == null) { console.log(`${pad(s.sheet, 22)}(no --map entry — skipped)`); continue; }
      const wb1 = s.inputs.billed_w1 ?? 0;
      const wb2 = s.inputs.billed_w2 ?? 0;
      const mir = byTech.get(techId) ?? { w1: 0, w2: 0 };
      const delta = (mir.w1 + mir.w2) - (wb1 + wb2);
      worst = Math.max(worst, Math.abs(delta));
      console.log(
        `${pad(s.sheet, 22)}${rpad(techId, 9)}${rpad(hrs(wb1), 9)}${rpad(hrs(mir.w1), 9)}${rpad(hrs(wb2), 9)}${rpad(hrs(mir.w2), 9)}${rpad(hrs(wb1 + wb2), 9)}${rpad(hrs(mir.w1 + mir.w2), 9)}${rpad(delta.toFixed(2), 9)}`,
      );
    }
    console.log(`worst |Δ total| = ${worst.toFixed(2)} h`);
  } else {
    console.log(`\n(no --map given — pass --map "Name=techId,..." to diff the ${techSheets.length} tech sheets against the mirror ids above)`);
  }

  // ── Month sales / fees / GP ─────────────────────────────────────────────────
  if (MONTH) {
    const agg = await monthAggregates(MONTH);
    console.log(`\n── Month ${MONTH} (${agg.start}..${agg.end}, ${agg.roCount} posted ROs) ──`);
    console.log(`mirror sales candidate A (Σ total_sales_cents):        ${usd(agg.salesTotal)}`);
    console.log(`mirror sales candidate B (Σ total − taxes):            ${usd(agg.salesMinusTaxes)}`);
    console.log(`mirror fees (Σ fee_total_cents):                       ${usd(agg.fees)}`);
    console.log(`mirror parts cost (contract: Σ authorized cost_cents): ${usd(agg.partsCost)}`);
    console.log(`mirror parts cost (qty-weighted candidate):            ${usd(agg.partsCostQty)}`);

    const saSheets = sheets.filter((s) => s.family === "service_advisor" && s.inputs);
    const withMonth = saSheets.filter((s) => s.inputs.month_sales != null);
    if (withMonth.length === 0) {
      console.log("\nFixture SA sheets carry no month_sales/gp values (not a bonus period?) — nothing to diff.");
    } else {
      for (const s of withMonth) {
        const wbSales = dollarsToCents(s.inputs.month_sales);
        const wbGpWith = dollarsToCents(s.inputs.gp_with_fees);
        const wbGpWithout = dollarsToCents(s.inputs.gp_without_fees);
        console.log(`\nSA sheet "${s.sheet}" (workbook figures — dollars → cents):`);
        console.log(`  wb month_sales:      ${usd(wbSales)}   Δ vs A: ${usd(agg.salesTotal - wbSales)}   Δ vs B: ${usd(agg.salesMinusTaxes - wbSales)}`);
        if (wbGpWith != null && wbGpWithout != null) {
          const wbImpliedFees = wbGpWith - wbGpWithout;
          console.log(`  wb GP with fees:     ${usd(wbGpWith)}   |  wb GP without fees: ${usd(wbGpWithout)}`);
          console.log(`  wb implied fees (GPwith − GPwithout): ${usd(wbImpliedFees)}   Δ vs mirror fees: ${usd(agg.fees - wbImpliedFees)}`);
          // GP = sales − parts − laborPay. Payroll runs don't exist pre-ship, so back the
          // labor-pay term OUT of the workbook GP and eyeball it against known payroll totals.
          const impliedLaborA = agg.salesTotal - agg.partsCost - wbGpWith;
          const impliedLaborB = agg.salesMinusTaxes - agg.partsCost - wbGpWith;
          console.log(`  implied labor pay (mirror sales − mirror parts − wb GPwith):  A → ${usd(impliedLaborA)}   B → ${usd(impliedLaborB)}`);
          console.log(`  (sanity: should ≈ the month's Technician+Foreman+ShopSupport total pay, prorated by days — decision #2/#17)`);
        } else {
          console.log(`  wb GP fields empty — sales diff only.`);
        }
      }
    }
  } else {
    console.log("\n(no --month given — pass --month YYYY-MM to diff month sales/fees/GP against the fixture SA sheets)");
  }
};

main().catch((e) => { console.error(`FAIL: ${e.message}`); process.exit(1); });
