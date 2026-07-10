/**
 * GOLDEN tests — every sheet of every extracted workbook fixture
 * (test-kit/fixtures/payroll/workbook-*.json: 5 pay periods × 19 sheets = 80 sheets
 * incl. roster drift) is replayed through computeSheet and every mapped output is
 * asserted against the workbook's cached Excel value: money within ±1 cent, hours and
 * ratios within ±0.01.
 *
 * Fixture inputs use the OLD manual-OT model (clock = reg-only + a separate OT entry;
 * decision #6 replaced that with the >40 auto-split), so each sheet feeds the recorded
 * (clock, ot) pair through computeSheet's `presplit` seam — the splitter itself has
 * synthetic tests in calc.split.test.ts. Dollar floats → cents via Math.round(x*100);
 * null inputs = 0.
 *
 * KNOWN WORKBOOK QUIRKS (assertions skipped, never engine bends — see SKIPS):
 *  - Quirk A (sub-cent rate): two 5-3-26 sheets carry hourly rates with 4 decimals
 *    (Williams $27.7673, Aube $25.3687). pay_config money is INTEGER cents by contract,
 *    so the converted rate is off by up to half a cent → rate×hours products drift a
 *    few cents. The formulas are proven by the other 4 workbooks for the same sheets.
 *  - Quirk B (hand-keyed leave pay): the PTO-block pay cells are unlocked in the
 *    workbook, and on 6 sheets someone typed leave pay at a rate ≠ the hourly rate
 *    (e.g. Trilli 6-28 holiday @ $53.06/hr vs $31.67 hourly). The 5-17 + 5-31 workbooks
 *    prove the template formula is hours × hourly rate (extraction doc: leave paid at
 *    the week's hourly rate) — these cells are manual overrides, not the formula.
 *  Every SKIPS entry must be consumed; a stale entry fails the last test.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { computeSheet } from "../calc";
import type {
  DerivedInputs,
  Family,
  OfficeManagerPayConfig,
  ServiceAdvisorPayConfig,
  SheetComputation,
  SheetEntries,
  ShopForemanPayConfig,
  SupportPayConfig,
  TechnicianPayConfig,
} from "../types";

// ── Fixture loading (the test-kit sits at the repo root, above qteklink-app) ──

const FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../test-kit/fixtures/payroll",
);

type Cell = number | string | null;
interface FixtureSheet {
  sheet: string;
  family: string; // fixture families: technician | shop_foreman | service_advisor | office_manager | hourly
  inputs: Record<string, Cell>;
  outputs: Record<string, Cell>;
}
interface FixtureWorkbook {
  source_workbook: string;
  period_label: string;
  sheets: FixtureSheet[];
}

const fixtureFiles = readdirSync(FIXTURE_DIR)
  .filter((f) => f.startsWith("workbook-") && f.endsWith(".json"))
  .sort();

const workbooks = fixtureFiles.map((file) => ({
  file,
  wb: JSON.parse(readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as FixtureWorkbook,
}));

/** null / missing / non-numeric (e.g. "#DIV/0!") input cell → 0. */
const num = (v: Cell | undefined): number => (typeof v === "number" ? v : 0);
/** Dollar float → integer cents (task rule: Math.round(x*100)); null → 0. */
const cents = (v: Cell | undefined): number => Math.round(num(v) * 100);
/** Output cell → number, or null when the workbook cell is empty / an error string. */
const out = (v: Cell | undefined): number | null => (typeof v === "number" ? v : null);

// ── Documented skips (sheet+cell+reason). Keyed `${file}::${sheet}::${field}`. ──

const QUIRK_A_WILLIAMS =
  "Quirk A: Williams 5-3 hourly rate $27.7673 has sub-cent precision — integer-cents pay_config shifts rate×hours by >1¢ on this sheet only";
const QUIRK_A_AUBE =
  "Quirk A: Aube 5-3 hourly rate $25.3687 has sub-cent precision — integer-cents pay_config shifts rate×hours by >1¢ on this sheet only";
const quirkB = (cell: string, rate: string, hourly: string) =>
  `Quirk B: hand-keyed ${cell} cell pays @ $${rate}/hr vs the $${hourly} hourly rate — manual override in the unlocked PTO block, not the template formula (hours × hourly rate, proven by the 5-17/5-31 workbooks)`;

