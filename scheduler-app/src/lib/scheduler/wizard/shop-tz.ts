/**
 * shop-tz — Vercel-side helpers for converting shop-local wall-clock
 * date+time values to TIMESTAMPTZ-compatible ISO strings.
 *
 * Created 2026-05-16 per the R6 pattern-extension audit: the same
 * hardcoded "-04:00" DST bug fixed in the edge-fn helper
 * (scheduler-slots.ts shopLocalToIsoString) was also present in the
 * Vercel-side card-data builders at:
 *   - build-summary-data.ts:255 (summary starts_at ISO)
 *   - get-current-card.ts:1303  (buildAppointmentLabel display string)
 *
 * Centralizing here so the next Vercel-side caller writes one line
 * instead of re-introducing the same offset string.
 *
 * Mechanics: probe Intl.DateTimeFormat with timeZone "America/New_York"
 * at 12:00 UTC on the target date (which is 7-8 AM shop-local — far
 * from any DST transition window) and read the longOffset value
 * ("GMT-04:00" in EDT, "GMT-05:00" in EST). Strip the "GMT" prefix to
 * build a TIMESTAMPTZ-compatible ISO suffix.
 *
 * Returns the wall-clock ISO `${date}T${HH:MM}:00${offset}` so
 * `new Date()` of the result resolves to the correct UTC instant.
 */

const SHOP_TIMEZONE = "America/New_York";

/**
 * Convert shop-local date+time to an ISO string with the correct
 * UTC offset for THAT specific date.
 *
 * @param date — "YYYY-MM-DD" (shop-local calendar date)
 * @param timeHHMM — "HH:MM" 24-hour zero-padded (shop-local wall time)
 * @returns "YYYY-MM-DDTHH:MM:00±HH:MM"
 */
export function shopLocalToIsoString(
  date: string,
  timeHHMM: string,
): string {
  const probe = new Date(`${date}T12:00:00Z`);
  const tzName =
    new Intl.DateTimeFormat("en-US", {
      timeZone: SHOP_TIMEZONE,
      timeZoneName: "longOffset",
    })
      .formatToParts(probe)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT-05:00";
  // tzName: "GMT-04:00" (EDT) or "GMT-05:00" (EST). Strip "GMT" prefix.
  const offset = tzName.replace(/^GMT/, "") || "-05:00";
  return `${date}T${timeHHMM}:00${offset}`;
}
