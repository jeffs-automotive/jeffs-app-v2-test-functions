/**
 * Tiny pure formatters/date helpers shared by the approval-dashboard UI. Money is integer
 * CENTS everywhere in the data model; these render it for display only. Dates are ISO
 * shop-local `YYYY-MM-DD` strings — `addDaysIso` does UTC-midnight math so it never shifts
 * across the local tz (the date is already shop-local; we only step the calendar).
 */
/** Internal — only fmtUsd consumes it (cents → "10,667.65"). */
function fmtCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtUsd(cents: number): string {
  return `$${fmtCents(cents)}`;
}

/** A strict ISO shop-local date — `YYYY-MM-DD` that is also a real calendar date. */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s;
}

/** Step an ISO date by ±N calendar days (UTC-midnight math; no tz shift). */
export function addDaysIso(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}
