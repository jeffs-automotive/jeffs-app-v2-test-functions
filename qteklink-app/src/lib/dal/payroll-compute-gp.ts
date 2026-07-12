/**
 * Payroll DAL — bonus-month GP composition (round-5 #38) + the GP-labor input
 * builders it falls back on. Internal support module for
 * src/lib/dal/payroll-compute.ts — split out to honor the ~500-line file
 * policy. Import the public surface from "@/lib/dal/payroll".
 *
 * resolveMonthGp is the composition root:
 *   1. PRIMARY (source 'qbo_tech_cost'): monthSales(incl fees, internal) −
 *      partsCost(#37) − QBO P&L COGS "6010 Technicians"
 *      (qboMonthTechnicianCostCents — src/lib/qbo/reports.ts).
 *   2. FALLBACK (source 'computed') ONLY when the QBO fetch throws — the catch
 *      here is the single sanctioned one (Sentry-captured with the shop_id
 *      tag): the pre-#38 prorated-labor path over every run overlapping the
 *      month (completed runs from frozen snapshots, other open runs computed
 *      live, voided skipped).
 * Both paths: gp_without_fees = gp_with_fees − monthFees; per-employee
 * overrides still win downstream (applyOverrides).
 *
 * GP labor allocation note (fallback path): gp.ts wants per-week totals. Week
 * totals from calc.ts are time-based (base+OT+billed+efficiency+leave);
 * run-level incentive extras (foreman monthly bonus, support manual incentive)
 * are split 50/50 across the two weeks so Σ weeks ≈ sheet total — consistent
 * with the decision #17 approximation.
 */
import * as Sentry from "@sentry/nextjs";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { addDaysIso } from "@/lib/format";
import { z } from "zod";
import { computeSheet } from "@/lib/payroll/calc";
import {
  billedHoursByTechnician,
  monthDateRange,
  priorYearShopBilledHours,
  roundCents,
  shopBilledHours,
} from "@/lib/payroll/derive";
import {
  GP_LABOR_ROLES,
  monthGpFromRuns,
  monthGpFromTechCost,
  type GpRunEmployeePay,
  type GpRunInput,
  type MonthGp,
  type MonthGpSource,
} from "@/lib/payroll/gp";
import { qboMonthTechnicianCostCents } from "@/lib/qbo/reports";
import { resolveRealmForShop } from "@/lib/dal/realm";
import {
  mergeLeaveRateWindow,
  resolveLeaveRate,
  type LeaveRateEntry,
} from "@/lib/dal/payroll-leave-rate";
import {
  familyForRole,
  parsePayConfig,
  RoleSchema,
  type DerivedInputs,
  type Family,
  type Overrides,
  type SheetComputation,
  type TechnicianPayConfig,
} from "@/lib/payroll/types";
import {
  fetchEmployeesByIds,
  fetchRunEntries,
  normalizeOverrides,
  sheetEntriesFromRow,
  RUN_COLS,
  type RunDbRow,
} from "@/lib/dal/payroll-shared";

// ── Override precedence (shared with the snapshot builder's sheet passes) ──────

/** override.value beats the derived number, key by key (provenance = the raw overrides
 *  object, which the snapshot keeps verbatim next to the effective inputs). */
export function applyOverrides(base: DerivedInputs, overrides: Overrides): DerivedInputs {
  return {
    billed_hours_w1: overrides.billed_hours_w1?.value ?? base.billed_hours_w1,
    billed_hours_w2: overrides.billed_hours_w2?.value ?? base.billed_hours_w2,
    month_sales_cents: overrides.month_sales_cents?.value ?? base.month_sales_cents,
    month_gp_with_fees_cents: overrides.month_gp_with_fees_cents?.value ?? base.month_gp_with_fees_cents,
    month_gp_without_fees_cents:
      overrides.month_gp_without_fees_cents?.value ?? base.month_gp_without_fees_cents,
    spiff_count: overrides.spiff_count?.value ?? base.spiff_count,
    shop_hours: overrides.shop_hours?.value ?? base.shop_hours,
    // Round-5 #32: the foreman goal override flips the source to 'override' so the
    // sheet + snapshot carry the provenance.
    shop_hour_goal: overrides.shop_hour_goal?.value ?? base.shop_hour_goal,
    shop_hour_goal_source:
      overrides.shop_hour_goal !== undefined ? "override" : base.shop_hour_goal_source,
    sales_goal_cents: overrides.sales_goal_cents?.value ?? base.sales_goal_cents,
    leave_rate_cents_per_hour:
      overrides.leave_rate_cents_per_hour?.value ?? base.leave_rate_cents_per_hour,
    // Not overridable by shape ({value, note} carries numbers only): resolveLeaveRate
    // owns the source and already reports 'override' when the override key is set.
    leave_rate_source: base.leave_rate_source,
  };
}

export const isTechnicianFamily = (family: Family): family is "technician" | "shop_foreman" =>
  family === "technician" || family === "shop_foreman";

