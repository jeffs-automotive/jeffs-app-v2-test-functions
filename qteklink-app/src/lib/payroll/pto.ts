/**
 * PTO accrual engine — PURE functions, no I/O (plan §3 of
 * docs/qteklink/payroll-pto-employee-mgmt-plan-2026-07-12.md; Round-11 decisions
 * #54–#57/#60 in docs/qteklink/payroll-workbook-extraction-2026-07-10.md). Plain
 * data in (employee fields, settings slice, run period, ledger entries, snapshot
 * PTO hours), ledger-entry payloads + warnings out — the DAL threads the payloads
 * into the completion RPC (plan §4), which owns balance stamping, the shop ledger
 * lock, and every idempotency guard. NO money in this module; hours are 2dp via
 * calc.ts's round2 idiom.
 *
 * The never-RAISE contract (C14 — completion must work on payday regardless of
 * setup order): every unconfigured/partial state degrades to "no accrual" —
 * tiers absent/empty ⇒ 0 accrual and no rows; NULL start_date and not
 * grandfathered ⇒ ineligible; grandfathered with NO dates at all ⇒ no accrual
 * plus a non-blocking warning in the return. Never a throw.
 *
 * Eligibility (C35) is pure anchor-cadence calendar math, independent of which
 * run rows exist: P0 = the first cadence period_start ≥ start_date (cadence =
 * anchor + 14n, the same arithmetic create_run validates); eligible on a run iff
 * run.period_start ≥ P0 + 84 days — their 7th FULL period (decision #55: a
 * partial hire period never counts). Voided runs, gaps, and out-of-order
 * backfills cannot shift eligibility. `pto_grandfathered` waives the wait and
 * only matters for employees the calendar math has not yet cleared.
 *
 * Gates differ (C37): archive/termination gate ACCRUAL only — a `usage` entry is
 * emitted for EVERY employee with paid PTO hours in the frozen snapshot, archived
 * or terminated included (they are paid; the ledger must decrement to match).
 * `termination_date < period_start` ⇒ no accrual; unarchive clears the date
 * server-side (plan §2a), so a rehire accrues again.
 *
 * Rollover (C33; N13 — the boundary is year(period_end), the #57 pay-date
 * convention, NOT derived from bonus_month): forfeit is a pure, order-independent
 * function of (ledger history, boundary year Y, cap) — carryover(Y) sums entries
 * attributable before Jan 1 of Y (run-linked entries bucket by their run's
 * period_end year; initial/adjustment by created_at); forfeit =
 * max(0, carryover(Y) − cap). The CALLER decides whether to apply it — the
 * at-most-once (employee, Y) check lives in the completion RPC's transaction.
 * No ledger history before Y ⇒ no forfeit (mid-year go-live seeds survive to the
 * first real boundary).
 */
import { round2 } from "./calc";

/** 6 full 14-day cadence periods (decision #55) — accrual starts on the 7th. */
export const PTO_WAIT_DAYS = 84;

const MS_PER_DAY = 86_400_000;

const dateMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const msToIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

// ── Input shapes (plain data — snake_case matches the DB/settings keys) ────────

/** One `pto_tenure_tiers` settings entry (plan §2d). */
export interface PtoTenureTier {
  min_years: number;
  hours_per_period: number;
}

/** The settings slice the engine consumes (plan §2d top-level payroll keys +
 *  the existing anchor). Every field tolerates the unconfigured state (C14). */
export interface PtoSettingsSlice {
  anchor_period_start: string | null;
  pto_tenure_tiers: readonly PtoTenureTier[] | null | undefined;
  /** null/undefined = unlimited carryover (no forfeits ever). */
  pto_rollover_cap_hours: number | null | undefined;
}

