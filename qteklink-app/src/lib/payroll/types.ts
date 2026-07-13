/**
 * Payroll shared types — Zod v4 schemas per the build contract
 * (docs/qteklink/payroll-contract.md §TS module layout; formulas + decisions:
 * docs/qteklink/payroll-workbook-extraction-2026-07-10.md).
 *
 * Contents: role → family mapping, PayConfig (per-family schemas + the tagged
 * discriminated union), Overrides, the run-entry + derived-input shapes consumed by
 * calc.ts, SheetComputation (the computed pay sheet), SummaryRow, and RunSnapshot v1
 * (the immutable JSONB written once by qteklink_payroll_complete_run).
 *
 * Money is integer CENTS everywhere (BIGINT cents in the DB); hours are 2dp numbers.
 * The DB `pay_config` JSONB carries NO family tag (the family is derived from the
 * employee's role), so the per-family schemas here are UNtagged — validate raw JSONB
 * with `parsePayConfig(family, json)`. `PayConfigSchema` is the tagged discriminated
 * union for in-memory use where the tag travels with the config.
 */
import { z } from "zod";

// ── Roles + families (contract §Roles + families) ─────────────────────────────

export const ROLES = [
  "general_manager",
  "service_manager",
  "asst_manager",
  "office_manager",
  "shop_foreman",
  "technician",
  "shop_support",
  "office_support",
] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

export const FAMILIES = [
  "service_advisor",
  "office_manager",
  "shop_foreman",
  "technician",
  "support",
] as const;
export const FamilySchema = z.enum(FAMILIES);
export type Family = z.infer<typeof FamilySchema>;

/** role → pay-sheet layout family (contract table; all three SA roles get spiffs). */
export const FAMILY_BY_ROLE: Record<Role, Family> = {
  general_manager: "service_advisor",
  service_manager: "service_advisor",
  asst_manager: "service_advisor",
  office_manager: "office_manager",
  shop_foreman: "shop_foreman",
  technician: "technician",
  shop_support: "support",
  office_support: "support",
};

export function familyForRole(role: Role): Family {
  return FAMILY_BY_ROLE[role];
}

/** Which Tekmetric employee-id type a family's optional tekmetric_employee_id must be. */
export const TEKMETRIC_ID_TYPE_BY_FAMILY: Record<Family, "technician" | "service_writer"> = {
  service_advisor: "service_writer",
  office_manager: "service_writer",
  shop_foreman: "technician",
  technician: "technician",
  support: "technician",
};