const SKIPS: Record<string, string> = {
  // ---- Quirk A — workbook-5-3-26-5-16-26.json :: Williams, Charles (rate cells E7/Q7) ----
  "workbook-5-3-26-5-16-26.json::Williams, Charles::hourly_pay_w1": QUIRK_A_WILLIAMS,
  "workbook-5-3-26-5-16-26.json::Williams, Charles::hourly_pay_w2": QUIRK_A_WILLIAMS,
  "workbook-5-3-26-5-16-26.json::Williams, Charles::ot_pay_w1": QUIRK_A_WILLIAMS,
  "workbook-5-3-26-5-16-26.json::Williams, Charles::ot_pay_w2": QUIRK_A_WILLIAMS,
  "workbook-5-3-26-5-16-26.json::Williams, Charles::eff_pay_w1": QUIRK_A_WILLIAMS,
  "workbook-5-3-26-5-16-26.json::Williams, Charles::reg_total": QUIRK_A_WILLIAMS,
  "workbook-5-3-26-5-16-26.json::Williams, Charles::incentive": QUIRK_A_WILLIAMS,
  "workbook-5-3-26-5-16-26.json::Williams, Charles::total_pay": QUIRK_A_WILLIAMS,
  // ---- Quirk A — workbook-5-3-26-5-16-26.json :: Aube, Marie (rate cells) ----
  "workbook-5-3-26-5-16-26.json::Aube, Marie::hourly_pay_w1": QUIRK_A_AUBE,
  "workbook-5-3-26-5-16-26.json::Aube, Marie::hourly_pay_w2": QUIRK_A_AUBE,
  "workbook-5-3-26-5-16-26.json::Aube, Marie::reg_total": QUIRK_A_AUBE,
  "workbook-5-3-26-5-16-26.json::Aube, Marie::total_pay": QUIRK_A_AUBE,
  // ---- Quirk B — workbook-6-14-26-6-27-26.json :: Eli Vasiliou (PTO pay cell) ----
  // pto 46.30h × $20.60 = $953.78, workbook cached $1,576.97 (@ ~$34.06/hr).
  "workbook-6-14-26-6-27-26.json::Eli Vasiliou::pto_pay": quirkB("PTO pay", "34.06", "20.60"),
  "workbook-6-14-26-6-27-26.json::Eli Vasiliou::total_pay": quirkB("PTO pay", "34.06", "20.60"),
  "workbook-6-14-26-6-27-26.json::Eli Vasiliou::pay_per_clock": quirkB("PTO pay", "34.06", "20.60"),
  "workbook-6-14-26-6-27-26.json::Eli Vasiliou::cost_per_billed": quirkB("PTO pay", "34.06", "20.60"),
  // ---- Quirk B — workbook-6-28-26-7-11-26.json (the in-flight period; July-3 holiday
  //      pay hand-keyed on 5 technician-family sheets; Trilli PTO too) ----
  "workbook-6-28-26-7-11-26.json::Clark, Matt::hol_pay": quirkB("Holiday pay", "43.27", "22.66"),
  "workbook-6-28-26-7-11-26.json::Clark, Matt::total_pay": quirkB("Holiday pay", "43.27", "22.66"),
  "workbook-6-28-26-7-11-26.json::Clark, Matt::pay_per_clock": quirkB("Holiday pay", "43.27", "22.66"),
  "workbook-6-28-26-7-11-26.json::Clark, Matt::cost_per_billed": quirkB("Holiday pay", "43.27", "22.66"),
  "workbook-6-28-26-7-11-26.json::Fuhrer, Joseph::hol_pay": quirkB("Holiday pay", "35.58", "20.00"),
  "workbook-6-28-26-7-11-26.json::Fuhrer, Joseph::total_pay": quirkB("Holiday pay", "35.58", "20.00"),
  "workbook-6-28-26-7-11-26.json::Fuhrer, Joseph::pay_per_clock": quirkB("Holiday pay", "35.58", "20.00"),
  "workbook-6-28-26-7-11-26.json::Fuhrer, Joseph::cost_per_billed": quirkB("Holiday pay", "35.58", "20.00"),
  "workbook-6-28-26-7-11-26.json::Trilli, George::pto_pay": quirkB("PTO pay", "53.06", "31.67"),
  "workbook-6-28-26-7-11-26.json::Trilli, George::hol_pay": quirkB("Holiday pay", "53.06", "31.67"),
  "workbook-6-28-26-7-11-26.json::Trilli, George::total_pay": quirkB("PTO+Holiday pay", "53.06", "31.67"),
  "workbook-6-28-26-7-11-26.json::Trilli, George::pay_per_clock": quirkB("PTO+Holiday pay", "53.06", "31.67"),
  "workbook-6-28-26-7-11-26.json::Trilli, George::cost_per_billed": quirkB("PTO+Holiday pay", "53.06", "31.67"),
  "workbook-6-28-26-7-11-26.json::Eli Vasiliou::hol_pay": quirkB("Holiday pay", "35.09", "20.60"),
  "workbook-6-28-26-7-11-26.json::Eli Vasiliou::total_pay": quirkB("Holiday pay", "35.09", "20.60"),
  "workbook-6-28-26-7-11-26.json::Eli Vasiliou::pay_per_clock": quirkB("Holiday pay", "35.09", "20.60"),
  "workbook-6-28-26-7-11-26.json::Eli Vasiliou::cost_per_billed": quirkB("Holiday pay", "35.09", "20.60"),
  "workbook-6-28-26-7-11-26.json::Williams, Charles::hol_pay": quirkB("Holiday pay", "45.87", "28.60"),
  "workbook-6-28-26-7-11-26.json::Williams, Charles::total_pay": quirkB("Holiday pay", "45.87", "28.60"),
  "workbook-6-28-26-7-11-26.json::Williams, Charles::pay_per_clock": quirkB("Holiday pay", "45.87", "28.60"),
  "workbook-6-28-26-7-11-26.json::Williams, Charles::cost_per_billed": quirkB("Holiday pay", "45.87", "28.60"),
};