/** The employee columns the engine reads (plan §2a). */
export interface PtoEmployeeFields {
  employee_id: string;
  display_name: string;
  archived: boolean;
  /** Tenure anchor (ISO date). NULL + not grandfathered ⇒ ineligible. */
  start_date: string | null;
  /** Set by the archive modal; cleared on unarchive (plan §2a). */
  termination_date: string | null;
  /** Waives the 6-full-period wait (decision #55). */
  pto_grandfathered: boolean;
  /** Overrides start_date for TIER lookup ONLY (acquired-company seniority). */
  pto_tenure_credit_date: string | null;
}

export interface PtoRunPeriod {
  period_start: string;
  period_end: string;
}

/** A ledger entry as the rollover carryover consumes it: signed hours + the
 *  attribution bucket — run-linked entries (accrual/usage/void_reversal, incl.
 *  reversals carrying the VOIDED run's linkage) supply their run's period_end;
 *  initial/adjustment entries supply created_at (ISO timestamp). */
export interface PtoLedgerEntryForRollover {
  hours: number;
  run_period_end: string | null;
  created_at: string;
}

// ── Output shapes ──────────────────────────────────────────────────────────────

export type PtoWarningCode = "grandfathered_no_dates";

/** Non-blocking completion-result warning (C14 — never a RAISE). */
export interface PtoWarning {
  employee_id: string;
  code: PtoWarningCode;
  message: string;
}

/** A run-driven ledger-entry payload (rides into the completion RPC as
 *  p_pto_entries — plan §4). Hours are SIGNED 2dp: accrual +, usage −,
 *  rollover_forfeit − (with its boundary_year). */
export interface PtoRunLedgerEntry {
  employee_id: string;
  kind: "accrual" | "usage" | "rollover_forfeit";
  hours: number;
  boundary_year: number | null;
}

export interface PtoAccrualResult {
  /** True iff this employee ACCRUES on this run: past the wait (or
   *  grandfathered) AND not gated by archive/termination. Usage is never
   *  gated by this flag (C37). */
  eligible: boolean;
  /** ≥ 0, 2dp. 0 when ineligible, tiers unconfigured, or no tier matches. */
  accrual_hours: number;
  warnings: PtoWarning[];
}

// ── Eligibility (C35 — pure anchor-cadence calendar math) ──────────────────────

/** The first cadence period_start (anchor + 14n, n any integer) ≥ `date`. */
export function firstCadencePeriodStartOnOrAfter(anchorPeriodStart: string, date: string): string {
  const anchorMs = dateMs(anchorPeriodStart);
  const diffDays = Math.round((dateMs(date) - anchorMs) / MS_PER_DAY);
  const n = Math.ceil(diffDays / 14);
  return msToIso(anchorMs + n * 14 * MS_PER_DAY);
}

/** P0 + 84 days — the period_start of the employee's 7th full cadence period,
 *  the first run they accrue on (decision #55). */
export function firstAccrualPeriodStart(anchorPeriodStart: string, startDate: string): string {
  const p0 = firstCadencePeriodStartOnOrAfter(anchorPeriodStart, startDate);
  return msToIso(dateMs(p0) + PTO_WAIT_DAYS * MS_PER_DAY);
}

// ── Tenure tiers (decision #56) ────────────────────────────────────────────────

/** Whole years of service between `basisDate` and `at` (anniversary-based;
 *  negative when the basis is in the future — no tier will match). */
export function yearsOfServiceAt(basisDate: string, at: string): number {
  const from = new Date(dateMs(basisDate));
  const to = new Date(dateMs(at));
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const anniversaryNotReached =
    to.getUTCMonth() < from.getUTCMonth() ||
    (to.getUTCMonth() === from.getUTCMonth() && to.getUTCDate() < from.getUTCDate());
  if (anniversaryNotReached) years -= 1;
  return years;
}

/** Rate = the greatest `min_years ≤ years` tier's hours (2dp). Order-agnostic;
 *  absent/empty tiers or no matching tier ⇒ 0 — never a throw (C14). */