export const RunStatusSchema = z.enum(["open", "completed", "voided"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

/** Where a technician/shop-foreman PTO/Holiday/Bereavement rate came from (round-3
 *  decision #24; round-4 seed history): the merged last-12-periods basis (completed
 *  runs + seeded pre-qteklink periods), the current run's ex-bonus ex-leave ratio,
 *  an explicit override, the single-rate seed fallback (round-4:
 *  pay_config.leave_rate_seed_cents_per_hour), or the base hourly rate (final
 *  fallback). */
export const LEAVE_RATE_SOURCES = ["history", "current_run", "override", "seed", "base_rate"] as const;
export const LeaveRateSourceSchema = z.enum(LEAVE_RATE_SOURCES);
export type LeaveRateSource = z.infer<typeof LeaveRateSourceSchema>;

/** Where the shop-foreman hour goal came from (round-5 decision #32, mirroring the
 *  SA sales-goal pattern): an explicit per-run override, the auto-derived prior-year
 *  same-month shop billed hours, or the legacy pay_config.shop_hour_goal fallback
 *  (derivation had no data / non-bonus run). */
export const SHOP_HOUR_GOAL_SOURCES = ["override", "prior_year", "config"] as const;
export const ShopHourGoalSourceSchema = z.enum(SHOP_HOUR_GOAL_SOURCES);
export type ShopHourGoalSource = z.infer<typeof ShopHourGoalSourceSchema>;

// ── PayConfig (config_version: 1) — contract §pay_config JSONB ────────────────

const centsInt = z.number().int().min(0);
const pct01 = z.number().min(0).max(1);
const hoursNum = z.number().min(0);

/** Optional mid-period (week-2) rate change — run_employees.pay_config only.
 *  Week 1 always uses the base fields. */
export const RatesW2Schema = z.strictObject({
  hourly_rate_cents: centsInt.optional(),
  billed_rate_cents: centsInt.optional(),
  weekly_salary_cents: centsInt.optional(),
});
export type RatesW2 = z.infer<typeof RatesW2Schema>;

const payConfigCommon = z.strictObject({
  config_version: z.literal(1),
  // Round-11 (plan §2a/§8.6): the legacy manual PTO keys are DEMOTED to optional
  // (the ledger is now the balance truth; the tenure-tier engine owns accrual).
  // They stay ALLOWED-forever inside the strictObject so stored / void-cloned /
  // frozen pay_configs that still carry them keep parsing — matching the SQL
  // validator's v_required (dropped) vs v_allowed (kept) split. The new employee
  // form no longer emits them, so REQUIRING them here broke every create.
  pto_balance_hours: hoursNum.optional(),
  pto_accrual_hours_per_period: hoursNum.optional(),
  rates_w2: RatesW2Schema.optional(),
});

/** One seeded pre-qteklink pay period for the leave-rate basis (round-4: Marie's
 *  average-pay figures, written by scripts/payroll-seed-leave-rates.mjs — never
 *  in-app). A completed qteklink run for the same period_start WINS over the seed
 *  (mergeLeaveRateWindow in the DAL), so seeds age out as real runs accumulate. */
export const LeaveRateSeedEntrySchema = z.strictObject({
  /** The seeded period's start date (ISO YYYY-MM-DD, Sun-anchored like real runs). */
  period_start: z.iso.date(),
  /** Σ base + OT + billed + efficiency pay for the period (bonuses/leave excluded). */
  work_pay_cents: centsInt,
  /** Σ worked clock hours for the period. */
  clock_hours: hoursNum,
});
export type LeaveRateSeedEntry = z.infer<typeof LeaveRateSeedEntrySchema>;

export const TechnicianPayConfigSchema = payConfigCommon.extend({
  hourly_rate_cents: centsInt,
  billed_rate_cents: centsInt,
  /** Round-4: single-rate seed fallback — used only when the merged history window
   *  is empty (source 'seed'); beats the current-run ratio. */
  leave_rate_seed_cents_per_hour: centsInt.optional(),
  /** Round-4: seeded pre-qteklink per-period figures feeding the leave-rate basis
   *  (max 26 = a year of bi-weekly periods; the merge windows to 12 per employee). */
  leave_rate_seed_history: z.array(LeaveRateSeedEntrySchema).max(26).optional(),
});
export type TechnicianPayConfig = z.infer<typeof TechnicianPayConfigSchema>;

export const ShopForemanPayConfigSchema = TechnicianPayConfigSchema.extend({
  shop_hour_goal: hoursNum,
  shop_hour_bonus_cents_per_hour: centsInt,
});
export type ShopForemanPayConfig = z.infer<typeof ShopForemanPayConfigSchema>;

export const ServiceAdvisorPayConfigSchema = payConfigCommon.extend({
  weekly_salary_cents: centsInt,
  gp_goal_1_cents: centsInt,
  gp_goal_2_cents: centsInt,
  sales_goal_cents: centsInt,
  tier1_pct: pct01,
  tier2_pct: pct01,
  tier3_pct: pct01,
  spiff_amount_cents: centsInt,
});
export type ServiceAdvisorPayConfig = z.infer<typeof ServiceAdvisorPayConfigSchema>;

export const OfficeManagerPayConfigSchema = payConfigCommon.extend({
  hourly_rate_cents: centsInt,
  sales_goal_cents: centsInt,
  bonus_pct: pct01,
});
export type OfficeManagerPayConfig = z.infer<typeof OfficeManagerPayConfigSchema>;

export const SupportPayConfigSchema = payConfigCommon.extend({
  hourly_rate_cents: centsInt,
});
export type SupportPayConfig = z.infer<typeof SupportPayConfigSchema>;

/** Untagged (DB-shape) schema per family — validates the raw `pay_config` JSONB. */
export const PAY_CONFIG_SCHEMA_BY_FAMILY = {
  technician: TechnicianPayConfigSchema,
  shop_foreman: ShopForemanPayConfigSchema,
  service_advisor: ServiceAdvisorPayConfigSchema,
  office_manager: OfficeManagerPayConfigSchema,
  support: SupportPayConfigSchema,
} as const;

export interface PayConfigByFamily {
  technician: TechnicianPayConfig;
  shop_foreman: ShopForemanPayConfig;
  service_advisor: ServiceAdvisorPayConfig;
  office_manager: OfficeManagerPayConfig;
  support: SupportPayConfig;
}
export type PayConfigFor<F extends Family> = PayConfigByFamily[F];

/** Validate a raw pay_config JSONB for the given family (throws ZodError on failure). */
export function parsePayConfig<F extends Family>(family: F, json: unknown): PayConfigFor<F> {
  return PAY_CONFIG_SCHEMA_BY_FAMILY[family].parse(json) as PayConfigFor<F>;
}

/** Tagged discriminated union — for in-memory contexts where the family tag travels
 *  with the config. NOT the DB shape (the JSONB has no `family` key). */
export const PayConfigSchema = z.discriminatedUnion("family", [
  TechnicianPayConfigSchema.extend({ family: z.literal("technician") }),
  ShopForemanPayConfigSchema.extend({ family: z.literal("shop_foreman") }),
  ServiceAdvisorPayConfigSchema.extend({ family: z.literal("service_advisor") }),
  OfficeManagerPayConfigSchema.extend({ family: z.literal("office_manager") }),
  SupportPayConfigSchema.extend({ family: z.literal("support") }),
]);
export type PayConfig = z.infer<typeof PayConfigSchema>;

// ── Overrides (run_employees.overrides JSONB) — contract §overrides ───────────
// Every key optional; shape { value, note }. `value` beats the derived number
// (precedence applied in the DAL — calc.ts receives the EFFECTIVE derived inputs).

const overrideOf = <T extends z.ZodType<number>>(value: T) =>
  z.strictObject({ value, note: z.string() });

export const OverridesSchema = z.strictObject({
  billed_hours_w1: overrideOf(hoursNum).optional(),
  billed_hours_w2: overrideOf(hoursNum).optional(),
  month_sales_cents: overrideOf(z.number().int()).optional(),
  // GP can legitimately be negative — int, no floor.
  month_gp_with_fees_cents: overrideOf(z.number().int()).optional(),
  month_gp_without_fees_cents: overrideOf(z.number().int()).optional(),
  spiff_count: overrideOf(z.number().int().min(0)).optional(),
  shop_hours: overrideOf(hoursNum).optional(),
  /** SA family (round-3 #22/#23): beats the auto-derived prior-year sales goal. */
  sales_goal_cents: overrideOf(z.number().int().min(0)).optional(),
  /** technician/shop_foreman (round-3 #24): beats the computed leave-rate basis. */
  leave_rate_cents_per_hour: overrideOf(z.number().int().min(0)).optional(),
  /** shop_foreman (round-5 #32): beats the auto-derived prior-year shop-hour goal. */
  shop_hour_goal: overrideOf(hoursNum).optional(),
});
export type Overrides = z.infer<typeof OverridesSchema>;

// ── Manual entry (run_employees hour columns) + derived inputs ────────────────

/** DB CHECK parity: hours >= 0 AND <= 120; manual_incentive_cents 0..5,000,000. */
const hoursEntry = z.number().min(0).max(120).nullish();

export const SheetEntriesSchema = z.strictObject({
  /** TOTAL worked clock hours per week (decision #6: OT auto-derived, >40/wk). */
  clock_hours_w1: hoursEntry,
  clock_hours_w2: hoursEntry,
  pto_w1: hoursEntry,
  pto_w2: hoursEntry,
  holiday_w1: hoursEntry,
  holiday_w2: hoursEntry,
  bereavement_w1: hoursEntry,
  bereavement_w2: hoursEntry,
  training_w1: hoursEntry,
  training_w2: hoursEntry,
  /** Support family only; null = no incentive entered (renders "n/a"). */
  manual_incentive_cents: z.number().int().min(0).max(5_000_000).nullish(),
});
export type SheetEntries = z.infer<typeof SheetEntriesSchema>;

/** Tekmetric-derived (or override-effective) inputs a sheet consumes. null/missing = 0
 *  (e.g. non-bonus runs pass no month numbers → bonuses compute to 0). */
export const DerivedInputsSchema = z.strictObject({
  billed_hours_w1: hoursNum.nullish(),
  billed_hours_w2: hoursNum.nullish(),
  month_sales_cents: z.number().int().nullish(),
  month_gp_with_fees_cents: z.number().int().nullish(),
  month_gp_without_fees_cents: z.number().int().nullish(),
  spiff_count: z.number().int().min(0).nullish(),
  shop_hours: hoursNum.nullish(),
  /** shop_foreman hour goal (round-5 #32): the auto-derived prior-year same-month
   *  shop billed hours (override already applied); null → calc falls back to the
   *  legacy pay_config.shop_hour_goal. Ignored by every other family. */
  shop_hour_goal: hoursNum.nullish(),
  shop_hour_goal_source: ShopHourGoalSourceSchema.nullish(),
  /** SA-family sales goal (round-3 #22/#23): the auto-derived prior-year same-month
   *  subtotal (override already applied); null → calc falls back to the legacy
   *  pay_config.sales_goal_cents. Ignored by every other family. */
  sales_goal_cents: z.number().int().nullish(),
  /** technician/shop_foreman leave rate (round-3 #24): the rate PTO/Holiday/
   *  Bereavement hours pay at (Training always pays the base hourly rate);
   *  null → each week's base hourly rate. Ignored by every other family. */
  leave_rate_cents_per_hour: z.number().int().min(0).nullish(),
  leave_rate_source: LeaveRateSourceSchema.nullish(),
});
export type DerivedInputs = z.infer<typeof DerivedInputsSchema>;

// ── SheetComputation — the computed pay sheet (calc.ts output) ────────────────

export const WeekSplitSchema = z.strictObject({
  reg: hoursNum,
  ot: hoursNum,
});
export type WeekSplit = z.infer<typeof WeekSplitSchema>;

/** One week of a sheet. `base_pay_cents` = hourly × reg for hourly families, the
 *  weekly salary for service advisors. Sheet-level components (foreman/SA/OM bonus,
 *  spiff, manual incentive) are NOT in `total_pay_cents` here — callers allocating
 *  run-level pay across weeks (e.g. gp.ts labor proration) decide that themselves. */
export const WeekComputationSchema = z.strictObject({
  reg_hours: hoursNum,
  ot_hours: hoursNum,
  base_pay_cents: z.number().int(),
  ot_pay_cents: z.number().int(),
  billed_hours: hoursNum.nullable(),
  efficiency_hours: hoursNum.nullable(),
  billed_pay_cents: z.number().int().nullable(),
  efficiency_pay_cents: z.number().int().nullable(),
  /** PTO+Hol+Ber+Trn pay for the week at that week's hourly rate; null for salaried. */
  leave_pay_cents: z.number().int().nullable(),
  /** base + OT + billed + efficiency + leave (the week's time-based pay). */
  total_pay_cents: z.number().int(),
});
export type WeekComputation = z.infer<typeof WeekComputationSchema>;

export const SheetComputationSchema = z.strictObject({
  family: FamilySchema,
  week1: WeekComputationSchema,
  week2: WeekComputationSchema,
  // Hours (2dp). total_hours = WORKED hours (reg + OT) — leave hours are separate.
  reg_hours: hoursNum,
  ot_hours: hoursNum,
  total_hours: hoursNum,
  pto_hours: hoursNum,
  holiday_hours: hoursNum,
  bereavement_hours: hoursNum,
  training_hours: hoursNum,
  /** Workbook "Reg Total": base pay + OT pay, both weeks (salary×2 for SAs). */
  reg_total_cents: z.number().int(),
  billed_hours_total: hoursNum.nullable(),
  /** Monthly bonus (foreman cliff / SA tier / office-mgr excess); null where the
   *  family has no bonus concept (technician, support). */
  bonus_cents: z.number().int().nullable(),
  /** shop_foreman only (round-5 #32): the effective hour goal the bonus was judged
   *  against + where it came from (override / prior-year derivation / legacy
   *  pay_config); null for every other family. Defaulted so frozen snapshots
   *  written before the goal derivation existed still parse. */
  shop_hour_goal: hoursNum.nullable().default(null),
  shop_hour_goal_source: ShopHourGoalSourceSchema.nullable().default(null),
  /** SA only: spiff_count × spiff_amount_cents. */
  spiff_cents: z.number().int().nullable(),
  /** Support only: echo of the entry (null = none entered → "n/a"). */
  manual_incentive_cents: z.number().int().nullable(),
  /** Family rollup: tech = billed+efficiency pay (+foreman bonus); SA = spiff+bonus;
   *  office_manager = bonus; support = manual incentive (null treated as 0). */
  incentive_cents: z.number().int(),
  // Leave pay; null for salaried families (hours-only). technician/shop_foreman pay
  // PTO/Hol/Ber at leave_rate_cents_per_hour (round-3 #24) and Training at the base
  // hourly rate; office_manager/support pay all leave at the week's hourly rate.
  pto_pay_cents: z.number().int().nullable(),
  training_pay_cents: z.number().int().nullable(),
  holiday_pay_cents: z.number().int().nullable(),
  bereavement_pay_cents: z.number().int().nullable(),
  /** technician/shop_foreman only (round-3 #24): the rate applied to PTO/Holiday/
   *  Bereavement hours + its provenance; null for every other family AND on the
   *  legacy no-rate-supplied path (leave then pays at each week's hourly rate). */
  leave_rate_cents_per_hour: z.number().int().nullable(),
  leave_rate_source: LeaveRateSourceSchema.nullable(),
  total_pay_cents: z.number().int(),
  /** Technician-family only (the workbook shows them only there); null elsewhere and
   *  null (never Infinity/NaN) on zero denominators. */
  metrics: z.strictObject({
    pay_per_clock_hour_cents: z.number().int().nullable(),
    cost_per_billed_hour_cents: z.number().int().nullable(),
    productivity: z.number().min(0).nullable(),
  }),
});
export type SheetComputation = z.infer<typeof SheetComputationSchema>;

// ── Per-run summary row (requirement #6; built by summary.ts) ─────────────────

export const SummaryRowSchema = z.strictObject({
  employee_id: z.uuid(),
  display_name: z.string(),
  role: RoleSchema,
  family: FamilySchema,
  reg_hours: hoursNum,
  ot_hours: hoursNum,
  reg_pay_cents: z.number().int(),
  ot_pay_cents: z.number().int(),
  billed_hours: hoursNum.nullable(),
  billed_pay_cents: z.number().int().nullable(),
  /** null = "n/a" (support family with no manual incentive entered). */
  incentive_cents: z.number().int().nullable(),
  bonus_cents: z.number().int().nullable(),
  spiff_cents: z.number().int().nullable(),
  pto_hours: hoursNum,
  pto_pay_cents: z.number().int().nullable(),
  training_hours: hoursNum,
  training_pay_cents: z.number().int().nullable(),
  holiday_hours: hoursNum,
  holiday_pay_cents: z.number().int().nullable(),
  bereavement_hours: hoursNum,
  bereavement_pay_cents: z.number().int().nullable(),
  total_pay_cents: z.number().int(),
});
export type SummaryRow = z.infer<typeof SummaryRowSchema>;

// ── Run-level totals block (round-9 decision #46; built by summary.ts) ─────────

/**
 * The run-level TOTALS block (round-9 #46 — replaces the summary table's TOTAL
 * row). Server-computed by summary.ts from the summary rows and stored on the
 * snapshot; the UI renders the totals card ONLY when the block exists — it never
 * computes money client-side. Older frozen snapshots predate the block (the
 * snapshot key is optional), so completed/voided runs from before the feature
 * show a "totals unavailable" note instead.
 *
 * n/a semantics: the nullable pay categories (incentive + the four leave pays)
 * and billed hours are null when EVERY row carried null — rendered "n/a", never
 * $0.00; a null component inside a mixed column counts as 0.
 */
export const RunTotalsSchema = z.strictObject({
  /** Grand total pay across every employee. */
  total_pay_cents: z.number().int(),
  reg_pay_cents: z.number().int(),
  ot_pay_cents: z.number().int(),
  incentive_pay_cents: z.number().int().nullable(),
  pto_pay_cents: z.number().int().nullable(),
  holiday_pay_cents: z.number().int().nullable(),
  bereavement_pay_cents: z.number().int().nullable(),
  training_pay_cents: z.number().int().nullable(),
  reg_hours: hoursNum,
  ot_hours: hoursNum,
  pto_hours: hoursNum,
  holiday_hours: hoursNum,
  bereavement_hours: hoursNum,
  training_hours: hoursNum,
  billed_hours: hoursNum.nullable(),
  /** total_pay ÷ total clock hours (reg + OT); null on a zero denominator. */
  cost_per_clock_hour_cents: z.number().int().nullable(),
  /** Round-9 addendum: total_pay ÷ total billed hours (ALL pay, same numerator as
   *  cost per clock hour); null on zero/absent billed hours. `.default(null)` so
   *  snapshots stored before this key still parse (renders "n/a" until recompute). */
  cost_per_billed_hour_cents: z.number().int().nullable().default(null),
});
export type RunTotals = z.infer<typeof RunTotalsSchema>;

// ── RunSnapshot v1 (written EXACTLY once by qteklink_payroll_complete_run) ─────

/** Settings `payroll.spiff_categories[]` entry (contract §settings). */
export const SpiffCategorySchema = z.strictObject({
  name: z.string(),
  counted: z.boolean(),
  multiplier: z.number().int().min(1).max(9),
  /** ISO timestamp the category was first observed in the mirror. */
  first_seen: z.string(),
  is_new: z.boolean(),
});
export type SpiffCategory = z.infer<typeof SpiffCategorySchema>;

/** Where the Tekmetric-derived numbers came from. Loose on purpose — the derive layer
 *  may add detail without a snapshot version bump. */
export const DerivedProvenanceSchema = z
  .object({
    /** Mirror freshness (max synced_at across the ROs read). */
    as_of: z.string(),
    period_start: z.iso.date(),
    period_end: z.iso.date(),
    bonus_month: z.string().nullable(),
    ro_count: z.number().int().nullable(),
    source: z.string(),
  })
  .loose();
export type DerivedProvenance = z.infer<typeof DerivedProvenanceSchema>;

export const SnapshotEmployeeSchema = z
  .strictObject({
    employee_id: z.uuid(),
    display_name: z.string(),
    role: RoleSchema,
    family: FamilySchema,
    /** The run row's pay_config verbatim (untagged DB shape) — validated per family below. */
    pay_config: z.record(z.string(), z.unknown()),
    entries: SheetEntriesSchema,
    overrides: OverridesSchema,
    /** EFFECTIVE derived inputs the sheet was computed from (override.value already applied). */
    derived: DerivedInputsSchema,
    sheet: SheetComputationSchema,
  })
  .superRefine((emp, ctx) => {
    const res = PAY_CONFIG_SCHEMA_BY_FAMILY[emp.family].safeParse(emp.pay_config);
    if (!res.success) {
      for (const issue of res.error.issues) {
        ctx.addIssue({
          code: "custom",
          message: `pay_config (${emp.family}): ${issue.message}`,
          path: ["pay_config", ...issue.path],
        });
      }
    }
  });
export type SnapshotEmployee = z.infer<typeof SnapshotEmployeeSchema>;

export const SNAPSHOT_VERSION = 1 as const;

export const RunSnapshotSchema = z.strictObject({
  snapshot_version: z.literal(SNAPSHOT_VERSION),
  /** calc.ts CALC_VERSION at completion time — pins which formula set produced the numbers. */
  calc_version: z.number().int().min(1),
  run: z.strictObject({
    run_id: z.uuid(),
    shop_id: z.number().int(),
    period_start: z.iso.date(),
    period_end: z.iso.date(),
    bonus_period: z.boolean(),
    bonus_month: z.iso.date().nullable(),
  }),
  employees: z.array(SnapshotEmployeeSchema),
  summary: z.array(SummaryRowSchema),
  /** Round-9 #46: run-level totals (the totals card). OPTIONAL for backward
   *  compatibility — frozen snapshots completed before the feature lack it and
   *  must keep parsing; the UI renders the card only when present. */
  summary_totals: RunTotalsSchema.optional(),
  derived_provenance: DerivedProvenanceSchema,
  /** The spiff-category set (settings.payroll.spiff_categories) used for spiff counts. */
  spiff_categories: z.array(SpiffCategorySchema),
});
export type RunSnapshot = z.infer<typeof RunSnapshotSchema>;
