/**
 * Payroll DAL — run computation assembly + snapshot builder (contract:
 * docs/qteklink/payroll-contract.md §dal/payroll.ts "run compute assembly").
 * Internal support module for src/lib/dal/payroll.ts (the public entrypoint) —
 * split out to honor the ~500-line file policy. Import from "@/lib/dal/payroll".
 *
 * Assembly (open runs): calc + derive with the override precedence rule —
 * override.value beats the derived number key-by-key; the RAW overrides object is
 * kept in the snapshot next to the EFFECTIVE inputs as provenance. Two passes:
 * non-service-advisor sheets first (they never need GP), then the bonus month's GP
 * (#38: sales incl fees − parts − QBO 6010 tech cost; on a QBO failure the labeled
 * fallback prorates labor pay over every run overlapping the month — completed runs
 * from their frozen snapshots, other open runs computed live, voided skipped), then
 * the service-advisor sheets that consume it.
 *
 * Read-path rule: completed/voided runs render EXCLUSIVELY from the frozen
 * snapshot — never recomputed.
 *
 * Round-3 amendments (2026-07-10, extraction #22–#27): tech/foreman PTO/Hol/Ber pay
 * at the avg-hourly-WITHOUT-bonus leave rate (override → merged 12-period window →
 * current run ex-bonus ex-leave → base hourly), and the SA sales goal auto-derives
 * from the prior-year same-month subtotal (override → priorYearMonthSubtotalCents →
 * legacy pay_config.sales_goal_cents when 0 ROs).
 * Round-4 (seed history): the leave-rate window merges completed-run entries with
 * seeded pre-qteklink periods from pay_config.leave_rate_seed_history (a real run
 * beats a same-period seed); pay_config.leave_rate_seed_cents_per_hour is the
 * single-rate 'seed' fallback between 'history' and 'current_run'.
 * Round-5 (#32): the shop-foreman hour goal auto-derives from prior-year same-month
 * shop billed hours, mirroring the SA sales goal (override → prior-year (roCount>0)
 * → legacy pay_config.shop_hour_goal); derived only for bonus runs with a foreman
 * on the roster; goal + source ride DerivedInputs/SheetComputation/snapshot.
 * Round-5 (#36/#37/#38): month sales display AFTER fees (Σ totalSales − taxes −
 * fees — reverses #28; the prior-year auto goal follows); parts cost = per-line
 * round(cost × qty) over authorized jobs + RO-level sublet items; and the GP
 * composition is PRIMARILY sales(incl fees, internal) − parts − QBO 6010
 * technician cost (source 'qbo_tech_cost'), with the prorated-labor computation
 * kept ONLY as the labeled fallback when the QBO fetch throws. The composition
 * root (resolveMonthGp) + the GP-labor input builders + applyOverrides live in
 * ./payroll-compute-gp.ts (~500-line file policy).
 */
import { getShopSettings } from "@/lib/dal/settings";
import { addDaysIso } from "@/lib/format";
import { CALC_VERSION, computeSheet } from "@/lib/payroll/calc";
import {
  billedHoursByTechnician,
  monthFeesCents,
  monthPartsCostCents,
  monthSalesPreTaxCents,
  priorYearMonthSubtotalCents,
  priorYearShopBilledHours,
  shopBilledHours,
  spiffCountsByServiceWriter,
  type DeriveProvenance,
} from "@/lib/payroll/derive";
import { GP_LABOR_ROLES, type MonthGpSource } from "@/lib/payroll/gp";
import {
  applyOverrides,
  gpPayFromSheet,
  isTechnicianFamily,
  resolveMonthGp,
} from "@/lib/dal/payroll-compute-gp";
import { buildRunSummary, type EmployeeSheet } from "@/lib/payroll/summary";
import {
  fetchLeaveRateHistory,
  mergeLeaveRateWindow,
  resolveLeaveRate,
  type LeaveRateResolution,
} from "@/lib/dal/payroll-leave-rate";
import {
  familyForRole,
  parsePayConfig,
  RoleSchema,
  RunSnapshotSchema,
  SNAPSHOT_VERSION,
  type DerivedInputs,
  type Family,
  type Overrides,
  type Role,
  type RunSnapshot,
  type SheetComputation,
  type SheetEntries,
  type SnapshotEmployee,
  type TechnicianPayConfig,
} from "@/lib/payroll/types";
import {
  fetchEmployeesByIds,
  fetchRunEntries,
  fetchRunGuarded,
  getPayrollSettings,
  normalizeOverrides,
  runFromRow,
  sheetEntriesFromRow,
  type EntryDbRow,
  type PayrollRun,
  type RunDbRow,
} from "@/lib/dal/payroll-shared";

