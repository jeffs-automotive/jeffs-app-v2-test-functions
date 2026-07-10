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
 * (labor pay prorated over every run overlapping the month — completed runs from
 * their frozen snapshots, other open runs computed live, voided skipped), then the
 * service-advisor sheets that consume it.
 *
 * Read-path rule: completed/voided runs render EXCLUSIVELY from the frozen
 * snapshot — never recomputed.
 *
 * Round-3 amendments (2026-07-10, extraction #22–#27): tech/foreman PTO/Hol/Ber pay
 * at the avg-hourly-WITHOUT-bonus leave rate (override → last-12-completed-runs
 * snapshot basis → current run ex-bonus ex-leave → base hourly), and the SA sales
 * goal auto-derives from the prior-year same-month subtotal (override →
 * priorYearMonthSubtotalCents → legacy pay_config.sales_goal_cents when 0 ROs).
 *
 * GP labor allocation note: gp.ts wants per-week totals. Week totals from calc.ts
 * are time-based (base+OT+billed+efficiency+leave); run-level incentive extras
 * (foreman monthly bonus, support manual incentive) are split 50/50 across the two
 * weeks so Σ weeks ≈ sheet total — consistent with the decision #17 approximation.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getShopSettings } from "@/lib/dal/settings";
import { addDaysIso } from "@/lib/format";
import { z } from "zod";
import { CALC_VERSION, computeSheet } from "@/lib/payroll/calc";
import {
  billedHoursByTechnician,
  monthDateRange,
  monthFeesCents,
  monthPartsCostCents,
  monthSalesPreTaxCents,
  priorYearMonthSubtotalCents,
  roundCents,
  shopBilledHours,
  spiffCountsByServiceWriter,
  type DeriveProvenance,
} from "@/lib/payroll/derive";
import { GP_LABOR_ROLES, monthGpFromRuns, type GpRunEmployeePay, type GpRunInput } from "@/lib/payroll/gp";
import { buildRunSummary, type EmployeeSheet } from "@/lib/payroll/summary";
import {
  fetchLeaveRateHistory,
  resolveLeaveRate,
  type LeaveRateHistory,
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
  RUN_COLS,
  type EntryDbRow,
  type PayrollRun,
  type RunDbRow,
} from "@/lib/dal/payroll-shared";

// ── Override precedence + GP helpers ───────────────────────────────────────────

/** override.value beats the derived number, key by key (provenance = the raw overrides
 *  object, which the snapshot keeps verbatim next to the effective inputs). */
function applyOverrides(base: DerivedInputs, overrides: Overrides): DerivedInputs {
  return {
    billed_hours_w1: overrides.billed_hours_w1?.value ?? base.billed_hours_w1,
    billed_hours_w2: overrides.billed_hours_w2?.value ?? base.billed_hours_w2,
    month_sales_cents: overrides.month_sales_cents?.value ?? base.month_sales_cents,
    month_gp_with_fees_cents: overrides.month_gp_with_fees_cents?.value ?? base.month_gp_with_fees_cents,
    month_gp_without_fees_cents:
      overrides.month_gp_without_fees_cents?.value ?? base.month_gp_without_fees_cents,
    spiff_count: overrides.spiff_count?.value ?? base.spiff_count,
    shop_hours: overrides.shop_hours?.value ?? base.shop_hours,
    sales_goal_cents: overrides.sales_goal_cents?.value ?? base.sales_goal_cents,
    leave_rate_cents_per_hour:
      overrides.leave_rate_cents_per_hour?.value ?? base.leave_rate_cents_per_hour,
    // Not overridable by shape ({value, note} carries numbers only): resolveLeaveRate
    // owns the source and already reports 'override' when the override key is set.
    leave_rate_source: base.leave_rate_source,
  };
}

const isTechnicianFamily = (family: Family): family is "technician" | "shop_foreman" =>
  family === "technician" || family === "shop_foreman";

/**
 * Per-week GP pay from a computed sheet: calc.ts week totals are time-based
 * (base+OT+billed+efficiency+leave); run-level incentive extras (foreman bonus,
 * manual incentive — anything in incentive_cents that is not already week-allocated
 * billed/efficiency pay) are split 50/50 so Σ weeks ≈ the sheet total.
 */
function gpPayFromSheet(role: string, sheet: SheetComputation): GpRunEmployeePay {
  const inWeeks =
    (sheet.week1.billed_pay_cents ?? 0) +
    (sheet.week1.efficiency_pay_cents ?? 0) +
    (sheet.week2.billed_pay_cents ?? 0) +
    (sheet.week2.efficiency_pay_cents ?? 0);
  const extras = sheet.incentive_cents - inWeeks;
  const extrasW1 = roundCents(extras / 2);
  return {
    role,
    totalPayW1Cents: sheet.week1.total_pay_cents + extrasW1,
    totalPayW2Cents: sheet.week2.total_pay_cents + (extras - extrasW1),
  };
}

/** Minimal tolerant read of a frozen snapshot for GP purposes (older snapshot
 *  versions may add fields; we only need role + week totals + incentive). */
const GpSnapshotEmployeeSchema = z.object({
  role: z.string(),
  sheet: z.object({
    incentive_cents: z.number(),
    week1: z.object({
      total_pay_cents: z.number(),
      billed_pay_cents: z.number().nullable(),
      efficiency_pay_cents: z.number().nullable(),
    }),
    week2: z.object({
      total_pay_cents: z.number(),
      billed_pay_cents: z.number().nullable(),
      efficiency_pay_cents: z.number().nullable(),
    }),
  }),
});

function gpInputFromSnapshot(run: RunDbRow): GpRunInput {
  const snap = run.snapshot as { employees?: unknown[] } | null;
  const employees = Array.isArray(snap?.employees) ? snap.employees : [];
  return {
    status: run.status,
    periodStart: run.period_start,
    employees: employees.map((e) => {
      const parsed = GpSnapshotEmployeeSchema.parse(e);
      return gpPayFromSheet(parsed.role, parsed.sheet as SheetComputation);
    }),
  };
}

/** Live GP-role pay for ANOTHER open run overlapping the month (its own billed-hours
 *  derivation + overrides; foreman shop hours only when that run is a bonus run).
 *  Tech/foreman leave pay uses the leave-rate basis (round-3 #24) so the per-week
 *  totals feeding gp.ts include leave at the same rates the run itself would pay. */
async function gpInputForOpenRun(
  shopId: number,
  run: RunDbRow,
  tz: string,
  shopHoursByMonth: Map<string, number>,
  leaveHistory: Map<string, LeaveRateHistory>,
): Promise<GpRunInput> {
  const rows = await fetchRunEntries(run.id);
  const gpRows = rows.filter((r) => (GP_LABOR_ROLES as readonly string[]).includes(r.role_snapshot));
  if (gpRows.length === 0) return { status: run.status, periodStart: run.period_start, employees: [] };

  const employees = await fetchEmployeesByIds(shopId, gpRows.map((r) => r.employee_id));
  const w2Start = addDaysIso(run.period_start, 7);
  const [billedW1, billedW2] = await Promise.all([
    billedHoursByTechnician(shopId, run.period_start, addDaysIso(run.period_start, 6), { tz }),
    billedHoursByTechnician(shopId, w2Start, run.period_end, { tz }),
  ]);
  let shopHours: number | null = null;
  if (run.bonus_period && run.bonus_month) {
    const month = run.bonus_month.slice(0, 7);
    if (!shopHoursByMonth.has(month)) {
      shopHoursByMonth.set(month, (await shopBilledHours(shopId, month, { tz })).value);
    }
    shopHours = shopHoursByMonth.get(month) ?? null;
  }

  const gpEmployees: GpRunEmployeePay[] = [];
  for (const r of gpRows) {
    const role = RoleSchema.parse(r.role_snapshot);
    const family = familyForRole(role);
    const payConfig = parsePayConfig(family, r.pay_config);
    const emp = employees.get(r.employee_id);
    const tmId = emp?.tekmetricIdType === "technician" ? emp.tekmetricEmployeeId : null;
    const base: DerivedInputs = {
      billed_hours_w1: tmId !== null ? (billedW1.value.get(tmId) ?? 0) : null,
      billed_hours_w2: tmId !== null ? (billedW2.value.get(tmId) ?? 0) : null,
      month_sales_cents: null,
      month_gp_with_fees_cents: null,
      month_gp_without_fees_cents: null,
      spiff_count: null,
      shop_hours: family === "shop_foreman" ? shopHours : null,
      sales_goal_cents: null,
      leave_rate_cents_per_hour: null, // resolved below for tech/foreman
      leave_rate_source: null,
    };
    const overrides = normalizeOverrides(r.overrides, `entry ${r.id}`);
    const entries = sheetEntriesFromRow(r);
    let effective = applyOverrides(base, overrides);
    let sheet = computeSheet(family, payConfig, entries, effective);
    if (isTechnicianFamily(family)) {
      const lr = resolveLeaveRate(
        overrides,
        leaveHistory.get(r.employee_id),
        sheet,
        (payConfig as TechnicianPayConfig).hourly_rate_cents,
      );
      effective = { ...effective, leave_rate_cents_per_hour: lr.rateCents, leave_rate_source: lr.source };
      sheet = computeSheet(family, payConfig, entries, effective);
    }
    gpEmployees.push(gpPayFromSheet(role, sheet));
  }
  return { status: run.status, periodStart: run.period_start, employees: gpEmployees };
}

// ── The snapshot builder ───────────────────────────────────────────────────────

interface MonthDerivations {
  month: string;
  salesCents: number;
  feesCents: number;
  partsCostCents: number;
  shopHours: number;
  spiffCounts: Map<number, number>;
  gpWithFeesCents: number;
  gpWithoutFeesCents: number;
  laborPayProratedCents: number;
  provenance: DeriveProvenance;
  /** Round-3 #22/#23: prior-year same-month subtotal (raw) + the SA sales goal it
   *  yields — null when the prior-year month had 0 posted ROs (no data → calc falls
   *  back to the legacy pay_config.sales_goal_cents). */
  priorYearSubtotalCents: number;
  salesGoalCents: number | null;
  salesGoalProvenance: DeriveProvenance;
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
    const [sales, fees, parts, shopHrs, spiffs, priorYear] = await Promise.all([
      monthSalesPreTaxCents(shopId, monthKey, { tz }),
      monthFeesCents(shopId, monthKey, { tz }),
      monthPartsCostCents(shopId, monthKey, { tz }),
      shopBilledHours(shopId, monthKey, { tz }),
      spiffCountsByServiceWriter(shopId, monthKey, settings.spiff_categories, { tz }),
      priorYearMonthSubtotalCents(shopId, monthKey, { tz }),
    ]);
    month = {
      month: monthKey,
      // Backtest-pinned (2026-07-10, Apr/May/Jun vs the real workbooks): the sheets' "Month Sales"
      // = Σ(totalSales − taxes − FEES) — fees are excluded from sales, not just taxes.
      // Residuals $14–$51/month (fee-vs-sales bucket classification + post-entry RO edits).
      salesCents: sales.value.totalSalesMinusTaxesCents - fees.value,
      feesCents: fees.value,
      partsCostCents: parts.value,
      shopHours: shopHrs.value,
      spiffCounts: spiffs.value,
      gpWithFeesCents: 0, // filled below once labor pay is known
      gpWithoutFeesCents: 0,
      laborPayProratedCents: 0,
      provenance: sales.provenance,
      // Round-3 #22/#23: the SA sales goal auto-prefills from the prior-year
      // same-month subtotal; 0 posted ROs in that month = no data → null → calc
      // falls back to the legacy pay_config.sales_goal_cents.
      priorYearSubtotalCents: priorYear.value,
      salesGoalCents: priorYear.provenance.roCount > 0 ? priorYear.value : null,
      salesGoalProvenance: priorYear.provenance,
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
      const prelim = computeSheet(family, payConfig, entries, effective);
      leaveRate = resolveLeaveRate(
        overrides,
        leaveHistory.get(r.employee_id),
        prelim,
        (payConfig as TechnicianPayConfig).hourly_rate_cents,
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

  // ── Month GP (needs pass-1 GP-role sheets of THIS run + every other overlapping run) ──
  if (month) {
    const { start: monthStart, end: monthEnd } = monthDateRange(month.month);
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("qteklink_payroll_runs")
      .select(RUN_COLS)
      .eq("shop_id", shopId)
      .neq("status", "voided")
      .neq("id", run.id)
      .lte("period_start", monthEnd)
      .gte("period_end", monthStart);
    if (error) throw new Error(`payroll DAL: overlapping runs fetch failed: ${error.message}`);
    const others = (data ?? []) as RunDbRow[];

    const currentInput: GpRunInput = {
      status: "open",
      periodStart: run.period_start,
      employees: assembled
        .filter((a) => (GP_LABOR_ROLES as readonly string[]).includes(a.role) && a.sheet !== null)
        .map((a) => gpPayFromSheet(a.role, a.sheet as SheetComputation)),
    };
    const shopHoursByMonth = new Map<string, number>([[month.month, month.shopHours]]);
    const gpInputs: GpRunInput[] = [currentInput];
    for (const other of others) {
      gpInputs.push(
        other.status === "completed"
          ? gpInputFromSnapshot(other)
          : await gpInputForOpenRun(shopId, other, tz, shopHoursByMonth, leaveHistory),
      );
    }
    const gp = monthGpFromRuns(gpInputs, month.month, {
      monthSalesCents: month.salesCents,
      monthPartsCostCents: month.partsCostCents,
      monthFeesCents: month.feesCents,
    });
    month.gpWithFeesCents = gp.gpWithFeesCents;
    month.gpWithoutFeesCents = gp.gpWithoutFeesCents;
    month.laborPayProratedCents = gp.laborPayProratedCents;
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
      // Round-3 #24: per-employee PTO/Hol/Ber rate + where it came from + how many
      // completed window runs backed it (technician/shop_foreman only).
      leave_rates: Object.fromEntries(
        assembled
          .filter((a) => a.leaveRate !== null)
          .map((a) => [
            a.row.employee_id,
            {
              rate_cents_per_hour: (a.leaveRate as LeaveRateResolution).rateCents,
              source: (a.leaveRate as LeaveRateResolution).source,
              window_runs: (a.leaveRate as LeaveRateResolution).windowRuns,
            },
          ]),
      ),
      ...(month
        ? {
            month_ro_count: month.provenance.roCount,
            month_sales_cents: month.salesCents,
            month_fees_cents: month.feesCents,
            month_parts_cost_cents: month.partsCostCents,
            month_shop_billed_hours: month.shopHours,
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