const consumedSkips = new Set<string>();

// ── Assertion helpers (±1 cent money, ±0.01 hours/ratios; skip-aware) ──────────

interface Ctx {
  file: string;
  sheet: string;
}

function skipped(ctx: Ctx, field: string): boolean {
  const key = `${ctx.file}::${ctx.sheet}::${field}`;
  if (key in SKIPS) {
    consumedSkips.add(key);
    return true;
  }
  return false;
}

/** Money: engine integer cents vs fixture dollar float, |diff| ≤ 1 cent. */
function expectMoney(ctx: Ctx, field: string, fixture: Cell | undefined, engineCents: number | null): void {
  const fx = out(fixture);
  if (fx === null || skipped(ctx, field)) return;
  const expected = Math.round(fx * 100);
  expect(
    engineCents,
    `${ctx.file} :: ${ctx.sheet} :: ${field} — engine ${engineCents}¢ vs workbook ${expected}¢`,
  ).not.toBeNull();
  expect(
    Math.abs((engineCents as number) - expected),
    `${ctx.file} :: ${ctx.sheet} :: ${field} — engine ${engineCents}¢ vs workbook ${expected}¢`,
  ).toBeLessThanOrEqual(1);
}

/** Hours / ratios: |diff| ≤ 0.01 (tiny epsilon absorbs float representation noise). */
function expectNum(ctx: Ctx, field: string, fixture: Cell | undefined, engine: number | null): void {
  const fx = out(fixture);
  if (fx === null || skipped(ctx, field)) return;
  expect(engine, `${ctx.file} :: ${ctx.sheet} :: ${field} — engine ${engine} vs workbook ${fx}`).not.toBeNull();
  expect(
    Math.abs((engine as number) - fx),
    `${ctx.file} :: ${ctx.sheet} :: ${field} — engine ${engine} vs workbook ${fx}`,
  ).toBeLessThanOrEqual(0.01 + 1e-9);
}

// ── Fixture sheet → engine invocation per family ───────────────────────────────

const baseConfig = { config_version: 1 as const, pto_balance_hours: 0, pto_accrual_hours_per_period: 0 };

function entriesFrom(i: Record<string, Cell>): SheetEntries {
  return {
    // Total worked clock per week — irrelevant under presplit but kept faithful.
    clock_hours_w1: num(i.clock_w1) + num(i.ot_w1),
    clock_hours_w2: num(i.clock_w2) + num(i.ot_w2),
    pto_w1: num(i.pto_w1),
    pto_w2: num(i.pto_w2),
    holiday_w1: num(i.hol_w1),
    holiday_w2: num(i.hol_w2),
    bereavement_w1: num(i.ber_w1),
    bereavement_w2: num(i.ber_w2),
    training_w1: num(i.trn_w1),
    training_w2: num(i.trn_w2),
    manual_incentive_cents: i.manual_incentive == null ? null : cents(i.manual_incentive),
  };
}

