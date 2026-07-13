// payroll-seed-leave-rates.mjs — the Chris+Claude LEAVE-RATE SEEDING tool (round-4:
// Marie's pre-qteklink average-pay figures get seeded via this script, NOT in-app;
// qteklink runs take over as they accumulate — a completed run for the same
// period_start WINS over its seed in mergeLeaveRateWindow).
//
// Writes pay_config.leave_rate_seed_history (per-period {period_start,
// avg_hourly_pay_cents}, max 26 — round-12: each period carries its already-averaged
// hourly RATE, since the basis is now the MEAN of per-period rates over the rolling-26
// window) and/or pay_config.leave_rate_seed_cents_per_hour (the single-rate 'seed'
// fallback) onto EXISTING technician / shop_foreman employees via the
// qteklink_payroll_upsert_employee RPC.
//
// HARD RULE (Chris): this tool UPDATES existing employees only — it NEVER creates
// an employee (p_employee_id is always the matched id) and never touches archived ones.
//
// DRY-RUN by default: prints the per-employee resolved match, the merged pay_config
// diff, and the average hourly rate the seeds imply. Pass --apply to write.
// READ + RPC only — no direct table writes (qteklink_payroll_* is RPC-write-only).
//
// Guardrails (round-4 review findings): every entry period_start must sit on the
// shop's payroll.anchor_period_start bi-weekly cadence (same rule as
// qteklink_payroll_create_run) AND be in the past — otherwise it would never be
// superseded by the real run for that period.
//
// Round-13 (reach OPEN runs): an already-OPEN run snapshotted each employee's
// pay_config into its entry rows at creation, and live compute reads the leave-rate
// seeds from that ENTRY snapshot (payroll-compute.ts) — NOT the live employee row.
// So --apply ALSO patches every seeded employee's OPEN-run entry rows (merging the
// seeds onto the entry's CURRENT snapshot, preserving any per-run rates_w2) via
// qteklink_payroll_update_entry, then marks those runs stale so the read-through
// live snapshot recomputes with the seeds. Both modes print the open-run patch plan.
//
// Input JSON (array; entries and seed_rate both optional per employee, >=1 required):
//   [{ "employee": "Cantrell, Jeff",
//      "entries": [{ "period_start": "2026-05-17", "avg_hourly_pay_dollars": 28.85 }],
//      "seed_rate_dollars_per_hour": 34.06 }]
//
// Run (from qteklink-app/):
//   node --env-file=.env.local scripts/payroll-seed-leave-rates.mjs seeds.json [--shop 7476] [--apply]
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const ACTOR_LABEL = "seed-script (Chris + Claude)";
const MAX_ENTRIES = 26;

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const VALUE_FLAGS = new Set(["--shop"]);
function flagValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (VALUE_FLAGS.has(argv[i])) { i++; continue; } // skip the flag AND its value
  if (argv[i].startsWith("--")) continue; // boolean/unknown flag
  positional.push(argv[i]);
}
const INPUT_PATH = positional[0];
const SHOP_ID = Number(flagValue("--shop") ?? 7476);
const APPLY = argv.includes("--apply");
if (!INPUT_PATH || !Number.isInteger(SHOP_ID) || SHOP_ID <= 0) {
  console.error("usage: node --env-file=.env.local scripts/payroll-seed-leave-rates.mjs <seeds.json> [--shop 7476] [--apply]");
  process.exit(1);
}

// ── env/client idiom (matches scripts/payroll-backtest.mjs) ───────────────────
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

// ── input validation (mirrors the Zod LeaveRateSeedEntrySchema + the RPC validator) ──
const usd = (cents) => `$${(cents / 100).toFixed(2)}`;
const dollarsToCents = (d) => Math.round(d * 100);
const isFiniteNum = (v) => typeof v === "number" && Number.isFinite(v);

function isValidIsoDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; // rejects 2026-02-30
}

// ── anchor cadence (round-4 review finding) ───────────────────────────────────
// Real runs are hard-anchored by qteklink_payroll_create_run
// ((period_start - anchor) % 14 = 0). A seed off that cadence (or future-dated)
// NEVER matches a completed run's period_start, so it is never superseded — once
// the real run for the same real-world period completes, BOTH occupy window slots
// and the period's RATE is counted twice in the mean-of-per-period-rates leave-rate
// average (round-12). Seeds must therefore sit on the SAME cadence, strictly in the
// past.
const DAY_MS = 86_400_000;
const dayNum = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
const isoFromDayNum = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** Today as a local-calendar YYYY-MM-DD (Chris runs this in the shop's timezone). */
function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** The shop's payroll.anchor_period_start (mirrors qteklink_payroll_create_run:
 *  the newest qteklink_settings row that has the key wins). null = not configured. */