export function tierHoursForYears(
  tiers: readonly PtoTenureTier[] | null | undefined,
  years: number,
): number {
  let best: PtoTenureTier | null = null;
  for (const tier of tiers ?? []) {
    if (tier.min_years <= years && (best === null || tier.min_years > best.min_years)) best = tier;
  }
  return best === null ? 0 : round2(best.hours_per_period);
}

// ── Accrual (decisions #54/#55/#56; gates per C37) ─────────────────────────────

/**
 * One employee's accrual for the run starting `periodStart`. Never throws:
 * every partial-configuration state degrades to `accrual_hours: 0` (C14).
 * The tenure BASIS is `pto_tenure_credit_date ?? start_date` — the credit date
 * shifts the tier lookup only, never eligibility. The new tier rate lands on the
 * first pay period whose period_start is on/after the anniversary (#56).
 */
export function computeAccrual(
  employee: PtoEmployeeFields,
  settings: PtoSettingsSlice,
  periodStart: string,
): PtoAccrualResult {
  const none = (eligible: boolean, warnings: PtoWarning[] = []): PtoAccrualResult => ({
    eligible,
    accrual_hours: 0,
    warnings,
  });
  // Accrual-only gates (C37): archived, or terminated before this period.
  // ISO dates compare lexicographically; termination ON period_start still
  // accrues (the employee worked into the period).
  if (employee.archived) return none(false);
  if (employee.termination_date !== null && employee.termination_date < periodStart) {
    return none(false);
  }
  // The wait: grandfather waives it; otherwise pure calendar math off the anchor.
  let eligible: boolean;
  if (employee.pto_grandfathered) {
    eligible = true;
  } else if (employee.start_date === null || settings.anchor_period_start === null) {
    eligible = false; // unconfigured ⇒ ineligible, no row, no warning (C14)
  } else {
    eligible =
      periodStart >= firstAccrualPeriodStart(settings.anchor_period_start, employee.start_date);
  }
  if (!eligible) return none(false);
  const basis = employee.pto_tenure_credit_date ?? employee.start_date;
  if (basis === null) {
    // Grandfathered with NO dates: eligible but tenure is uncomputable — no
    // accrual + a non-blocking warning in the completion result (C14).
    return none(true, [
      {
        employee_id: employee.employee_id,
        code: "grandfathered_no_dates",
        message: `${employee.display_name}: grandfathered but has no start date or tenure-credit date — PTO accrual skipped`,
      },
    ]);
  }
  const accrual = tierHoursForYears(settings.pto_tenure_tiers, yearsOfServiceAt(basis, periodStart));
  return { eligible: true, accrual_hours: accrual, warnings: [] };
}

// ── Rollover (decision #57; C33 order-independent; N13 not bonus_month) ────────

/** The boundary a run can trigger: the calendar year its period END lands in
 *  (#57 pay-date convention). Same value for every year-Y run — the at-most-once
 *  (employee, Y) guard is the RPC's job. */
export function rolloverBoundaryYear(periodEnd: string): number {
  return Number(periodEnd.slice(0, 4));
}

/** Which calendar year a ledger entry is attributable to (C33 bucketing):
 *  run-linked entries by their run's period_end year; others by created_at. */
export function attributionYear(entry: PtoLedgerEntryForRollover): number {
  return Number((entry.run_period_end ?? entry.created_at).slice(0, 4));
}

/** carryover(Y) = Σ hours of entries attributable before Jan 1 of Y (2dp), or
 *  null when NO entry attributes before Y — "no history" is distinct from a
 *  zero balance (mid-year go-live must never forfeit, C33). */
export function carryoverHours(
  entries: readonly PtoLedgerEntryForRollover[],
  boundaryYear: number,
): number | null {
  let sum: number | null = null;
  for (const entry of entries) {
    if (attributionYear(entry) < boundaryYear) sum = (sum ?? 0) + entry.hours;
  }
  return sum === null ? null : round2(sum);
}

/** forfeit = max(0, carryover(Y) − cap), 2dp. 0 when the cap is null/undefined
 *  (unlimited) or there is no history before Y. Pure — the caller decides
 *  whether to apply it (the RPC enforces at-most-once per (employee, Y)). */