/** The OLD manual-OT model: the workbook's clock cell is reg-only and OT is a separate
 *  manual entry — feed that recorded split straight into the formulas. */
function presplitFrom(i: Record<string, Cell>) {
  return {
    presplit: {
      w1: { reg: num(i.clock_w1), ot: num(i.ot_w1) },
      w2: { reg: num(i.clock_w2), ot: num(i.ot_w2) },
    },
  };
}

function computeFixtureSheet(fs: FixtureSheet): { engineFamily: Family; sheet: SheetComputation } {
  const i = fs.inputs;
  const entries = entriesFrom(i);
  const opts = presplitFrom(i);
  switch (fs.family) {
    case "technician": {
      const pc: TechnicianPayConfig = {
        ...baseConfig,
        hourly_rate_cents: cents(i.rate_hourly_w1),
        billed_rate_cents: cents(i.rate_billed_w1),
        rates_w2: { hourly_rate_cents: cents(i.rate_hourly_w2), billed_rate_cents: cents(i.rate_billed_w2) },
      };
      const derived: DerivedInputs = { billed_hours_w1: num(i.billed_w1), billed_hours_w2: num(i.billed_w2) };
      return { engineFamily: "technician", sheet: computeSheet("technician", pc, entries, derived, opts) };
    }
    case "shop_foreman": {
      const pc: ShopForemanPayConfig = {
        ...baseConfig,
        hourly_rate_cents: cents(i.rate_hourly_w1),
        billed_rate_cents: cents(i.rate_billed_w1),
        rates_w2: { hourly_rate_cents: cents(i.rate_hourly_w2), billed_rate_cents: cents(i.rate_billed_w2) },
        shop_hour_goal: num(i.shop_hour_goal),
        shop_hour_bonus_cents_per_hour: cents(i.hour_bonus_rate),
      };
      const derived: DerivedInputs = {
        billed_hours_w1: num(i.billed_w1),
        billed_hours_w2: num(i.billed_w2),
        shop_hours: num(i.shop_hours),
      };
      return { engineFamily: "shop_foreman", sheet: computeSheet("shop_foreman", pc, entries, derived, opts) };
    }
    case "service_advisor": {
      const pc: ServiceAdvisorPayConfig = {
        ...baseConfig,
        weekly_salary_cents: cents(i.salary_w1),
        rates_w2: { weekly_salary_cents: cents(i.salary_w2) },
        gp_goal_1_cents: cents(i.gp_goal_1),
        gp_goal_2_cents: cents(i.gp_goal_2),
        sales_goal_cents: cents(i.sales_goal),
        tier1_pct: num(i.tier1),
        tier2_pct: num(i.tier2),
        tier3_pct: num(i.tier3),
        spiff_amount_cents: cents(i.spiff_amount),
      };
      const derived: DerivedInputs = {
        month_sales_cents: cents(i.month_sales),
        month_gp_with_fees_cents: cents(i.gp_with_fees),
        month_gp_without_fees_cents: cents(i.gp_without_fees),
        spiff_count: num(i.fivepack_count),
      };
      return {
        engineFamily: "service_advisor",
        sheet: computeSheet("service_advisor", pc, entries, derived, opts),
      };
    }
    case "office_manager": {
      const pc: OfficeManagerPayConfig = {
        ...baseConfig,
        hourly_rate_cents: cents(i.rate_w1),
        rates_w2: { hourly_rate_cents: cents(i.rate_w2) },
        sales_goal_cents: cents(i.sales_goal),
        bonus_pct: num(i.bonus_pct),
      };
      const derived: DerivedInputs = { month_sales_cents: cents(i.month_sales) };
      return { engineFamily: "office_manager", sheet: computeSheet("office_manager", pc, entries, derived, opts) };
    }
    case "hourly": {
      // The fixture's "hourly" layout family = the contract's "support" family.
      const pc: SupportPayConfig = {
        ...baseConfig,
        hourly_rate_cents: cents(i.rate_w1),
        rates_w2: { hourly_rate_cents: cents(i.rate_w2) },
      };
      return { engineFamily: "support", sheet: computeSheet("support", pc, entries, {}, opts) };
    }
    default:
      throw new Error(`unknown fixture family: ${fs.family}`);
  }
}