async function fetchAnchorPeriodStart() {
  const { data, error } = await sb
    .from("qteklink_settings")
    .select("payroll, updated_at")
    .eq("shop_id", SHOP_ID)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`qteklink_settings fetch failed: ${error.message}`);
  for (const row of data ?? []) {
    if (row.payroll === null || typeof row.payroll !== "object" || !("anchor_period_start" in row.payroll)) continue;
    const anchor = row.payroll.anchor_period_start;
    if (!isValidIsoDate(anchor)) {
      throw new Error(`shop ${SHOP_ID} has a malformed payroll.anchor_period_start (${JSON.stringify(anchor)}) — fix qteklink_settings first`);
    }
    return anchor;
  }
  return null;
}

/** Cadence + not-in-the-future errors for every seed entry (all reported at once). */
function cadenceErrors(items, anchor, today) {
  const out = [];
  for (const it of items) {
    for (const e of it.seedEntries ?? []) {
      if (e.period_start >= today) {
        out.push(`"${it.employee}" ${e.period_start}: period_start must be in the past (today is ${today}) — a future period would permanently hold a leave-rate window slot and evict a real period`);
        continue;
      }
      const diff = dayNum(e.period_start) - dayNum(anchor);
      if (((diff % 14) + 14) % 14 !== 0) {
        const nearest = isoFromDayNum(dayNum(anchor) + Math.round(diff / 14) * 14);
        out.push(`"${it.employee}" ${e.period_start}: off the bi-weekly cadence anchored at ${anchor} — the nearest on-cadence period_start is ${nearest}; an off-cadence seed is never superseded by the real run for that period (double-count)`);
      }
    }
  }
  return out;
}

/** Validate one input item → { employee, seedEntries (cents), seedRateCents } or throws. */
function parseItem(item, idx) {
  const ctx = `input[${idx}]`;
  if (item === null || typeof item !== "object" || Array.isArray(item)) throw new Error(`${ctx}: must be an object`);
  for (const key of Object.keys(item)) {
    if (!["employee", "entries", "seed_rate_dollars_per_hour"].includes(key)) {
      throw new Error(`${ctx}: unknown key "${key}"`);
    }
  }
  const { employee, entries, seed_rate_dollars_per_hour: seedRateDollars } = item;
  if (typeof employee !== "string" || employee.trim().length === 0) throw new Error(`${ctx}: "employee" must be a non-blank display name`);
  if (entries === undefined && seedRateDollars === undefined) {
    throw new Error(`${ctx} (${employee}): needs "entries" and/or "seed_rate_dollars_per_hour"`);
  }
  let seedRateCents = null;
  if (seedRateDollars !== undefined) {
    if (!isFiniteNum(seedRateDollars) || seedRateDollars < 0) throw new Error(`${ctx} (${employee}): seed_rate_dollars_per_hour must be a number >= 0`);
    seedRateCents = dollarsToCents(seedRateDollars);
  }
  let seedEntries = null;
  if (entries !== undefined) {
    if (!Array.isArray(entries) || entries.length === 0) throw new Error(`${ctx} (${employee}): "entries" must be a non-empty array`);
    if (entries.length > MAX_ENTRIES) throw new Error(`${ctx} (${employee}): at most ${MAX_ENTRIES} entries (a year of bi-weekly periods)`);
    const seen = new Set();
    seedEntries = entries.map((e, j) => {
      const ectx = `${ctx} (${employee}) entries[${j}]`;
      if (e === null || typeof e !== "object" || Array.isArray(e)) throw new Error(`${ectx}: must be an object`);
      for (const key of Object.keys(e)) {
        if (!["period_start", "avg_hourly_pay_dollars"].includes(key)) throw new Error(`${ectx}: unknown key "${key}"`);
      }
      if (!isValidIsoDate(e.period_start)) throw new Error(`${ectx}: period_start must be a valid YYYY-MM-DD date (got ${JSON.stringify(e.period_start)})`);
      if (seen.has(e.period_start)) throw new Error(`${ectx}: duplicate period_start ${e.period_start}`);
      seen.add(e.period_start);
      // Round-12: each period carries its already-averaged hourly RATE (the mean-of-
      // per-period-rates basis), not a work_pay/clock_hours pair.
      if (!isFiniteNum(e.avg_hourly_pay_dollars) || e.avg_hourly_pay_dollars < 0) throw new Error(`${ectx}: avg_hourly_pay_dollars must be a number >= 0`);
      return { period_start: e.period_start, avg_hourly_pay_cents: dollarsToCents(e.avg_hourly_pay_dollars) };
    });
  }
  return { employee: employee.trim(), seedEntries, seedRateCents };
}