// ── The snapshot builder ───────────────────────────────────────────────────────

interface MonthDerivations {
  month: string;
  /** Round-5 #36 (reverses #28): the DISPLAY/tier month sales =
   *  Σ(totalSales − taxes − FEES) — the backtest-pinned original. */
  salesCents: number;
  /** Round-5 #38: the INTERNAL GP base = Σ(totalSales − taxes), fees still in.
   *  Never displayed as "month sales". */
  salesInclFeesCents: number;
  feesCents: number;
  partsCostCents: number;
  shopHours: number;
  spiffCounts: Map<number, number>;
  gpWithFeesCents: number;
  gpWithoutFeesCents: number;
  /** Round-5 #38: which composition produced the GP figures —
   *  'qbo_tech_cost' (primary) or 'computed' (the labeled fallback). */
  gpSource: MonthGpSource;
  /** QBO P&L COGS 6010 for the month; null on the computed fallback. */
  qboTechCostCents: number | null;
  qboTechCostAccountLabel: string | null;
  /** Prorated GP labor pay — computed ONLY on the fallback path (#38);
   *  null when the QBO tech-cost composition was used. */
  laborPayProratedCents: number | null;
  provenance: DeriveProvenance;
  /** Round-3 #22/#23: prior-year same-month subtotal (raw) + the SA sales goal it
   *  yields — null when the prior-year month had 0 posted ROs (no data → calc falls
   *  back to the legacy pay_config.sales_goal_cents). */
  priorYearSubtotalCents: number;
  salesGoalCents: number | null;
  salesGoalProvenance: DeriveProvenance;
  /** Round-5 #32: prior-year same-month TOTAL SHOP HOURS + the foreman goal it
   *  yields. Derived only when a foreman is on the roster (all null otherwise);
   *  goal null when the prior-year month had 0 posted ROs (no data → calc falls
   *  back to the legacy pay_config.shop_hour_goal). */
  priorYearShopHours: number | null;
  shopHourGoal: number | null;
  shopHourGoalProvenance: DeriveProvenance | null;
}

/**
 * Build the live RunSnapshot for an OPEN run. Two passes: the non-service-advisor
 * sheets first (they never need GP), then month GP (labor pay prorated over every
 * run overlapping the bonus month — completed from snapshots, open computed live,
 * voided skipped), then the service-advisor sheets that consume it.
 */