// ── GP-labor input builders (the fallback path's material) ─────────────────────

/**
 * Per-week GP pay from a computed sheet: calc.ts week totals are time-based
 * (base+OT+billed+efficiency+leave); run-level incentive extras (foreman bonus,
 * manual incentive — anything in incentive_cents that is not already week-allocated
 * billed/efficiency pay) are split 50/50 so Σ weeks ≈ the sheet total.
 */
export function gpPayFromSheet(role: string, sheet: SheetComputation): GpRunEmployeePay {
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
  leaveHistory: Map<string, LeaveRateEntry[]>,
  priorYearGoalByMonth: Map<string, number | null>,
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
  let shopHourGoal: number | null = null;
  if (run.bonus_period && run.bonus_month) {
    const month = run.bonus_month.slice(0, 7);
    if (!shopHoursByMonth.has(month)) {
      shopHoursByMonth.set(month, (await shopBilledHours(shopId, month, { tz })).value);
    }
    shopHours = shopHoursByMonth.get(month) ?? null;
    // Round-5 #32: this run's foreman goal (prior-year same-month shop hours;
    // derived only when a foreman is on ITS roster, cached per month, null = no
    // data → calc falls back to the run row's pay_config.shop_hour_goal).
    if (gpRows.some((r) => r.role_snapshot === "shop_foreman")) {
      if (!priorYearGoalByMonth.has(month)) {
        const py = await priorYearShopBilledHours(shopId, month, { tz });
        priorYearGoalByMonth.set(month, py.provenance.roCount > 0 ? py.value : null);
      }
      shopHourGoal = priorYearGoalByMonth.get(month) ?? null;
    }
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
      shop_hour_goal: family === "shop_foreman" ? shopHourGoal : null,
      shop_hour_goal_source:
        family === "shop_foreman" && shopHourGoal !== null ? "prior_year" : null,
      sales_goal_cents: null,
      leave_rate_cents_per_hour: null, // resolved below for tech/foreman
      leave_rate_source: null,
    };
    const overrides = normalizeOverrides(r.overrides, `entry ${r.id}`);
    const entries = sheetEntriesFromRow(r);
    let effective = applyOverrides(base, overrides);
    let sheet = computeSheet(family, payConfig, entries, effective);
    if (isTechnicianFamily(family)) {
      // Round-4: merge the run history with the pay_config seed entries (a real
      // run beats a same-period seed) and thread the single-rate seed fallback.
      const techConfig = payConfig as TechnicianPayConfig;
      const lr = resolveLeaveRate(
        overrides,
        mergeLeaveRateWindow(
          leaveHistory.get(r.employee_id) ?? [],
          techConfig.leave_rate_seed_history ?? [],
        ),
        techConfig.leave_rate_seed_cents_per_hour ?? null,
        sheet,
        techConfig.hourly_rate_cents,
      );
      effective = { ...effective, leave_rate_cents_per_hour: lr.rateCents, leave_rate_source: lr.source };
      sheet = computeSheet(family, payConfig, entries, effective);
    }
    gpEmployees.push(gpPayFromSheet(role, sheet));
  }
  return { status: run.status, periodStart: run.period_start, employees: gpEmployees };
}

// ── The composition root (#38) ─────────────────────────────────────────────────

export interface MonthGpResolution {
  gpWithFeesCents: number;
  gpWithoutFeesCents: number;
  gpSource: MonthGpSource;
  qboTechCostCents: number | null;
  qboTechCostAccountLabel: string | null;
  /** Round-7 #41: when the tech cost was ACTUALLY fetched from QBO — the memo's
   *  freshness clock (== now on a fresh fetch; carried through on a memo reuse). */
  qboTechCostFetchedAt: string | null;
  /** The realm the tech cost was fetched from — pins the memo to (realm, month). */
  qboTechCostRealmId: string | null;
  /** Only computed on the fallback path; null when QBO supplied the tech cost. */
  laborPayProratedCents: number | null;
}

/** Round-7 #41: a previously-fetched QBO 6010 tech cost carried inside the live
 *  snapshot — reused by DEBOUNCED/inline recomputes when < 6h old, so tab-switch
 *  and edit recomputes never block on a live QBO P&L call. Dry-run / nightly /
 *  manual refresh pass NO memo (always fetch fresh). */
export interface QboTechCostMemo {
  /** The bonus month ("YYYY-MM") the value was fetched for. */
  month: string;
  valueCents: number;
  accountLabel: string;
  /** ISO timestamp of the ORIGINAL QBO fetch. */
  fetchedAt: string;
  realmId: string;
}