// ── employee matching (case-insensitive display_name; update-only, never archived) ──
async function fetchShopEmployees() {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("qteklink_payroll_employees")
      .select("id, display_name, role, tekmetric_employee_id, pay_config, archived_at")
      .eq("shop_id", SHOP_ID)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`qteklink_payroll_employees fetch failed: ${error.message}`);
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return out;
}

function matchEmployee(allEmployees, name) {
  const needle = name.trim().toLowerCase();
  const matches = allEmployees.filter((e) => e.display_name.trim().toLowerCase() === needle);
  const active = matches.filter((e) => e.archived_at === null);
  if (active.length === 1) return { emp: active[0] };
  if (active.length > 1) return { error: `ambiguous: ${active.length} active employees named "${name}" (${active.map((e) => e.id).join(", ")}) — disambiguate in the DB first` };
  if (matches.length > 0) return { error: `"${name}" matches only ARCHIVED employee(s) (${matches.map((e) => e.id).join(", ")}) — the seeder never touches archived employees` };
  return { error: `no employee named "${name}" in shop ${SHOP_ID} — the seeder NEVER creates employees (Chris hard rule); add them in-app first` };
}

// ── main ──────────────────────────────────────────────────────────────────────
const main = async () => {
  let input;
  try {
    input = JSON.parse(readFileSync(INPUT_PATH, "utf8"));
  } catch (e) {
    throw new Error(`could not read/parse ${INPUT_PATH}: ${e.message}`);
  }
  if (!Array.isArray(input) || input.length === 0) throw new Error("input must be a non-empty JSON array");

  const items = input.map((item, idx) => parseItem(item, idx));
  const dupNames = new Set();
  const seenNames = new Set();
  for (const it of items) {
    const k = it.employee.toLowerCase();
    if (seenNames.has(k)) dupNames.add(it.employee);
    seenNames.add(k);
  }
  if (dupNames.size > 0) throw new Error(`duplicate employee(s) in input: ${[...dupNames].join(", ")}`);

  // Seed periods must sit on the shop's real-run cadence (see cadenceErrors above).
  const anchor = await fetchAnchorPeriodStart();
  if (anchor === null && items.some((it) => it.seedEntries !== null)) {
    throw new Error(`shop ${SHOP_ID} has no payroll.anchor_period_start in qteklink_settings — configure it in-app first (seed periods are validated against the same bi-weekly cadence as real runs)`);
  }

  console.log(`${APPLY ? "APPLY" : "DRY-RUN (pass --apply to write)"}  |  shop ${SHOP_ID}  |  anchor ${anchor ?? "(not configured)"}  |  ${items.length} employee(s)  |  actor "${ACTOR_LABEL}"`);

  const allEmployees = await fetchShopEmployees();
  const errors = anchor === null ? [] : cadenceErrors(items, anchor, localToday());
  const plans = [];

  for (const it of items) {
    const { emp, error } = matchEmployee(allEmployees, it.employee);
    if (error) { errors.push(error); continue; }
    if (emp.role !== "technician" && emp.role !== "shop_foreman") {
      errors.push(`"${it.employee}" is role ${emp.role} — leave-rate seeds apply to technician/shop_foreman only`);
      continue;
    }
    if (emp.pay_config === null || typeof emp.pay_config !== "object" || Array.isArray(emp.pay_config)) {
      errors.push(`"${it.employee}" has a malformed pay_config — fix in-app first`);
      continue;
    }
    // Merge ONLY the provided seed fields onto the CURRENT pay_config (an omitted
    // field keeps whatever is already there — this tool never clears seeds).
    const merged = { ...emp.pay_config };
    if (it.seedEntries !== null) merged.leave_rate_seed_history = it.seedEntries;
    if (it.seedRateCents !== null) merged.leave_rate_seed_cents_per_hour = it.seedRateCents;
    plans.push({ it, emp, merged });
  }

  for (const { it, emp } of plans) {
    console.log(`\n── ${emp.display_name}  (id ${emp.id}, role ${emp.role}, tekmetric ${emp.tekmetric_employee_id ?? "n/a"}) ──`);
    const oldHistory = emp.pay_config.leave_rate_seed_history;
    const oldRate = emp.pay_config.leave_rate_seed_cents_per_hour;
    if (it.seedEntries !== null) {
      console.log(`  leave_rate_seed_history: ${Array.isArray(oldHistory) ? `${oldHistory.length} existing entr(ies) REPLACED by` : "(none) →"} ${it.seedEntries.length} entr(ies)`);
      for (const e of it.seedEntries) {
        console.log(`    ${e.period_start}  avg_hourly_pay ${usd(e.avg_hourly_pay_cents)}/h`);
      }
      // Round-12: the basis is the MEAN of the per-period rates, so the preview is
      // the arithmetic mean of the seeded rates (rounded once), matching the DAL's
      // mergeLeaveRateWindow.
      const mean = Math.round(it.seedEntries.reduce((s, e) => s + e.avg_hourly_pay_cents, 0) / it.seedEntries.length);
      console.log(`  → seeds imply avg ${usd(mean)}/h (mean of ${it.seedEntries.length} per-period rate(s))`);
    } else {
      console.log(`  leave_rate_seed_history: unchanged (${Array.isArray(oldHistory) ? `${oldHistory.length} existing entr(ies)` : "none"})`);
    }
    if (it.seedRateCents !== null) {
      console.log(`  leave_rate_seed_cents_per_hour: ${oldRate !== undefined ? `${usd(oldRate)}/h →` : "(none) →"} ${usd(it.seedRateCents)}/h`);
    } else {
      console.log(`  leave_rate_seed_cents_per_hour: unchanged (${oldRate !== undefined ? `${usd(oldRate)}/h` : "none"})`);
    }
    const untouched = Object.keys(emp.pay_config).filter((k) => !["leave_rate_seed_history", "leave_rate_seed_cents_per_hour"].includes(k));
    console.log(`  (all other pay_config keys untouched: ${untouched.join(", ")})`);
  }

  if (errors.length > 0) {
    console.error(`\n${errors.length} error(s) — nothing was written:`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }

  // ── Reach OPEN runs (round-13) ──────────────────────────────────────────────
  // An already-OPEN run cloned each employee's pay_config into its entry rows at
  // creation (qteklink_payroll_create_run), and live compute reads the leave-rate
  // seeds from the ENTRY snapshot (payroll-compute.ts:295 → r.pay_config), NOT the
  // live employee row. So writing the base config alone leaves the open run paying
  // PTO/Holiday/Bereavement at 'current_run'/'base_rate'. Build the per-entry patch
  // plan now (merge the seed fields onto each entry's CURRENT snapshot so any per-run
  // rates_w2 survives); --apply writes them via qteklink_payroll_update_entry
  // (open-runs-only, validated, audited) and then marks the open runs stale.
  const planByEmpId = new Map(plans.map((p) => [p.emp.id, p]));
  const { data: openRuns, error: openErr } = await sb
    .from("qteklink_payroll_runs")
    .select("id, period_start")
    .eq("shop_id", SHOP_ID)
    .eq("status", "open")
    .order("period_start", { ascending: true });
  if (openErr) throw new Error(`open-run check failed: ${openErr.message}`);

  const entryPatches = []; // { runEmployeeId, runPeriodStart, empName, entryMerged }
  if ((openRuns ?? []).length > 0 && plans.length > 0) {
    const { data: entryRows, error: entryErr } = await sb
      .from("qteklink_payroll_run_employees")
      .select("id, run_id, employee_id, pay_config")
      .in("run_id", openRuns.map((r) => r.id))
      .in("employee_id", [...planByEmpId.keys()]);
    if (entryErr) throw new Error(`open-run entry check failed: ${entryErr.message}`);
    const periodByRunId = new Map((openRuns ?? []).map((r) => [r.id, r.period_start]));
    for (const row of entryRows ?? []) {
      const plan = planByEmpId.get(row.employee_id);
      if (!plan) continue;
      if (row.pay_config === null || typeof row.pay_config !== "object" || Array.isArray(row.pay_config)) {
        errors.push(`open run ${periodByRunId.get(row.run_id)} entry for "${plan.emp.display_name}" has a malformed pay_config — fix in-app first`);
        continue;
      }
      // Merge ONLY the provided seed fields onto the ENTRY's current snapshot (mirrors
      // the base-config merge above; per-run rates_w2 and every other key survive).
      const entryMerged = { ...row.pay_config };
      if (plan.it.seedEntries !== null) entryMerged.leave_rate_seed_history = plan.it.seedEntries;
      if (plan.it.seedRateCents !== null) entryMerged.leave_rate_seed_cents_per_hour = plan.it.seedRateCents;
      entryPatches.push({
        runEmployeeId: row.id,
        runPeriodStart: periodByRunId.get(row.run_id),
        empName: plan.emp.display_name,
        entryMerged,
      });
    }
  }
  if (errors.length > 0) {
    console.error(`\n${errors.length} error(s) — nothing was written:`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }

  if ((openRuns ?? []).length > 0) {
    console.log(
      entryPatches.length > 0
        ? `\nOPEN run(s): ${entryPatches.length} seeded entry row(s) will be patched so the seeds REACH them, then the run(s) are marked stale to recompute:`
        : `\nOPEN run(s): ${openRuns.length} open, but none contain a seeded employee — nothing to patch.`,
    );
    for (const run of openRuns) {
      const names = entryPatches.filter((p) => p.runPeriodStart === run.period_start).map((p) => p.empName).sort();
      console.log(`  open run ${run.period_start} (${run.id}): ${names.length > 0 ? `patch ${names.join(", ")}` : "no seeded employees in it"}`);
    }
  }

  if (!APPLY) {
    console.log(
      `\nDRY-RUN complete — ${plans.length} employee base config(s)` +
        `${entryPatches.length > 0 ? ` + ${entryPatches.length} open-run entry row(s)` : ""} ready. Re-run with --apply to write.`,
    );
    return;
  }

  for (const { emp, merged } of plans) {
    if (!emp.id) throw new Error("refusing to upsert without an employee id — the seeder never creates employees");
    const { data, error } = await sb.rpc("qteklink_payroll_upsert_employee", {
      p_shop_id: SHOP_ID,
      p_employee_id: emp.id, // ALWAYS the matched id — update-only, never a create
      p_display_name: emp.display_name,
      p_role: emp.role,
      p_tekmetric_employee_id: emp.tekmetric_employee_id === null ? null : Number(emp.tekmetric_employee_id),
      p_pay_config: merged,
      p_archived: false,
      p_actor_user_id: null,
      p_actor_label: ACTOR_LABEL,
    });
    if (error) throw new Error(`upsert for "${emp.display_name}" failed: ${error.message} (earlier employees in this run WERE written)`);
    if (data !== emp.id) throw new Error(`upsert for "${emp.display_name}" returned unexpected id ${data} (expected ${emp.id})`);
    console.log(`✓ wrote seeds for ${emp.display_name} (${emp.id})`);
  }

  // Patch each seeded employee's OPEN-run entry snapshot, then invalidate the open
  // runs' live caches so the next run view recomputes with the seeds. Everything is
  // idempotent — a re-run re-patches the same entries and re-marks stale.
  for (const p of entryPatches) {
    const { error } = await sb.rpc("qteklink_payroll_update_entry", {
      p_run_employee_id: p.runEmployeeId,
      p_patch: { pay_config: p.entryMerged },
      p_actor_user_id: null,
      p_actor_label: ACTOR_LABEL,
    });
    if (error) throw new Error(`open-run entry patch for "${p.empName}" (run ${p.runPeriodStart}) failed: ${error.message} (base configs + earlier entries WERE written; re-run to finish — the seeder is idempotent)`);
    console.log(`✓ patched open-run entry for ${p.empName} (run ${p.runPeriodStart})`);
  }
  if (entryPatches.length > 0) {
    const { data: marked, error: markErr } = await sb.rpc("qteklink_payroll_mark_open_runs_stale", { p_shop_id: SHOP_ID });
    if (markErr) throw new Error(`mark_open_runs_stale failed: ${markErr.message} (entries WERE patched — open the run in-app once to force a recompute)`);
    console.log(`✓ marked ${typeof marked === "number" ? marked : 0} open run(s) stale — the next run view recomputes with the seeds`);
  }
  console.log(
    `\nAPPLY complete — ${plans.length} employee(s) updated` +
      (entryPatches.length > 0 ? ` + ${entryPatches.length} open-run entry row(s) patched (open runs marked stale)` : "") +
      `. Verify in-app (dashboard + open-run leave rates show source 'history').`,
  );
};

main().catch((e) => { console.error(`FAIL: ${e.message}`); process.exit(1); });
