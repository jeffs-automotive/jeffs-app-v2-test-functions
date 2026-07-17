/** Pure formatting helpers for the back-office UI + digest. Unit-tested. */

export function centsToUsd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days since an ISO timestamp (clamped at 0). */
export function daysSince(iso: string | null | undefined, nowMs: number = Date.now()): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((nowMs - t) / DAY_MS));
}

/** True when an issue has been idle longer than the stale threshold (hours). */
export function isStale(lastActivityIso: string | null | undefined, staleHours: number, nowMs: number = Date.now()): boolean {
  if (!lastActivityIso) return false;
  const t = new Date(lastActivityIso).getTime();
  if (Number.isNaN(t)) return false;
  return nowMs - t > staleHours * 60 * 60 * 1000;
}

/** First day of the current month in the shop timezone, as YYYY-MM-DD (for the counts RPC). */
export function monthStartYmd(tz: string, nowMs: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(nowMs));
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}-01`;
}
