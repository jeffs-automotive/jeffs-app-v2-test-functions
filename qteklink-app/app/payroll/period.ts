/**
 * Pure period helpers for the /payroll dashboard — bi-weekly cadence math + the
 * period-range label. Page-local (app/payroll/), presentational/derivation only:
 * the create-run RPC re-validates cadence server-side; this only computes the
 * NEXT on-cadence period to offer in the "Start new payroll run" affordance.
 */
import { addDaysIso, isIsoDate } from "@/lib/format";

export const PERIOD_DAYS = 14;

/** "6/28" from "2026-06-28" — pure string math, no timezone involvement. */
export function fmtMonthDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/** "6/28 – 7/11" for a run's period columns/labels. */
export function fmtPeriodRange(startIso: string, endIso: string): string {
  return `${fmtMonthDay(startIso)} – ${fmtMonthDay(endIso)}`;
}

/**
 * The next on-cadence bi-weekly period start:
 *   - with prior runs: the latest NON-VOIDED run's period_start + 14 (payroll is
 *     sequential — a voided run's period is re-covered by its open clone, which
 *     shares the same period_start);
 *   - fresh install: the on-cadence period containing today (the anchor itself
 *     when the anchor is still in the future);
 *   - null when the anchor is unset/invalid — the affordance must disable and
 *     point at /payroll/settings.
 */
export function nextOnCadencePeriodStart(
  anchorPeriodStart: string | null,
  latestNonVoidedPeriodStart: string | null,
  todayIso: string,
): string | null {
  if (anchorPeriodStart === null || !isIsoDate(anchorPeriodStart)) return null;
  if (latestNonVoidedPeriodStart !== null) {
    return addDaysIso(latestNonVoidedPeriodStart, PERIOD_DAYS);
  }
  const anchorMs = Date.parse(`${anchorPeriodStart}T00:00:00Z`);
  const todayMs = Date.parse(`${todayIso}T00:00:00Z`);
  if (!Number.isFinite(todayMs) || todayMs <= anchorMs) return anchorPeriodStart;
  const periodsElapsed = Math.floor((todayMs - anchorMs) / (PERIOD_DAYS * 86_400_000));
  return addDaysIso(anchorPeriodStart, periodsElapsed * PERIOD_DAYS);
}

/** Today as an ISO date (UTC calendar day — only used to pick the suggested period). */
export function todayIsoUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