export const QBO_TECH_COST_MEMO_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export interface ResolveMonthGpOpts {
  shopId: number;
  run: RunDbRow;
  /** The bonus month ("YYYY-MM"). */
  month: string;
  tz: string;
  /** #38 GP base — Σ(totalSales − taxes), fees IN (since round-9 #45 this is
   *  ALSO the displayed month sales; pre-#45 snapshots displayed an after-fees
   *  figure instead). */
  salesInclFeesCents: number;
  partsCostCents: number;
  feesCents: number;
  /** This run's month shop hours + foreman goal — seed the fallback's per-month caches. */
  shopHours: number;
  shopHourGoal: number | null;
  leaveHistory: Map<string, LeaveRateEntry[]>;
  /** THIS run's GP-role per-week pay (from the pass-1 sheets) for the fallback. */
  currentRunGpEmployees: GpRunEmployeePay[];
  /** Round-7 #41: reuse this previously-fetched tech cost instead of a live QBO
   *  call — honored only when the (realm, month) match and it is < 6h old. */
  qboTechCostMemo?: QboTechCostMemo | null;
}

/** Memo validity (round-7 #41): same month, < 6h old, and the shop still resolves
 *  to the SAME realm the value was fetched from (one cheap DB read vs a full QBO
 *  P&L fetch). Invalid/expired → null → fetch fresh. */
async function reusableTechCostMemo(
  shopId: number,
  month: string,
  memo: QboTechCostMemo | null | undefined,
): Promise<QboTechCostMemo | null> {
  if (!memo || memo.month !== month) return null;
  const ageMs = Date.now() - Date.parse(memo.fetchedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs >= QBO_TECH_COST_MEMO_MAX_AGE_MS) return null;
  const realmId = await resolveRealmForShop(shopId);
  if (realmId !== memo.realmId) return null;
  return memo;
}

/** The #38 GP composition: QBO 6010 tech cost primary; the prorated-labor path
 *  computed ONLY as the labeled fallback when the QBO fetch throws. */
export async function resolveMonthGp(opts: ResolveMonthGpOpts): Promise<MonthGpResolution> {
  const { shopId, run, month, tz } = opts;
  let gp: MonthGp;
  try {
    const memo = await reusableTechCostMemo(shopId, month, opts.qboTechCostMemo);
    const tech = memo
      ? { valueCents: memo.valueCents, accountLabel: memo.accountLabel, fetchedAt: memo.fetchedAt, realmId: memo.realmId }
      : await (async () => {
          const fresh = await qboMonthTechnicianCostCents(shopId, month);
          return {
            valueCents: fresh.valueCents,
            accountLabel: fresh.accountLabel,
            fetchedAt: new Date().toISOString(),
            realmId: fresh.realmId,
          };
        })();
    gp = monthGpFromTechCost({
      monthSalesInclFeesCents: opts.salesInclFeesCents,
      monthPartsCostCents: opts.partsCostCents,
      qboTechCostCents: tech.valueCents,
      monthFeesCents: opts.feesCents,
    });
    return {
      gpWithFeesCents: gp.gpWithFeesCents,
      gpWithoutFeesCents: gp.gpWithoutFeesCents,
      gpSource: "qbo_tech_cost",
      qboTechCostCents: tech.valueCents,
      qboTechCostAccountLabel: tech.accountLabel,
      qboTechCostFetchedAt: tech.fetchedAt,
      qboTechCostRealmId: tech.realmId,
      laborPayProratedCents: null,
    };
  } catch (e) {
    // THE ONLY SANCTIONED CATCH (#38): QBO unreachable / row missing / surprising
    // shape → visible in Sentry, then the labeled computed fallback below.
    Sentry.captureException(e, {
      tags: { qteklink_action: "payroll-qbo-tech-cost", shop_id: String(shopId) },
      extra: { month, run_id: run.id },
    });
  }

  const { start: monthStart, end: monthEnd } = monthDateRange(month);
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
    employees: opts.currentRunGpEmployees,
  };
  const shopHoursByMonth = new Map<string, number>([[month, opts.shopHours]]);
  // Seed the goal cache with THIS run's month (another non-voided bonus run can
  // never share it — the partial unique — but the map keys per month anyway).
  const priorYearGoalByMonth = new Map<string, number | null>([[month, opts.shopHourGoal]]);
  const gpInputs: GpRunInput[] = [currentInput];
  for (const other of others) {
    gpInputs.push(
      other.status === "completed"
        ? gpInputFromSnapshot(other)
        : await gpInputForOpenRun(shopId, other, tz, shopHoursByMonth, opts.leaveHistory, priorYearGoalByMonth),
    );
  }
  // GP-with-fees keeps fee revenue IN — the fallback feeds the fee-INCLUSIVE
  // subtotal (#38; since round-9 #45 identical to the displayed month sales).
  const fallback = monthGpFromRuns(gpInputs, month, {
    monthSalesCents: opts.salesInclFeesCents,
    monthPartsCostCents: opts.partsCostCents,
    monthFeesCents: opts.feesCents,
  });
  return {
    gpWithFeesCents: fallback.gpWithFeesCents,
    gpWithoutFeesCents: fallback.gpWithoutFeesCents,
    gpSource: "computed",
    qboTechCostCents: null,
    qboTechCostAccountLabel: null,
    qboTechCostFetchedAt: null,
    qboTechCostRealmId: null,
    laborPayProratedCents: fallback.laborPayProratedCents,
  };
}