// ── Per-family output assertions ───────────────────────────────────────────────

function assertHourlyBilledOutputs(ctx: Ctx, o: Record<string, Cell>, s: SheetComputation): void {
  expectNum(ctx, "eff_w1", o.eff_w1, s.week1.efficiency_hours);
  expectNum(ctx, "eff_w2", o.eff_w2, s.week2.efficiency_hours);
  expectMoney(ctx, "hourly_pay_w1", o.hourly_pay_w1, s.week1.base_pay_cents);
  expectMoney(ctx, "hourly_pay_w2", o.hourly_pay_w2, s.week2.base_pay_cents);
  expectMoney(ctx, "billed_pay_w1", o.billed_pay_w1, s.week1.billed_pay_cents);
  expectMoney(ctx, "billed_pay_w2", o.billed_pay_w2, s.week2.billed_pay_cents);
  expectMoney(ctx, "ot_pay_w1", o.ot_pay_w1, s.week1.ot_pay_cents);
  expectMoney(ctx, "ot_pay_w2", o.ot_pay_w2, s.week2.ot_pay_cents);
  expectMoney(ctx, "eff_pay_w1", o.eff_pay_w1, s.week1.efficiency_pay_cents);
  expectMoney(ctx, "eff_pay_w2", o.eff_pay_w2, s.week2.efficiency_pay_cents);
  expectNum(ctx, "reg_hours", o.reg_hours, s.reg_hours);
  expectNum(ctx, "ot_hours", o.ot_hours, s.ot_hours);
  expectNum(ctx, "total_hours", o.total_hours, s.total_hours);
  expectNum(ctx, "total_billed", o.total_billed, s.billed_hours_total);
  expectMoney(ctx, "reg_total", o.reg_total, s.reg_total_cents);
  expectMoney(ctx, "incentive", o.incentive, s.incentive_cents);
  expectMoney(ctx, "pto_pay", o.pto_pay, s.pto_pay_cents);
  expectMoney(ctx, "trn_pay", o.trn_pay, s.training_pay_cents);
  expectMoney(ctx, "hol_pay", o.hol_pay, s.holiday_pay_cents);
  expectMoney(ctx, "ber_pay", o.ber_pay, s.bereavement_pay_cents);
  expectMoney(ctx, "total_pay", o.total_pay, s.total_pay_cents);
  // Metrics: dollar-per-hour cells compare as money (±1¢); productivity is a ratio.
  // A workbook "#DIV/0!" cell (zero-hour sheet) must be a NULL metric, never a number.
  if (out(o.pay_per_clock) === null) {
    expect(s.metrics.pay_per_clock_hour_cents, `${ctx.file} :: ${ctx.sheet} :: pay_per_clock null`).toBeNull();
  } else {
    expectMoney(ctx, "pay_per_clock", o.pay_per_clock, s.metrics.pay_per_clock_hour_cents);
  }
  if (out(o.cost_per_billed) === null) {
    expect(s.metrics.cost_per_billed_hour_cents, `${ctx.file} :: ${ctx.sheet} :: cost_per_billed null`).toBeNull();
  } else {
    expectMoney(ctx, "cost_per_billed", o.cost_per_billed, s.metrics.cost_per_billed_hour_cents);
  }
  if (out(o.productivity) === null) {
    expect(s.metrics.productivity, `${ctx.file} :: ${ctx.sheet} :: productivity null`).toBeNull();
  } else {
    expectNum(ctx, "productivity", o.productivity, s.metrics.productivity);
  }
}

function assertPlainHourlyOutputs(ctx: Ctx, o: Record<string, Cell>, s: SheetComputation): void {
  expectMoney(ctx, "hourly_pay_w1", o.hourly_pay_w1, s.week1.base_pay_cents);
  expectMoney(ctx, "hourly_pay_w2", o.hourly_pay_w2, s.week2.base_pay_cents);
  expectMoney(ctx, "ot_pay_w1", o.ot_pay_w1, s.week1.ot_pay_cents);
  expectMoney(ctx, "ot_pay_w2", o.ot_pay_w2, s.week2.ot_pay_cents);
  expectNum(ctx, "reg_hours", o.reg_hours, s.reg_hours);
  expectNum(ctx, "ot_hours", o.ot_hours, s.ot_hours);
  expectNum(ctx, "total_hours", o.total_hours, s.total_hours);
  expectMoney(ctx, "reg_total", o.reg_total, s.reg_total_cents);
  expectMoney(ctx, "incentive", o.incentive, s.incentive_cents);
  expectMoney(ctx, "pto_pay", o.pto_pay, s.pto_pay_cents);
  expectMoney(ctx, "trn_pay", o.trn_pay, s.training_pay_cents);
  expectMoney(ctx, "hol_pay", o.hol_pay, s.holiday_pay_cents);
  expectMoney(ctx, "ber_pay", o.ber_pay, s.bereavement_pay_cents);
  expectMoney(ctx, "total_pay", o.total_pay, s.total_pay_cents);
}