export function rolloverForfeitHours(
  entries: readonly PtoLedgerEntryForRollover[],
  boundaryYear: number,
  capHours: number | null | undefined,
): number {
  if (capHours === null || capHours === undefined) return 0;
  const carryover = carryoverHours(entries, boundaryYear);
  if (carryover === null) return 0;
  return round2(Math.max(0, carryover - capHours));
}

// ── Projection (plan §3 dry run) ───────────────────────────────────────────────

/** Projected balance = current balance + accrual − entered PTO hours (2dp). */
export function projectPtoBalance(
  currentBalanceHours: number,
  accrualHours: number,
  enteredPtoHours: number,
): number {
  return round2(currentBalanceHours + accrualHours - enteredPtoHours);
}

// ── Per-employee run assembly (the p_pto_entries payload builder) ──────────────

export interface EmployeePtoInput {
  employee: PtoEmployeeFields;
  /** The employee's paid PTO hours from the FROZEN snapshot (sheet.pto_hours). */
  snapshot_pto_hours: number;
  /** The employee's full ledger history (for the rollover carryover). */
  ledger_entries: readonly PtoLedgerEntryForRollover[];
}

export interface EmployeePtoComputation {
  employee_id: string;
  /** See {@link PtoAccrualResult.eligible} — accrual gate only, never usage. */
  eligible: boolean;
  accrual_hours: number;
  /** Positive magnitude of the usage decrement (0 = no usage row). */
  usage_hours: number;
  /** Positive magnitude of the forfeit (0 = no forfeit row). */
  rollover_forfeit_hours: number;
  boundary_year: number;
  /** Ledger payloads in write order: accrual (+), usage (−), forfeit (−). */
  entries: PtoRunLedgerEntry[];
  warnings: PtoWarning[];
}

/**
 * Assemble one employee's run-driven ledger payloads for a completing run:
 * accrual per {@link computeAccrual}; a usage entry for ANY paid PTO hours in
 * the snapshot regardless of archive/termination/eligibility (C37); a
 * rollover_forfeit candidate for Y = year(period_end) when the capped carryover
 * demands one (the caller applies it only if no un-reversed (employee, Y)
 * forfeit exists — checked in-transaction, plan §2b). Zero-hour rows are never
 * emitted, so zero PTO configuration ⇒ zero rows ⇒ completion behaves exactly
 * as today (C14).
 */
export function buildEmployeeRunPtoEntries(
  input: EmployeePtoInput,
  settings: PtoSettingsSlice,
  run: PtoRunPeriod,
): EmployeePtoComputation {
  const employeeId = input.employee.employee_id;
  const accrual = computeAccrual(input.employee, settings, run.period_start);
  const usageHours = round2(Math.max(0, input.snapshot_pto_hours));
  const boundaryYear = rolloverBoundaryYear(run.period_end);
  const forfeitHours = rolloverForfeitHours(
    input.ledger_entries,
    boundaryYear,
    settings.pto_rollover_cap_hours,
  );
  const entries: PtoRunLedgerEntry[] = [];
  if (accrual.accrual_hours > 0) {
    entries.push({ employee_id: employeeId, kind: "accrual", hours: accrual.accrual_hours, boundary_year: null });
  }
  if (usageHours > 0) {
    entries.push({ employee_id: employeeId, kind: "usage", hours: round2(-usageHours), boundary_year: null });
  }
  if (forfeitHours > 0) {
    entries.push({
      employee_id: employeeId,
      kind: "rollover_forfeit",
      hours: round2(-forfeitHours),
      boundary_year: boundaryYear,
    });
  }
  return {
    employee_id: employeeId,
    eligible: accrual.eligible,
    accrual_hours: accrual.accrual_hours,
    usage_hours: usageHours,
    rollover_forfeit_hours: forfeitHours,
    boundary_year: boundaryYear,
    entries,
    warnings: accrual.warnings,
  };
}