export async function buildOpenRunSnapshot(shopId: number, run: RunDbRow): Promise<RunSnapshot> {
  const [{ payroll: settings }, shopSettings] = await Promise.all([
    getPayrollSettings(shopId),
    getShopSettings(shopId),
  ]);
  const tz = shopSettings.settings.shopTimezone;

  const rows = await fetchRunEntries(run.id);
  const employees = await fetchEmployeesByIds(shopId, rows.map((r) => r.employee_id));

  const w2Start = addDaysIso(run.period_start, 7);
  const [billedW1, billedW2, leaveHistory] = await Promise.all([
    billedHoursByTechnician(shopId, run.period_start, addDaysIso(run.period_start, 6), { tz }),
    billedHoursByTechnician(shopId, w2Start, run.period_end, { tz }),
    // Round-3 #24: the tech/foreman PTO/Hol/Ber rate basis (last 12 completed runs,
    // read from frozen snapshots) — also feeds other open runs' GP labor pay below.
    fetchLeaveRateHistory(shopId),
  ]);

  // ── Bonus-month derivations (only when the slider is on) ──
  let month: MonthDerivations | null = null;
  if (run.bonus_period && run.bonus_month) {
    const monthKey = run.bonus_month.slice(0, 7);
    // Round-5 #32: derive the foreman's prior-year hour goal only when a foreman
    // is actually on this run's roster.
    const hasForeman = rows.some((r) => r.role_snapshot === "shop_foreman");
    const [sales, fees, parts, shopHrs, spiffs, priorYear, priorYearShopHrs] = await Promise.all([
      monthSalesPreTaxCents(shopId, monthKey, { tz }),
      monthFeesCents(shopId, monthKey, { tz }),
      monthPartsCostCents(shopId, monthKey, { tz }),
      shopBilledHours(shopId, monthKey, { tz }),
      spiffCountsByServiceWriter(shopId, monthKey, settings.spiff_categories, { tz }),
      priorYearMonthSubtotalCents(shopId, monthKey, { tz }),
      hasForeman ? priorYearShopBilledHours(shopId, monthKey, { tz }) : Promise.resolve(null),
    ]);
    month = {
      month: monthKey,
      // Round-5 #36 (reverses #28): month sales display AFTER FEES =
      // Σ(totalSales − taxes − fees) — the backtest-pinned original (June
      // 2026 = $273,061.13). Feeds the bonus panels + the SA tier's sales side.
      salesCents: sales.value.totalSalesMinusTaxesCents - fees.value,
      // Round-5 #38: the fee-INCLUSIVE subtotal stays as the INTERNAL GP base.
      salesInclFeesCents: sales.value.totalSalesMinusTaxesCents,
      feesCents: fees.value,
      partsCostCents: parts.value,
      shopHours: shopHrs.value,
      spiffCounts: spiffs.value,
      gpWithFeesCents: 0, // filled below by the #38 GP composition
      gpWithoutFeesCents: 0,
      gpSource: "qbo_tech_cost", // resolved below (falls to 'computed' on a QBO failure)
      qboTechCostCents: null,
      qboTechCostAccountLabel: null,
      laborPayProratedCents: null, // fallback path only (#38)
      provenance: sales.provenance,
      // Round-3 #22/#23: the SA sales goal auto-prefills from the prior-year
      // same-month subtotal; 0 posted ROs in that month = no data → null → calc
      // falls back to the legacy pay_config.sales_goal_cents.
      priorYearSubtotalCents: priorYear.value,
      salesGoalCents: priorYear.provenance.roCount > 0 ? priorYear.value : null,
      salesGoalProvenance: priorYear.provenance,
      // Round-5 #32: the foreman hour goal auto-derives from prior-year same-month
      // shop hours (mirroring the SA sales goal); 0 posted ROs in that month = no
      // data → null → calc falls back to the legacy pay_config.shop_hour_goal.
      priorYearShopHours: priorYearShopHrs?.value ?? null,
      shopHourGoal:
        priorYearShopHrs && priorYearShopHrs.provenance.roCount > 0 ? priorYearShopHrs.value : null,
      shopHourGoalProvenance: priorYearShopHrs?.provenance ?? null,
    };
  }

  // ── Pass 1: every non-SA sheet (needs billed hours / shop hours / month sales only) ──
  interface AssembledEmployee {
    row: EntryDbRow;
    role: Role;
    family: Family;
    entries: SheetEntries;
    overrides: Overrides;
    effective: DerivedInputs;
    sheet: SheetComputation | null; // SA filled in pass 2
    leaveRate: LeaveRateResolution | null; // tech/foreman only (round-3 #24)
  }
  const assembled: AssembledEmployee[] = rows.map((r) => {
    const role = RoleSchema.parse(r.role_snapshot);
    const family = familyForRole(role);
    const emp = employees.get(r.employee_id);
    const techId = emp?.tekmetricIdType === "technician" ? emp.tekmetricEmployeeId : null;
    const writerId = emp?.tekmetricIdType === "service_writer" ? emp.tekmetricEmployeeId : null;
    const isTechFamily = isTechnicianFamily(family);
    const base: DerivedInputs = {
      billed_hours_w1: isTechFamily && techId !== null ? (billedW1.value.get(techId) ?? 0) : null,
      billed_hours_w2: isTechFamily && techId !== null ? (billedW2.value.get(techId) ?? 0) : null,
      month_sales_cents:
        (family === "office_manager" || family === "service_advisor") && month ? month.salesCents : null,
      month_gp_with_fees_cents: null, // pass 2
      month_gp_without_fees_cents: null, // pass 2
      spiff_count:
        family === "service_advisor" && month && writerId !== null
          ? (month.spiffCounts.get(writerId) ?? 0)
          : null,
      shop_hours: family === "shop_foreman" && month ? month.shopHours : null,
      // Round-5 #32: the auto-derived foreman hour goal (null = no prior-year data
      // → calc falls back to the legacy pay_config.shop_hour_goal).
      shop_hour_goal: family === "shop_foreman" && month ? month.shopHourGoal : null,
      shop_hour_goal_source:
        family === "shop_foreman" && month && month.shopHourGoal !== null ? "prior_year" : null,
      // Round-3 #23: the auto-derived SA sales goal (office_manager keeps its fixed
      // pay_config.sales_goal_cents — never derived).
      sales_goal_cents: family === "service_advisor" && month ? month.salesGoalCents : null,
      leave_rate_cents_per_hour: null, // resolved below for tech/foreman
      leave_rate_source: null,
    };
    const entries = sheetEntriesFromRow(r);
    const overrides = normalizeOverrides(r.overrides, `entry ${r.id}`);
    let effective = applyOverrides(base, overrides);
    const payConfig = parsePayConfig(family, r.pay_config);
    let sheet: SheetComputation | null = null;
    let leaveRate: LeaveRateResolution | null = null;
    if (isTechFamily) {
      // Preliminary sheet (no leave rate) → its base/OT/billed/efficiency components
      // feed the current-run fallback basis; then recompute with the resolved rate.
      // Round-4: the window merges completed-run history with the pay_config seed
      // entries (a real run beats a same-period seed); the single-rate seed
      // fallback slots between 'history' and 'current_run'.
      const prelim = computeSheet(family, payConfig, entries, effective);
      const techConfig = payConfig as TechnicianPayConfig;
      leaveRate = resolveLeaveRate(
        overrides,
        mergeLeaveRateWindow(
          leaveHistory.get(r.employee_id) ?? [],
          techConfig.leave_rate_seed_history ?? [],
        ),
        techConfig.leave_rate_seed_cents_per_hour ?? null,
        prelim,
        techConfig.hourly_rate_cents,
      );
      effective = {
        ...effective,
        leave_rate_cents_per_hour: leaveRate.rateCents,
        leave_rate_source: leaveRate.source,
      };
      sheet = computeSheet(family, payConfig, entries, effective);
    } else if (family !== "service_advisor") {
      sheet = computeSheet(family, payConfig, entries, effective);
    }
    return { row: r, role, family, entries, overrides, effective, sheet, leaveRate };
  });

  // ── Month GP (round-5 #38): QBO 6010 technician cost is THE composition;
  //    the prorated-labor path (pass-1 GP-role sheets of THIS run + every other
  //    overlapping run) runs ONLY as the labeled fallback when the QBO fetch
  //    throws (resolveMonthGp owns the single sanctioned catch). ──
  if (month) {
    const resolution = await resolveMonthGp({
      shopId,
      run,
      month: month.month,
      tz,
      salesInclFeesCents: month.salesInclFeesCents,
      partsCostCents: month.partsCostCents,
      feesCents: month.feesCents,
      shopHours: month.shopHours,
      shopHourGoal: month.shopHourGoal,
      leaveHistory,
      currentRunGpEmployees: assembled
        .filter((a) => (GP_LABOR_ROLES as readonly string[]).includes(a.role) && a.sheet !== null)
        .map((a) => gpPayFromSheet(a.role, a.sheet as SheetComputation)),
    });
    month.gpWithFeesCents = resolution.gpWithFeesCents;
    month.gpWithoutFeesCents = resolution.gpWithoutFeesCents;
    month.gpSource = resolution.gpSource;
    month.qboTechCostCents = resolution.qboTechCostCents;
    month.qboTechCostAccountLabel = resolution.qboTechCostAccountLabel;
    month.laborPayProratedCents = resolution.laborPayProratedCents;
  }

  // ── Pass 2: the service-advisor sheets (consume sales + GP + spiffs) ──
  for (const a of assembled) {
    if (a.family !== "service_advisor") continue;
    const base: DerivedInputs = {
      ...a.effective,
      month_gp_with_fees_cents: month ? month.gpWithFeesCents : null,
      month_gp_without_fees_cents: month ? month.gpWithoutFeesCents : null,
    };
    a.effective = applyOverrides(base, a.overrides);
    const payConfig = parsePayConfig(a.family, a.row.pay_config);
    a.sheet = computeSheet(a.family, payConfig, a.entries, a.effective);
  }

  // ── Assemble the snapshot ──
  const snapshotEmployees: SnapshotEmployee[] = assembled
    .map((a) => ({
      employee_id: a.row.employee_id,
      display_name: employees.get(a.row.employee_id)?.displayName ?? "(deleted employee)",
      role: a.role,
      family: a.family,
      pay_config: a.row.pay_config,
      entries: a.entries,
      overrides: a.overrides,
      derived: a.effective,
      sheet: a.sheet as SheetComputation,
    }))
    .sort((x, y) => x.display_name.localeCompare(y.display_name));

  const summary = buildRunSummary(
    snapshotEmployees.map(
      (e): EmployeeSheet => ({
        employee_id: e.employee_id,
        display_name: e.display_name,
        role: e.role,
        family: e.family,
        sheet: e.sheet,
      }),
    ),
  );

  const asOfCandidates = [billedW1.provenance.asOf, billedW2.provenance.asOf];
  if (month) asOfCandidates.push(month.provenance.asOf);
  const snapshot: RunSnapshot = {
    snapshot_version: SNAPSHOT_VERSION,
    calc_version: CALC_VERSION,
    run: {
      run_id: run.id,
      shop_id: run.shop_id,
      period_start: run.period_start,
      period_end: run.period_end,
      bonus_period: run.bonus_period,
      bonus_month: run.bonus_month,
    },
    employees: snapshotEmployees,
    summary,
    derived_provenance: {
      as_of: asOfCandidates.sort().pop() as string,
      period_start: run.period_start,
      period_end: run.period_end,
      bonus_month: run.bonus_month,
      ro_count: billedW1.provenance.roCount + billedW2.provenance.roCount,
      source: "tekmetric_ros mirror",
      // extra keys allowed by the loose provenance schema:
      // Round-3 #24 (+ round-4 seeds): per-employee PTO/Hol/Ber rate + where it came
      // from + how many completed runs vs seeded pre-qteklink periods backed the
      // merged window (technician/shop_foreman only).
      leave_rates: Object.fromEntries(
        assembled
          .filter((a) => a.leaveRate !== null)
          .map((a) => [
            a.row.employee_id,
            {
              rate_cents_per_hour: (a.leaveRate as LeaveRateResolution).rateCents,
              source: (a.leaveRate as LeaveRateResolution).source,
              window_runs: (a.leaveRate as LeaveRateResolution).windowRuns,
              seeded_entries: (a.leaveRate as LeaveRateResolution).seededEntries,
            },
          ]),
      ),
      ...(month
        ? {
            month_ro_count: month.provenance.roCount,
            // Round-5 #36: the DISPLAY month sales (after fees). The
            // fee-inclusive internal GP base rides alongside for audit.
            month_sales_cents: month.salesCents,
            month_sales_incl_fees_cents: month.salesInclFeesCents,
            month_fees_cents: month.feesCents,
            month_parts_cost_cents: month.partsCostCents,
            month_shop_billed_hours: month.shopHours,
            // Round-5 #38: GP composition provenance — the source label, the
            // QBO 6010 tech cost (null on fallback), and the prorated labor
            // pay (null unless the computed fallback ran).
            month_gp_source: month.gpSource,
            month_qbo_tech_cost_cents: month.qboTechCostCents,
            month_qbo_tech_cost_account: month.qboTechCostAccountLabel,
            month_labor_pay_prorated_cents: month.laborPayProratedCents,
            month_gp_with_fees_cents: month.gpWithFeesCents,
            month_gp_without_fees_cents: month.gpWithoutFeesCents,
            // Round-3 #22/#23: the auto-derived SA sales goal + its provenance.
            month_sales_goal_cents: month.salesGoalCents,
            month_sales_goal_source:
              month.salesGoalCents === null ? "pay_config_fallback" : "prior_year_subtotal",
            month_sales_goal_prior_year: {
              subtotal_cents: month.priorYearSubtotalCents,
              ro_count: month.salesGoalProvenance.roCount,
              date_range: month.salesGoalProvenance.dateRange,
              as_of: month.salesGoalProvenance.asOf,
            },
            // Round-5 #32: the auto-derived foreman hour goal + its provenance
            // (not_derived = no foreman on the roster, derivation skipped).
            month_shop_hour_goal: month.shopHourGoal,
            month_shop_hour_goal_source:
              month.shopHourGoalProvenance === null
                ? "not_derived"
                : month.shopHourGoal === null
                  ? "pay_config_fallback"
                  : "prior_year_shop_hours",
            ...(month.shopHourGoalProvenance
              ? {
                  month_shop_hour_goal_prior_year: {
                    shop_hours: month.priorYearShopHours,
                    ro_count: month.shopHourGoalProvenance.roCount,
                    date_range: month.shopHourGoalProvenance.dateRange,
                    as_of: month.shopHourGoalProvenance.asOf,
                  },
                }
              : {}),
          }
        : {}),
    },
    spiff_categories: settings.spiff_categories,
  };
  // Assembled from typed parts, but parse anyway: an invalid snapshot must never
  // reach the completion RPC (defense in depth on the immutability write).
  return RunSnapshotSchema.parse(snapshot);
}

export interface PayrollRunComputation {
  run: PayrollRun;
  snapshot: RunSnapshot;
}

/**
 * The run's computed sheets + summary. Read-path rule (plan §calc engine): OPEN runs
 * compute live from mirror + entries; COMPLETED/VOIDED runs render exclusively from
 * the frozen snapshot — never recomputed.
 */
export async function computePayrollRun(shopId: number, runId: string): Promise<PayrollRunComputation> {
  const run = await fetchRunGuarded(shopId, runId);
  if (run.status !== "open") {
    return { run: runFromRow(run), snapshot: RunSnapshotSchema.parse(run.snapshot) };
  }
  return { run: runFromRow(run), snapshot: await buildOpenRunSnapshot(shopId, run) };
}
