/**
 * Eastern-time formatters for user-facing timestamps in the admin app.
 *
 * Why: Server Components render on Vercel's Node runtime (TZ=UTC by default),
 * so `.toLocaleString()` there shows UTC strings instead of shop-local time.
 * Client Components render in browser-local — also wrong if the operator is
 * outside Eastern. This forces every timestamp display to the shop's zone
 * regardless of render context.
 *
 * Hydration-safe: the `timeZone` is pinned in the formatter (NOT inherited
 * from the runtime), so server-rendered HTML and client hydration produce
 * IDENTICAL strings. No React #418 mismatch risk.
 *
 * DST is handled automatically via the IANA zone `America/New_York` — it
 * resolves to EDT (UTC-4) March–November and EST (UTC-5) the rest of the
 * year. No manual flip needed.
 */
const fmtDateTime = new Intl.DateTimeFormat("en-US", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/New_York",
});

const fmtDateOnly = new Intl.DateTimeFormat("en-US", {
  dateStyle: "short",
  timeZone: "America/New_York",
});

const fmtDateTimeLong = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/New_York",
});

/** "12/25/24, 3:30 PM" (short date + short time, ET). */
export function formatEastern(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  return fmtDateTime.format(d);
}

/** "12/25/24" (date only, ET). Use for date-only column displays like the
 * capacity calendar strip where the underlying value is a DATE (no time). */
export function formatEasternDate(
  input: string | Date | null | undefined,
): string {
  if (!input) return "—";
  // For YYYY-MM-DD strings (Postgres DATE), parse them as ET-local rather
  // than UTC-midnight so "May 27" stays "May 27" in ET (otherwise an ISO
  // date string parsed at UTC midnight renders as the day before in ET).
  let d: Date;
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    // Naive-date string — pin to noon ET-equivalent (16:00 UTC during EST,
    // 17:00 UTC during EDT — using 17:00 UTC is safe year-round since it's
    // mid-day ET in both zones).
    d = new Date(`${input}T17:00:00Z`);
  } else {
    d = typeof input === "string" ? new Date(input) : input;
  }
  if (Number.isNaN(d.getTime())) return "—";
  return fmtDateOnly.format(d);
}

/** "Dec 25, 2024, 3:30 PM" (medium date + short time, ET). Use when the
 * value could span a wide range (e.g., the 30-day revert window) and
 * the year matters for disambiguation. */
export function formatEasternLong(
  input: string | Date | null | undefined,
): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  return fmtDateTimeLong.format(d);
}