function assertServiceAdvisorOutputs(ctx: Ctx, o: Record<string, Cell>, s: SheetComputation): void {
  expectMoney(ctx, "week1_pay", o.week1_pay, s.week1.base_pay_cents);
  expectMoney(ctx, "week2_pay", o.week2_pay, s.week2.base_pay_cents);
  expectNum(ctx, "reg_hours", o.reg_hours, s.reg_hours);
  expectNum(ctx, "ot_hours", o.ot_hours, s.ot_hours);
  expectNum(ctx, "total_hours", o.total_hours, s.total_hours);
  expectMoney(ctx, "reg_total", o.reg_total, s.reg_total_cents);
  expectMoney(ctx, "spiff", o.spiff, s.spiff_cents);
  expectMoney(ctx, "bonus", o.bonus, s.bonus_cents);
  expectMoney(ctx, "incentive", o.incentive, s.incentive_cents);
  expectMoney(ctx, "total_pay", o.total_pay, s.total_pay_cents);
  // Salaried: leave is HOURS-only (tracked, never paid on top) — pay must be null.
  expectNum(ctx, "pto_hours", o.pto_hours, s.pto_hours);
  expectNum(ctx, "trn_hours", o.trn_hours, s.training_hours);
  expectNum(ctx, "hol_hours", o.hol_hours, s.holiday_hours);
  expectNum(ctx, "ber_hours", o.ber_hours, s.bereavement_hours);
  expect(s.pto_pay_cents, `${ctx.file} :: ${ctx.sheet} :: salaried pto_pay is n/a`).toBeNull();
  expect(s.holiday_pay_cents, `${ctx.file} :: ${ctx.sheet} :: salaried hol_pay is n/a`).toBeNull();
}

// ── The suite ──────────────────────────────────────────────────────────────────

it("loads EVERY workbook fixture (5 pay periods, 80 sheets)", () => {
  expect(workbooks.map((w) => w.file)).toHaveLength(5);
  expect(workbooks.reduce((n, w) => n + w.wb.sheets.length, 0)).toBe(80);
});

for (const { file, wb } of workbooks) {
  describe(`golden: ${file} (${wb.period_label})`, () => {
    for (const fixtureSheet of wb.sheets) {
      it(`${fixtureSheet.sheet} [${fixtureSheet.family}]`, () => {
        const ctx: Ctx = { file, sheet: fixtureSheet.sheet };
        const { engineFamily, sheet } = computeFixtureSheet(fixtureSheet);
        expect(sheet.family).toBe(engineFamily);
        const o = fixtureSheet.outputs;
        switch (fixtureSheet.family) {
          case "technician":
          case "shop_foreman":
            assertHourlyBilledOutputs(ctx, o, sheet);
            if (fixtureSheet.family === "shop_foreman") expectMoney(ctx, "bonus", o.bonus, sheet.bonus_cents);
            break;
          case "service_advisor":
            assertServiceAdvisorOutputs(ctx, o, sheet);
            break;
          case "office_manager":
            assertPlainHourlyOutputs(ctx, o, sheet);
            expectMoney(ctx, "bonus", o.bonus, sheet.bonus_cents);
            break;
          case "hourly":
            assertPlainHourlyOutputs(ctx, o, sheet);
            break;
          default:
            throw new Error(`unknown fixture family: ${fixtureSheet.family}`);
        }
      });
    }
  });
}

describe("skip hygiene", () => {
  it("every documented workbook-quirk skip was exercised (no stale entries)", () => {
    const stale = Object.keys(SKIPS).filter((k) => !consumedSkips.has(k));
    expect(stale, `stale SKIPS entries: ${stale.join(", ")}`).toEqual([]);
  });
});
