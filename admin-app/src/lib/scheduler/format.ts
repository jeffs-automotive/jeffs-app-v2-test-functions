/**
 * Deterministic date/time formatters for the schedulerconfig surface.
 *
 * Why not `Date.toLocaleString()`: server-side (Node) and client-side (browser)
 * use DIFFERENT default locales + timezones, so the rendered text differs
 * between SSR and hydration. React 19 flags this as hydration mismatch
 * (error #418), which in turn breaks Next.js's prefetch + click navigation
 * (the dashboard card → schedulerconfig link silently fails because the
 * prefetch render errors out).
 *
 * Fix: render every timestamp in UTC with an explicit suffix so it's
 * unambiguous + identical between server and client. Admin tooling reading
 * audit logs should be reading UTC anyway.
 *
 * Format: `May 26 22:00 UTC` (compact, no year — the audit log filter
 * window is already short).
 */

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Render an ISO timestamp string (or Date) as `Mon DD HH:MM UTC`.
 * Pure function; deterministic. Safe to call from both Server Components
 * and Client Components — the result is identical, so no hydration mismatch.
 */
export function formatUtcShort(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  const month = MONTH_ABBR[d.getUTCMonth()];
  const day = pad2(d.getUTCDate());
  const hour = pad2(d.getUTCHours());
  const min = pad2(d.getUTCMinutes());
  return `${month} ${day} ${hour}:${min} UTC`;
}

/**
 * Same as above but includes the year — for contexts where the row could
 * be older (e.g., the lost-update warning banner that may show audit rows
 * from across the 30-day window).
 */
export function formatUtcLong(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  const year = d.getUTCFullYear();
  const month = MONTH_ABBR[d.getUTCMonth()];
  const day = pad2(d.getUTCDate());
  const hour = pad2(d.getUTCHours());
  const min = pad2(d.getUTCMinutes());
  return `${month} ${day} ${year} ${hour}:${min} UTC`;
}
